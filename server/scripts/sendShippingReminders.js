#!/usr/bin/env node
/**
 * Shipping Reminder SMS Script
 * 
 * Sends three types of outbound shipping reminders:
 * 1. 24-hour "ship by tomorrow" reminder
 * 2. End-of-day "not scanned yet" alert
 * 3. 48-hour "auto-cancel" flow for unshipped items
 * 
 * CRON SCHEDULING (Render/Heroku):
 * Run every 15 minutes: *\/15 * * * * node server/scripts/sendShippingReminders.js
 * 
 * For testing:
 * npm run test:shipping-reminders
 */
require('dotenv').config();

let sendSMS = null;
try {
  const smsModule = require('../api-util/sendSMS');
  sendSMS = smsModule.sendSMS;
} catch (error) {
  console.warn('⚠️ SMS module not available — SMS functionality disabled');
  sendSMS = () => Promise.resolve();
}

// ✅ Use centralized SDK factory (same pattern as sendReturnReminders.js)
// getFlexSdk() automatically uses Integration SDK when INTEGRATION_CLIENT_ID/SECRET are set
const getFlexSdk = require('../util/getFlexSdk');
const { shortLink } = require('../api-util/shortlink');
const { withinSendWindow } = require('../util/time');
const { computeShipByDate, formatShipBy } = require('../lib/shipping');
const { getRedis } = require('../redis');

// ──────────────────────────────────────────────────────────────────────────
// Redis-backed idempotency (replaces protectedData.shippingReminders flags).
// The Integration SDK does not expose sdk.transactions.update, so any write
// to protectedData silently fails → same SMS re-sent on every cron tick.
// Keys per transaction, per phase:
//   shippingReminder:{txId}:24h:sent     (TTL 7 days)
//   shippingReminder:{txId}:eod:sent     (TTL 7 days)
//   shippingReminder:{txId}:cancel:sent  (TTL 7 days)
//   shippingReminder:{txId}:{phase}:inFlight  (TTL 10 min)
// ──────────────────────────────────────────────────────────────────────────
const SENT_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const INFLIGHT_TTL_SEC = 10 * 60; // 10 min — longer than any single send
const redisKey = (txId, phase, suffix) => `shippingReminder:${txId}:${phase}:${suffix}`;

async function isSent(redis, txId, phase) {
  try { return !!(await redis.get(redisKey(txId, phase, 'sent'))); } catch { return false; }
}
async function isInFlight(redis, txId, phase) {
  try { return !!(await redis.get(redisKey(txId, phase, 'inFlight'))); } catch { return false; }
}
async function markInFlight(redis, txId, phase) {
  if (DRY) {
    console.log(`[shipping-reminder] DRY-RUN: Would SET ${redisKey(txId, phase, 'inFlight')} (TTL ${INFLIGHT_TTL_SEC}s)`);
    return;
  }
  await redis.set(redisKey(txId, phase, 'inFlight'), new Date().toISOString(), 'EX', INFLIGHT_TTL_SEC);
}
async function clearInFlight(redis, txId, phase) {
  if (DRY) return;
  try { await redis.del(redisKey(txId, phase, 'inFlight')); } catch {}
}
async function markSent(redis, txId, phase) {
  if (DRY) {
    console.log(`[shipping-reminder] DRY-RUN: Would SET ${redisKey(txId, phase, 'sent')} (TTL ${SENT_TTL_SEC}s)`);
    return;
  }
  await redis.set(redisKey(txId, phase, 'sent'), new Date().toISOString(), 'EX', SENT_TTL_SEC);
  try { await redis.del(redisKey(txId, phase, 'inFlight')); } catch {}
}

// ---- CLI flags / env guards ----
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const getOpt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const DRY = has('--dry-run') || process.env.DRY_RUN === '1' || process.env.SMS_DRY_RUN === '1';
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const LIMIT = parseInt(getOpt('--limit', process.env.LIMIT || '0'), 10) || 0;
const ONLY_PHONE = process.env.ONLY_PHONE; // e.g. +15551234567 for targeted test

if (DRY) {
  const realSend = sendSMS;
  sendSMS = async (to, body, opts = {}) => {
    const { tag, meta } = opts;
    const metaJson = meta ? JSON.stringify(meta) : '{}';
    const bodyJson = JSON.stringify(body);
    console.log(`[SMS:OUT] tag=${tag || 'none'} to=${to} meta=${metaJson} body=${bodyJson} dry-run=true`);
    if (VERBOSE) console.log('opts:', opts);
    return { dryRun: true };
  };
}

/**
 * Check if outbound shipment has been scanned by carrier
 * Uses the same logic as the webhook handler
 * @param {Object} protectedData - Transaction protectedData
 * @param {Object} metadata - Transaction metadata
 * @returns {boolean} True if package has been scanned/accepted by carrier
 */
function isOutboundScanned(protectedData, metadata) {
  const outbound = protectedData?.outbound || {};
  
  // Method 1: Check for firstScanAt timestamp (set by webhook)
  if (outbound.firstScanAt) {
    return true;
  }
  
  // Method 2: Check tracking status in metadata or protectedData
  const trackingStatus = metadata?.tracking?.status || 
                        outbound.trackingStatus || 
                        outbound.status;
  
  if (trackingStatus) {
    const upperStatus = trackingStatus.toUpperCase();
    const firstScanStatuses = ['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE'];
    if (firstScanStatuses.includes(upperStatus)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get shipBy date from transaction
 * Priority: metadata.shipBy → protectedData.outbound.shipByDate → computed
 */
async function getShipByDate(tx) {
  const metadata = tx?.attributes?.metadata || {};
  const protectedData = tx?.attributes?.protectedData || {};
  const outbound = protectedData.outbound || {};
  
  // Try metadata first (from transition/accept)
  if (metadata.shipBy) {
    const date = new Date(metadata.shipBy);
    if (!Number.isNaN(+date)) {
      return date;
    }
  }
  
  // Try protectedData
  if (outbound.shipByDate) {
    const date = new Date(outbound.shipByDate);
    if (!Number.isNaN(+date)) {
      return date;
    }
  }
  
  // Fallback to computed shipBy date
  return await computeShipByDate(tx);
}

/**
 * Get outbound label URL from transaction
 * Checks multiple locations for backward compatibility
 */
function getOutboundLabelUrl(tx) {
  const metadata = tx?.attributes?.metadata || {};
  const protectedData = tx?.attributes?.protectedData || {};
  const outbound = protectedData.outbound || {};
  
  // Priority order:
  // 1. metadata.labelUrl (from transition/accept)
  // 2. outbound.labelUrl
  // 3. outbound.qrCodeUrl (for UPS QR codes)
  // 4. protectedData.outboundLabelUrl (legacy)
  
  return metadata.labelUrl ||
         outbound.labelUrl ||
         outbound.qrCodeUrl ||
         protectedData.outboundLabelUrl ||
         null;
}

/**
 * Format date for SMS display (e.g., "Jan 15")
 */
function formatDateForSMS(date) {
  if (!date) return null;
  try {
    return formatShipBy(date);
  } catch {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Check if we're at the end of the ship-by date (23:50 UTC or later)
 * Uses UTC for consistency and is robust to 15-minute cron intervals
 */
function isEndOfShipByDay(shipByDate) {
  if (!shipByDate) return false;

  const now = new Date();
  const shipBy = new Date(shipByDate);

  // Normalize to UTC midnight for date-only comparison
  shipBy.setUTCHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  // Must be the ship-by date
  if (shipBy.getTime() !== today.getTime()) {
    return false;
  }

  // "End of day" window: 22:00 UTC onward on the ship-by date.
  // - 22:00 UTC = 6pm EDT / 3pm PDT, late enough in a US workday that a
  //   lender who hasn't scanned the label by now isn't likely to today.
  // - Wide window (2+ hours) is cron-proof: with an hourly on-the-hour
  //   cron, at least two ticks (22:00, 23:00) fall inside the window.
  // - Redis :eod:sent idempotency guarantees only one SMS per tx per day
  //   regardless of how many ticks hit the window.
  return now.getUTCHours() >= 22;
}

/**
 * Cancel a transaction via Sharetribe API
 * Uses transition/cancel which requires operator role
 * Respects DRY mode - will not actually cancel in dry-run mode
 */
async function cancelTransaction(txId, integrationSdk) {
  if (DRY) {
    console.log('[shipping-reminder] DRY-RUN: Would cancel transaction', txId);
    return { success: true, dryRun: true };
  }
  
  try {
    console.log('[shipping-reminder] Attempting to cancel transaction', txId);
    
    const response = await integrationSdk.transactions.transition({
      id: txId,
      transition: 'transition/cancel',
      params: {}
    });
    
    console.log('[shipping-reminder] Transaction canceled successfully', txId);
    return { success: true, transaction: response?.data?.data };
  } catch (error) {
    console.error('[shipping-reminder] Failed to cancel transaction', txId, error.message);
    
    // Check if transaction is already canceled or in invalid state
    if (error.response?.status === 400 || error.response?.status === 409) {
      console.log('[shipping-reminder] Transaction may already be canceled or in invalid state');
      return { success: false, error: 'invalid_state' };
    }
    
    return { success: false, error: error.message };
  }
}

async function sendShippingReminders() {
  console.log('[shipping-reminder] Starting shipping reminder SMS script...');
  
  try {
    // Initialize SDK using centralized helper (same pattern as sendReturnReminders.js)
    // getFlexSdk() automatically uses Integration SDK when INTEGRATION_CLIENT_ID/SECRET are set
    const sdk = getFlexSdk();
    const redis = getRedis();

    // Log Integration SDK configuration (non-secret)
    const integrationClientId = process.env.INTEGRATION_CLIENT_ID || 'MISSING';
    const integrationBaseUrl =
      process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL ||
      process.env.SHARETRIBE_SDK_BASE_URL ||
      process.env.FLEX_INTEGRATION_API_BASE_URL ||
      'MISSING';
    
    console.log('[shipping-reminder] Integration env summary', {
      hasClientId: !!integrationClientId && integrationClientId !== 'MISSING',
      integrationClientIdPrefix: integrationClientId !== 'MISSING' ? integrationClientId.slice(0, 6) : null,
      integrationBaseUrl,
    });
    
    console.log('[shipping-reminder] SDKs initialized');
    
    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    
    // Query all accepted transactions (outbound shipping)
    const query = {
      state: 'accepted',
      include: ['listing', 'provider', 'customer'],
      'fields.listing': 'title',
      'fields.provider': 'profile',
      'fields.customer': 'profile',
      per_page: 100
    };
    
    let transactions, included;
    try {
      const response = await sdk.transactions.query(query);
      transactions = response?.data?.data || [];
      included = new Map();
      for (const inc of response?.data?.included || []) {
        const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
        included.set(key, inc);
      }
    } catch (queryError) {
      // Detailed error logging for 403 debugging
      console.error('[shipping-reminder] Flex query failed', {
        status: queryError.response && queryError.response.status,
        data: queryError.response && queryError.response.data,
        headers: queryError.response && queryError.response.headers && {
          'x-sharetribe-request-id': queryError.response.headers['x-sharetribe-request-id'],
        },
        message: queryError.message,
        code: queryError.code,
      });
      throw queryError;
    }
    
    console.log(`[shipping-reminder] Found ${transactions.length} accepted transactions`);
    
    let sent24h = 0, sentEndOfDay = 0, sentCancel = 0, failed = 0, processed = 0;
    
    for (const tx of transactions) {
      processed++;
      
      const txId = tx?.id?.uuid || tx?.id;
      const protectedData = tx?.attributes?.protectedData || {};
      const metadata = tx?.attributes?.metadata || {};
      const outbound = protectedData.outbound || {};
      
      // CRITICAL: Only process OUTBOUND shipments (provider → customer)
      // Skip return-only transactions by checking for outbound label/tracking presence
      const hasOutboundLabel = getOutboundLabelUrl(tx) !== null;
      const hasOutboundTracking = !!(protectedData.outboundTrackingNumber || outbound.trackingNumber);
      const isReturnOnly = !hasOutboundLabel && !hasOutboundTracking && 
                          (!!protectedData.returnTrackingNumber || !!protectedData.returnLabelUrl);
      
      if (isReturnOnly) {
        if (VERBOSE) {
          console.log(`[shipping-reminder] Skipping tx ${txId} - return shipment only (no outbound label)`);
        }
        continue;
      }
      
      // Additional check: if metadata.direction is explicitly 'return', skip it
      if (metadata.direction === 'return') {
        if (VERBOSE) {
          console.log(`[shipping-reminder] Skipping tx ${txId} - metadata.direction=return`);
        }
        continue;
      }
      
      // Skip if already scanned
      if (isOutboundScanned(protectedData, metadata)) {
        if (VERBOSE) {
          console.log(`[shipping-reminder] Skipping tx ${txId} - already scanned`);
        }
        continue;
      }
      
      // Skip if already canceled or completed
      const state = tx?.attributes?.state;
      if (state === 'cancelled' || state === 'canceled' || state === 'completed' || state === 'delivered') {
        if (VERBOSE) {
          console.log(`[shipping-reminder] Skipping tx ${txId} - state: ${state}`);
        }
        continue;
      }
      
      // Get shipBy date
      const shipByDate = await getShipByDate(tx);
      if (!shipByDate) {
        if (VERBOSE) {
          console.log(`[shipping-reminder] Skipping tx ${txId} - no shipBy date`);
        }
        continue;
      }

      // Anchor shipBy time-of-day to when the lender accepted.
      // shipByDate from Sharetribe is typically a bare date at 00:00 UTC —
      // using that directly makes the 24h reminder fire at midnight UTC
      // (= late evening US time). Instead, use outbound.acceptedAt's hour/
      // minute so the reminder goes out at the same time-of-day the lender
      // first engaged. Falls back to 15:00 UTC (~11am ET / 8am PT) if
      // acceptedAt is missing — a reasonable daytime default.
      const acceptedAtRaw = outbound.acceptedAt || metadata.acceptedAt;
      const acceptedAt = acceptedAtRaw ? new Date(acceptedAtRaw) : null;
      const shipBy = new Date(shipByDate);
      if (acceptedAt && !Number.isNaN(+acceptedAt)) {
        shipBy.setUTCHours(
          acceptedAt.getUTCHours(),
          acceptedAt.getUTCMinutes(),
          0,
          0
        );
      } else {
        // Daytime default: 15:00 UTC = 11am EDT / 8am PDT
        shipBy.setUTCHours(15, 0, 0, 0);
      }
      
      // Get provider phone
      const providerRef = tx?.relationships?.provider?.data;
      const providerKey = providerRef ? `${providerRef.type}/${providerRef.id?.uuid || providerRef.id}` : null;
      const provider = providerKey ? included.get(providerKey) : null;
      
      const providerPhone = provider?.attributes?.profile?.protectedData?.phone ||
                           provider?.attributes?.profile?.protectedData?.phoneNumber ||
                           null;
      
      if (!providerPhone) {
        if (VERBOSE) {
          console.log(`[shipping-reminder] Skipping tx ${txId} - no provider phone`);
        }
        continue;
      }
      
      if (ONLY_PHONE && providerPhone !== ONLY_PHONE) {
        if (VERBOSE) console.log(`[shipping-reminder] Skipping ${providerPhone} (ONLY_PHONE=${ONLY_PHONE})`);
        continue;
      }
      
      // Get listing title
      const listingRef = tx?.relationships?.listing?.data;
      const listingKey = listingRef ? `${listingRef.type}/${listingRef.id?.uuid || listingRef.id}` : null;
      const listing = listingKey ? included.get(listingKey) : null;
      const listingTitle = listing?.attributes?.title || 'your item';
      
      // Get label URL
      const labelUrl = getOutboundLabelUrl(tx);
      if (!labelUrl) {
        if (VERBOSE) {
          console.log(`[shipping-reminder] Skipping tx ${txId} - no label URL`);
        }
        continue;
      }
      
      const shipByStr = formatDateForSMS(shipByDate);
      
      // Calculate time differences in hours
      const nowMs = now.getTime();
      const shipByMs = shipBy.getTime();
      const msUntilShipBy = shipByMs - nowMs;
      const hoursUntilShipBy = msUntilShipBy / (1000 * 60 * 60);
      const hoursAfterShipBy = -hoursUntilShipBy; // Negative if before, positive if after
      
      // 1. 24-hour before ship-by reminder
      // Normally the anchor is (shipBy - 24h). Mirror shipping.adjustIfSundayUTC:
      // if that anchor lands on Sunday, roll back to Saturday same time-of-day
      // so lenders aren't nudged on a day mail can't move. shipBy itself is
      // already adjusted off Sunday upstream, so this branch only fires when
      // shipBy is a Monday (→ natural anchor Sunday → shifted to Saturday).
      let reminderAt = new Date(shipByMs - 24 * 60 * 60 * 1000);
      if (reminderAt.getUTCDay() === 0) {
        reminderAt = new Date(reminderAt.getTime() - 24 * 60 * 60 * 1000);
      }
      const isIn24hWindow = nowMs >= reminderAt.getTime() && nowMs < shipByMs;
      if (isIn24hWindow) {
        if (await isSent(redis, txId, '24h')) {
          if (VERBOSE) console.log(`[shipping-reminder] Skip 24h for tx ${txId} — already sent`);
        } else if (await isInFlight(redis, txId, '24h')) {
          if (VERBOSE) console.log(`[shipping-reminder] Skip 24h for tx ${txId} — inFlight`);
        } else {
          console.log(`[shipping-reminder] Sending 24h reminder for tx ${txId}`);
          // Quiet-hours gate: 8 AM – 11 PM PT (Pattern A — 15-min poll retries naturally)
          if (!withinSendWindow()) {
            console.log(`[shipping-reminder][QUIET-HOURS] tx=${txId} 24h — deferred to next poll`);
            continue;
          }
          try {
            await markInFlight(redis, txId, '24h');
            const shortUrl = await shortLink(labelUrl);
            const message = `Sherbrt 🍧 Reminder: Please ship your item by ${shipByStr}. Shipping label: ${shortUrl}`;

            const smsResult = await sendSMS(providerPhone, message, {
              role: 'lender',
              tag: 'shipping_reminder_24h',
              meta: { transactionId: txId, listingId: listing?.id?.uuid || listing?.id, direction: 'outbound' }
            });

            if (!smsResult?.skipped) {
              await markSent(redis, txId, '24h');
              console.log(`[shipping-reminder] Marked 24h reminder as sent for tx ${txId}`);
              sent24h++;
            } else {
              await clearInFlight(redis, txId, '24h');
              console.log(`[shipping-reminder] SMS skipped (${smsResult.reason}) - NOT marking 24h reminder as sent for tx ${txId}`);
            }
          } catch (e) {
            console.error(`[shipping-reminder] SMS failed for 24h reminder:`, e?.message || e);
            await clearInFlight(redis, txId, '24h');
            failed++;
          }
        }
      }
      
      // 2. End-of-ship-by-day "not scanned" alert
      // Compare date-only (shipBy now has time-of-day from acceptedAt anchor)
      const shipByDay = new Date(shipBy); shipByDay.setUTCHours(0, 0, 0, 0);
      const isShipByDay = shipByDay.getTime() === today.getTime();
      if (isShipByDay && isEndOfShipByDay(shipByDate)) {
        if (await isSent(redis, txId, 'eod')) {
          if (VERBOSE) console.log(`[shipping-reminder] Skip end-of-day for tx ${txId} — already sent`);
        } else if (await isInFlight(redis, txId, 'eod')) {
          if (VERBOSE) console.log(`[shipping-reminder] Skip end-of-day for tx ${txId} — inFlight`);
        } else {
          console.log(`[shipping-reminder] Sending end-of-day reminder for tx ${txId}`);
          // Quiet-hours gate: 8 AM – 11 PM PT (Pattern A — 15-min poll retries naturally)
          if (!withinSendWindow()) {
            console.log(`[shipping-reminder][QUIET-HOURS] tx=${txId} eod — deferred to next poll`);
            continue;
          }
          try {
            await markInFlight(redis, txId, 'eod');
            const shortUrl = await shortLink(labelUrl);
            const message = `Sherbrt 🍧: Your item hasn't been scanned yet. Please ship ASAP to receive your payment. Shipping label: ${shortUrl}`;

            const smsResult = await sendSMS(providerPhone, message, {
              role: 'lender',
              tag: 'shipping_reminder_end_of_day',
              meta: { transactionId: txId, listingId: listing?.id?.uuid || listing?.id, direction: 'outbound' }
            });

            if (!smsResult?.skipped) {
              await markSent(redis, txId, 'eod');
              console.log(`[shipping-reminder] Marked end-of-day reminder as sent for tx ${txId}`);
              sentEndOfDay++;
            } else {
              await clearInFlight(redis, txId, 'eod');
              console.log(`[shipping-reminder] SMS skipped (${smsResult.reason}) - NOT marking end-of-day reminder as sent for tx ${txId}`);
            }
          } catch (e) {
            console.error(`[shipping-reminder] SMS failed for end-of-day reminder:`, e?.message || e);
            await clearInFlight(redis, txId, 'eod');
            failed++;
          }
        }
      }
      
      // 3. Auto-cancel after 48 hours past ship-by
      // Check if ship-by date has passed and we're 48-72 hours after
      if (hoursAfterShipBy >= 48 && hoursAfterShipBy < 72) {
        if (await isSent(redis, txId, 'cancel')) {
          if (VERBOSE) console.log(`[shipping-reminder] Skip auto-cancel for tx ${txId} — already sent`);
        } else if (await isInFlight(redis, txId, 'cancel')) {
          if (VERBOSE) console.log(`[shipping-reminder] Skip auto-cancel for tx ${txId} — inFlight`);
        } else {
          console.log(`[shipping-reminder] Auto-cancel triggered for tx ${txId}`);
          // Quiet-hours gate: 8 AM – 11 PM PT (Pattern A — 15-min poll retries naturally)
          if (!withinSendWindow()) {
            console.log(`[shipping-reminder][QUIET-HOURS] tx=${txId} cancel — deferred to next poll`);
            continue;
          }
          try {
            await markInFlight(redis, txId, 'cancel');

            const cancelResult = await cancelTransaction(txId, sdk);

            if (cancelResult.success || cancelResult.error === 'invalid_state' || cancelResult.dryRun) {
              const message = `Sherbrt 🍧: Your item was not shipped out in time. This transaction has been canceled.`;
              const smsResult = await sendSMS(providerPhone, message, {
                role: 'lender',
                tag: 'shipping_auto_cancel',
                meta: { transactionId: txId, listingId: listing?.id?.uuid || listing?.id, direction: 'outbound' }
              });

              if (!smsResult?.skipped) {
                await markSent(redis, txId, 'cancel');
                console.log(`[shipping-reminder] Marked auto-cancel as sent for tx ${txId}`);
                sentCancel++;
              } else {
                await clearInFlight(redis, txId, 'cancel');
                console.log(`[shipping-reminder] SMS skipped (${smsResult.reason}) - NOT marking auto-cancel as sent for tx ${txId}`);
              }
            } else {
              console.error(`[shipping-reminder] Failed to cancel transaction ${txId}, skipping SMS`);
              await clearInFlight(redis, txId, 'cancel');
              failed++;
            }
          } catch (e) {
            console.error(`[shipping-reminder] Auto-cancel failed for tx ${txId}:`, e?.message || e);
            await clearInFlight(redis, txId, 'cancel');
            failed++;
          }
        }
      }
      
      if (LIMIT && (sent24h + sentEndOfDay + sentCancel) >= LIMIT) {
        console.log(`[shipping-reminder] Limit reached (${LIMIT}). Stopping.`);
        break;
      }
    }
    
    console.log(`\n[shipping-reminder] Done. 24h=${sent24h} EndOfDay=${sentEndOfDay} Cancel=${sentCancel} Failed=${failed} Processed=${processed}`);
    if (DRY) {
      console.log('[shipping-reminder] DRY-RUN mode: no real SMS were sent and no transactions were canceled.');
    }
    
  } catch (err) {
    // Detailed error logging for 403 debugging
    console.error('[shipping-reminder] Flex query failed', {
      status: err.response && err.response.status,
      data: err.response && err.response.data,
      headers: err.response && err.response.headers && {
        'x-sharetribe-request-id': err.response.headers['x-sharetribe-request-id'],
      },
      message: err.message,
      code: err.code,
    });
    console.error('[shipping-reminder] Fatal:', err?.message || err);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  if (argv.includes('--daemon')) {
    // Run as daemon with internal scheduling
    console.log('[shipping-reminder] Starting shipping reminders daemon (every 15 minutes)');
    setInterval(async () => {
      try {
        await sendShippingReminders();
      } catch (error) {
        console.error('[shipping-reminder] Daemon error:', error.message);
      }
    }, 15 * 60 * 1000); // 15 minutes
    
    // Run immediately
    sendShippingReminders();
  } else {
    sendShippingReminders()
      .then(() => {
        console.log('[shipping-reminder] Shipping reminder script completed successfully');
        process.exit(0);
      })
      .catch((error) => {
        console.error('[shipping-reminder] Shipping reminder script failed:', error.message);
        process.exit(1);
      });
  }
}

module.exports = { sendShippingReminders };


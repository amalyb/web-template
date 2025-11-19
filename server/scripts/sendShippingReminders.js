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
 * Run every 15 minutes: */15 * * * * node server/scripts/sendShippingReminders.js
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

// ✅ Use centralized SDK factories
const getFlexSdk = require('../util/getFlexSdk');              // Integration SDK (privileged)
const getMarketplaceSdk = require('../util/getMarketplaceSdk'); // Marketplace SDK (reads)
const { shortLink } = require('../api-util/shortlink');
const { computeShipByDate, formatShipBy } = require('../lib/shipping');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

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
  
  // Normalize to UTC midnight
  shipBy.setUTCHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  
  // Check if same day
  if (shipBy.getTime() !== today.getTime()) {
    return false;
  }
  
  // Check if it's late in the day (23:50 UTC or later)
  // This ensures we catch it on any 15-minute cron run after 23:50
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  
  // Consider end of day as 23:50 UTC or later (catches 23:50, 23:55, 00:00, etc.)
  return hour >= 23 && minute >= 50;
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
    // Initialize SDKs
    const integSdk = getFlexSdk();           // for transitions (cancellation)
    const readSdk = getMarketplaceSdk();    // for queries/search
    const integrationSdk = getIntegrationSdk(); // for privileged operations
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
      const response = await readSdk.transactions.query(query);
      transactions = response?.data?.data || [];
      included = new Map();
      for (const inc of response?.data?.included || []) {
        const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
        included.set(key, inc);
      }
    } catch (queryError) {
      console.error('[shipping-reminder] Query failed', queryError.message);
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
      
      // Normalize shipBy to UTC midnight
      const shipBy = new Date(shipByDate);
      shipBy.setUTCHours(0, 0, 0, 0);
      
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
      
      // Check flags for duplicate prevention
      const flags = protectedData.shippingReminders || {};
      
      // 1. 24-hour before ship-by reminder
      // Send between (shipBy - 24h) and shipBy (i.e., within 24 hours before ship-by)
      // Use range check: hoursUntilShipBy > 0 (before shipBy) and hoursUntilShipBy <= 24
      // This ensures we catch it on any 15-minute cron run in that window
      if (hoursUntilShipBy > 0 && hoursUntilShipBy <= 24 && !flags.shippingReminderSent24h) {
        console.log(`[shipping-reminder] Sending 24h reminder for tx ${txId}`);
        
        try {
          const shortUrl = await shortLink(labelUrl);
          const message = `Sherbrt 🍧 Reminder: Please ship your item by tomorrow (${shipByStr}). Shipping label: ${shortUrl}`;
          
          await sendSMS(providerPhone, message, {
            role: 'lender',
            tag: 'shipping_reminder_24h',
            meta: { transactionId: txId, listingId: listing?.id?.uuid || listing?.id, direction: 'outbound' }
          });
          
          // Mark as sent
          try {
            await readSdk.transactions.update({
              id: tx.id,
              attributes: {
                protectedData: {
                  ...protectedData,
                  shippingReminders: {
                    ...flags,
                    shippingReminderSent24h: true
                  }
                }
              }
            });
            console.log(`[shipping-reminder] Marked 24h reminder as sent for tx ${txId}`);
          } catch (updateError) {
            console.error(`[shipping-reminder] Failed to mark 24h reminder as sent:`, updateError.message);
          }
          
          sent24h++;
        } catch (e) {
          console.error(`[shipping-reminder] SMS failed for 24h reminder:`, e?.message || e);
          failed++;
        }
      }
      
      // 2. End-of-ship-by-day "not scanned" alert
      // Check if it's the ship-by date and it's late in the day
      const isShipByDay = shipBy.getTime() === today.getTime();
      if (isShipByDay && isEndOfShipByDay(shipByDate) && !flags.shippingReminderSentEndOfDay) {
        console.log(`[shipping-reminder] Sending end-of-day reminder for tx ${txId}`);
        
        try {
          const shortUrl = await shortLink(labelUrl);
          const message = `Sherbrt 🍧: Your item hasn't been scanned yet. Please ship ASAP to receive your payment. Need help? Reply anytime. Shipping label: ${shortUrl}`;
          
          await sendSMS(providerPhone, message, {
            role: 'lender',
            tag: 'shipping_reminder_end_of_day',
            meta: { transactionId: txId, listingId: listing?.id?.uuid || listing?.id, direction: 'outbound' }
          });
          
          // Mark as sent
          try {
            await readSdk.transactions.update({
              id: tx.id,
              attributes: {
                protectedData: {
                  ...protectedData,
                  shippingReminders: {
                    ...flags,
                    shippingReminderSentEndOfDay: true
                  }
                }
              }
            });
            console.log(`[shipping-reminder] Marked end-of-day reminder as sent for tx ${txId}`);
          } catch (updateError) {
            console.error(`[shipping-reminder] Failed to mark end-of-day reminder as sent:`, updateError.message);
          }
          
          sentEndOfDay++;
        } catch (e) {
          console.error(`[shipping-reminder] SMS failed for end-of-day reminder:`, e?.message || e);
          failed++;
        }
      }
      
      // 3. Auto-cancel after 48 hours past ship-by
      // Check if ship-by date has passed and we're 48-72 hours after
      if (hoursAfterShipBy >= 48 && hoursAfterShipBy < 72 && !flags.shippingAutoCancelSent) {
        console.log(`[shipping-reminder] Auto-cancel triggered for tx ${txId}`);
        
        // Cancel the transaction first
        const cancelResult = await cancelTransaction(txId, integrationSdk);
        
        if (cancelResult.success || cancelResult.error === 'invalid_state' || cancelResult.dryRun) {
          // Send SMS after cancellation (or in dry-run mode)
          try {
            const message = `Sherbrt 🍧: Your item was not shipped out in time. This transaction has been canceled.`;
            
            await sendSMS(providerPhone, message, {
              role: 'lender',
              tag: 'shipping_auto_cancel',
              meta: { transactionId: txId, listingId: listing?.id?.uuid || listing?.id, direction: 'outbound' }
            });
            
            // Mark as sent
            try {
              await readSdk.transactions.update({
                id: tx.id,
                attributes: {
                  protectedData: {
                    ...protectedData,
                    shippingReminders: {
                      ...flags,
                      shippingAutoCancelSent: true
                    }
                  }
                }
              });
              console.log(`[shipping-reminder] Marked auto-cancel as sent for tx ${txId}`);
            } catch (updateError) {
              console.error(`[shipping-reminder] Failed to mark auto-cancel as sent:`, updateError.message);
            }
            
            sentCancel++;
          } catch (e) {
            console.error(`[shipping-reminder] SMS failed for auto-cancel:`, e?.message || e);
            failed++;
          }
        } else {
          console.error(`[shipping-reminder] Failed to cancel transaction ${txId}, skipping SMS`);
          failed++;
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


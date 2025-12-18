#!/usr/bin/env node
/**
 * Return Reminder SMS Script
 * 
 * Sends SMS reminders to borrowers for return shipments:
 * - T-1 day: QR/label reminder (ship back tomorrow)
 * - Today: Ship back today reminder
 * - Tomorrow: Due tomorrow reminder
 * 
 * OPTION A: Uses Integration SDK via getFlexSdk() helper
 * - Prefers Integration SDK when INTEGRATION_CLIENT_ID + INTEGRATION_CLIENT_SECRET are set
 * - Falls back to Marketplace SDK if Integration credentials not available
 * - Same pattern as other cron scripts (shipping/overdue reminders)
 * - No exchangeToken() call needed - Integration SDK handles auth automatically
 * 
 * Environment Variables (Option A):
 * Required (Integration SDK - preferred):
 * - INTEGRATION_CLIENT_ID
 * - INTEGRATION_CLIENT_SECRET
 * 
 * Optional (Marketplace SDK fallback):
 * - REACT_APP_SHARETRIBE_SDK_CLIENT_ID
 * - SHARETRIBE_SDK_CLIENT_SECRET
 * 
 * Both SDKs use:
 * - SHARETRIBE_SDK_BASE_URL or REACT_APP_SHARETRIBE_SDK_BASE_URL
 *   (defaults to https://flex-api.sharetribe.com)
 * 
 * CRON SCHEDULING (Render/Heroku):
 * Run every 15 minutes: 0,15,30,45 * * * * node server/scripts/sendReturnReminders.js
 * 
 * Example dry-run (no real SMS):
 * SMS_DRY_RUN=1 ONLY_PHONE=+15551234567 node server/scripts/sendReturnReminders.js --verbose
 * 
 * Example forcing a date window for testing:
 * SMS_DRY_RUN=1 FORCE_TODAY=2025-11-21 FORCE_TOMORROW=2025-11-22 node server/scripts/sendReturnReminders.js --verbose
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

// ✅ Use centralized SDK helper (same as shipping/overdue scripts)
// This automatically prefers Integration SDK when INTEGRATION_CLIENT_ID/SECRET are set
const getFlexSdk = require('../util/getFlexSdk');
const { shortLink } = require('../api-util/shortlink');
const { getFirstChargeableLateDate } = require('../lib/businessDays');

// Pacific Time date handling (mirrors server/lib/businessDays.js pattern)
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const TZ = 'America/Los_Angeles';

// ---- CLI flags / env guards ----
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const getOpt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const DRY = has('--dry-run') || process.env.SMS_DRY_RUN === '1';
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const DEBUG_SMS = process.env.DEBUG_SMS === '1';
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

function yyyymmdd(d) {
  // Convert date to Pacific Time and format as YYYY-MM-DD
  return dayjs(d).tz(TZ).format('YYYY-MM-DD');
}

async function sendReturnReminders() {
  console.log('🚀 Starting return reminder SMS script...');
  
  try {
    // Initialize SDK using centralized helper (same pattern as shipping/overdue scripts)
    const sdk = getFlexSdk();
    console.log('✅ SDK initialized');
    
    // Safety check: log which marketplace we're targeting
    console.log('[RETURN-REMINDER] Using Flex SDK for marketplace:', process.env.REACT_APP_SHARETRIBE_MARKETPLACE_ID || 'unknown');

    // today/tomorrow window (allow overrides for testing)
    // Calculate dates in Pacific Time (mirrors server/lib/businessDays.js pattern)
    const nowPT = dayjs().tz(TZ);
    const today = process.env.FORCE_TODAY || nowPT.format('YYYY-MM-DD');
    const tomorrow = process.env.FORCE_TOMORROW || nowPT.add(1, 'day').format('YYYY-MM-DD');
    console.log(`[RETURN-REMINDER-DEBUG] 📅 Current time (PT): ${nowPT.format()}`);
    console.log(`[RETURN-REMINDER-DEBUG] 📅 Window: today=${today}, tomorrow=${tomorrow}`);

    // Query transactions for T-1, today, and tomorrow (with pagination)
    const baseQuery = {
      state: 'delivered',
      include: ['customer', 'listing', 'booking', 'provider'],
      per_page: parseInt(process.env.PER_PAGE || '100', 10), // allow override for pagination testing
    };

    const ONLY_TX = process.env.ONLY_TX;

    let sent = 0, failed = 0, processed = 0;
    let totalCandidates = 0;
    let page = 1;
    let hasNext = true;
    let stopProcessing = false;

    while (hasNext && !stopProcessing) {
      const res = await sdk.transactions.query({ ...baseQuery, page });
      const txs = res?.data?.data || [];
      const meta = res?.data?.meta || {};
      totalCandidates += txs.length;

      console.log(`[RETURN-REMINDER] page=${page} count=${txs.length} next_page=${meta.next_page}`);

      const included = new Map();
      for (const inc of res?.data?.included || []) {
        // key like "user/UUID"
        const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
        included.set(key, inc);
      }

      for (const tx of txs) {
        processed++;

        const txId = tx?.id?.uuid || tx?.id?.uuid?.uuid || tx?.id?.toString?.() || tx?.id;
        if (ONLY_TX && txId !== ONLY_TX) {
          if (VERBOSE) console.log(`[RETURN-REMINDER-DEBUG] skipping non-target tx=${txId || '(no id)'} ONLY_TX=${ONLY_TX}`);
          continue;
        }

        const deliveryEnd = tx?.attributes?.deliveryEnd;
        const deliveryEndRaw = deliveryEnd;
        const deliveryEndNormalized = deliveryEnd ? dayjs(deliveryEnd).tz(TZ).format('YYYY-MM-DD') : null;

        const bookingRef = tx?.relationships?.booking?.data;
        const bookingKey = bookingRef ? `${bookingRef.type}/${bookingRef.id?.uuid || bookingRef.id}` : null;
        const booking = bookingKey ? included.get(bookingKey) : null;
        const bookingEndRaw = booking?.attributes?.end || null;
        const bookingEndNormalized = bookingEndRaw ? dayjs(bookingEndRaw).tz(TZ).format('YYYY-MM-DD') : null;
        
        // [RETURN-REMINDER-DEBUG] Log transaction details for debugging
        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || tx?.id || '(no id)'} bookingEndRaw=${bookingEndRaw} bookingEndNormalized=${bookingEndNormalized} deliveryEndRaw=${deliveryEndRaw} deliveryEndNormalized=${deliveryEndNormalized} today=${today} tomorrow=${tomorrow}`);
        
        const due = bookingEndNormalized;
        if (!due) {
          console.log(`[RETURN-REMINDER][SKIP] tx=${tx?.id?.uuid || '(no id)'} reason=missing booking end bookingKey=${bookingKey} bookingEndRaw=${bookingEndRaw}`);
          continue;
        }

        const tMinus1ForTx = dayjs(due).tz(TZ).subtract(1, 'day').format('YYYY-MM-DD');
        const firstChargeableLateDate =
          typeof getFirstChargeableLateDate === 'function' ? getFirstChargeableLateDate(due) : null;
        
        const matchesTMinus1 = today === tMinus1ForTx;
        const matchesToday = today === due;
        const matchesFirstChargeableLateDate =
          firstChargeableLateDate ? firstChargeableLateDate === today : false;
        
        const matchesWindow = matchesTMinus1 || matchesToday || matchesFirstChargeableLateDate;
        
        if (!matchesWindow) {
          console.log(`[RETURN-REMINDER][SKIP] tx=${tx?.id?.uuid || '(no id)'} reason=not return day window due=${due} bookingEndRaw=${bookingEndRaw} window=T-1:${tMinus1ForTx}|TODAY:${due}|firstChargeableLateDate:${firstChargeableLateDate}`);
          continue;
        }
        
        // Determine which reminder window this transaction falls into
        let reminderType = null;
        if (matchesTMinus1) {
          reminderType = 'T-1';
        } else if (matchesToday) {
          reminderType = 'TODAY';
        } else if (matchesFirstChargeableLateDate) {
          reminderType = 'TOMORROW_CHARGEABLE';
        }

        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} MATCHES window - reminderType=${reminderType} due=${due} tMinus1ForTx=${tMinus1ForTx} firstChargeableLateDate=${firstChargeableLateDate} todayPT=${today}`);

        // resolve customer from included
        const custRef = tx?.relationships?.customer?.data;
        const custKey = custRef ? `${custRef.type}/${custRef.id?.uuid || custRef.id}` : null;
        const customer = custKey ? included.get(custKey) : null;
        
        // Prefer checkout-entered phone stored on the transaction, then fall back to profile phone
        const protectedData = tx?.attributes?.protectedData || {};
        const normalizePhoneCandidate = (val) => {
          const trimmed = val && String(val).trim();
          if (!trimmed) return null;
          return trimmed.length >= 7 ? trimmed : null;
        };

        const checkoutPhoneCandidate =
          protectedData.customerPhone ||
          protectedData.phone ||
          protectedData.customer_phone ||
          protectedData?.checkoutDetails?.customerPhone ||
          protectedData?.checkoutDetails?.phone;
        const checkoutPhone = normalizePhoneCandidate(checkoutPhoneCandidate);

        const profilePhoneCandidate =
          customer?.attributes?.profile?.protectedData?.phone ||
          customer?.attributes?.profile?.protectedData?.phoneNumber;
        const profilePhone = normalizePhoneCandidate(profilePhoneCandidate);

        const borrowerPhone = checkoutPhone || profilePhone || null;

        if (!borrowerPhone) {
          console.warn(`[RETURN-REMINDER][NO-PHONE] Skipping return-day SMS, no checkout/prof phone`, { txId: tx?.id?.uuid || '(no id)' });
          continue;
        }
        
        console.log(`[RETURN-REMINDER][PHONE-SELECTED] tx=${tx?.id?.uuid || '(no id)'} used=${checkoutPhone ? 'checkoutPhone(protectedData)' : 'profilePhone'}`);

        if (ONLY_PHONE && borrowerPhone !== ONLY_PHONE) {
          if (VERBOSE) console.log(`↩️ Skipping ${borrowerPhone} (ONLY_PHONE=${ONLY_PHONE})`);
          continue;
        }
        
        const maskedPhone = borrowerPhone.replace(/\d(?=\d{4})/g, '*');
        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} borrowerPhone=${maskedPhone}`);

        // choose message based on due date derived from booking end
        let message;
        let tag;
        const pd = tx?.attributes?.protectedData || {};
        const returnData = pd.return || {};
        
        const effectiveReminderDate = reminderType === 'TOMORROW_CHARGEABLE' ? firstChargeableLateDate : due;
        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} effectiveReminderDate=${effectiveReminderDate} reminderType=${reminderType}`);
        
        if (reminderType === 'T-1') {
          // Idempotency: skip if T-1 already sent
          if (returnData.tMinus1SentAt) {
            console.log(`[RETURN-REMINDER-DEBUG] tx=${txId || '(no id)'} skipping T-1 reminder, already sent at ${returnData.tMinus1SentAt}`);
            continue;
          }

          // T-1 day: Send QR/label (use real label if available)
          // Check for return label in priority order: QR URL (preferred), then label URL
          let returnLabelUrl = pd.returnQrUrl ||  // Preferred: USPS QR code URL
                              pd.returnLabelUrl || // Fallback: PDF label URL
                              returnData.label?.url || 
                              pd.returnLabel || 
                              pd.shippingLabelUrl || 
                              pd.returnShippingLabel;
          
          // If no return label exists, log warning (label should have been created during accept transition)
          if (!returnLabelUrl && !returnData.tMinus1SentAt) {
            console.warn(`[RETURN-REMINDER-DEBUG] [return-reminders] ⚠️ No return label found for tx ${tx?.id?.uuid || '(no id)'} - label should have been created during accept transition - SKIPPING`);
            // Note: Creating a real Shippo label here would require addresses, parcel info, etc.
            // For now, skip sending T-1 reminder if no label exists (better than sending placeholder)
            continue;
          }
          
          // Log whether we're using QR or label URL
          const labelType = pd.returnQrUrl ? 'QR' : 'label';
          const labelSource = pd.returnQrUrl ? 'returnQrUrl' : 
                             pd.returnLabelUrl ? 'returnLabelUrl' : 
                             returnData.label?.url ? 'returnData.label.url' : 'other';
          console.log(`[return-reminders] Using ${labelType} URL from ${labelSource} for tx ${tx?.id?.uuid || '(no id)'}`);
          
          const shortUrl = await shortLink(returnLabelUrl);
          console.log('[SMS] shortlink', { type: 'return', short: shortUrl, original: returnLabelUrl });
          const labelNoun = labelType === 'QR' ? 'QR code' : 'shipping label';
          message = `📦 It's almost return time! Please ship your item back tomorrow using this ${labelNoun}: ${shortUrl}. Late fees are $15/day if it ships after the return date. Thanks for sharing style 💌`;
          tag = 'return_tminus1_to_borrower';
          
        } else if (reminderType === 'TODAY') {
          // Today: Ship back
          // Idempotency check: skip if already sent
          if (returnData.todayReminderSentAt) {
            console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} skipping TODAY reminder, already sent at ${returnData.todayReminderSentAt}`);
            continue;
          }
          
          // Check if package already scanned - skip reminder if so
          if (
            returnData.firstScanAt ||
            returnData.status === 'accepted' ||
            returnData.status === 'in_transit'
          ) {
            console.log(`[return-reminders] 🚚 Package already scanned for tx ${tx?.id?.uuid || '(no id)'} - skipping day-of reminder`);
            continue;
          }
          
          const returnLabelUrl = returnData.label?.url ||
                                pd.returnLabelUrl || 
                                pd.returnLabel || 
                                pd.shippingLabelUrl || 
                                pd.returnShippingLabel;

          if (returnLabelUrl) {
            const shortUrl = await shortLink(returnLabelUrl);
            console.log('[SMS] shortlink', { type: 'return', short: shortUrl, original: returnLabelUrl });
            message = `📦 Today's the day! Ship your Sherbrt item back. Return label: ${shortUrl}`;
            tag = 'return_reminder_today';
          } else {
            message = `📦 Today's the day! Ship your Sherbrt item back. Check your dashboard for return instructions.`;
            tag = 'return_reminder_today_no_label';
          }
          
        } else if (reminderType === 'TOMORROW_CHARGEABLE') {
          // HYBRID: "Tomorrow" reminder fires on first chargeable late date
          // Idempotency check: skip if already sent
          if (returnData.tomorrowReminderSentAt) {
            console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} skipping TOMORROW reminder, already sent at ${returnData.tomorrowReminderSentAt}`);
            continue;
          }
          
          // Log detailed info for debugging
          console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} due=${due} firstChargeableLateDate=${firstChargeableLateDate} todayPT=${today} → sending TOMORROW reminder`);
          
          message = `📦 Your Sherbrt return is now late. A $15/day late fee is being charged until the carrier scans it. Please ship it back ASAP using your QR code or label. After 5 days late, you may be charged the full replacement value of the item. 💌`;
          tag = 'return_reminder_tomorrow';
        }

        if (VERBOSE) {
          console.log(`📬 To ${borrowerPhone} (tx ${tx?.id?.uuid || ''}) → ${message}`);
        }

        try {
          if (VERBOSE || DEBUG_SMS) {
            console.log(`[RETURN-REMINDER][SEND] about to send tag=${tag} tx=${tx?.id?.uuid || '(no id)'} phone=${maskedPhone} type=${reminderType}`);
          }
          const smsResult = await sendSMS(borrowerPhone, message, { 
            role: 'borrower', 
            kind: 'return-reminder',
            tag: tag,
            meta: { transactionId: tx?.id?.uuid || tx?.id }
          });
          
          // Only mark reminder as sent for idempotency if SMS was actually sent
          if (!smsResult?.skipped) {
            console.log(`[RETURN-REMINDER][SENT] tx=${tx?.id?.uuid || '(no id)'} phone=${maskedPhone}`);
            if (VERBOSE || DEBUG_SMS) {
              console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} SMS sent successfully - tag=${tag} sid=${smsResult?.sid || 'n/a'}`);
            }
            const timestamp = new Date().toISOString();
            
            if (reminderType === 'T-1') {
              try {
                await sdk.transactions.update({
                  id: tx.id,
                  attributes: {
                    protectedData: {
                      ...pd,
                      return: {
                        ...returnData,
                        tMinus1SentAt: timestamp
                      }
                    }
                  }
                });
                console.log(`💾 Marked T-1 SMS as sent for tx ${tx?.id?.uuid || '(no id)'}`);
              } catch (updateError) {
                console.error(`❌ Failed to mark T-1 as sent:`, updateError.message);
              }
            } else if (reminderType === 'TODAY') {
              try {
                await sdk.transactions.update({
                  id: tx.id,
                  attributes: {
                    protectedData: {
                      ...pd,
                      return: {
                        ...returnData,
                        todayReminderSentAt: timestamp
                      }
                    }
                  }
                });
                console.log(`💾 Marked TODAY reminder as sent for tx ${tx?.id?.uuid || '(no id)'}`);
              } catch (updateError) {
                console.error(`❌ Failed to mark TODAY reminder as sent:`, updateError.message);
              }
            } else if (reminderType === 'TOMORROW_CHARGEABLE' || reminderType === 'TOMORROW') {
              // Mark "tomorrow" reminder as sent (works for both HYBRID and legacy calendar-based)
              try {
                await sdk.transactions.update({
                  id: tx.id,
                  attributes: {
                    protectedData: {
                      ...pd,
                      return: {
                        ...returnData,
                        tomorrowReminderSentAt: timestamp
                      }
                    }
                  }
                });
                console.log(`💾 Marked TOMORROW reminder as sent for tx ${tx?.id?.uuid || '(no id)'} (firstChargeableLateDate=${firstChargeableLateDate})`);
              } catch (updateError) {
                console.error(`❌ Failed to mark TOMORROW as sent:`, updateError.message);
              }
            }
            
            sent++;
          } else {
            console.log(`[RETURN-REMINDER-DEBUG] ⏭️ SMS skipped (${smsResult.reason}) - NOT marking reminder as sent for tx ${tx?.id?.uuid || '(no id)'}`);
          }
        } catch (e) {
          console.error(`❌ SMS failed to ${borrowerPhone}:`, e?.message || e);
          failed++;
        }

        if (LIMIT && sent >= LIMIT) {
          console.log(`⏹️ Limit reached (${LIMIT}). Stopping.`);
          stopProcessing = true;
          break;
        }
      }

      hasNext = !!meta.next_page;
      page += 1;
    }

    console.log(`📊 Found ${totalCandidates} candidate transactions across ${page - 1} page(s)`);
    console.log(`\n📊 Done. Sent=${sent} Failed=${failed} Processed=${processed}`);
    if (DRY) console.log('🧪 DRY-RUN mode: no real SMS were sent.');
    
  } catch (err) {
    console.error('\n❌ Fatal error:', err?.message || err);
    if (err.response) {
      console.error('🔎 Flex API response status:', err.response.status);
      console.error('🔎 Flex API response data:', JSON.stringify(err.response.data, null, 2));
    }
    if (err.stack) {
      console.error('🔎 Stack trace:', err.stack);
    }
    process.exit(1);
  }
}

// ============================================================================
// TEST COMMANDS (for local/testing)
// ============================================================================
// Example dry-run (no real SMS):
// SMS_DRY_RUN=1 ONLY_PHONE=+15551234567 node server/scripts/sendReturnReminders.js --verbose
//
// Example forcing a date window for testing:
// SMS_DRY_RUN=1 FORCE_TODAY=2025-11-21 FORCE_TOMORROW=2025-11-22 node server/scripts/sendReturnReminders.js --verbose
//
// Verification steps:
// 1. Run in DRY_RUN mode: Should complete without errors, log "Done. Sent=0" if no matches
// 2. Check logs: Should see reasonable [RETURN-REMINDER-DEBUG] lines for each transaction checked
// 3. Verify SDK initialization: Should see "[FlexSDK] Using Integration SDK..." or "[FlexSDK] Using Marketplace SDK..."
// 4. No [FLEX-400-DIAG] spam: Diagnostic logging removed, only essential logs remain
// ============================================================================

// Run the script if called directly
if (require.main === module) {
  if (argv.includes('--daemon')) {
    // Run as daemon with internal scheduling
    console.log('🔄 Starting return reminders daemon (every 15 minutes)');
    let isRunning = false;
    const runOnceSafely = async () => {
      if (isRunning) {
        console.log('⏳ Previous run still in progress, skipping this tick');
        return;
      }
      isRunning = true;
      try {
        await sendReturnReminders();
      } catch (error) {
        console.error('❌ Daemon error:', error.message);
      } finally {
        isRunning = false;
      }
    };

    // Schedule future runs
    setInterval(runOnceSafely, 15 * 60 * 1000); // 15 minutes

    // Run immediately
    runOnceSafely();
  } else {
    sendReturnReminders()
      .then(() => {
        console.log('🎉 Return reminder script completed successfully');
        process.exit(0);
      })
      .catch((error) => {
        console.error('💥 Return reminder script failed:', error.message);
        process.exit(1);
      });
  }
}

module.exports = { sendReturnReminders }; 
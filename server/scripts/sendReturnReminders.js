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
    // tMinus1 is calculated based on whichever "today" is active (forced or PT)
    const tMinus1 = dayjs(today).tz(TZ).subtract(1, 'day').format('YYYY-MM-DD');
    console.log(`[RETURN-REMINDER-DEBUG] 📅 Current time (PT): ${nowPT.format()}`);
    console.log(`[RETURN-REMINDER-DEBUG] 📅 Window: t-1=${tMinus1}, today=${today}, tomorrow=${tomorrow}`);

    // Query transactions for T-1, today, and tomorrow
    const query = {
      state: 'delivered',
      include: ['customer', 'listing'],
      per_page: 100, // use snake_case like our other scripts
    };

    const res = await sdk.transactions.query(query);
    const txs = res?.data?.data || [];
    const included = new Map();
    for (const inc of res?.data?.included || []) {
      // key like "user/UUID"
      const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
      included.set(key, inc);
    }

    console.log(`📊 Found ${txs.length} candidate transactions`);

    let sent = 0, failed = 0, processed = 0;

    for (const tx of txs) {
      processed++;

      const deliveryEnd = tx?.attributes?.deliveryEnd;
      const deliveryEndRaw = deliveryEnd;
      // Normalize deliveryEnd to Pacific Time date (handles both ISO strings and date-only strings)
      const deliveryEndNormalized = deliveryEnd ? dayjs(deliveryEnd).tz(TZ).format('YYYY-MM-DD') : null;
      const bookingEnd = tx?.attributes?.booking?.end;
      // Normalize bookingEnd to Pacific Time date (handles both ISO strings and date-only strings)
      const bookingEndNormalized = bookingEnd ? dayjs(bookingEnd).tz(TZ).format('YYYY-MM-DD') : null;
      
      // [RETURN-REMINDER-DEBUG] Log transaction details for debugging
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || tx?.id || '(no id)'} deliveryEndRaw=${deliveryEndRaw} deliveryEndNormalized=${deliveryEndNormalized} bookingEnd=${bookingEnd} bookingEndNormalized=${bookingEndNormalized} today=${today} tomorrow=${tomorrow} tMinus1=${tMinus1}`);
      
      // Compute first chargeable late date for this transaction (for "tomorrow" reminder)
      const due = deliveryEndNormalized;
      const firstChargeableLateDate = due ? getFirstChargeableLateDate(due) : null;
      
      // Check both raw and normalized deliveryEnd for T-1 and Today reminders
      // Also include transactions eligible for "tomorrow" reminder (first chargeable late date)
      const matchesTMinus1 = deliveryEnd === tMinus1 || deliveryEndNormalized === tMinus1;
      const matchesToday = deliveryEnd === today || deliveryEndNormalized === today;
      const matchesCalendarTomorrow = deliveryEnd === tomorrow || deliveryEndNormalized === tomorrow;
      const matchesFirstChargeableLateDate = due && firstChargeableLateDate === today;
      
      const matchesWindow = matchesTMinus1 || matchesToday || matchesCalendarTomorrow || matchesFirstChargeableLateDate;
      
      if (!matchesWindow) {
        console.log(`[RETURN-REMINDER][SKIP] tx=${tx?.id?.uuid || '(no id)'} reason=not return day window deliveryEnd=${deliveryEndRaw} window=T-1:${tMinus1}|TODAY:${today}|TOMORROW:${tomorrow}|firstChargeableLateDate:${firstChargeableLateDate}`);
        continue;
      }
      
      // Determine which reminder window this transaction falls into
      let reminderType = null;
      if (matchesTMinus1) {
        reminderType = 'T-1';
      } else if (matchesToday) {
        reminderType = 'TODAY';
      } else if (matchesFirstChargeableLateDate) {
        // HYBRID: "tomorrow" reminder fires on first chargeable late date, not calendar tomorrow
        reminderType = 'TOMORROW_CHARGEABLE';
      } else if (matchesCalendarTomorrow) {
        // Legacy fallback (shouldn't happen with new logic, but keep for safety)
        reminderType = 'TOMORROW';
      }
      
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} MATCHES window - reminderType=${reminderType} deliveryEnd=${deliveryEndRaw} due=${due} firstChargeableLateDate=${firstChargeableLateDate} todayPT=${today}`);

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

      // choose message based on delivery end date
      let message;
      let tag;
      const pd = tx?.attributes?.protectedData || {};
      const returnData = pd.return || {};
      
      // Use normalized date for comparison if raw doesn't match
      // For TOMORROW_CHARGEABLE, we use the firstChargeableLateDate logic instead of calendar tomorrow
      const effectiveDeliveryEnd = matchesTMinus1 ? tMinus1 :
                                   matchesToday ? today :
                                   matchesFirstChargeableLateDate ? firstChargeableLateDate :
                                   matchesCalendarTomorrow ? tomorrow : null;
      
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} effectiveDeliveryEnd=${effectiveDeliveryEnd} reminderType=${reminderType}`);
      
      if (reminderType === 'T-1') {
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
        message = `📦 It's almost return time! Here's your QR to ship back tomorrow: ${shortUrl} Thanks for sharing style 💌`;
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
        
        message = `⏳ Your Sherbrt return is due tomorrow—please ship it back and submit pics & feedback.`;
        tag = 'return_reminder_tomorrow';
      } else {
        // Legacy fallback (shouldn't happen with new logic, but keep for safety)
        // Tomorrow: Due tomorrow (calendar-based)
        // Idempotency check: skip if already sent
        if (returnData.tomorrowReminderSentAt) {
          console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} skipping TOMORROW reminder, already sent at ${returnData.tomorrowReminderSentAt}`);
          continue;
        }
        
        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} using legacy calendar-based TOMORROW reminder`);
        
        message = `⏳ Your Sherbrt return is due tomorrow—please ship it back and submit pics & feedback.`;
        tag = 'return_reminder_tomorrow';
      }

      if (VERBOSE) {
        console.log(`📬 To ${borrowerPhone} (tx ${tx?.id?.uuid || ''}) → ${message}`);
      }

      try {
        const smsResult = await sendSMS(borrowerPhone, message, { 
          role: 'borrower', 
          kind: 'return-reminder',
          tag: tag,
          meta: { transactionId: tx?.id?.uuid || tx?.id }
        });
        
        // Only mark reminder as sent for idempotency if SMS was actually sent
        if (!smsResult?.skipped) {
          console.log(`[RETURN-REMINDER][SENT] tx=${tx?.id?.uuid || '(no id)'} phone=${maskedPhone}`);
          console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} SMS sent successfully - tag=${tag}`);
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
          } else if (reminderType === 'TOMORROW_CHARGEABLE' || effectiveDeliveryEnd === tomorrow) {
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
              console.error(`❌ Failed to mark TOMORROW reminder as sent:`, updateError.message);
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
        break;
      }
    }

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
    setInterval(async () => {
      try {
        await sendReturnReminders();
      } catch (error) {
        console.error('❌ Daemon error:', error.message);
      }
    }, 15 * 60 * 1000); // 15 minutes
    
    // Run immediately
    sendReturnReminders();
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
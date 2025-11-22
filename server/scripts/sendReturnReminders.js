#!/usr/bin/env node
require('dotenv').config();

let sendSMS = null;
try {
  const smsModule = require('../api-util/sendSMS');
  sendSMS = smsModule.sendSMS;
} catch (error) {
  console.warn('⚠️ SMS module not available — SMS functionality disabled');
  sendSMS = () => Promise.resolve();
}

// ✅ Use the correct SDK helper
const { getTrustedSdk } = require('../api-util/sdk');
const { shortLink } = require('../api-util/shortlink');

// Create a trusted SDK instance for scripts (no req needed)
async function getScriptSdk() {
  const sharetribeSdk = require('sharetribe-flex-sdk');
  const CLIENT_ID = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
  const CLIENT_SECRET = process.env.SHARETRIBE_SDK_CLIENT_SECRET;
  const BASE_URL = process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL;
  
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Missing Sharetribe credentials: REACT_APP_SHARETRIBE_SDK_CLIENT_ID and SHARETRIBE_SDK_CLIENT_SECRET required');
  }
  
  const sdk = sharetribeSdk.createInstance({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    baseUrl: BASE_URL,
  });
  
  // Exchange token to get trusted access
  const response = await sdk.exchangeToken();
  const trustedToken = response.data;
  
  return sharetribeSdk.createInstance({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    baseUrl: BASE_URL,
    tokenStore: sharetribeSdk.tokenStore.memoryStore(trustedToken),
  });
}

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
  // Always use UTC for consistent date handling
  return new Date(d).toISOString().split('T')[0];
}

async function sendReturnReminders() {
  console.log('🚀 Starting return reminder SMS script...');
  try {
    const sdk = await getScriptSdk();
    console.log('✅ SDK initialized');

    // today/tomorrow window (allow overrides for testing)
    const now = Date.now();
    const nowISO = new Date(now).toISOString();
    const today = process.env.FORCE_TODAY || yyyymmdd(now);
    const tomorrow = process.env.FORCE_TOMORROW || yyyymmdd(now + 24 * 60 * 60 * 1000);
    const tMinus1 = yyyymmdd(new Date(today).getTime() - 24 * 60 * 60 * 1000);
    console.log(`[RETURN-REMINDER-DEBUG] 📅 Current time: ${nowISO} (UTC)`);
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
      const deliveryEndNormalized = deliveryEnd ? yyyymmdd(deliveryEnd) : null;
      const bookingEnd = tx?.attributes?.booking?.end;
      const bookingEndNormalized = bookingEnd ? yyyymmdd(bookingEnd) : null;
      
      // [RETURN-REMINDER-DEBUG] Log transaction details for debugging
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || tx?.id || '(no id)'} deliveryEndRaw=${deliveryEndRaw} deliveryEndNormalized=${deliveryEndNormalized} bookingEnd=${bookingEnd} bookingEndNormalized=${bookingEndNormalized} today=${today} tomorrow=${tomorrow} tMinus1=${tMinus1}`);
      
      // Check both raw and normalized deliveryEnd
      const matchesWindow = deliveryEnd === tMinus1 || deliveryEnd === today || deliveryEnd === tomorrow ||
                            deliveryEndNormalized === tMinus1 || deliveryEndNormalized === today || deliveryEndNormalized === tomorrow;
      
      if (!matchesWindow) {
        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} SKIPPED - deliveryEnd (${deliveryEndRaw}) does not match window [${tMinus1}, ${today}, ${tomorrow}]`);
        continue;
      }
      
      // Determine which reminder window this transaction falls into
      let reminderType = null;
      if (deliveryEnd === tMinus1 || deliveryEndNormalized === tMinus1) {
        reminderType = 'T-1';
      } else if (deliveryEnd === today || deliveryEndNormalized === today) {
        reminderType = 'TODAY';
      } else if (deliveryEnd === tomorrow || deliveryEndNormalized === tomorrow) {
        reminderType = 'TOMORROW';
      }
      
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} MATCHES window - reminderType=${reminderType} deliveryEnd=${deliveryEndRaw}`);

      // resolve customer from included
      const custRef = tx?.relationships?.customer?.data;
      const custKey = custRef ? `${custRef.type}/${custRef.id?.uuid || custRef.id}` : null;
      const customer = custKey ? included.get(custKey) : null;

      const borrowerPhone =
        customer?.attributes?.profile?.protectedData?.phone ||
        customer?.attributes?.profile?.protectedData?.phoneNumber ||
        null;

      if (!borrowerPhone) {
        console.warn(`[RETURN-REMINDER-DEBUG] ⚠️ No borrower phone for tx ${tx?.id?.uuid || '(no id)'} - SKIPPING`);
        continue;
      }
      
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} borrowerPhone=${borrowerPhone ? borrowerPhone.replace(/\d(?=\d{4})/g, '*') : 'MISSING'}`);

      if (ONLY_PHONE && borrowerPhone !== ONLY_PHONE) {
        if (VERBOSE) console.log(`↩️ Skipping ${borrowerPhone} (ONLY_PHONE=${ONLY_PHONE})`);
        continue;
      }

      // choose message based on delivery end date
      let message;
      let tag;
      const pd = tx?.attributes?.protectedData || {};
      const returnData = pd.return || {};
      
      // Use normalized date for comparison if raw doesn't match
      const effectiveDeliveryEnd = (deliveryEnd === tMinus1 || deliveryEndNormalized === tMinus1) ? tMinus1 :
                                   (deliveryEnd === today || deliveryEndNormalized === today) ? today :
                                   (deliveryEnd === tomorrow || deliveryEndNormalized === tomorrow) ? tomorrow : null;
      
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} effectiveDeliveryEnd=${effectiveDeliveryEnd} reminderType=${reminderType}`);
      
      if (effectiveDeliveryEnd === tMinus1) {
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
        
      } else if (effectiveDeliveryEnd === today) {
        // Today: Ship back
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
        
      } else {
        // Tomorrow: Due tomorrow
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
        
        // Only mark T-1 as sent for idempotency if SMS was actually sent
        if (!smsResult?.skipped) {
          console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} SMS sent successfully - tag=${tag}`);
          if (effectiveDeliveryEnd === tMinus1) {
            try {
              await sdk.transactions.update({
                id: tx.id,
                attributes: {
                  protectedData: {
                    ...pd,
                    return: {
                      ...returnData,
                      tMinus1SentAt: new Date().toISOString()
                    }
                  }
                }
              });
              console.log(`💾 Marked T-1 SMS as sent for tx ${tx?.id?.uuid || '(no id)'}`);
            } catch (updateError) {
              console.error(`❌ Failed to mark T-1 as sent:`, updateError.message);
            }
          }
          
          sent++;
        } else {
          console.log(`[RETURN-REMINDER-DEBUG] ⏭️ SMS skipped (${smsResult.reason}) - NOT marking T-1 as sent for tx ${tx?.id?.uuid || '(no id)'}`);
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
    console.error('❌ Fatal:', err?.message || err);
    if (err.response) {
      console.error('🔎 Flex API response status:', err.response.status);
      console.error('🔎 Flex API response data:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

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
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

// ✅ Use centralized SDK factories
const getFlexSdk = require('../util/getFlexSdk');              // Integration SDK (privileged)
const getMarketplaceSdk = require('../util/getMarketplaceSdk'); // Marketplace SDK (reads)
const { shortLink } = require('../api-util/shortlink');

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
    // Initialize both SDKs: Marketplace for reads, Integration for privileged operations
    const integSdk = getFlexSdk();           // for transitions (if needed)
    const readSdk  = getMarketplaceSdk();    // for queries/search
    console.log('✅ SDKs initialized (read + integ)');
    
    // Diagnostic startup logging
    if (process.env.DIAG === '1') {
      const mask = (v) => v ? v.slice(0, 6) + '…' + v.slice(-4) : '(not set)';
      const baseUrl = process.env.SHARETRIBE_SDK_BASE_URL || 
                      process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL || 
                      'https://flex-api.sharetribe.com';
      console.log('[DIAG] Using SDKs: read=Marketplace, integ=Integration');
      console.log('[DIAG] Marketplace clientId:', mask(process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID));
      console.log('[DIAG] Integration clientId:', mask(process.env.INTEGRATION_CLIENT_ID));
      console.log('[DIAG] Base URL:', baseUrl);
    }

    // today/tomorrow window (allow overrides for testing)
    const today = process.env.FORCE_TODAY || yyyymmdd(Date.now());
    const tomorrow = process.env.FORCE_TOMORROW || yyyymmdd(Date.now() + 24 * 60 * 60 * 1000);
    const tMinus1 = yyyymmdd(new Date(today).getTime() - 24 * 60 * 60 * 1000);
    console.log(`📅 Window: t-1=${tMinus1}, today=${today}, tomorrow=${tomorrow}`);

    // Query transactions for T-1, today, and tomorrow
    const query = {
      state: 'delivered',
      deliveryEnd: [tMinus1, today, tomorrow],
      include: ['customer', 'listing'],
      perPage: 50,
    };

    let res, txs, included;
    try {
      res = await readSdk.transactions.query(query);
      txs = res?.data?.data || [];
      included = new Map();
      for (const inc of res?.data?.included || []) {
        // key like "user/UUID"
        const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
        included.set(key, inc);
      }
    } catch (queryError) {
      const status = queryError.response?.status;
      const data = queryError.response?.data;
      
      if (process.env.DIAG === '1') {
        console.error('[DIAG] Query error details:', {
          endpoint: 'transactions.query',
          status,
          data,
          query,
          errorMessage: queryError.message,
          errorCode: queryError.code
        });
      }
      
      console.error('❌ Query failed', { 
        status, 
        query,
        errorMessage: queryError.message
      });
      
      if (status === 400) {
        console.error('');
        console.error('⚠️  400 BAD REQUEST - Possible causes:');
        console.error('   1. Invalid query parameters (check perPage vs per_page)');
        console.error('   2. Invalid deliveryEnd format or state value');
        console.error('   3. Malformed include parameter');
        console.error('');
        if (data?.errors) {
          console.error('   API Errors:');
          data.errors.forEach((err, i) => {
            console.error(`   [${i}] ${err.title || err.detail || JSON.stringify(err)}`);
          });
        }
      }
      
      throw queryError;
    }

    console.log(`📊 Found ${txs.length} candidate transactions`);

    let sent = 0, failed = 0, processed = 0;

    for (const tx of txs) {
      processed++;

      const deliveryEnd = tx?.attributes?.deliveryEnd;
      if (deliveryEnd !== tMinus1 && deliveryEnd !== today && deliveryEnd !== tomorrow) continue;

      // resolve customer from included
      const custRef = tx?.relationships?.customer?.data;
      const custKey = custRef ? `${custRef.type}/${custRef.id?.uuid || custRef.id}` : null;
      const customer = custKey ? included.get(custKey) : null;

      const borrowerPhone =
        customer?.attributes?.profile?.protectedData?.phone ||
        customer?.attributes?.profile?.protectedData?.phoneNumber ||
        null;

      if (!borrowerPhone) {
        console.warn(`⚠️ No borrower phone for tx ${tx?.id?.uuid || '(no id)'}`);
        continue;
      }

      if (ONLY_PHONE && borrowerPhone !== ONLY_PHONE) {
        if (VERBOSE) console.log(`↩️ Skipping ${borrowerPhone} (ONLY_PHONE=${ONLY_PHONE})`);
        continue;
      }

      // choose message based on delivery end date
      let message;
      let tag;
      const pd = tx?.attributes?.protectedData || {};
      const returnData = pd.return || {};
      
      if (deliveryEnd === tMinus1) {
        // T-1 day: Send QR/label (use stored return label URL)
        // Check multiple fields for backward compatibility
        let returnLabelUrl = returnData.label?.url || 
                            pd.returnLabelUrl || 
                            pd.returnQrUrl ||  // Also check QR URL (preferred for USPS)
                            pd.returnLabel || 
                            pd.shippingLabelUrl || 
                            pd.returnShippingLabel;
        
        // If no return label exists, log warning and skip SMS (don't use placeholder)
        if (!returnLabelUrl && !returnData.tMinus1SentAt) {
          console.warn(`⚠️ [RETURN-REMINDER] No return label found for tx ${tx?.id?.uuid || '(no id)'} - skipping T-1 reminder`);
          console.warn(`   Expected return label to be created during transition/accept.`);
          console.warn(`   Check protectedData.returnLabelUrl or protectedData.returnQrUrl`);
          continue; // Skip this transaction
        }
        
        // If return label URL is missing but we've already sent, skip
        if (!returnLabelUrl) {
          console.log(`⏭️ [RETURN-REMINDER] No return label URL for tx ${tx?.id?.uuid || '(no id)'}, but T-1 already sent - skipping`);
          continue;
        }
        
        // Create short link for SMS
        const shortUrl = await shortLink(returnLabelUrl);
        console.log('[SMS] shortlink', { 
          type: 'return', 
          short: shortUrl, 
          original: returnLabelUrl,
          transactionId: tx?.id?.uuid || tx?.id
        });
        message = `📦 It's almost return time! Here's your QR to ship back tomorrow: ${shortUrl} Thanks for sharing style 💌`;
        tag = 'return_tminus1_to_borrower';
        
      } else if (deliveryEnd === today) {
        // Today: Ship back
        // Check multiple fields for backward compatibility (same as T-1)
        const returnLabelUrl = returnData.label?.url ||
                              pd.returnLabelUrl || 
                              pd.returnQrUrl ||  // Also check QR URL (preferred for USPS)
                              pd.returnLabel || 
                              pd.shippingLabelUrl || 
                              pd.returnShippingLabel;

        if (returnLabelUrl) {
          const shortUrl = await shortLink(returnLabelUrl);
          console.log('[SMS] shortlink', { 
            type: 'return', 
            short: shortUrl, 
            original: returnLabelUrl,
            transactionId: tx?.id?.uuid || tx?.id
          });
          message = `📦 Today's the day! Ship your Sherbrt item back. Return label: ${shortUrl}
Don't forget to post your pics and tag @shoponsherbrt on Instagram! 📸✨`;
          tag = 'return_reminder_today';
        } else {
          // No return label available - send message without link
          console.warn(`⚠️ [RETURN-REMINDER] No return label found for tx ${tx?.id?.uuid || '(no id)'} on return day`);
          message = `📦 Today's the day! Ship your Sherbrt item back. Check your dashboard for return instructions.
Don't forget to post your pics and tag @shoponsherbrt on Instagram! 📸✨`;
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
        await sendSMS(borrowerPhone, message, { 
          role: 'borrower', 
          kind: 'return-reminder',
          tag: tag,
          meta: { transactionId: tx?.id?.uuid || tx?.id }
        });
        
        // Mark T-1 as sent for idempotency
        if (deliveryEnd === tMinus1) {
          try {
            await readSdk.transactions.update({
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
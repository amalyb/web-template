const getFlexSdk = require('../util/getFlexSdk');              // Integration SDK (privileged)
const getMarketplaceSdk = require('../util/getMarketplaceSdk'); // Marketplace SDK (reads)
const { sendSMS: sendSMSOriginal } = require('../api-util/sendSMS');
const { maskPhone } = require('../api-util/phone');
const { shortLink } = require('../api-util/shortlink');
const { applyCharges } = require('../lib/lateFees');

// Parse command line arguments
const argv = process.argv.slice(2);
const has = name => argv.includes(name);
const getOpt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

// Normalize environment flags for both SMS and charges
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.SMS_DRY_RUN === '1' || has('--dry-run');
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const LIMIT = parseInt(getOpt('--limit', process.env.LIMIT || '0'), 10) || 0;
const ONLY_PHONE = process.env.ONLY_PHONE; // e.g. +15551234567 for targeted test
const FORCE_NOW = process.env.FORCE_NOW ? new Date(process.env.FORCE_NOW) : null;

if (FORCE_NOW) {
  console.log(`⏰ FORCE_NOW active: ${FORCE_NOW.toISOString()}`);
}

// Wrapper for sendSMS that respects DRY_RUN mode
let sendSMS;
if (DRY_RUN) {
  console.log('🔍 DRY_RUN mode: SMS and charges will be simulated only');
  sendSMS = async (to, body, opts = {}) => {
    const { tag, meta } = opts;
    const metaJson = meta ? JSON.stringify(meta) : '{}';
    const bodyJson = JSON.stringify(body);
    console.log(`[SMS:OUT] tag=${tag || 'none'} to=${to} meta=${metaJson} body=${bodyJson} dry-run=true`);
    if (VERBOSE) console.log('opts:', opts);
    return { dryRun: true };
  };
} else {
  sendSMS = sendSMSOriginal;
}

function yyyymmdd(d) {
  // Always use UTC for consistent date handling
  return new Date(d).toISOString().split('T')[0];
}

function diffDays(date1, date2) {
  const d1 = new Date(date1 + 'T00:00:00.000Z'); // Force UTC
  const d2 = new Date(date2 + 'T00:00:00.000Z'); // Force UTC
  return Math.ceil((d1 - d2) / (1000 * 60 * 60 * 24));
}

function isInTransit(trackingStatus) {
  const upperStatus = trackingStatus?.toUpperCase();
  return upperStatus === 'IN_TRANSIT' || upperStatus === 'ACCEPTED';
}

/**
 * @deprecated This function is now handled by applyCharges() from lib/lateFees.js
 * Kept for backward compatibility only. Do not use in new code.
 */
async function evaluateReplacementCharge(tx) {
  console.warn('⚠️ evaluateReplacementCharge is deprecated. Use applyCharges() from lib/lateFees.js instead.');
  return {
    replacementAmount: 5000,
    evaluated: true,
    timestamp: new Date().toISOString(),
    deprecated: true
  };
}

async function sendOverdueReminders() {
  console.log('🚀 Starting overdue reminder SMS script...');
  
  try {
    // Initialize both SDKs: Marketplace for reads, Integration for privileged operations
    const integSdk = getFlexSdk();           // for transitions/charges
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

    const today = process.env.FORCE_TODAY || yyyymmdd(Date.now());
    const todayDate = new Date(today);
    
    console.log(`📅 Processing overdue reminders for: ${today}`);

    // Load delivered transactions where return date has passed and no first scan
    const query = {
      state: 'delivered',
      include: ['customer', 'listing'],
      per_page: 100  // snake_case for Marketplace SDK
    };

    let response, transactions, included;
    try {
      response = await readSdk.transactions.query(query);
      transactions = response.data.data;
      included = response.data.included;
    } catch (queryError) {
      // Debug logging for errors
      const status = queryError.response?.status;
      const data = queryError.response?.data;
      const headers = queryError.response?.headers;
      
      if (process.env.DIAG === '1') {
        console.error('[DIAG] Query error details:', {
          endpoint: 'transactions.query',
          status,
          data,
          query,
          errorMessage: queryError.message,
          errorCode: queryError.code
        });
      } else {
        console.error('❌ Query failed', { 
          status, 
          query,
          errorMessage: queryError.message
        });
      }
      
      // Helpful hint for 403 errors
      if (status === 403) {
        console.error('');
        console.error('⚠️  403 FORBIDDEN - Possible causes:');
        console.error('   1. Test environment credentials may be expired or invalid');
        console.error('   2. Marketplace SDK may not have access to delivered state transactions');
        console.error('   3. Try with INTEGRATION_CLIENT_ID/SECRET for broader access');
        console.error('');
      }
      
      // Helpful hint for 400 errors
      if (status === 400) {
        console.error('');
        console.error('⚠️  400 BAD REQUEST - Possible causes:');
        console.error('   1. Invalid query parameters (check per_page vs perPage)');
        console.error('   2. Invalid state value or filter');
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

    console.log(`📊 Found ${transactions.length} delivered transactions`);

    let sent = 0, failed = 0, processed = 0;
    let charged = 0, chargesFailed = 0;

    for (const tx of transactions) {
      processed++;
      
      const deliveryEnd = tx?.attributes?.deliveryEnd;
      if (!deliveryEnd) continue;
      
      const returnDate = new Date(deliveryEnd);
      const daysLate = diffDays(todayDate, returnDate);
      
      // Skip if not overdue
      if (daysLate < 1) continue;
      
      const protectedData = tx?.attributes?.protectedData || {};
      const returnData = protectedData.return || {};
      
      // Skip if already scanned (in transit)
      if (returnData.firstScanAt) {
        console.log(`✅ Return already in transit for tx ${tx?.id?.uuid || '(no id)'}`);
        continue;
      }
      
      // Get borrower phone
      const customerRef = tx?.relationships?.customer?.data;
      const customerKey = customerRef ? `${customerRef.type}/${customerRef.id?.uuid || customerRef.id}` : null;
      const customer = customerKey ? included.get(customerKey) : null;
      
      const borrowerPhone = customer?.attributes?.profile?.protectedData?.phone ||
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
      
      // Get listing info
      const listingRef = tx?.relationships?.listing?.data;
      const listingKey = listingRef ? `${listingRef.type}/${listingRef.id?.uuid || listingRef.id}` : null;
      const listing = listingKey ? included.get(listingKey) : null;
      
      // Get return label URL
      const returnLabelUrl = returnData.label?.url ||
                            protectedData.returnLabelUrl ||
                            protectedData.returnLabel ||
                            protectedData.shippingLabelUrl ||
                            protectedData.returnShippingLabel ||
                            `https://sherbrt.com/return/${tx?.id?.uuid || tx?.id}`;
      
      const shortUrl = await shortLink(returnLabelUrl);
      console.log('[SMS] shortlink', { type: 'overdue', short: shortUrl, original: returnLabelUrl });
      
      // Check if we've already notified for this day
      const overdue = returnData.overdue || {};
      const lastNotifiedDay = overdue.lastNotifiedDay;
      
      if (lastNotifiedDay === daysLate) {
        console.log(`📅 Already notified for day ${daysLate} for tx ${tx?.id?.uuid || '(no id)'}`);
        continue;
      }
      
      // Calculate fees
      const fees = returnData.fees || {};
      const perDayCents = fees.perDayCents || 1500; // $15/day default
      const feesStartedAt = fees.startedAt || new Date(returnDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const totalCents = perDayCents * daysLate;
      
      // Determine message based on days late
      let message;
      let tag;
      
      if (daysLate === 1) {
        message = `⚠️ Due yesterday. Please ship today to avoid $15/day late fees. QR: ${shortUrl}`;
        tag = 'overdue_day1_to_borrower';
      } else if (daysLate === 2) {
        message = `🚫 2 days late. $15/day fees are adding up. Ship now: ${shortUrl}`;
        tag = 'overdue_day2_to_borrower';
      } else if (daysLate === 3) {
        message = `⏰ 3 days late. Fees continue. Ship today to avoid full replacement.`;
        tag = 'overdue_day3_to_borrower';
      } else if (daysLate === 4) {
        message = `⚠️ 4 days late. Ship immediately to prevent replacement charges.`;
        tag = 'overdue_day4_to_borrower';
      } else {
        // Day 5+
        const replacementAmount = 5000; // $50.00 in cents
        message = `🚫 5 days late. You may be charged full replacement ($${replacementAmount/100}). Avoid this by shipping today: ${shortUrl}`;
        tag = 'overdue_day5_to_borrower';
      }
      
      if (VERBOSE) {
        console.log(`📬 To ${borrowerPhone} (tx ${tx?.id?.uuid || ''}, ${daysLate} days late) → ${message}`);
      }
      
      try {
        await sendSMS(borrowerPhone, message, {
          role: 'borrower',
          tag: tag,
          meta: { 
            txId: tx?.id?.uuid || tx?.id,
            listingId: listing?.id?.uuid || listing?.id,
            daysLate: daysLate,
            totalFeesCents: totalCents
          }
        });
        
        // Update transaction with SMS notification tracking only
        // (Charges are now handled by applyCharges() below)
        const updatedReturnData = {
          ...returnData,
          overdue: {
            ...overdue,
            daysLate: daysLate,
            lastNotifiedDay: daysLate
          }
        };
        
        try {
          await readSdk.transactions.update({
            id: tx.id,
            attributes: {
              protectedData: {
                ...protectedData,
                return: updatedReturnData
              }
            }
          });
          console.log(`💾 Updated transaction with SMS notification tracking for tx ${tx?.id?.uuid || '(no id)'}`);
        } catch (updateError) {
          console.error(`❌ Failed to update transaction:`, updateError.message);
        }
        
        sent++;
      } catch (e) {
        console.error(`❌ SMS failed to ${borrowerPhone}:`, e?.message || e);
        failed++;
      }
      
      // Apply charges (separate try/catch so charge failures don't block SMS)
      try {
        if (DRY_RUN) {
          console.log(`💳 [DRY_RUN] Would evaluate charges for tx ${tx?.id?.uuid || '(no id)'}`);
        } else {
          const chargeResult = await applyCharges({
            sdkInstance: integSdk,  // Use Integration SDK for privileged transition
            txId: tx.id.uuid || tx.id,
            now: FORCE_NOW || new Date()
          });
          
          if (chargeResult.charged) {
            console.log(`💳 Charged ${chargeResult.items.join(' + ')} for tx ${tx?.id?.uuid || '(no id)'}`);
            if (chargeResult.amounts) {
              chargeResult.amounts.forEach(a => {
                console.log(`   💰 ${a.code}: $${(a.cents / 100).toFixed(2)}`);
              });
            }
            charged++;
          } else {
            console.log(`ℹ️ No charge for tx ${tx?.id?.uuid || '(no id)'} (${chargeResult.reason || 'n/a'})`);
          }
        }
      } catch (chargeError) {
        if (process.env.DIAG === '1') {
          console.error('[DIAG] Charge error details:', {
            endpoint: 'transactions.transition (via applyCharges)',
            status: chargeError.response?.status || chargeError.status,
            data: chargeError.response?.data,
            txId: tx?.id?.uuid || tx?.id,
            errorMessage: chargeError.message,
          });
        }
        
        console.error(`❌ Charge failed for tx ${tx?.id?.uuid || '(no id)'}: ${chargeError.message}`);
        
        // Check for permission errors and provide helpful guidance
        const status = chargeError.response?.status || chargeError.status;
        const data = chargeError.response?.data;
        
        if (status === 403 || status === 401 ||
            chargeError.message?.includes('403') || chargeError.message?.includes('401') ||
            chargeError.message?.includes('permission') || chargeError.message?.includes('forbidden')) {
          console.error('');
          console.error('⚠️  PERMISSION ERROR DETECTED:');
          console.error('   The transition/privileged-apply-late-fees requires proper permissions.');
          console.error('   Possible fixes:');
          console.error('   1. In process.edn, change :actor.role/operator to :actor.role/admin');
          console.error('   2. Ensure your Integration app has operator-level privileges in Flex Console');
          console.error('   3. Verify REACT_APP_SHARETRIBE_SDK_CLIENT_ID and SHARETRIBE_SDK_CLIENT_SECRET');
          console.error('');
        }
        
        if (status === 400) {
          console.error('');
          console.error('⚠️  400 BAD REQUEST - Possible causes:');
          console.error('   1. Invalid transition parameters');
          console.error('   2. Transaction state doesn\'t allow this transition');
          console.error('   3. Transition name mismatch with process.edn');
          console.error('');
          if (data?.errors) {
            console.error('   API Errors:');
            data.errors.forEach((err, i) => {
              console.error(`   [${i}] ${err.title || err.detail || JSON.stringify(err)}`);
            });
          }
        }
        
        chargesFailed++;
      }
      
      if (LIMIT && sent >= LIMIT) {
        console.log(`⏹️ Limit reached (${LIMIT}). Stopping.`);
        break;
      }
    }
    
    // Final summary
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 OVERDUE REMINDERS RUN SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Candidates processed: ${processed}`);
    console.log(`   SMS sent:             ${sent}`);
    console.log(`   SMS failed:           ${failed}`);
    console.log(`   Charges applied:      ${charged}`);
    console.log(`   Charges failed:       ${chargesFailed}`);
    console.log('═══════════════════════════════════════════════════════════');
    if (DRY_RUN) {
      console.log('   Mode: DRY_RUN (no actual SMS or charges)');
    }
    console.log('');
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Unit test helpers
function testOverdueScenarios() {
  console.log('🧪 Testing overdue scenarios:');
  
  const today = new Date('2024-01-20');
  const returnDate = new Date('2024-01-15');
  const daysLate = Math.ceil((today - returnDate) / (1000 * 60 * 60 * 24));
  
  console.log(`Days late: ${daysLate}`);
  console.log(`Per day fee: $15 (1500 cents)`);
  console.log(`Total fees: $${(1500 * daysLate) / 100}`);
  
  // Test replacement evaluation
  if (daysLate >= 5) {
    console.log('🔍 Would evaluate replacement charge');
  }
}

if (require.main === module) {
  if (argv.includes('--test')) {
    testOverdueScenarios();
  } else if (argv.includes('--daemon')) {
    // Run as daemon with internal scheduling (daily at 9 AM UTC)
    console.log('🔄 Starting overdue reminders daemon (daily at 9 AM UTC)');
    
    const runDaily = async () => {
      try {
        await sendOverdueReminders();
      } catch (error) {
        console.error('❌ Daemon error:', error.message);
      }
    };
    
    // Calculate time until next 9 AM UTC
    const now = new Date();
    const next9AM = new Date(now);
    next9AM.setUTCHours(9, 0, 0, 0);
    if (next9AM <= now) {
      next9AM.setUTCDate(next9AM.getUTCDate() + 1);
    }
    
    const msUntilNext9AM = next9AM.getTime() - now.getTime();
    console.log(`⏰ Next run scheduled for: ${next9AM.toISOString()}`);
    
    setTimeout(() => {
      runDaily();
      // Then run every 24 hours
      setInterval(runDaily, 24 * 60 * 60 * 1000);
    }, msUntilNext9AM);
    
    // Run immediately for testing
    runDaily();
  } else {
    sendOverdueReminders();
  }
}

module.exports = { sendOverdueReminders, evaluateReplacementCharge, testOverdueScenarios };

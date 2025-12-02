#!/usr/bin/env node
/**
 * Overdue Reminder SMS Script
 * 
 * Sends overdue return reminders and applies late fees:
 * - SMS reminders for borrowers who haven't returned items
 * - Applies daily late fees ($15/day) for days 1-4
 * - Applies replacement charge for day 5+ (6+ chargeable days)
 * 
 * CRON SCHEDULING (Render/Heroku):
 * Run daily at 9 AM UTC: 0 9 * * * node server/scripts/sendOverdueReminders.js
 * 
 * For testing:
 * npm run worker:overdue-reminders -- --dry-run
 */
require('dotenv').config();

/**
 * Helper function to normalize Flex error output with detailed diagnostics
 */
function logFlexError(context, err, extra = {}) {
  const status = err?.response?.status || err?.status;
  const data = err?.response?.data;
  const headers = err?.response?.headers || {};
  const correlationId =
    headers['x-sharetribe-correlation-id'] ||
    headers['x-correlation-id'] ||
    headers['x-request-id'];

  console.error('[OVERDUE][ERROR]', {
    context,
    status,
    correlationId,
    message: err?.message,
    responseData: data,
    ...extra,
  });

  if (err?.stack) {
    console.error('[OVERDUE][STACK]', err.stack);
  }
}

const getFlexSdk = require('../util/getFlexSdk');              // Integration SDK (privileged)
const { sendSMS: sendSMSOriginal } = require('../api-util/sendSMS');
const { maskPhone } = require('../api-util/phone');
const { shortLink } = require('../api-util/shortlink');
const { applyCharges } = require('../lib/lateFees');
const {
  ymd,
  computeChargeableLateDays,
} = require('../lib/businessDays');

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

// Helper function for backward compatibility (used in a few places)
function yyyymmdd(d) {
  // Use shared ymd helper which uses Pacific time
  return ymd(d);
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
    // Initialize Integration SDK for all operations (reads + transitions/charges)
    const integSdk = getFlexSdk();           // Integration SDK (privileged: reads + transitions/charges)
    const readSdk  = integSdk;               // Use Integration SDK for all transaction queries/updates
    console.log('✅ SDKs initialized (read + integ)');
    
    // Startup integration configuration logging
    console.log('[OVERDUE] Integration config', {
      baseUrl: process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL,
      integrationClientId: `${process.env.INTEGRATION_CLIENT_ID?.slice(0, 6)}…${process.env.INTEGRATION_CLIENT_ID?.slice(-4)}`,
      marketplaceId: process.env.REACT_APP_SHARETRIBE_MARKETPLACE_ID,
    });
    
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

    const today = process.env.FORCE_TODAY || ymd(new Date());
    const todayDate = new Date();
    
    console.log(`📅 Processing overdue reminders for: ${today}`);

    // ============================================================================
    // TEST PLAN - Manual Test Steps
    // ============================================================================
    // Test 1: Returned on time
    //   - Create transaction with return due date = today - 1 day
    //   - Trigger return scan before due date
    //   - Verify: No late fees, normal payout on scan
    //
    // Test 2: Returned 3 days late
    //   - Create transaction with return due date = today - 3 days
    //   - Trigger return scan today (3 days late)
    //   - Verify: 3 × $15 late fees applied, payout on scan
    //
    // Test 3: Returned 6 days late
    //   - Create transaction with return due date = today - 6 days
    //   - Trigger return scan today (6 days late)
    //   - Verify: Replacement charge applied (not daily fees), payout on scan
    //
    // Test 4: Never returned, 3 days late
    //   - Create transaction with return due date = today - 3 days
    //   - Do NOT trigger return scan
    //   - Verify: 3 × $15 late fees applied (no payout, stays in accepted state)
    //
    // Test 5: Never returned, 6 days late
    //   - Create transaction with return due date = today - 6 days
    //   - Do NOT trigger return scan
    //   - Verify: Replacement charge applied (no payout, stays in accepted state)
    //
    // ============================================================================
    // EDGE CASES: Business Days (Sundays + USPS Holidays Excluded)
    // ============================================================================
    // Test 6: Due Friday, scanned Monday (Sunday in between)
    //   - Create transaction with return due date = Friday (e.g., 2025-01-10)
    //   - Trigger return scan on Monday (e.g., 2025-01-13)
    //   - Verify: 2 chargeable late days (Sat + Mon; Sunday Jan 12 skipped)
    //   - Verify: 2 × $15 late fees applied (not 3)
    //
    // Test 7: Due Wednesday, non-return, Day 5 threshold across Sunday
    //   - Create transaction with return due date = Wednesday (e.g., 2025-01-08)
    //   - Do NOT trigger return scan
    //   - Wait until Monday (e.g., 2025-01-13) - 4 chargeable days later
    //     (Thu, Fri, Sat, Mon; Sunday Jan 12 skipped)
    //   - Verify: Replacement charge applied on Day 5 (next chargeable day after Day 4)
    //   - Verify: Day 5 effectively falls on the next chargeable day because Sunday is excluded
    //
    // Test 8: Due right before USPS holiday (e.g., Wed before Thanksgiving)
    //   - Create transaction with return due date = Wednesday (e.g., 2025-11-26)
    //   - Trigger return scan on Friday (e.g., 2025-11-28)
    //   - Verify: 1 chargeable late day (Fri only; Thu 11/27 is Thanksgiving)
    //   - Verify: 1 × $15 late fee applied (not 2)
    //
    // Test 9: Day 5 falls on a Sunday or holiday
    //   - Create transaction with return due date such that Day 5 would be Sunday/holiday
    //   - Verify: Day 5 effectively becomes the next chargeable day (e.g., Monday)
    //   - Verify: Replacement charge applies on the first chargeable day after Day 4
    //
    // ============================================================================
    // DIAGNOSTIC EXAMPLES (for verification)
    // ============================================================================
    // Case A (returned late, Sunday in middle):
    //   Due Friday, scanned Monday with Sunday in between → daysLate = 2
    //   computeChargeableLateDays('2025-01-13', '2025-01-10') // => 2 (Sat + Mon)
    //
    // Case B (non-return, multiple business days):
    //   Due Wednesday, today Monday → daysLate = 4 (Thu, Fri, Sat, Mon)
    //   computeChargeableLateDays('2025-01-13', '2025-01-08') // => 4 (Thu, Fri, Sat, Mon)
    //
    // Day-5 threshold:
    //   For computeChargeableLateDays(...) >= 5, applyCharges should attempt replacement,
    //   and subsequent runs should neither re-charge replacement nor send further SMS
    //   because replacementCharged === true.
    // ============================================================================

    // Query both states: delivered (Scenario A) and accepted (Scenario B)
    const allTransactions = [];
    const statesToQuery = ['delivered', 'accepted'];
    
    for (const state of statesToQuery) {
      const query = {
        state: state,
        include: ['customer', 'listing'],
        per_page: 100  // snake_case for Marketplace SDK
      };

      let response, transactions;
      try {
        response = await readSdk.transactions.query(query);
        transactions = response.data.data;
        const rawIncluded = response.data.included || [];
        
        // Convert included array → Map keyed by "type/uuid"
        const includedMap = new Map(
          rawIncluded.map(i => [`${i.type}/${i.id.uuid || i.id}`, i])
        );
        
        // Store transactions with their included data
        transactions.forEach(tx => {
          tx._included = includedMap;
          tx._state = state;
        });
        
        allTransactions.push(...transactions);
        console.log(`📊 Found ${transactions.length} ${state} transactions`);
      } catch (err) {
        logFlexError(`transactions.query (state=${state})`, err, { query });
        console.warn('[OVERDUE] Skipping state due to query error', { state });
        
        // Helpful hint for 403 errors
        const status = err?.response?.status || err?.status;
        if (status === 403) {
          console.error('');
          console.error('⚠️  403 FORBIDDEN - Possible causes:');
          console.error('   1. Test environment credentials may be expired or invalid');
          console.error(`   2. Marketplace SDK may not have access to ${state} state transactions`);
          console.error('   3. Try with INTEGRATION_CLIENT_ID/SECRET for broader access');
          console.error('');
        }
        
        // Helpful hint for 400 errors
        if (status === 400) {
          const data = err?.response?.data;
          console.error('');
          console.error('⚠️  400 BAD REQUEST - Possible causes:');
          console.error('   1. Invalid query parameters (check per_page vs perPage)');
          console.error('   2. Invalid state value or filter');
          console.error('   3. Malformed include parameter');
          console.error('');
          if (data?.errors) {
            console.error('   API Errors:');
            data.errors.forEach((errItem, i) => {
              console.error(`   [${i}] ${errItem.title || errItem.detail || JSON.stringify(errItem)}`);
            });
          }
        }
        
        // Continue with other states even if one fails
        continue;
      }
    }

    console.log(`📊 Total transactions to process: ${allTransactions.length}`);

    let sent = 0, failed = 0, processed = 0;
    let charged = 0, chargesFailed = 0;

    for (const tx of allTransactions) {
      processed++;
      
      const currentState = tx._state || tx?.attributes?.state;
      const included = tx._included || new Map();
      
      // Get return due date
      const protectedData = tx?.attributes?.protectedData || {};
      const returnData = protectedData.return || {};
      
      // Stop SMS once replacement has been charged
      if (returnData.replacementCharged) {
        if (VERBOSE) {
          console.log(
            `⏭️ Skipping tx ${tx?.id?.uuid || '(no id)'} - replacement already charged`
          );
        }
        continue;
      }
      
      const deliveryEnd = tx?.attributes?.deliveryEnd || tx?.attributes?.booking?.end;
      const returnDueAt = returnData.dueAt || deliveryEnd;
      
      if (!returnDueAt) {
        if (VERBOSE) console.log(`⏭️ Skipping tx ${tx?.id?.uuid || '(no id)'} - no return due date`);
        continue;
      }
      
      const returnDate = new Date(returnDueAt);
      const hasScan = !!returnData.firstScanAt;
      
      // Determine scenario and check if transaction qualifies
      let scenario;
      let shouldProcess = false;
      
      if (currentState === 'delivered' && hasScan) {
        // SCENARIO A: Returned late (has scan, in delivered state)
        // Check if scan date is after return due date (using chargeable late days)
        const scanDate = new Date(returnData.firstScanAt);
        const daysLate = computeChargeableLateDays(scanDate, returnDate);
        
        if (daysLate >= 1) {
          scenario = 'delivered-late';
          shouldProcess = true;
          console.log(`[LATE FEES] SCENARIO A: Returned late - tx ${tx?.id?.uuid || '(no id)'}, ${daysLate} chargeable days late (scan: ${ymd(scanDate)}, due: ${ymd(returnDate)})`);
        } else {
          if (VERBOSE) console.log(`✅ Returned on time for tx ${tx?.id?.uuid || '(no id)'} - no late fees`);
        }
      } else if (currentState === 'accepted' && !hasScan) {
        // SCENARIO B: Never returned (no scan, still in accepted state)
        // Check if today is past return due date (using chargeable late days)
        const daysLate = computeChargeableLateDays(todayDate, returnDate);
        
        if (daysLate >= 1) {
          scenario = 'non-return';
          shouldProcess = true;
          console.log(`[LATE FEES] SCENARIO B: Never returned - tx ${tx?.id?.uuid || '(no id)'}, ${daysLate} chargeable days late (due: ${ymd(returnDate)}, today: ${today})`);
        } else {
          if (VERBOSE) console.log(`⏭️ Not yet overdue for tx ${tx?.id?.uuid || '(no id)'}`);
        }
      } else {
        // Skip unexpected combinations
        if (VERBOSE) {
          console.log(`⏭️ Skipping tx ${tx?.id?.uuid || '(no id)'} - state=${currentState}, hasScan=${hasScan} (unexpected combination)`);
        }
        continue;
      }
      
      if (!shouldProcess) {
        continue;
      }
      
      // Calculate days late for this transaction (chargeable late days)
      // NOTE: This calculation matches the logic in lib/lateFees.js:
      // - When firstScanAt exists: use scan date (locks lateness to when item was shipped)
      // - When firstScanAt does not exist: use today (tracks ongoing lateness)
      // - Both use chargeable late days (Sundays and USPS holidays excluded)
      // - All dates normalized to Pacific time (America/Los_Angeles)
      let daysLate;
      if (scenario === 'delivered-late') {
        // Scenario A: Based on scan date (when borrower actually shipped)
        const scanDate = new Date(returnData.firstScanAt);
        daysLate = computeChargeableLateDays(scanDate, returnDate);
      } else {
        // Scenario B: Based on today (ongoing lateness for non-return)
        daysLate = computeChargeableLateDays(todayDate, returnDate);
      }
      
      // SMS reminders: Only send for Scenario B (never returned)
      // Scenario A (returned late) doesn't need reminders - item already returned
      if (scenario === 'non-return') {
        // Get borrower phone
        // First try transaction protectedData (checkout-entered phone - preferred)
        // Then fall back to customer profile protectedData
        const customerRef = tx?.relationships?.customer?.data;
        const customerKey = customerRef ? `${customerRef.type}/${customerRef.id?.uuid || customerRef.id}` : null;
        const customer = customerKey ? included.get(customerKey) : null;
        
        // Check transaction protectedData first (checkout-entered, E.164 normalized)
        const txPhone = protectedData?.customerPhone || 
                       protectedData?.phone || 
                       protectedData?.customer_phone;
        
        // Fall back to customer profile protectedData
        const profilePhone = customer?.attributes?.profile?.protectedData?.phone ||
                           customer?.attributes?.profile?.protectedData?.phoneNumber;
        
        const borrowerPhone = (txPhone && String(txPhone).trim()) || 
                             (profilePhone && String(profilePhone).trim()) || 
                             null;
        
        if (borrowerPhone) {
          if (ONLY_PHONE && borrowerPhone !== ONLY_PHONE) {
            if (VERBOSE) console.log(`↩️ Skipping ${borrowerPhone} (ONLY_PHONE=${ONLY_PHONE})`);
          } else {
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
            // SMS gating logic for Scenario B: SMS sends ONLY when:
            // 1. scenario === 'non-return' (already checked above)
            // 2. borrowerPhone exists (already checked above)
            // 3. lastNotifiedDay !== daysLate (check below)
            const overdue = returnData.overdue || {};
            const lastNotifiedDay = overdue.lastNotifiedDay;
            
            if (lastNotifiedDay !== daysLate) {
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
                message = [
                  `🚫 5+ chargeable days late.`,
                  `Per Sherbrt policy, you may be charged the full replacement value set by the lender if the item is not returned.`,
                  `Please ship back your item as soon as possible: ${shortUrl}`
                ].join(' ');
                tag = 'overdue_day5_to_borrower';
              }
              
              if (VERBOSE) {
                console.log(`📬 To ${borrowerPhone} (tx ${tx?.id?.uuid || ''}, ${daysLate} chargeable days late) → ${message}`);
              }
              
              try {
                const smsResult = await sendSMS(borrowerPhone, message, {
                  role: 'borrower',
                  tag: tag,
                  meta: { 
                    txId: tx?.id?.uuid || tx?.id,
                    listingId: listing?.id?.uuid || listing?.id,
                    daysLate: daysLate,
                    scenario: scenario
                  }
                });
                
                // Only update transaction with SMS notification tracking if SMS was actually sent
                // (Charges are now handled by applyCharges() below)
                if (!smsResult?.skipped) {
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
                    logFlexError('transactions.update (SMS notification tracking)', updateError, {
                      txId: tx?.id?.uuid || tx?.id,
                      state: currentState
                    });
                    console.error(`❌ Failed to update transaction:`, updateError.message);
                  }
                  
                  sent++;
                } else {
                  console.log(`⏭️ SMS skipped (${smsResult.reason}) - NOT updating lastNotifiedDay flag for tx ${tx?.id?.uuid || '(no id)'}`);
                }
              } catch (e) {
                console.error(`❌ SMS failed to ${borrowerPhone}:`, e?.message || e);
                failed++;
              }
            } else {
              console.log(`📅 Already notified for day ${daysLate} for tx ${tx?.id?.uuid || '(no id)'}`);
            }
          }
        } else {
          console.warn(`⚠️ No borrower phone for tx ${tx?.id?.uuid || '(no id)'} - skipping SMS`);
        }
      } else {
        // Scenario A: Item already returned, no SMS needed
        console.log(`ℹ️ [SCENARIO A] Item already returned - skipping SMS reminder`);
      }
      
      // Apply charges (separate try/catch so charge failures don't block SMS)
      // applyCharges() handles both Scenario A and Scenario B internally
      try {
        if (DRY_RUN) {
          console.log(`💳 [DRY_RUN] Would evaluate charges for tx ${tx?.id?.uuid || '(no id)'} (scenario: ${scenario})`);
        } else {
          const chargeResult = await applyCharges({
            sdkInstance: integSdk,  // Use Integration SDK for privileged transition
            txId: tx.id.uuid || tx.id,
            now: FORCE_NOW || new Date()
          });
          
          if (chargeResult.charged) {
            console.log(`💳 [${scenario}] Charged ${chargeResult.items.join(' + ')} for tx ${tx?.id?.uuid || '(no id)'} (${chargeResult.lateDays || '?'} days late)`);
            if (chargeResult.amounts) {
              chargeResult.amounts.forEach(a => {
                console.log(`   💰 ${a.code}: $${(a.cents / 100).toFixed(2)}`);
              });
            }
            charged++;
          } else {
            console.log(`ℹ️ [${scenario}] No charge for tx ${tx?.id?.uuid || '(no id)'} (${chargeResult.reason || 'n/a'})`);
          }
        }
      } catch (chargeError) {
        logFlexError(`applyCharges (scenario=${scenario})`, chargeError, {
          txId: tx?.id?.uuid || tx?.id,
          scenario: scenario,
          state: currentState
        });
        
        console.error(`❌ [${scenario}] Charge failed for tx ${tx?.id?.uuid || '(no id)'}: ${chargeError.message}`);
        
        // Check for permission errors and provide helpful guidance
        const status = chargeError.response?.status || chargeError.status;
        const data = chargeError.response?.data;
        
        if (status === 403 || status === 401 ||
            chargeError.message?.includes('403') || chargeError.message?.includes('401') ||
            chargeError.message?.includes('permission') || chargeError.message?.includes('forbidden')) {
          console.error('');
          console.error('⚠️  PERMISSION ERROR DETECTED:');
          console.error('   The late-fee transitions require proper permissions.');
          console.error('   Possible fixes:');
          console.error('   1. In process.edn, ensure :actor.role/operator has access');
          console.error('   2. Ensure your Integration app has operator-level privileges in Flex Console');
          console.error('   3. Verify INTEGRATION_CLIENT_ID and INTEGRATION_CLIENT_SECRET');
          console.error(`   4. Check that transition exists for scenario: ${scenario}`);
          console.error('');
        }
        
        if (status === 400) {
          console.error('');
          console.error('⚠️  400 BAD REQUEST - Possible causes:');
          console.error('   1. Invalid transition parameters');
          console.error(`   2. Transaction state doesn't allow this transition (scenario: ${scenario})`);
          console.error('   3. Transition name mismatch with process.edn');
          console.error(`   4. Expected transition: ${scenario === 'delivered-late' ? 'transition/privileged-apply-late-fees' : 'transition/privileged-apply-late-fees-non-return'}`);
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
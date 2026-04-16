#!/usr/bin/env node
/**
 * Overdue Reminder SMS Script
 * 
 * Sends overdue return reminders and applies late fees:
 * - SMS reminders for borrowers who haven't returned items
 * - Applies daily late fees ($15/day) starting Day 1
 * - Replacement charging is manual / operator-initiated (not automatic)
 * 
 * CRON SCHEDULING (Render/Heroku):
 * Run daily at 17:00 UTC (~10 AM PT): 0 17 * * * node server/scripts/sendOverdueReminders.js
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
const { getRedis } = require('../redis');
const {
  ymd,
  computeChargeableLateDays,
} = require('../lib/businessDays');
const { sendTransactionalEmail } = require('../email/emailClient');

// Redis SMS dedupe constants (mirrors sendShippingReminders.js pattern)
const SENT_TTL_SEC     = 7 * 24 * 60 * 60; // 7 days
const INFLIGHT_TTL_SEC = 10 * 60;           // 10 min
const LATE_FEE_CENTS   = 1500;              // $15 per charge (digest)

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
const ONLY_TX = process.env.ONLY_TX;      // e.g. specific transaction UUID for targeted test
const FORCE_NOW = process.env.FORCE_NOW ? new Date(process.env.FORCE_NOW) : null;

if (FORCE_NOW) {
  console.log(`⏰ FORCE_NOW active: ${FORCE_NOW.toISOString()}`);
}

// Per-run guard to avoid duplicate sends if persistence fails mid-run
const runNotificationGuard = new Map();

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

function hasReplacementCharged(tx) {
  const pd = tx?.attributes?.protectedData || {};
  const ret = pd.return || {};
  return !!ret.replacementCharged;
}

async function triggerReplacementCompletionIfNeeded({ sdk, txId }) {
  try {
    const { data } = await sdk.transactions.show({ id: txId });
    const tx = data.data;
    const state = tx?.attributes?.state;
    const lastTransition = tx?.attributes?.lastTransition;
    const replacementCharged = hasReplacementCharged(tx);
    
    console.log('[REPLACEMENT-PAYOUT] check', {
      txId,
      state,
      lastTransition,
      replacementCharged,
    });

    if (!replacementCharged) {
      console.log('[REPLACEMENT-PAYOUT] Skip - replacement not charged yet');
      return;
    }

    if (state !== 'accepted') {
      console.log('[REPLACEMENT-PAYOUT] Skip - state not accepted (likely already completed)');
      return;
    }

    if (lastTransition === 'transition/complete-return' || lastTransition === 'transition/complete-replacement') {
      console.log('[REPLACEMENT-PAYOUT] Skip - already completed via', lastTransition);
      return;
    }

    try {
      await sdk.transactions.transition({
        id: txId,
        transition: 'transition/complete-replacement',
        params: {}
      });
      console.log('[REPLACEMENT-PAYOUT] transition/complete-replacement triggered successfully');
    } catch (transitionError) {
      const status = transitionError?.response?.status || transitionError?.status;
      const code = transitionError?.response?.data?.errors?.[0]?.code;
      const title = transitionError?.response?.data?.errors?.[0]?.title || transitionError?.message;
      if (status === 400 || status === 409) {
        console.log(`[REPLACEMENT-PAYOUT] Idempotent skip (status ${status}, code ${code || 'none'}): ${title}`);
      } else {
        console.error('[REPLACEMENT-PAYOUT] Failed to trigger transition/complete-replacement', {
          status,
          code,
          title,
          message: transitionError.message,
        });
      }
    }
  } catch (error) {
    console.error('[REPLACEMENT-PAYOUT] Failed to load transaction for completion', {
      txId,
      message: error?.message,
    });
  }
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

/**
 * Send daily late-fee digest email (§3b.2)
 * Summarizes all charges and skips from the current run.
 */
async function sendLateFeeDigest(events) {
  const ymdToday = ymd(new Date());
  const chargedEvents = events.filter(e => e.bucket === 'charged');
  const skippedEvents = events.filter(e => e.bucket.startsWith('skipped_'));
  const totalCents = chargedEvents.reduce((s, e) => s + e.totalCents, 0);
  const totalDollars = (totalCents / 100).toFixed(2);

  const lines = [
    `Sherbrt late-fee digest for ${ymdToday}`,
    ``,
    `Charged: $${totalDollars} across ${chargedEvents.length} tx(s)`,
    ...chargedEvents.map(e =>
      `  tx ${e.txId?.slice(0, 8)} — "${e.listingTitle}" (${e.borrowerName}) — day ${e.daysLate} — $${(e.totalCents / 100).toFixed(2)}`
    ),
    ``,
    `Skipped: ${skippedEvents.length}`,
    ``,
    `Flag: ${process.env.OVERDUE_FEES_CHARGING_ENABLED === 'true' ? 'LIVE' : 'DISABLED (dry-run)'}`,
  ];

  try {
    await sendTransactionalEmail({
      to: process.env.OPS_ALERT_EMAIL || 'amalyb@gmail.com',
      subject: `[Sherbrt] Late-fee digest ${ymdToday} — $${totalDollars} (${chargedEvents.length} charged)`,
      text: lines.join('\n'),
    });
    console.log('[OVERDUE][DIGEST_SENT]', { ymd: ymdToday, charged: chargedEvents.length, totalCents });
  } catch (err) {
    console.error('[OVERDUE][DIGEST_FAILED]', { error: err.message });
  }
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

    const nowDate = FORCE_NOW || new Date();
    const today = process.env.FORCE_TODAY || ymd(nowDate);
    const todayDate = nowDate;
    
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
//   - Verify: Late fees continue; replacement requires manual operator action
    //
    // Test 4: Never returned, 3 days late
    //   - Create transaction with return due date = today - 3 days
    //   - Do NOT trigger return scan
    //   - Verify: 3 × $15 late fees applied (no payout, stays in accepted state)
    //
    // Test 5: Never returned, 6 days late
    //   - Create transaction with return due date = today - 6 days
    //   - Do NOT trigger return scan
//   - Verify: Late fees continue; replacement requires manual operator action
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
//   - Verify: Day 5+ is an escalation threshold (next chargeable day after Day 4)
//   - Verify: Late fees continue; replacement requires manual operator action (no auto replacement)
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
//   - Verify: Late fees continue; replacement (if any) is manual/operator-only (no auto replacement)
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
//   For computeChargeableLateDays(...) >= 5, treat this as an escalation threshold.
//   Continue charging daily late fees.
//   Do NOT attempt automatic replacement while auto replacement is disabled.
//   Replacement, if pursued, must be manual/operator-initiated.
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
    const chargeDigest = []; // collect charge events for end-of-run digest email (§3b.2)

    // Overdue rules summary:
    // - If past expected return date AND no return scan AND no replacement charge:
    //   -> treat as overdue and keep sending late SMS/fees (even if state === 'delivered').
    // - Once a return scan exists, or replacementCharged is true:
    //   -> stop overdue processing for this transaction.
    for (const tx of allTransactions) {
      processed++;
      
      const txId = tx?.id?.uuid || tx?.id;
      const currentState = tx._state || tx?.attributes?.state;
      const included = tx._included || new Map();
      
      // Get return due date
      const protectedData = tx?.attributes?.protectedData || {};
      const returnData = protectedData.return || {};
      const replacementCharged = hasReplacementCharged(tx);
      
      // Stop SMS once replacement has been charged
      if (replacementCharged) {
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
      let precomputedDaysLate;

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
      } else if (currentState === 'delivered' && !hasScan) {
        // POLICY SKIP (post-PR-2): once a tx reaches :state/delivered, the
        // item is considered returned; SMS + charging both stop, regardless
        // of scan data. Mirrors the skip in server/lib/lateFees.js. Covers
        // missed webhooks, operator moves, and future non-scan return paths
        // (e.g. hand-courier delivery). WARN so data anomalies still surface.
        console.warn(`[OVERDUE] SKIP tx=${tx?.id?.uuid || '(no id)'} reason=delivered-without-scan state=${currentState} — review tx for data anomaly or non-scan return path`);
        continue;
      } else if (currentState === 'accepted' && !hasScan) {
        // SCENARIO B: Never returned (no scan, still in accepted state)
        // Check if today is past return due date (using chargeable late days)
        const daysLate = computeChargeableLateDays(todayDate, returnDate);
        precomputedDaysLate = daysLate;

        if (daysLate >= 1) {
          scenario = 'non-return';
          shouldProcess = true;
          console.log(`[LATE FEES] SCENARIO B: Never returned - tx ${tx?.id?.uuid || '(no id)'}, ${daysLate} chargeable days late (due: ${ymd(returnDate)}, today: ${today}, state: ${currentState})`);
        } else {
          if (VERBOSE) console.log(`⏭️ Not yet overdue for tx ${tx?.id?.uuid || '(no id)'}`);
        }
      } else {
        // Remaining case: accepted + hasScan (borrower shipped; carrier in
        // transit; complete-return hasn't fired yet). Matches the
        // 'borrower-shipped-in-transit' skip in server/lib/lateFees.js.
        // Normal multi-day transit window, not an error.
        if (currentState === 'accepted' && hasScan) {
          console.log(`[OVERDUE] SKIP tx=${tx?.id?.uuid || '(no id)'} reason=borrower-shipped-in-transit state=${currentState} firstScanAt=${returnData.firstScanAt || 'unknown'}`);
        } else if (VERBOSE) {
          console.log(`⏭️ Skipping tx ${tx?.id?.uuid || '(no id)'} - state=${currentState}, hasScan=${hasScan} (unexpected combination)`);
        }
        continue;
      }
      
      if (!shouldProcess) {
        continue;
      }

      // Resolve listing + customer from included data (needed for digest + day-6 email)
      const listingRef = tx?.relationships?.listing?.data;
      const listingKey = listingRef ? `${listingRef.type}/${listingRef.id?.uuid || listingRef.id}` : null;
      const listing = listingKey ? included.get(listingKey) : null;

      const customerRef = tx?.relationships?.customer?.data;
      const customerKey = customerRef ? `${customerRef.type}/${customerRef.id?.uuid || customerRef.id}` : null;
      const customer = customerKey ? included.get(customerKey) : null;

      const customerName =
        customer?.attributes?.profile?.displayName ||
        customer?.attributes?.profile?.firstName ||
        'unknown';

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
        daysLate = typeof precomputedDaysLate === 'number' ? precomputedDaysLate : computeChargeableLateDays(todayDate, returnDate);
      }
      
      // Apply charges (separate try/catch so charge failures don't block SMS)
      // applyCharges() handles both Scenario A and Scenario B internally
      let chargeResult = null;
      try {
        if (DRY_RUN) {
          console.log(`💳 [DRY_RUN] Would evaluate charges for tx ${txId || '(no id)'} (scenario: ${scenario})`);
        } else {
          chargeResult = await applyCharges({
            sdkInstance: integSdk,  // Use Integration SDK for privileged transition
            txId: tx.id.uuid || tx.id,
            now: FORCE_NOW || new Date()
          });
          
          if (chargeResult.charged) {
            console.log(`💳 [${scenario}] Charged ${chargeResult.items.join(' + ')} for tx ${txId || '(no id)'} (${chargeResult.lateDays || '?'} days late)`);
            if (chargeResult.amounts) {
              chargeResult.amounts.forEach(a => {
                console.log(`   💰 ${a.code}: $${(a.cents / 100).toFixed(2)}`);
              });
            }
            charged++;
            
            // Trigger payout only after confirmed replacement charge
            if (chargeResult.items.includes('replacement')) {
              await triggerReplacementCompletionIfNeeded({
                sdk: integSdk,
                txId: tx.id.uuid || tx.id
              });
            }
          } else {
            console.log(`ℹ️ [${scenario}] No charge for tx ${txId || '(no id)'} (${chargeResult.reason || 'n/a'})`);
          }
        }
      } catch (chargeError) {
        logFlexError(`applyCharges (scenario=${scenario})`, chargeError, {
          txId: txId || tx?.id?.uuid || tx?.id,
          scenario: scenario,
          state: currentState
        });
        
        console.error(`❌ [${scenario}] Charge failed for tx ${txId || '(no id)'}: ${chargeError.message}`);
        
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

      // Digest accumulation (§3b.2) — runs for both scenario A and B
      if (chargeResult) {
        if (chargeResult.charged === true) {
          chargeDigest.push({
            bucket: 'charged',
            txId: tx?.id?.uuid,
            listingTitle: listing?.attributes?.title || 'unknown',
            borrowerName: customerName,
            daysLate: chargeResult.lateDays,
            totalCents: LATE_FEE_CENTS,
          });
        } else if (chargeResult.charged === false && chargeResult.reason) {
          chargeDigest.push({
            bucket: `skipped_${chargeResult.reason}`,
            txId: tx?.id?.uuid,
            daysLate: chargeResult.lateDays || daysLate,
            totalCents: 0,
          });
        }
      }

      // SMS reminders: Only send for Scenario B (never returned)
      // Scenario A (returned late) doesn't need reminders - item already returned
      if (scenario === 'non-return') {
        // Get borrower phone
        // First try transaction protectedData (checkout-entered phone - preferred)
        // Then fall back to customer profile protectedData

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
            // Canonical return-label URL (9.1 spec: two fields only)
            const returnLabelUrl = protectedData.returnQrUrl || protectedData.returnLabelUrl;

            if (!returnLabelUrl) {
              console.warn(`[OVERDUE][NO-LABEL] tx=${txId} day=${daysLate} — no returnQrUrl or returnLabelUrl, skipping SMS`);
              continue;
            }

            let shortUrl = returnLabelUrl;
            try {
              const maybeShort = await shortLink(returnLabelUrl);
              if (maybeShort) shortUrl = maybeShort;
            } catch (shortErr) {
              console.warn('[SMS] shortlink generation failed, using fallback', {
                txId,
                error: shortErr?.message || shortErr
              });
            }
            console.log('[SMS] shortlink', { type: 'overdue', short: shortUrl, original: returnLabelUrl });
            
            // ================================================================
            // SMS DEDUPE — Redis-backed (PR-3a, replaces dead transition call)
            // Pattern matches sendShippingReminders.js / sendReturnReminders.js.
            // runNotificationGuard kept as belt-and-suspenders intra-run guard.
            // ================================================================
            if (daysLate > 6) {
              if (!ONLY_TX || txId === ONLY_TX) {
                console.log('[OVERDUE][DAY>6][HARD-STOP]', { txId, daysLate });
              }
              continue; // Hard stop after day 6 — no SMS or persistence attempts
            }

            const redis = getRedis();
            const sentKey = `overdueNotified:${txId}:${daysLate}:sent`;
            const inFlightKey = `overdueNotified:${txId}:${daysLate}:inFlight`;

            // Check Redis sent mark
            if (await redis.get(sentKey)) {
              console.log(`[OVERDUE][ALREADY-SENT] tx=${txId} day=${daysLate}`);
              continue;
            }
            // Check Redis in-flight mark
            if (await redis.get(inFlightKey)) {
              console.log(`[OVERDUE][IN-FLIGHT] tx=${txId} day=${daysLate}`);
              continue;
            }
            // Belt-and-suspenders: in-memory guard for intra-run dupes
            const runGuardDay = runNotificationGuard.get(txId);
            if (runGuardDay === daysLate) {
              console.log(`[OVERDUE][RUN-GUARD] tx=${txId} day=${daysLate}`);
              continue;
            }

            if (DRY_RUN) {
              console.log(`[OVERDUE][DRY-RUN] Would SET ${sentKey}`);
              continue; // DRY_RUN skips Redis writes too
            }

            // Resolve itemTitle from listing
            const itemTitle = listing?.attributes?.title || 'your item';

            // Build message using new standardized copy (9.1 spec)
            let message;
            let tag;

            if (daysLate === 1) {
              message = `⚠️ Your Sherbrt return for "${itemTitle}" ended yesterday. ` +
                `$15/day late fee may apply until scanned by the carrier. ` +
                `Please ship today using your QR/label: ${shortUrl}. ` +
                `For help: bestie@sherbrt.com.`;
              tag = 'overdue_day1_to_borrower';
            } else if (daysLate === 2) {
              message = `⚠️ Your Sherbrt return for "${itemTitle}" is now 2 days late. ` +
                `$15/day late fee applies until scanned by the carrier. ` +
                `Please ship today using your QR/label: ${shortUrl}.`;
              tag = 'overdue_day2_to_borrower';
            } else if (daysLate === 3) {
              message = `⚠️ Your Sherbrt return for "${itemTitle}" is now 3 days late. ` +
                `$15/day late fee applies until scanned by the carrier. ` +
                `Please ship today using your QR/label: ${shortUrl}.`;
              tag = 'overdue_day3_to_borrower';
            } else if (daysLate === 4) {
              message = `⚠️ Your Sherbrt return for "${itemTitle}" is now 4 days late. ` +
                `$15/day late fee continues and you may be charged the full replacement value. ` +
                `Ship immediately using your QR/label: ${shortUrl}. ` +
                `For help: bestie@sherbrt.com.`;
              tag = 'overdue_day4_to_borrower';
            } else if (daysLate === 5) {
              message = `⚠️ Your Sherbrt return for "${itemTitle}" is now 5 days late. ` +
                `$15/day late fee continues. ` +
                `Ship immediately using your QR/label: ${shortUrl} to avoid a replacement charge. ` +
                `For help: bestie@sherbrt.com.`;
              tag = 'overdue_day5_to_borrower';
            } else if (daysLate === 6) {
              message = `🚨 Your Sherbrt return for "${itemTitle}" is now 6 days late. ` +
                `Your borrow is being investigated and the full replacement value of the item may be charged. ` +
                `Please ship it back ASAP using your QR code or label: ${shortUrl}. ` +
                `For help: bestie@sherbrt.com.`;
              tag = 'overdue_day6_to_borrower';
            }

            if (VERBOSE) {
              console.log(`[SMS] To ${borrowerPhone} (tx ${txId}, day ${daysLate}) → ${message}`);
            }

            // Set in-memory guard immediately (belt-and-suspenders)
            runNotificationGuard.set(txId, daysLate);

            // Set Redis in-flight mark before SMS send
            await redis.set(inFlightKey, '1', 'EX', INFLIGHT_TTL_SEC);

            try {
              if (daysLate === 6) {
                console.log('[OVERDUE][DAY6_SENT]', {
                  txId: tx?.id?.uuid || tx?.id,
                  daysLate,
                  tag,
                });
              }

              const smsResult = await sendSMS(borrowerPhone, message, {
                role: 'borrower',
                tag: tag,
                meta: {
                  txId: tx?.id?.uuid || tx?.id,
                  listingId: listing?.id?.uuid || listing?.id,
                  daysLate,
                  scenario,
                }
              });

              if (smsResult?.success || !smsResult?.skipped) {
                // Atomic: SET NX EX closes the double-send race if two
                // processes overlap on restart.
                await redis.set(sentKey, String(daysLate), 'NX', 'EX', SENT_TTL_SEC);
                await redis.del(inFlightKey);
                sent++;

                // §3b.1 — Day-6 fire-and-forget operator alert email
                if (daysLate === 6) {
                  const emailBody = [
                    `Day-6 SMS just fired to borrower — replacement charge commitment is now in effect.`,
                    ``,
                    `Tx: ${tx?.id?.uuid || 'unknown'}`,
                    `Listing: ${listing?.attributes?.title || 'unknown'} (${listing?.id?.uuid || 'unknown'})`,
                    `Borrower: ${customerName} (${borrowerPhone})`,
                    `Return due: ${ymd(returnDate)}`,
                    `Days late: ${daysLate}`,
                    ``,
                    `Action: decide whether to trigger manual replacement charge.`,
                    `Console: https://console.sharetribe.com/o/sherbrt/transactions/${tx?.id?.uuid}`,
                  ].join('\n');

                  if (!DRY_RUN) {
                    sendTransactionalEmail({
                      to: process.env.OPS_ALERT_EMAIL || 'amalyb@gmail.com',
                      subject: `[Sherbrt] Day-6 overdue — manual replacement decision needed (tx ${tx?.id?.uuid?.slice(0, 8) || '??'})`,
                      text: emailBody,
                    }).catch(err => {
                      console.error('[OVERDUE][DAY6_EMAIL_FAILED]', { txId: tx?.id?.uuid, error: err.message });
                    });
                  } else {
                    console.log('[OVERDUE][DAY6_EMAIL_DRY_RUN]', { txId: tx?.id?.uuid });
                  }
                }
              } else {
                await redis.del(inFlightKey); // let next tick retry
                console.log(`[OVERDUE][SMS-SKIPPED] tx=${txId} reason=${smsResult?.reason}`);
              }
            } catch (e) {
              await redis.del(inFlightKey);
              console.error(`[OVERDUE][SMS-FAILED] tx=${txId} day=${daysLate}:`, e?.message || e);
              failed++;
            }
          }
        } else {
          console.warn(`⚠️ No borrower phone for tx ${tx?.id?.uuid || '(no id)'} - skipping SMS`);
        }
      } else {
        // Scenario A: Item already returned, no SMS needed
        console.log(`ℹ️ [SCENARIO A] Item already returned - skipping SMS reminder`);
      }
      
      if (LIMIT && sent >= LIMIT) {
        console.log(`⏹️ Limit reached (${LIMIT}). Stopping.`);
        break;
      }
    }
    
    // §3b.2 — Send daily late-fee digest email (end-of-run)
    if (chargeDigest.length > 0 && !DRY_RUN) {
      await sendLateFeeDigest(chargeDigest);
    } else if (chargeDigest.length > 0) {
      console.log('[OVERDUE][DIGEST_DRY_RUN]', { events: chargeDigest.length });
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
    console.log('🔍 Day 5+ escalation threshold reached (replacement is manual/operator-only)');
  }
}

if (require.main === module) {
  if (argv.includes('--test')) {
    testOverdueScenarios();
  } else if (argv.includes('--daemon')) {
    // Run as daemon with internal scheduling (daily at 17:00 UTC ~10 AM PT)
    console.log('🔄 Starting overdue reminders daemon (daily at 17:00 UTC)');
    
    const runDaily = async () => {
      try {
        await sendOverdueReminders();
      } catch (error) {
        console.error('❌ Daemon error:', error.message);
      }
    };
    
    // Calculate time until next 17:00 UTC (~10 AM PT)
    const now = new Date();
    const nextRunTime = new Date(now);
    nextRunTime.setUTCHours(17, 0, 0, 0);
    if (nextRunTime <= now) {
      nextRunTime.setUTCDate(nextRunTime.getUTCDate() + 1);
    }

    const msUntilNextRun = nextRunTime.getTime() - now.getTime();
    console.log(`⏰ Next run scheduled for: ${nextRunTime.toISOString()}`);

    setTimeout(() => {
      runDaily();
      // Then run every 24 hours
      setInterval(runDaily, 24 * 60 * 60 * 1000);
    }, msUntilNextRun);
    
    // Run immediately for testing
    runDaily();
  } else {
    sendOverdueReminders();
  }
}

module.exports = { sendOverdueReminders, evaluateReplacementCharge, testOverdueScenarios };
/**
 * Late fee policy — unified daily charging model (PR-3a, April 2026)
 *
 * - $15/day, charged daily, max 5 charges = $75 cap
 * - Charge for day N-1 on day N's cron (24h scan-lag rule)
 * - Day 1 = SMS only, no charge (daysLate <= 1 guard returns 'scan-lag-grace')
 * - Days 2-6 cron = SMS + $15 charge for prior day
 * - Day 6 = replacement warning SMS + 5th/final $15 charge (for day 5)
 * - Day 7+ = hard stop (no SMS, no charge)
 * - USPS scan stops all charging immediately ('scan-detected' skip)
 * - Cap is count-based (chargeHistory entries with code='late-fee'), not day-based
 * - Both tx states (delivered+scan, accepted+no-scan) use the same charging logic
 * - Only transition/privileged-apply-late-fees-non-return ever fires (from :state/accepted)
 * - transition/privileged-apply-late-fees (from :state/delivered) is vestigial — see note below
 * - Automatic replacement charging is DISABLED (AUTO_REPLACEMENT_ENABLED = false)
 * - Full replacement charges must be applied manually by an operator
 *
 * Vestigial transition: transition/privileged-apply-late-fees (from :state/delivered,
 * process.edn:128) was added in v4 but is never called under the unified model.
 * Any :state/delivered tx is intercepted by the hasScan check (scan-detected skip) or
 * the PR-2 delivered-without-scan policy-skip before reaching the transition call.
 * Kept in process.edn to avoid a v5 push for zero behavioral benefit.
 *
 * Called by: server/scripts/sendOverdueReminders.js
 *
 * Late days are calculated as "chargeable late days" that exclude Sundays and USPS federal holidays.
 * All dates normalized to Pacific time (America/Los_Angeles).
 */

const dayjs = require('dayjs');
const {
  TZ,
  ymd,
  isNonChargeableDate,
  computeChargeableLateDays,
} = require('./businessDays');

// Configuration
// LATE_FEE_CENTS defaults to $15/day. Can be overridden in staging via
// env var (e.g. LATE_FEE_CENTS_OVERRIDE=50 for $0.50 dry-runs).
const LATE_FEE_CENTS = process.env.LATE_FEE_CENTS_OVERRIDE
  ? parseInt(process.env.LATE_FEE_CENTS_OVERRIDE, 10)
  : 1500;

// Master kill switch for automatic overdue fee charging in applyCharges().
// Default OFF. Flip to 'true' in the Render environment to enable.
// SMS reminders in sendOverdueReminders.js are NOT gated by this flag.
const OVERDUE_FEES_CHARGING_ENABLED =
  String(process.env.OVERDUE_FEES_CHARGING_ENABLED || 'false').toLowerCase() === 'true';

// Process-version floor for late-fee charging. Bumped to v4 alongside the
// 9.0 PR-2 push that added transition/privileged-apply-late-fees{,-non-return}.
// Earlier-version transactions predate the late-fee transitions and are
// skipped cleanly with reason 'processVersion-too-old'.
const MIN_PROCESS_VERSION_FOR_LATE_FEES = 4;

// Count-based cap: max 5 charges of $15 = $75 total. This is count-based
// (how many times we've charged), not day-based (how many days late).
// Count is the correct metric because missed cron runs could skip a day,
// and we shouldn't penalize the borrower for our infrastructure gaps.
const MAX_LATE_FEE_CHARGES = 5;

// Automatic replacement charging is DISABLED. All replacement charges are
// manual/operator-only (see PR-3b day-6 email alert for the operator cue).
const AUTO_REPLACEMENT_ENABLED = false;

/**
 * Check if return shipment has been scanned by carrier.
 *
 * Under the unified model, a scan stops ALL charging immediately — the
 * 'scan-detected' early return in applyCharges() relies on this function.
 *
 * @param {Object} returnData - transaction.protectedData.return
 * @returns {boolean} True if package has been scanned/accepted by carrier
 */
function isScanned(returnData) {
  if (!returnData) return false;
  
  // Method 1: Check for firstScanAt timestamp (set by webhook)
  if (returnData.firstScanAt) {
    return true;
  }
  
  // Method 2: Check status field
  const status = returnData.status?.toLowerCase();
  if (status && ['accepted', 'in_transit'].includes(status)) {
    return true;
  }
  
  return false;
}

/**
 * Get replacement value from listing metadata.
 * Used by the MANUAL replacement path only (operator-initiated).
 * Not called by the daily late-fee charging logic.
 *
 * @param {Object} listing - Listing object from Flex API
 * @returns {number} Replacement value in cents
 * @throws {Error} If no replacement value found in listing
 */
function getReplacementValue(listing) {
  const publicData = listing?.attributes?.publicData || {};
  
  // Priority 1: Explicit replacement value
  if (publicData.replacementValueCents && publicData.replacementValueCents > 0) {
    return publicData.replacementValueCents;
  }
  
  // Priority 2: Retail price
  if (publicData.retailPriceCents && publicData.retailPriceCents > 0) {
    return publicData.retailPriceCents;
  }
  
  // Priority 3: Listing price (from attributes, not publicData)
  const listingPrice = listing?.attributes?.price;
  if (listingPrice && listingPrice.amount > 0) {
    return listingPrice.amount;
  }
  
  // No fallback - throw error
  const listingId = listing?.id?.uuid || listing?.id || 'unknown';
  throw new Error(
    `No replacement value found for listing ${listingId}. ` +
    `Please set publicData.replacementValueCents or publicData.retailPriceCents.`
  );
}

/**
 * Apply daily late fees to a transaction (unified model).
 *
 * Under the unified model, both tx states (delivered+scan, accepted+no-scan)
 * use the same charging logic: $15/day, quantity 1, max 5 charges = $75.
 * Only transition/privileged-apply-late-fees-non-return (from :state/accepted)
 * ever fires. Any :state/delivered tx is intercepted by early-return checks.
 *
 * Flow:
 * 1. Load transaction with listing data
 * 2. Gate: processVersion floor
 * 3. Early returns: scan-detected, borrower-shipped-in-transit,
 *    delivered-without-scan, unexpected state
 * 4. Guard: daysLate <= 1 → scan-lag-grace (no charge on day 1)
 * 5. Guard: already-charged-today (lastLateFeeDayCharged idempotency)
 * 6. Guard: max-charges-reached (count-based, 5 charges = $75)
 * 7. Gate: feature flag (OVERDUE_FEES_CHARGING_ENABLED)
 * 8. Call privileged-apply-late-fees-non-return with $15 line item
 *
 * Idempotency:
 * - Charge dedupe: Flex protectedData lastLateFeeDayCharged (per-day gate)
 * - Cap: chargeHistory.filter(code='late-fee').length >= 5
 * - SMS dedupe is separate (Redis, handled by sendOverdueReminders.js)
 *
 * @param {Object} options
 * @param {Object} options.sdkInstance - Flex Integration SDK instance
 * @param {string} options.txId - Transaction UUID
 * @param {Date} options.now - Current time (supports FORCE_NOW for testing)
 * @returns {Promise<Object>} { charged, reason, items, amounts, lateDays, scenario }
 */
async function applyCharges({ sdkInstance, txId, now }) {
  try {
    console.log(`[lateFees] Processing transaction ${txId}...`);
    
    // Load transaction with listing data
    const response = await sdkInstance.transactions.show({
      id: txId,
      include: ['listing']
    });
    
    const tx = response.data.data;
    const included = response.data.included || [];
    const currentState = tx.attributes?.state;

    // ============================================================================
    // GATE 1: Process-version floor.
    // Late-fee privileged transitions only exist on v>=MIN_PROCESS_VERSION.
    // Older txs skip cleanly with a structured reason. No throw.
    // ============================================================================
    const processVersion = tx.attributes?.processVersion;
    if (!processVersion || processVersion < MIN_PROCESS_VERSION_FOR_LATE_FEES) {
      console.log(`[lateFees] SKIP tx=${txId} reason=processVersion-too-old processVersion=${processVersion || 'null'} min=${MIN_PROCESS_VERSION_FOR_LATE_FEES}`);
      return {
        charged: false,
        reason: 'processVersion-too-old',
        processVersion: processVersion || null,
        minRequired: MIN_PROCESS_VERSION_FOR_LATE_FEES,
      };
    }

    // Extract listing
    const listingRef = tx.relationships?.listing?.data;
    const listingKey = listingRef ? `${listingRef.type}/${listingRef.id?.uuid || listingRef.id}` : null;
    const listing = listingKey ? included.find(i => 
      `${i.type}/${i.id.uuid || i.id}` === listingKey
    ) : null;
    
    if (!listing) {
      throw new Error(`Listing not found for transaction ${txId}`);
    }
    
    const protectedData = tx.attributes?.protectedData || {};
    const returnData = protectedData.return || {};
    
    // Determine return due date
    // Priority 1: Explicit return.dueAt
    // Priority 2: booking.end (deliveryEnd)
    const returnDueAt = returnData.dueAt || tx.attributes?.booking?.end;
    
    if (!returnDueAt) {
      throw new Error(
        `No return due date found for transaction ${txId}. ` +
        `Expected protectedData.return.dueAt or booking.end.`
      );
    }
    
    // Detect scenario based on state and firstScanAt
    const hasScan = isScanned(returnData);
    const scanDate = returnData.firstScanAt ? dayjs(returnData.firstScanAt) : null;

    // ============================================================================
    // UNIFIED DAILY CHARGING — early returns for non-chargeable states
    // ============================================================================
    // Under the unified model, both tx states charge $15/day, quantity 1.
    // The only question is: has a scan appeared? If yes, stop charging.
    // Only accepted && !hasScan proceeds to the charging path.
    // ============================================================================

    if (hasScan) {
      // Scan detected — item has been returned (or is in transit).
      // No further charging regardless of how many late days remain.
      console.log(`[lateFees] SKIP tx=${txId} reason=scan-detected ` +
        `scanDate=${scanDate ? ymd(scanDate) : 'unknown'} returnDueAt=${ymd(returnDueAt)}`);
      return { charged: false, reason: 'scan-detected' };
    }

    if (currentState === 'delivered' && !hasScan) {
      // POLICY SKIP: Transaction reached :state/delivered without a scan on
      // record. Possible causes: operator move, missed webhook, or (future)
      // a non-scan return path such as hand-courier delivery. Policy: once
      // state is delivered, the item is considered returned and late fees
      // stop regardless of scan data. Logged at WARN so data anomalies still
      // surface for investigation until non-scan return paths are formalized.
      console.warn(`[lateFees] SKIP tx=${txId} reason=delivered-without-scan state=${currentState} — review tx for data anomaly or non-scan return path`);
      return {
        charged: false,
        reason: 'delivered-without-scan',
        state: currentState,
        hasScan: false,
      };
    }

    if (currentState !== 'accepted') {
      // Genuine unexpected state (e.g. preauthorized, cancelled, expired).
      // Shouldn't happen inside the overdue cron's query, but guard anyway.
      console.log(`[lateFees] SKIP tx=${txId} reason=state-${currentState}-unhandled hasScan=${hasScan}`);
      return {
        charged: false,
        reason: `state-${currentState}-unhandled`,
        state: currentState,
        hasScan,
      };
    }

    // ============================================================================
    // From here: currentState === 'accepted' && !hasScan (non-return path)
    // This is the ONLY path that reaches the charging transition.
    // ============================================================================
    // NOTE: `scenario` in the *return value* stays 'non-return' for backward-compat
    // with nonReturnNeverShips.js and callers that switch on it. The *chargeHistory*
    // entry uses 'daily-overdue' (see below). This asymmetry is intentional.
    const scenario = 'non-return';
    const effectiveDate = dayjs(now);
    const lateDays = computeChargeableLateDays(now, returnDueAt);

    console.log(`[lateFees] Charging path: state=${currentState} hasScan=false`);
    console.log(`[lateFees] Return due: ${ymd(returnDueAt)}, Today: ${ymd(now)}, Days late: ${lateDays}`);

    if (lateDays < 1) {
      console.log(`[lateFees] Not yet overdue - no charges apply`);
      return {
        charged: false,
        reason: 'not-overdue',
        lateDays,
        scenario,
      };
    }

    // ============================================================================
    // SCAN-LAG GRACE: day 1 cron never charges.
    // The scan-lag rule says "charge for day N-1 on day N's cron," and there
    // is no day 0 to charge for. This guard codifies that as a code-level
    // gate rather than relying solely on cron timing — if the cron ever fires
    // early or a manual invocation passes daysLate=1, this prevents a false charge.
    // ============================================================================
    if (lateDays <= 1) {
      console.log(`[lateFees] SKIP tx=${txId} reason=scan-lag-grace daysLate=${lateDays}`);
      return { charged: false, reason: 'scan-lag-grace', daysLate: lateDays };
    }

    // Per-day idempotency: only one charge per effective date
    const lastLateFeeDayCharged = returnData.lastLateFeeDayCharged;
    const effectiveYmd = ymd(effectiveDate);

    if (lastLateFeeDayCharged === effectiveYmd) {
      console.log(`[lateFees] SKIP tx=${txId} reason=already-charged-today effective=${effectiveYmd}`);
      return { charged: false, reason: 'already-charged-today', lateDays, scenario };
    }

    // ============================================================================
    // COUNT-BASED CAP: max 5 charges total = $75.
    // Count-based (how many times we've charged), not day-based. If cron missed
    // a day, the borrower isn't penalized for our infrastructure gaps.
    // Filter by code='late-fee' (not scenario) so old 'non-return' entries
    // from before the 'daily-overdue' rename still count toward the cap.
    // ============================================================================
    const priorChargeCount = (returnData.chargeHistory || [])
      .filter(e => e.items?.some(i => i.code === 'late-fee'))
      .length;

    if (priorChargeCount >= MAX_LATE_FEE_CHARGES) {
      console.log(`[lateFees] SKIP tx=${txId} reason=max-charges-reached count=${priorChargeCount}`);
      return { charged: false, reason: 'max-charges-reached', chargeCount: priorChargeCount, lateDays, scenario };
    }

    // Build the line item — always quantity: 1, always $15.
    const newLineItems = [{
      code: 'late-fee',
      unitPrice: { amount: LATE_FEE_CENTS, currency: 'USD' },
      quantity: 1,
      percentage: 0,
      includeFor: ['customer'],
    }];

    console.log(`[lateFees] Charging $${LATE_FEE_CENTS / 100} for tx=${txId} ` +
      `day=${lateDays} effective=${effectiveYmd} chargeCount=${priorChargeCount + 1}/${MAX_LATE_FEE_CHARGES}`);

    // ============================================================================
    // GATE 3: Feature flag.
    // Master kill switch. Ships defaulted OFF. Until flipped to true in the
    // Render env, every call here short-circuits with a structured reason
    // and a `wouldCharge` summary so we can verify amounts in dry-run logs
    // before enabling real billing in prod.
    // ============================================================================
    if (!OVERDUE_FEES_CHARGING_ENABLED) {
      const wouldCharge = newLineItems.map(i => ({
        code: i.code,
        cents: i.unitPrice.amount,
      }));
      console.log(`[lateFees] SKIP tx=${txId} reason=feature-flag-disabled wouldCharge=${JSON.stringify(wouldCharge)} lateDays=${lateDays} scenario=${scenario}`);
      return {
        charged: false,
        reason: 'feature-flag-disabled',
        wouldCharge,
        lateDays,
        scenario,
      };
    }

    // ============================================================================
    // TRANSITION CALL
    // Under the unified model, only privileged-apply-late-fees-non-return fires
    // (from :state/accepted). See file-level docstring for vestigial transition note.
    // ============================================================================
    const transitionName = 'transition/privileged-apply-late-fees-non-return';
    console.log(`[lateFees] Calling ${transitionName} with 1 line item...`);

    await sdkInstance.transactions.transition({
      id: txId,
      transition: transitionName,
      params: {
        lineItems: newLineItems,
        protectedData: {
          ...protectedData,
          return: {
            ...returnData,
            lastLateFeeDayCharged: effectiveYmd,
            // Track charge history with 'daily-overdue' scenario.
            // Old entries used 'non-return' — cap filter uses code='late-fee',
            // not scenario, so they're backward-compatible.
            chargeHistory: [
              ...(returnData.chargeHistory || []),
              {
                date: effectiveYmd,
                scenario: 'daily-overdue',
                items: newLineItems.map(i => ({ code: i.code, amount: i.unitPrice.amount })),
                timestamp: dayjs(now).toISOString(),
                lateDays,
              }
            ]
          }
        }
      }
    });

    console.log(`[lateFees] Charges applied successfully (${transitionName}, day ${lateDays}, $${LATE_FEE_CENTS / 100})`);

    return {
      charged: true,
      items: ['late-fee'],
      amounts: [{ code: 'late-fee', cents: LATE_FEE_CENTS }],
      lateDays,
      scenario,
    };
    
  } catch (error) {
    // Enhance error with context
    const enhancedError = new Error(
      `Failed to apply late fees for transaction ${txId}: ${error.message}`
    );
    enhancedError.originalError = error;
    enhancedError.txId = txId;
    enhancedError.timestamp = dayjs(now).toISOString();
    
    console.error(`[lateFees] ❌ Error:`, enhancedError.message);
    console.error(`[lateFees] Stack:`, error.stack);
    
    throw enhancedError;
  }
}

module.exports = { applyCharges, MAX_LATE_FEE_CHARGES };


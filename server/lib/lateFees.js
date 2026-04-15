/**
 * Late fee & replacement policy (manual replacement model)
 *
 * - $15/day late fees accrue starting Day 1 and continue until the item is scanned in
 * - Late fees are charged idempotently per effective day
 * - Automatic replacement charging is DISABLED by design
 * - Day 5+ represents an escalation threshold only (warnings / operator review)
 * - Full replacement charges must be applied manually by an operator
 *
 * NOTE:
 * AUTO_REPLACEMENT_ENABLED is intentionally false to prevent accidental replacement charges.
 *
 * Called by: server/scripts/sendOverdueReminders.js
 *
 * Late days are calculated as "chargeable late days" that exclude Sundays and USPS federal holidays.
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

// Hard cap on chargeable days. Defense-in-depth alongside the day-6
// SMS hard-stop in sendOverdueReminders.js.
const MAX_CHARGEABLE_DAYS = 6;

// Feature flag: gate automatic replacement charges (Day 5+) while keeping daily late fees
const AUTO_REPLACEMENT_ENABLED = false;

/**
 * Check if return shipment has been scanned by carrier
 * 
 * Current policy: We continue charging late fees until carrier accepts the package.
 * Once scanned as "accepted" or "in_transit", late fees stop but replacement is prevented.
 * 
 * Adjust this logic if your policy differs (e.g., continue fees until delivered).
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
 * Get replacement value from listing metadata
 * Tries multiple fields in priority order
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
 * Apply late fees and/or replacement charges to a transaction
 * 
 * This function handles two scenarios:
 * - SCENARIO A: Returned late (state: 'delivered', has firstScanAt)
 * - SCENARIO B: Never returned (state: 'accepted', no firstScanAt)
 * 
 * Process:
 * 1. Loads transaction with listing data
 * 2. Detects scenario (A or B) based on state and firstScanAt
 * 3. Calculates days late (scanDate-based for A, today-based for B)
 * 4. Checks idempotency flags (what's already been charged)
 * 5. Builds line items for new charges
 * 6. Calls appropriate privileged transition to charge customer
 * 7. Updates protectedData to prevent duplicate charges
 * 
 * Idempotency:
 * - Late fees: Max one charge per day (tracked by lastLateFeeDayCharged)
 * - Replacement: Max one charge ever (tracked by replacementCharged boolean)
 * - Once replacement is charged, no further daily fees are added
 * 
 * @param {Object} options - Configuration object
 * @param {Object} options.sdkInstance - Flex SDK instance (Integration or trusted)
 * @param {string} options.txId - Transaction UUID
 * @param {string|Date} options.now - Current time (for time-travel testing)
 * 
 * @returns {Promise<Object>} Result object with charged status and items
 * @returns {boolean} returns.charged - True if charges were applied
 * @returns {string[]} [returns.items] - Array of charged item codes (e.g., ['late-fee', 'replacement'])
 * @returns {string} [returns.reason] - Reason if no charges applied (e.g., 'no-op', 'not-overdue')
 * @returns {string} [returns.scenario] - 'delivered-late' or 'non-return'
 * 
 * @throws {Error} If transaction not found, missing return date, or API errors
 * 
 * @example
 * const result = await applyCharges({
 *   sdkInstance: sdk,
 *   txId: 'abc-123-def-456',
 *   now: new Date()
 * });
 * 
 * if (result.charged) {
 *   console.log(`Charged: ${result.items.join(', ')} (scenario: ${result.scenario})`);
 * } else {
 *   console.log(`No charges: ${result.reason}`);
 * }
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

    let scenario, lateDays, transitionName, effectiveDate;
    
    // ============================================================================
    // LATE DAYS CALCULATION LOGIC (Chargeable Business Days)
    // ============================================================================
    // Case A: firstScanAt exists (returned, possibly late)
    //   → lateDays = chargeable days between returnDueDate and scanDate
    //   → This locks in lateness based on when borrower actually shipped
    //   → Example: dueDate = Jan 10 (Fri), firstScanAt = Jan 13 (Mon)
    //     → lateDays = 2 (Sat + Mon; Sunday Jan 12 skipped)
    //   → Even if today = Jan 20, we STILL use 2 (not 10) - no stacking after scan
    //
    // Case B: firstScanAt does not exist (no scan/non-return)
    //   → lateDays = chargeable days between returnDueDate and today
    //   → This tracks ongoing lateness for items never returned
    //   → Example: dueDate = Jan 10 (Fri), today = Jan 13 (Mon)
    //     → lateDays = 2 (Sat + Mon; Sunday Jan 12 skipped)
    //   → This updates daily until item is returned or replacement charged
    //   → Sundays and USPS holidays are excluded from the count
    //   → All dates normalized to Pacific time (America/Los_Angeles)
    // ============================================================================
    
    if (currentState === 'delivered' && hasScan) {
      // SCENARIO A: Returned late (has scan, in delivered state)
      scenario = 'delivered-late';
      effectiveDate = scanDate;
      
      // When a return scan exists, lateDays is calculated using scan date vs due date.
      // This ensures lateness is locked to when borrower actually shipped, not current date.
      // Calculate late days based on scan date (when item was actually returned)
      lateDays = computeChargeableLateDays(scanDate, returnDueAt);
      
      transitionName = 'transition/privileged-apply-late-fees';
      
      console.log(`[lateFees] SCENARIO A: Returned late`);
      console.log(`[lateFees] State: ${currentState}, Scan date: ${ymd(scanDate)}, Return due: ${ymd(returnDueAt)}`);
      console.log(`[lateFees] Days late (based on scan): ${lateDays}`);
      
    } else if (currentState === 'accepted' && !hasScan) {
      // SCENARIO B: Never returned (no scan, still in accepted state)
      scenario = 'non-return';
      effectiveDate = dayjs(now);

      // When no scan exists, lateDays is calculated using today vs due date.
      // This tracks ongoing lateness for items that haven't been returned yet.
      // Calculate late days based on today (how many days past due)
      lateDays = computeChargeableLateDays(now, returnDueAt);

      transitionName = 'transition/privileged-apply-late-fees-non-return';

      console.log(`[lateFees] SCENARIO B: Never returned (state=${currentState})`);
      console.log(`[lateFees] No scan, Return due: ${ymd(returnDueAt)}, Today: ${ymd(now)}`);
      console.log(`[lateFees] Days late (based on today): ${lateDays}`);

    } else if (currentState === 'accepted' && hasScan) {
      // POLICY SKIP: Borrower has shipped the return (first scan recorded) but
      // the package is still in transit — complete-return hasn't fired yet.
      // The late fee clock stops at first scan; we do not penalize borrowers
      // for carrier transit time. Normal multi-day window, not an error.
      // Log the raw ISO firstScanAt (not just the YMD date) so future
      // staleness investigations can grep for scans older than N days.
      console.log(`[lateFees] SKIP tx=${txId} reason=borrower-shipped-in-transit state=${currentState} firstScanAt=${returnData.firstScanAt || 'unknown'}`);
      return {
        charged: false,
        reason: 'borrower-shipped-in-transit',
        state: currentState,
        hasScan: true,
        firstScanAt: returnData.firstScanAt || null,
        scanDate: scanDate ? ymd(scanDate) : null,
      };

    } else if (currentState === 'delivered' && !hasScan) {
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

    } else {
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
    
    if (lateDays < 1) {
      console.log(`[lateFees] Not yet overdue - no charges apply`);
      return {
        charged: false,
        reason: 'not-overdue',
        lateDays,
        scenario
      };
    }

    // ============================================================================
    // GATE 2: Day-6 hard cap.
    // The cron already hard-stops SMS at Day 6. We mirror that cap here
    // inside applyCharges() so an out-of-band caller can't accidentally
    // bill past the policy ceiling.
    // ============================================================================
    if (lateDays > MAX_CHARGEABLE_DAYS) {
      console.log(`[lateFees] SKIP tx=${txId} reason=exceeded-max-chargeable-days lateDays=${lateDays} max=${MAX_CHARGEABLE_DAYS}`);
      return {
        charged: false,
        reason: 'exceeded-max-chargeable-days',
        lateDays,
        maxChargeableDays: MAX_CHARGEABLE_DAYS,
        scenario,
      };
    }
    
    // Get idempotency flags
    const lastLateFeeDayCharged = returnData.lastLateFeeDayCharged;
    const replacementCharged = returnData.replacementCharged === true;
    
    console.log(`[lateFees] Idempotency: lastFeeDay=${lastLateFeeDayCharged}, replacementCharged=${replacementCharged}`);
    
    // Build line items for new charges
    const newLineItems = [];
    const effectiveYmd = ymd(effectiveDate);
    
    // Late fee logic:
    // - Days 1-4: Charge $15/day (one charge per day, idempotent)
    // - Day 5+: Skip daily fees, charge replacement instead
    // - If replacement already charged, skip everything
    
    if (replacementCharged) {
      console.log(`[lateFees] Replacement already charged - no further charges apply`);
    } else if (AUTO_REPLACEMENT_ENABLED && lateDays >= 5) {
      // Replacement charging is feature-flagged OFF. This block remains for future use.
      const replacementCents = getReplacementValue(listing);
      newLineItems.push({
        code: 'replacement',
        unitPrice: { amount: replacementCents, currency: 'USD' },
        quantity: 1,
        percentage: 0,
        includeFor: ['customer']
      });
      console.log(`[lateFees] Adding replacement charge: $${replacementCents / 100} (Day ${lateDays}+)`);
    } else if (lateDays >= 1) {
      if (lateDays >= 5 && !AUTO_REPLACEMENT_ENABLED) {
        // Day 5+ behavior (auto replacement disabled):
        // - Automatic replacement is disabled
        // - Continue charging daily late fees
        // - Replacement, if needed, is handled manually by an operator
        console.log('[lateFees] [replacement-disabled] lateDays>=5; auto replacement disabled; continuing daily late fees only');
      }
      // Days 1+ (including 5+ when replacement is disabled): charge daily late fee if not already charged for this day
      if (lastLateFeeDayCharged !== effectiveYmd) {
        newLineItems.push({
          code: 'late-fee',
          unitPrice: { amount: LATE_FEE_CENTS, currency: 'USD' },
          quantity: 1,
          percentage: 0,
          includeFor: ['customer']
        });
        console.log(`[lateFees] Adding late fee: $${LATE_FEE_CENTS / 100} for day ${lateDays} (effective date: ${effectiveYmd})`);
      } else {
        console.log(`[lateFees] Late fee already charged for effective date ${effectiveYmd}`);
      }
    }
    
    // No-op path: Nothing to charge
    if (newLineItems.length === 0) {
      console.log(`[lateFees] No new charges to apply`);
      return { 
        charged: false, 
        reason: 'no-op',
        lateDays,
        scenario,
        lastLateFeeDayCharged,
        replacementCharged
      };
    }
    
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

    console.log(`[lateFees] Calling ${transitionName} with ${newLineItems.length} line items...`);

    // Call privileged transition to apply charges.
    // :action/privileged-set-line-items reads from params.lineItems; no other
    // key is documented or consumed by any Flex action.
    await sdkInstance.transactions.transition({
      id: txId,
      transition: transitionName,
      params: {
        lineItems: newLineItems,
        protectedData: {
          ...protectedData,
          return: {
            ...returnData,
            // Update idempotency flags
            lastLateFeeDayCharged: newLineItems.find(i => i.code === 'late-fee') 
              ? effectiveYmd 
              : lastLateFeeDayCharged,
            replacementCharged: replacementCharged || newLineItems.some(i => i.code === 'replacement'),
            // Track charge history
            chargeHistory: [
              ...(returnData.chargeHistory || []),
              {
                date: effectiveYmd,
                scenario: scenario,
                items: newLineItems.map(i => ({ code: i.code, amount: i.unitPrice.amount })),
                timestamp: dayjs(now).toISOString(),
                lateDays: lateDays
              }
            ]
          }
        }
      }
    });
    
    console.log(`[lateFees] ✅ Charges applied successfully (scenario: ${scenario})`);
    
    // Return success
    return {
      charged: true,
      items: newLineItems.map(i => i.code),
      amounts: newLineItems.map(i => ({ code: i.code, cents: i.unitPrice.amount })),
      lateDays,
      scenario
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

// Export only applyCharges
module.exports = { applyCharges };


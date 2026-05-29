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
 * Lender share split (added May 2026 — gated by LATE_FEE_LENDER_SHARE_ENABLED,
 * default OFF):
 * - When ON, each daily late fee emits TWO line items:
 *     1. customer-side  `late-fee`            ($15 charged to borrower)
 *     2. provider-side  `late-fee-lender-share` (LENDER_LATE_FEE_SHARE_PCT% of $15
 *        added to lender's payout total — default 50% = $7.50/day)
 *   Borrower-facing UX is unchanged: same $15 charge, same cap, same SMS copy.
 *   The provider line item adds to the cumulative payout total and is only
 *   actually transferred at the next stripe-create-payout action, which fires
 *   on :transition/complete-return or :transition/complete-replacement.
 * - When OFF, only the customer-side line item is emitted (historical behavior
 *   — 100% of late fees to Sherbrt).
 * - Replacement value (manual, operator-only) is NOT affected by this flag;
 *   replacement = make-whole-for-lost-asset, lender share handled separately by
 *   operator at the time of the manual replacement charge.
 *
 * Cap accounting note: the count-based cap filter matches `code === 'late-fee'`,
 * not the new `late-fee-lender-share` code, so adding the lender share does NOT
 * inflate the cap — 5 charges = 5 chargeHistory entries either way.
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

// =============================================================================
// LENDER SHARE OF DAILY LATE FEE
// =============================================================================
// Master kill switch for routing a share of each daily late fee to the lender's
// payout. Default OFF — when OFF, every late fee continues to go 100% to
// Sherbrt (historical behavior). When ON, a provider-side line item is added
// to each charge so the lender receives LENDER_LATE_FEE_SHARE_PCT% of the
// fee in their next payout (at complete-return or complete-replacement).
//
// Rollout pattern matches OVERDUE_FEES_CHARGING_ENABLED (9.0 PR-1 → PR-5):
// ship with flag OFF, dry-run in staging, flip in prod after verification.
const LATE_FEE_LENDER_SHARE_ENABLED =
  String(process.env.LATE_FEE_LENDER_SHARE_ENABLED || 'false').toLowerCase() === 'true';

// Percent of each daily late fee routed to the lender. Default 50% — see the
// May 2026 lender-share policy note in CLAUDE_CONTEXT.md for rationale. Clamped
// 0-100; values outside the range are coerced to the nearest bound. Override
// via env for staging (e.g. LENDER_LATE_FEE_SHARE_PCT_OVERRIDE=25 to test a
// 25/75 split before committing to a code change).
const LENDER_LATE_FEE_SHARE_PCT_RAW = process.env.LENDER_LATE_FEE_SHARE_PCT_OVERRIDE
  ? parseInt(process.env.LENDER_LATE_FEE_SHARE_PCT_OVERRIDE, 10)
  : 50;
const LENDER_LATE_FEE_SHARE_PCT = Number.isFinite(LENDER_LATE_FEE_SHARE_PCT_RAW)
  ? Math.max(0, Math.min(100, LENDER_LATE_FEE_SHARE_PCT_RAW))
  : 50;

/**
 * Compute the effective cents contribution of a single line item.
 *
 * Mirrors Sharetribe's own line-total calculation:
 *  - percentage-based items: unitPrice * (percentage / 100)
 *  - quantity-based items:   unitPrice * quantity (default quantity 1)
 *
 * Used to populate `amounts` / `wouldCharge` summaries with EFFECTIVE money
 * moved per item (e.g. lender-share at 50% reports 750 cents, not 1500), so
 * digests, dry-run logs, and audit history reflect actual cash flow.
 *
 * Rounding: Math.round is half-up (rounds .5 toward +∞), NOT banker's
 * rounding (half-to-even). At realistic percentages (25/50/75/100) no
 * rounding occurs. At odd percentages (33/67/etc.) the JS-side rounding may
 * disagree with Sharetribe's own line-total rounding by 1 cent; treat
 * `amounts[].cents` as a high-fidelity ESTIMATE, not as the authoritative
 * line-total. The authoritative value is whatever Sharetribe persists on
 * `tx.attributes.lineItems[].lineTotal` after the transition.
 *
 * @param {Object} lineItem
 * @returns {number} cents (integer, Math.round half-up)
 */
function lineItemEffectiveCents(lineItem) {
  const base = lineItem?.unitPrice?.amount || 0;
  const pct = lineItem?.percentage;
  if (typeof pct === 'number' && pct !== 0) {
    return Math.round((base * pct) / 100);
  }
  const qty = typeof lineItem?.quantity === 'number' ? lineItem.quantity : 1;
  return base * qty;
}

/**
 * Build the line items for ONE daily late-fee charge.
 *
 * Always emits the customer-side `late-fee` line item ($lateFeeCents,
 * quantity 1, includeFor customer). When `lenderSharePct > 0`, ALSO emits a
 * provider-side `late-fee-lender-share` line item that adds
 * lateFeeCents * lenderSharePct / 100 to the lender's payout total.
 *
 * Shape of the provider line item mirrors `line-item/provider-commission` in
 * server/api-util/lineItems.js: percentage-based, no quantity, so Sharetribe
 * computes lineTotal = unitPrice * percentage / 100.
 *
 * Sherbrt's take per charge = lateFeeCents * (1 - lenderSharePct/100)
 * (less Stripe processing on the customer-side charge).
 *
 * Exported for unit testing.
 *
 * @param {Object} opts
 * @param {number} opts.lateFeeCents - Full daily charge in cents (e.g. 1500).
 * @param {number} opts.lenderSharePct - 0-100. Set to 0 to suppress provider line.
 * @returns {Array<Object>} Sharetribe line items
 */
function buildLateFeeLineItems({ lateFeeCents, lenderSharePct }) {
  const customerLine = {
    code: 'late-fee',
    unitPrice: { amount: lateFeeCents, currency: 'USD' },
    quantity: 1,
    percentage: 0,
    includeFor: ['customer'],
  };

  if (!lenderSharePct || lenderSharePct <= 0) {
    return [customerLine];
  }

  const providerLine = {
    code: 'late-fee-lender-share',
    unitPrice: { amount: lateFeeCents, currency: 'USD' },
    percentage: lenderSharePct,
    includeFor: ['provider'],
  };

  return [customerLine, providerLine];
}

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
    
    // Load transaction with listing + booking data
    const response = await sdkInstance.transactions.show({
      id: txId,
      include: ['listing', 'booking']
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
    // Priority 2: booking.end resolved from the INCLUDED booking resource.
    //   booking is a relationship, not a tx attribute, so tx.attributes.booking?.end
    //   is always undefined; the show() above now includes 'booking'.
    const bookingRef = tx.relationships?.booking?.data;
    const bookingKey = bookingRef ? `${bookingRef.type}/${bookingRef.id?.uuid || bookingRef.id}` : null;
    const includedBookingEnd = bookingKey
      ? included.find(i => `${i.type}/${i.id.uuid || i.id}` === bookingKey)?.attributes?.end
      : null;
    const returnDueAt = returnData.dueAt || tx.attributes?.booking?.end || includedBookingEnd;
    
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

    // Build the line items. Borrower always pays LATE_FEE_CENTS (quantity 1).
    // When the lender-share flag is ON, also emit a provider-side line item
    // that routes LENDER_LATE_FEE_SHARE_PCT% of the fee to the lender at the
    // next payout transition (complete-return / complete-replacement).
    // Borrower charge amount is identical either way; only the split changes.
    const effectiveLenderSharePct = LATE_FEE_LENDER_SHARE_ENABLED
      ? LENDER_LATE_FEE_SHARE_PCT
      : 0;
    const newLineItems = buildLateFeeLineItems({
      lateFeeCents: LATE_FEE_CENTS,
      lenderSharePct: effectiveLenderSharePct,
    });

    // lenderShareCents/platformShareCents are JS-side SUMMARIES used for
    // dry-run logs, the digest email, and the chargeHistory audit trail.
    // At realistic configs (25/50/75/100) they match Sharetribe's
    // authoritative line-total exactly. At odd percentages (33, 67, etc.)
    // Sharetribe's own rounding may disagree with Math.round by 1 cent; the
    // authoritative value is tx.attributes.lineItems[].lineTotal after the
    // transition lands. lenderShareCents + platformShareCents === LATE_FEE_CENTS
    // is guaranteed here by construction (platform = LATE_FEE_CENTS - lender),
    // so the SUMMARY is internally consistent even if it diverges from
    // Sharetribe's by a penny.
    const lenderShareCents = effectiveLenderSharePct > 0
      ? Math.round((LATE_FEE_CENTS * effectiveLenderSharePct) / 100)
      : 0;
    const platformShareCents = LATE_FEE_CENTS - lenderShareCents;

    console.log(`[lateFees] Charging $${LATE_FEE_CENTS / 100} for tx=${txId} ` +
      `day=${lateDays} effective=${effectiveYmd} chargeCount=${priorChargeCount + 1}/${MAX_LATE_FEE_CHARGES} ` +
      `split=lender:$${lenderShareCents / 100}/platform:$${platformShareCents / 100} ` +
      `lenderShareEnabled=${LATE_FEE_LENDER_SHARE_ENABLED}`);

    // ============================================================================
    // GATE 3: Feature flag.
    // Master kill switch. Ships defaulted OFF. Until flipped to true in the
    // Render env, every call here short-circuits with a structured reason
    // and a `wouldCharge` summary so we can verify amounts in dry-run logs
    // before enabling real billing in prod.
    // ============================================================================
    if (!OVERDUE_FEES_CHARGING_ENABLED) {
      // Use EFFECTIVE cents so dry-run logs show the true money flow:
      // - customer line: $15 charged
      // - provider line (when split flag on): $7.50 routed to lender
      // Pre-split tests assert `wouldCharge.some(w => w.code==='late-fee' && w.cents===1500)`
      // which is preserved (customer line is unchanged at 1500 cents).
      const wouldCharge = newLineItems.map(i => ({
        code: i.code,
        cents: lineItemEffectiveCents(i),
      }));
      console.log(`[lateFees] SKIP tx=${txId} reason=feature-flag-disabled wouldCharge=${JSON.stringify(wouldCharge)} lateDays=${lateDays} scenario=${scenario}`);
      return {
        charged: false,
        reason: 'feature-flag-disabled',
        wouldCharge,
        lateDays,
        scenario,
        lenderShareCents,
        platformShareCents,
        lenderShareEnabled: LATE_FEE_LENDER_SHARE_ENABLED,
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
                // Track EFFECTIVE cents per item (i.e. lender share at 50%
                // records 750, not 1500) so the digest + operator audit
                // reflects real money moved. The cap filter matches
                // `code === 'late-fee'` only, so this extra entry does NOT
                // count toward the 5-charge cap (one history row per charge,
                // not per line item).
                items: newLineItems.map(i => ({
                  code: i.code,
                  amount: lineItemEffectiveCents(i),
                })),
                lenderShareCents,
                platformShareCents,
                lenderShareEnabled: LATE_FEE_LENDER_SHARE_ENABLED,
                timestamp: dayjs(now).toISOString(),
                lateDays,
              }
            ]
          }
        }
      }
    });

    console.log(`[lateFees] Charges applied successfully (${transitionName}, day ${lateDays}, $${LATE_FEE_CENTS / 100})`);

    // Return value: `items` and `amounts` enumerate ALL emitted line items.
    // When the lender-share flag is OFF this is identical to historical
    // behavior (single 'late-fee' entry). When ON it includes the
    // 'late-fee-lender-share' provider entry with its EFFECTIVE cents
    // (e.g. 750 at 50%). Existing consumers using `.includes('late-fee')` /
    // `.some(a => a.code === 'late-fee')` continue to match correctly.
    return {
      charged: true,
      items: newLineItems.map(i => i.code),
      amounts: newLineItems.map(i => ({
        code: i.code,
        cents: lineItemEffectiveCents(i),
      })),
      lateDays,
      scenario,
      lenderShareCents,
      platformShareCents,
      lenderShareEnabled: LATE_FEE_LENDER_SHARE_ENABLED,
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

module.exports = {
  applyCharges,
  MAX_LATE_FEE_CHARGES,
  // Exposed for unit testing the lender-share split (May 2026):
  buildLateFeeLineItems,
  lineItemEffectiveCents,
  // Exposed for staging dry-run inspection + tests asserting current config:
  LATE_FEE_LENDER_SHARE_ENABLED,
  LENDER_LATE_FEE_SHARE_PCT,
};


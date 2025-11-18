/**
 * Late Fees & Replacement Charge Logic
 * 
 * Applies late return fees ($15/day) and replacement charges (Day 5+)
 * for overdue transactions via Flex privileged transitions.
 * 
 * Called by: server/scripts/sendOverdueReminders.js
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

// Configuration
const TZ = 'America/Los_Angeles';
const LATE_FEE_CENTS = 1500; // $15/day

// Feature flag: Gate late fee charging
const LATE_FEES_ENABLED = process.env.LATE_FEES_ENABLED !== 'false' && process.env.LATE_FEES_ENABLED !== '0';

/**
 * Format date as YYYY-MM-DD in Pacific timezone
 * @param {string|Date|dayjs.Dayjs} d - Date to format
 * @returns {string} Date in YYYY-MM-DD format
 */
function ymd(d) {
  return dayjs(d).tz(TZ).format('YYYY-MM-DD');
}

/**
 * Calculate number of days late (how many days past return due date)
 * Uses Pacific timezone and truncates to start of day for consistent calculations
 * 
 * @param {string|Date|dayjs.Dayjs} now - Current time
 * @param {string|Date|dayjs.Dayjs} returnAt - Return due date
 * @returns {number} Number of days late (0 or positive)
 * 
 * @example
 * computeLateDays('2025-11-10', '2025-11-08') // => 2 (2 days late)
 * computeLateDays('2025-11-08', '2025-11-08') // => 0 (due today, not late)
 * computeLateDays('2025-11-07', '2025-11-08') // => 0 (not yet due)
 */
function computeLateDays(now, returnAt) {
  const n = dayjs(now).tz(TZ).startOf('day');
  const r = dayjs(returnAt).tz(TZ).startOf('day');
  return Math.max(0, n.diff(r, 'day'));
}

/**
 * Check if return shipment has been scanned/accepted by carrier
 * 
 * Policy: Package is considered "scanned" once accepted or in-transit.
 * Once scanned, late fees stop (softer policy matching test branch).
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
 * Check if return shipment has been fully delivered
 * 
 * @param {Object} returnData - transaction.protectedData.return
 * @returns {boolean} True if package has been delivered
 */
function isDelivered(returnData) {
  if (!returnData) return false;
  
  const status = returnData.status?.toLowerCase();
  return status === 'delivered';
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
 * This function:
 * 1. Loads transaction with listing data
 * 2. Calculates days late
 * 3. Checks idempotency flags (what's already been charged)
 * 4. Builds line items for new charges
 * 5. Calls privileged transition to charge customer
 * 6. Updates protectedData to prevent duplicate charges
 * 
 * Idempotency:
 * - Late fees: Max one charge per day (tracked by lastLateFeeDayCharged)
 * - Replacement: Max one charge ever (tracked by replacementCharged boolean)
 * 
 * @param {Object} options - Configuration object
 * @param {Object} options.sdkInstance - Flex SDK instance (Integration or trusted)
 * @param {string} options.txId - Transaction UUID
 * @param {string|Date} options.now - Current time (for time-travel testing)
 * 
 * @returns {Promise<Object>} Result object with charged status and items
 * @returns {boolean} returns.charged - True if charges were applied
 * @returns {string[]} [returns.items] - Array of charged item codes (e.g., ['late-fee', 'replacement'])
 * @returns {string} [returns.reason] - Reason if no charges applied (e.g., 'no-op', 'already-scanned')
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
 *   console.log(`Charged: ${result.items.join(', ')}`);
 * } else {
 *   console.log(`No charges: ${result.reason}`);
 * }
 */
async function applyCharges({ sdkInstance, txId, now }) {
  try {
    // Feature flag check
    if (!LATE_FEES_ENABLED) {
      console.log(`[late-fees] LATE_FEES_ENABLED is false – skipping late fee evaluation for tx ${txId}`);
      return { charged: false, reason: 'feature-disabled' };
    }
    
    console.log(`[late-fees] Processing transaction ${txId}...`);
    
    // Load transaction with listing data
    const response = await sdkInstance.transactions.show({
      id: txId,
      include: ['listing']
    });
    
    const tx = response.data.data;
    const included = response.data.included || [];
    
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
    
    console.log(`[late-fees] Return due: ${ymd(returnDueAt)}, Now: ${ymd(now)}`);
    
    // Check if package has been scanned (stops late fees)
    const scanned = isScanned(returnData);
    const delivered = isDelivered(returnData);
    
    console.log(`[late-fees] Package status: scanned=${scanned}, delivered=${delivered}`);
    
    if (delivered) {
      console.log(`[late-fees] Package already delivered - no charges apply`);
      return { 
        charged: false, 
        reason: 'already-delivered',
        deliveredAt: returnData.firstScanAt || 'status-based'
      };
    }
    
    // Policy: Stop late fees once scanned (softer policy matching test branch)
    if (scanned) {
      console.log(`[late-fees] Package already scanned - no charges apply`);
      return { 
        charged: false, 
        reason: 'already-scanned',
        scannedAt: returnData.firstScanAt || 'status-based'
      };
    }
    
    // Calculate days late
    const lateDays = computeLateDays(now, returnDueAt);
    console.log(`[late-fees] Days late: ${lateDays}`);
    
    if (lateDays < 1) {
      console.log(`[late-fees] Not yet overdue - no charges apply`);
      return { charged: false, reason: 'not-overdue', lateDays };
    }
    
    // Get idempotency flags
    const lastLateFeeDayCharged = returnData.lastLateFeeDayCharged;
    const replacementCharged = returnData.replacementCharged === true;
    
    console.log(`[late-fees] Idempotency: lastFeeDay=${lastLateFeeDayCharged}, replacementCharged=${replacementCharged}`);
    
    // Build line items for new charges
    const newLineItems = [];
    const todayYmd = ymd(now);
    
    // Late fee: Charge if we haven't charged today yet
    // Policy: Stop fees once scanned (checked above)
    if (lateDays >= 1 && lastLateFeeDayCharged !== todayYmd) {
      newLineItems.push({
        code: 'late-fee',
        unitPrice: { amount: LATE_FEE_CENTS, currency: 'USD' },
        quantity: 1,
        percentage: 0,
        includeFor: ['customer']
      });
      console.log(`[late-fees] Adding late fee: $${LATE_FEE_CENTS / 100} for day ${lateDays}`);
    } else if (lastLateFeeDayCharged === todayYmd) {
      console.log(`[late-fees] Late fee already charged today (${todayYmd})`);
    }
    
    // Replacement: Charge if Day 5+, not scanned, and not already charged
    // Policy: No replacement if carrier has scanned the package
    if (lateDays >= 5 && !scanned && !replacementCharged) {
      const replacementCents = getReplacementValue(listing);
      newLineItems.push({
        code: 'replacement',
        unitPrice: { amount: replacementCents, currency: 'USD' },
        quantity: 1,
        percentage: 0,
        includeFor: ['customer']
      });
      console.log(`[late-fees] Adding replacement charge: $${replacementCents / 100} (listing: ${listing?.id?.uuid || listing?.id || 'unknown'})`);
    } else if (replacementCharged) {
      console.log(`[late-fees] Replacement already charged`);
    }
    
    // No-op path: Nothing to charge
    if (newLineItems.length === 0) {
      console.log(`[late-fees] No new charges to apply`);
      return { 
        charged: false, 
        reason: 'no-op',
        lateDays,
        lastLateFeeDayCharged,
        replacementCharged
      };
    }
    
    console.log(`[late-fees] Calling transition with ${newLineItems.length} line items...`);
    
    // Call privileged transition to apply charges
    // Provide both 'ctx/new-line-items' and 'lineItems' for compatibility
    await sdkInstance.transactions.transition({
      id: txId,
      transition: 'transition/privileged-apply-late-fees',
      params: {
        'ctx/new-line-items': newLineItems,
        lineItems: newLineItems,
        protectedData: {
          ...protectedData,
          return: {
            ...returnData,
            // Update idempotency flags
            lastLateFeeDayCharged: newLineItems.find(i => i.code === 'late-fee') 
              ? todayYmd 
              : lastLateFeeDayCharged,
            replacementCharged: replacementCharged || newLineItems.some(i => i.code === 'replacement'),
            // Track charge history
            chargeHistory: [
              ...(returnData.chargeHistory || []),
              {
                date: todayYmd,
                items: newLineItems.map(i => ({ code: i.code, amount: i.unitPrice.amount })),
                timestamp: dayjs(now).toISOString()
              }
            ]
          }
        }
      }
    });
    
    console.log(`[late-fees] ✅ Charges applied successfully: ${newLineItems.map(i => `${i.code}=$${(i.unitPrice.amount / 100).toFixed(2)}`).join(', ')}`);
    
    // Return success
    return {
      charged: true,
      items: newLineItems.map(i => i.code),
      amounts: newLineItems.map(i => ({ code: i.code, cents: i.unitPrice.amount })),
      lateDays
    };
    
  } catch (error) {
    // Enhance error with context
    const enhancedError = new Error(
      `Failed to apply late fees for transaction ${txId}: ${error.message}`
    );
    enhancedError.originalError = error;
    enhancedError.txId = txId;
    enhancedError.timestamp = dayjs(now).toISOString();
    
    console.error(`[late-fees] ❌ Error:`, enhancedError.message);
    console.error(`[late-fees] Stack:`, error.stack);
    
    throw enhancedError;
  }
}

// Export functions for use in other modules
module.exports = { applyCharges, getReplacementValue };


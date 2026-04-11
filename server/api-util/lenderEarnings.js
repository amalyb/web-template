/**
 * Lender earnings helpers.
 *
 * Single source of truth for:
 *   1. Calculating the lender's payout total from a set of line items.
 *   2. Formatting a Money object into a human-readable currency string
 *      for SMS/email copy.
 *
 * Used by both the initial lender SMS (server/api/initiate-privileged.js)
 * and the 60-minute follow-up reminder worker
 * (server/scripts/sendLenderRequestReminders.js) so the two messages can
 * never drift on the earnings amount shown to the lender.
 */
const Decimal = require('decimal.js');
const { types } = require('sharetribe-flex-sdk');
const { Money } = types;
const { calculateTotalForProvider } = require('./lineItemHelpers');
const { getAmountAsDecimalJS, convertDecimalJSToNumber, unitDivisor } = require('./currency');

/**
 * Calculate the lender's payout total (Money) from a set of line items.
 * Returns null if line items are missing/empty or the calc throws.
 *
 * @param {Array} lineItems - Flex line items (from tx.attributes.lineItems
 *   or freshly computed via transactionLineItems()).
 * @returns {Object|null} Money object ({ amount, currency }) or null.
 */
/**
 * Safely extract a numeric amount from a Money-like value.
 * Handles: Money instances, plain { amount, currency } objects,
 * and Sharetribe SDK Long objects ({ low_, high_ }).
 */
function toNumericAmount(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  // goog.math.Long from the SDK transit layer
  if (typeof value === 'object' && typeof value.low_ === 'number') {
    // Long: (high_ * 2^32) + low_ (unsigned)
    return (value.high_ || 0) * 4294967296 + (value.low_ >>> 0);
  }
  if (typeof value.toString === 'function') {
    const n = Number(value.toString());
    if (!isNaN(n)) return n;
  }
  return null;
}

function calculateLenderPayoutTotal(lineItems) {
  try {
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return null;
    }

    // First try the standard path (works when lineItems have Money instances)
    try {
      return calculateTotalForProvider(lineItems);
    } catch (_ignored) {
      // Fall through to manual calculation
    }

    // Manual path for Integration SDK responses where amounts are plain
    // objects or Long types instead of Money instances.
    const providerItems = lineItems.filter(
      li => Array.isArray(li.includeFor) && li.includeFor.includes('provider')
    );
    if (providerItems.length === 0) return null;

    let totalAmount = 0;
    let currency = null;

    for (const li of providerItems) {
      const lt = li.lineTotal;
      if (!lt) continue;

      const amt = toNumericAmount(lt.amount != null ? lt.amount : lt);
      if (amt == null) {
        console.warn('[lenderEarnings] Could not extract numeric amount from lineTotal:', lt);
        continue;
      }

      // Grab currency from whichever field has it
      if (!currency) {
        currency = lt.currency || (li.unitPrice && li.unitPrice.currency) || null;
      }

      totalAmount += amt;
    }

    if (currency == null) return null;

    return new Money(totalAmount, currency);
  } catch (e) {
    console.warn('[lenderEarnings] Could not calculate payout:', e.message);
    return null;
  }
}

/**
 * Format a Money object to a currency string (e.g. "$21.24").
 * Returns null on missing/invalid input.
 *
 * @param {Object} money - Money object from the Flex SDK.
 * @returns {string|null}
 */
function formatMoneyServerSide(money) {
  if (!money || !money.currency) {
    return null;
  }

  try {
    // Extract numeric amount, handling Money instances, plain objects, and Longs
    let numericAmount = toNumericAmount(money.amount);
    if (numericAmount == null) return null;

    const divisor = unitDivisor(money.currency);
    const majorUnits = numericAmount / divisor;

    const currencySymbols = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      CAD: 'C$',
      AUD: 'A$',
    };

    const symbol = currencySymbols[money.currency] || money.currency + ' ';
    return `${symbol}${majorUnits.toFixed(2)}`;
  } catch (e) {
    console.warn('[lenderEarnings] Error formatting money:', e.message);
    return null;
  }
}

module.exports = {
  calculateLenderPayoutTotal,
  formatMoneyServerSide,
};

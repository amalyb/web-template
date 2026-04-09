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
function calculateLenderPayoutTotal(lineItems) {
  try {
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return null;
    }
    return calculateTotalForProvider(lineItems);
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
  if (!money || money.amount == null || !money.currency) {
    return null;
  }

  try {
    const amountDecimal = getAmountAsDecimalJS(money);
    const divisor = unitDivisor(money.currency);
    const divisorDecimal = new Decimal(divisor);
    const majorUnitsDecimal = amountDecimal.dividedBy(divisorDecimal);
    const majorUnits = convertDecimalJSToNumber(majorUnitsDecimal);

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

/**
 * Build a stable session key for checkout based on user + listing + dates
 * This key is used to prevent duplicate initiation calls for the same checkout session
 */

/**
 * Build speculation key from order parameters
 * @param {Object} params - Parameters containing listingId, bookingStart, bookingEnd, unitType
 * @returns {string} A stable key representing this booking
 */
export function makeSpeculationKey({ listingId, bookingStart, bookingEnd, unitType }) {
  const lid = typeof listingId === 'string'
    ? listingId
    : (listingId?.uuid || listingId?.id?.uuid || '');
  
  // TDZ-safe: extract method reference before calling
  const startToISO = bookingStart && bookingStart.toISOString;
  const start = typeof bookingStart === 'string' 
    ? bookingStart 
    : (typeof startToISO === 'function' ? startToISO.call(bookingStart) : '');
  
  const endToISO = bookingEnd && bookingEnd.toISOString;
  const end = typeof bookingEnd === 'string' 
    ? bookingEnd 
    : (typeof endToISO === 'function' ? endToISO.call(bookingEnd) : '');
  
  return [lid, start, end, unitType || ''].join('|');
}

/**
 * Build a stable session key for checkout initiation
 * @param {Object} params
 * @param {string} params.userId - User ID or anonymous ID
 * @param {string} params.anonymousId - Fallback anonymous ID
 * @param {string} params.listingId - Listing ID
 * @param {string} params.startISO - ISO string of booking start
 * @param {string} params.endISO - ISO string of booking end
 * @returns {string} Session key
 */
export function buildCheckoutSessionKey({ userId, anonymousId, listingId, startISO, endISO }) {
  const userKey = userId || anonymousId || 'unknown';
  const start = startISO || 'na';
  const end = endISO || 'na';
  const lid = listingId || 'na';
  return `${userKey}|${lid}|${start}|${end}`;
}


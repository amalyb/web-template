/**
 * Core order params logic - pure functions with no React dependencies
 * This module contains only the essential helper functions that can be
 * imported by any module without creating circular dependencies.
 */

/**
 * Extract listing ID from various formats (SDK UUID, plain string, Redux state)
 * @param {Object} listing - Listing object
 * @param {string|Object} listingId - Listing ID in various formats
 * @returns {string|null} Normalized listing ID
 */
export function extractListingId(listing, listingId) {
  if (listing?.id?.uuid) return listing.id.uuid;
  if (typeof listingId === 'string') return listingId;
  if (typeof listingId?.uuid === 'string') return listingId.uuid;
  return null;
}

/**
 * Normalize date values to ISO string format
 * @param {*} value - Date value in various formats
 * @returns {string|null} ISO string or null
 */
export function normalizeISO(value) {
  if (!value) return null;
  try {
    if (typeof value === 'string') return value;
    if (value?.toISOString) return value.toISOString();
    if (value?.toISO) return value.toISO();
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

/**
 * Normalize booking dates from pageData (handles multiple shapes)
 * @param {Object} pageData - Page data from session storage
 * @returns {Object} { startISO: string|null, endISO: string|null }
 */
export function normalizeBookingDates(pageData) {
  // Try multiple paths to find booking dates
  const bookingStart = 
    pageData?.orderData?.bookingDates?.bookingStart || 
    pageData?.bookingDates?.start ||
    null;
  
  const bookingEnd = 
    pageData?.orderData?.bookingDates?.bookingEnd || 
    pageData?.bookingDates?.end ||
    null;

  return {
    startISO: normalizeISO(bookingStart),
    endISO: normalizeISO(bookingEnd),
  };
}

/**
 * Build robust orderParams with validation
 * @param {Object} params
 * @param {Object} params.listing - Listing object
 * @param {string} params.listingId - Listing ID
 * @param {*} params.start - Start date
 * @param {*} params.end - End date
 * @param {Object} params.protectedData - Protected data
 * @returns {Object} { ok: boolean, reason: string|null, params: Object|null }
 */
export function buildOrderParams({ listing, listingId, start, end, protectedData }) {
  const id = extractListingId(listing, listingId);
  const startISO = normalizeISO(start);
  const endISO = normalizeISO(end);

  const bookingDates =
    startISO && endISO ? { start: startISO, end: endISO } : null;

  return {
    ok: Boolean(id && bookingDates),
    reason: !id ? 'missing-listingId' : (!bookingDates ? 'missing-bookingDates' : null),
    params: id && bookingDates
      ? { listingId: id, bookingDates, protectedData: protectedData || {} }
      : null,
  };
}


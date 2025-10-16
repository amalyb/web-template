// server/lib/statusMap.js
/**
 * Shippo Carrier Status Normalization
 *
 * Maps carrier-specific tracking statuses to normalized application phases.
 * This helps consolidate different carrier status codes into meaningful
 * business logic states.
 */

// Statuses that indicate item has been picked up by carrier (Step 4: SMS to borrower)
const SHIPPED_STATUSES = new Set([
  'ACCEPTED', // USPS: Label created and accepted by carrier
  'ACCEPTANCE', // Alternative spelling
  'IN_TRANSIT', // UPS/FedEx: Package is in transit
  'TRANSIT', // Alternative: Package is in transit
  'PICKUP', // Alternative: Package picked up
]);

// Statuses that indicate delivery completed (Step 6: SMS to borrower)
const DELIVERED_STATUSES = new Set([
  'DELIVERED', // Standard delivery status
  'DELIVERY', // Alternative spelling
]);

// Statuses that indicate delivery failed or exception
const EXCEPTION_STATUSES = new Set([
  'FAILURE', // Delivery failed
  'RETURNED', // Returned to sender
  'EXCEPTION', // Delivery exception
  'UNKNOWN', // Unknown status
]);

/**
 * Normalize carrier status to application phase
 *
 * @param {string} statusRaw - Raw status from Shippo webhook (e.g., 'IN_TRANSIT', 'DELIVERED')
 * @returns {string} - Normalized phase: 'SHIPPED' | 'DELIVERED' | 'EXCEPTION' | 'OTHER'
 */
function toCarrierPhase(statusRaw) {
  const status = String(statusRaw || '')
    .trim()
    .toUpperCase();

  if (SHIPPED_STATUSES.has(status)) {
    return 'SHIPPED';
  }

  if (DELIVERED_STATUSES.has(status)) {
    return 'DELIVERED';
  }

  if (EXCEPTION_STATUSES.has(status)) {
    return 'EXCEPTION';
  }

  return 'OTHER';
}

/**
 * Check if status indicates first scan / shipped
 *
 * @param {string} status - Raw status from Shippo
 * @returns {boolean}
 */
function isShippedStatus(status) {
  return toCarrierPhase(status) === 'SHIPPED';
}

/**
 * Check if status indicates delivered
 *
 * @param {string} status - Raw status from Shippo
 * @returns {boolean}
 */
function isDeliveredStatus(status) {
  return toCarrierPhase(status) === 'DELIVERED';
}

module.exports = {
  toCarrierPhase,
  isShippedStatus,
  isDeliveredStatus,
  SHIPPED_STATUSES,
  DELIVERED_STATUSES,
  EXCEPTION_STATUSES,
};

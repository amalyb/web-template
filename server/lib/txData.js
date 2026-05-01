// server/lib/txData.js
/**
 * Transaction ProtectedData Utilities
 * 
 * Helper functions for safely reading and updating transaction protectedData
 * using the Integration SDK (privileged operations).
 */

const { getIntegrationSdk, txUpdateProtectedData, deepMerge } = require('../api-util/integrationSdk');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const isRetryable = err => {
  const status = err?.status || err?.response?.status;
  return !!(status && (status >= 500 || status === 429 || status === 409));
};

/**
 * Fetch a transaction with all details
 * 
 * @param {string} txId - Transaction UUID
 * @param {object} options - Optional: { include: ['customer', 'provider', 'listing'] }
 * @returns {Promise<object>} - Transaction data
 */
async function fetchTx(txId, options = {}) {
  const integrationSdk = getIntegrationSdk();
  const params = {
    id: txId,
    ...options
  };
  
  const res = await integrationSdk.transactions.show(params, { expand: true });
  return res.data.data;
}

/**
 * Update transaction protectedData using Integration SDK.
 *
 * Routes through the v6 operator-update-pd-<state> transitions in
 * txUpdateProtectedData (read-modify-write client-side, then the
 * transition replaces tx.attributes.protectedData wholesale).
 *
 * @param {string} txId - Transaction UUID (plain string)
 * @param {object} patch - Partial protectedData to merge (non-destructive)
 * @param {object} options - Optional: { source: 'shippo|accept|reminder' }
 * @returns {Promise<object>} - Envelope: { success: true, data, transition }
 *   on happy path; { success: false, reason, state, error } on unsupported
 *   state. Throws on network errors, 5xx, or repeated 409.
 */
async function upsertProtectedData(txId, patch, options = {}) {
  const { source } = options;
  return await txUpdateProtectedData(txId, patch, { source });
}

/**
 * Read transaction protectedData
 * 
 * @param {string} txId - Transaction UUID
 * @returns {Promise<object>} - protectedData object (or {} if not found)
 */
async function readProtectedData(txId) {
  try {
    const tx = await fetchTx(txId);
    return tx.attributes.protectedData || {};
  } catch (error) {
    console.error(`❌ [txData] Failed to read protectedData for ${txId}:`, error.message);
    throw error;
  }
}

/**
 * Returns true if the transaction's outbound package has had ANY carrier scan.
 *
 * Checks (in order):
 *   1. Webhook's idempotency flag (primary, written at first-scan SMS time)
 *   2. Canonical outbound.firstScanAt (written by webhook patch, 2026-04)
 *   3. Last known tracking status (indicates physical movement)
 *
 * Used by ship-by reminders, overdue reminders, and the auto-cancel-unshipped
 * cron job to decide whether a package is in motion.
 */
function hasOutboundScan(tx) {
  const pd = tx?.attributes?.protectedData || {};

  // Primary: webhook idempotency flag (set when first-scan SMS sends)
  if (pd.shippingNotification?.firstScan?.sent === true) return true;

  // Canonical field (written by shippoTracking.js on first-scan events)
  if (pd.outbound?.firstScanAt) return true;

  // Secondary: last tracking status indicates physical movement
  const status = String(pd.lastTrackingStatus?.status || '').toUpperCase();
  const movingStatuses = ['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  if (movingStatuses.includes(status)) return true;

  return false;
}

/**
 * Returns ISO timestamp of first outbound scan, or null if not scanned.
 */
function getOutboundFirstScanAt(tx) {
  const pd = tx?.attributes?.protectedData || {};
  return (
    pd.outbound?.firstScanAt ||
    pd.shippingNotification?.firstScan?.sentAt ||
    pd.lastTrackingStatus?.timestamp ||
    null
  );
}

module.exports = {
  upsertProtectedData,
  fetchTx,
  readProtectedData,
  deepMerge, // Re-export for convenience
  hasOutboundScan,
  getOutboundFirstScanAt,
};


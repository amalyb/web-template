// server/lib/txData.js
/**
 * Transaction ProtectedData Utilities
 *
 * Helper functions for safely reading and updating transaction protectedData
 * using the Integration SDK (privileged operations).
 */

const {
  getIntegrationSdk,
  txUpdateProtectedData,
  deepMerge,
} = require('../api-util/integrationSdk');

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
    ...options,
  };

  const res = await integrationSdk.transactions.show(params, { expand: true });
  return res.data.data;
}

/**
 * Merge patch into transaction.protectedData using Integration SDK.
 *
 * This function uses the robust txUpdateProtectedData from integrationSdk.js
 * with automatic retry logic for 409 conflicts.
 *
 * @param {string} txId - Transaction UUID
 * @param {object} patch - Partial protectedData to merge (non-destructive)
 * @param {object} options - { retries?: 3, delayMs?: 300, maxRetries?: 3, backoffMs?: 100 }
 * @returns {Promise<object>} - Result: { success: true/false, data?, error? }
 */
async function upsertProtectedData(txId, patch, options = {}) {
  // Map legacy parameter names to new ones for backwards compatibility
  const { retries = 3, delayMs = 300, maxRetries = retries, backoffMs = delayMs } = options;

  // Use the robust implementation from integrationSdk.js
  return txUpdateProtectedData(txId, patch, { maxRetries, backoffMs });
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

module.exports = {
  upsertProtectedData,
  fetchTx,
  readProtectedData,
  deepMerge, // Re-export for convenience
};

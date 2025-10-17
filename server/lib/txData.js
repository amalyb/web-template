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
 * The Integration SDK's updateMetadata endpoint handles merging server-side,
 * so we just pass the patch directly without client-side read-modify-write.
 * 
 * @param {string} txId - Transaction UUID (plain string)
 * @param {object} patch - Partial protectedData to merge (non-destructive)
 * @param {object} options - Optional: { source: 'shippo|accept|reminder' }
 * @returns {Promise<object>} - Transaction data from response
 */
async function upsertProtectedData(txId, patch, options = {}) {
  // Extract source for logging (ignore legacy retry options)
  const { source } = options;
  
  // Use the simple helper from integrationSdk.js
  // Returns transaction data directly (not wrapped in { success, data, error })
  const data = await txUpdateProtectedData(txId, patch, { source });
  
  // Return success wrapper for backwards compatibility with existing code
  return { success: true, data };
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
  deepMerge // Re-export for convenience
};


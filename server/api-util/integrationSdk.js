// server/api-util/integrationSdk.js
const { createInstance } = require('sharetribe-flex-integration-sdk');

let cached;
function getIntegrationSdk() {
  if (!cached) {
    cached = createInstance({
      clientId: process.env.INTEGRATION_CLIENT_ID,
      clientSecret: process.env.INTEGRATION_CLIENT_SECRET,
    });
  }
  return cached;
}

// Alias for consistency with other modules
// Uses Integration SDK with client credentials (no req.cookies needed)
function getTrustedSdk() {
  return getIntegrationSdk();
}

/**
 * Deep merge helper - non-destructive merge of patch into base
 * Arrays are replaced, not merged
 */
function deepMerge(base, patch) {
  const result = { ...base };
  
  for (const key in patch) {
    if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      // Recursively merge objects
      result[key] = deepMerge(base[key] || {}, patch[key]);
    } else {
      // Replace primitives and arrays
      result[key] = patch[key];
    }
  }
  
  return result;
}

/**
 * Safely update transaction protectedData with read-modify-write pattern
 * 
 * @param {string} txId - Transaction UUID
 * @param {object} patch - Partial protectedData to merge (non-destructive)
 * @param {object} options - { maxRetries: 3, backoffMs: 100 }
 * @returns {Promise<object>} - { success: true/false, data?, error? }
 */
async function txUpdateProtectedData(txId, patch, options = {}) {
  const { maxRetries = 3, backoffMs = 100 } = options;
  const sdk = getTrustedSdk();
  
  console.log(`[PERSIST] Updating protectedData for tx=${txId}, keys=${Object.keys(patch).join(',')}`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. Read current transaction
      const showResponse = await sdk.transactions.show({ id: txId });
      const currentTx = showResponse.data.data;
      const currentProtectedData = currentTx.attributes.protectedData || {};
      
      // 2. Deep merge patch into current protectedData
      const mergedProtectedData = deepMerge(currentProtectedData, patch);
      
      console.log(`[PERSIST] Attempt ${attempt}/${maxRetries}: Merging keys into protectedData`);
      
      // 3. Write back using update() (privileged)
      const updateResponse = await sdk.transactions.update({
        id: txId,
        protectedData: mergedProtectedData
      });
      
      console.log(`✅ [PERSIST] Successfully updated protectedData for tx=${txId}`);
      return { success: true, data: updateResponse.data };
      
    } catch (error) {
      const status = error.status || error.response?.status;
      
      if (status === 409 && attempt < maxRetries) {
        // Conflict - another concurrent update happened, retry
        const backoff = backoffMs * attempt; // Linear backoff
        console.warn(`⚠️ [PERSIST] 409 Conflict on attempt ${attempt}/${maxRetries}, retrying in ${backoff}ms`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      
      // Non-retryable error or max retries exceeded
      console.error('[PERSIST][ERR]', {
        txId,
        message: error?.message,
        status: error?.status || error?.response?.status,
        data: error?.data || error?.response?.data,
        apiErrors: error?.apiErrors,
        attempt,
        maxRetries
      });
      
      return { 
        success: false, 
        error: error.message,
        status,
        attempt,
        details: error?.response?.data
      };
    }
  }
  
  // Should never reach here but just in case
  return { success: false, error: 'Max retries exceeded', attempt: maxRetries };
}

module.exports = { 
  getIntegrationSdk, 
  getTrustedSdk,
  txUpdateProtectedData,
  deepMerge // Export for testing
};

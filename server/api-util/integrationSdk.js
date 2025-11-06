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
 * Whitelist of allowed protectedData keys for Integration API
 * Only these keys will be sent to updateMetadata
 */
const ALLOWED_PROTECTED_DATA_KEYS = [
  'providerStreet',
  'providerStreet2',
  'providerCity',
  'providerState',
  'providerZip',
  'providerPhone',
  'providerEmail',
  'providerName',
  'customerStreet',
  'customerStreet2',
  'customerCity',
  'customerState',
  'customerZip',
  'customerPhone',
  'customerEmail',
  'customerName',
  'bookingStartISO',
  'outbound',
  'return',
  'shipByDate',
  'shipByISO',
  'outboundQrCodeUrl',
  'outboundLabelUrl',
  'outboundTrackingNumber',
  'outboundTrackingUrl',
  'returnQrCodeUrl',
  'returnTrackingUrl',
];

/**
 * Prune protectedData to only include whitelisted keys
 * Prevents 400 errors from unexpected keys
 */
function pruneProtectedData(data) {
  if (!data || typeof data !== 'object') return {};
  
  const pruned = {};
  for (const key of ALLOWED_PROTECTED_DATA_KEYS) {
    if (key in data && data[key] !== undefined) {
      pruned[key] = data[key];
    }
  }
  return pruned;
}

/**
 * Update transaction protectedData using Integration SDK
 * 
 * NOTE: Integration API method is updateMetadata, not update.
 * 
 * @param {string} txId - Transaction UUID (plain string, not SDK UUID object)
 * @param {object} protectedPatch - Partial protectedData to patch
 * @param {object} opts - Optional: { source: 'shippo|accept|reminder' }
 * @returns {Promise<object>} - Transaction data from response
 */
async function txUpdateProtectedData(txId, protectedPatch, opts = {}) {
  const sdk = getTrustedSdk();
  
  // Prune to only allowed keys to prevent 400 errors
  const pruned = pruneProtectedData(protectedPatch);
  const ctx = { txId, keys: Object.keys(pruned), source: opts.source };
  
  try {
    console.log('[INT][PD] updateMetadata', ctx);
    console.log('[INT][PD][DEBUG] Endpoint: transactions.updateMetadata', {
      method: 'POST',
      path: `/transactions/${txId}/update_metadata`,
      bodyKeys: Object.keys(pruned),
      prunedCount: Object.keys(protectedPatch || {}).length - Object.keys(pruned).length,
    });

    // NOTE: Integration API method is updateMetadata, not update.
    const res = await sdk.transactions.updateMetadata({
      id: txId,                 // string UUID, not SDK UUID object
      protectedData: pruned,    // Use pruned data
      // metadata: {}           // include if you also want to patch normal metadata
    });

    console.log('[INT][PD][OK]', ctx);
    return res.data;
  } catch (e) {
    const err = e?.response?.data?.errors?.[0] || {};
    console.error('[INT][PD][ERR]', {
      ...ctx,
      status: e?.response?.status,
      statusText: e?.response?.statusText,
      code: err.code,
      title: err.title,
      details: err.details || err.message || e.message,
      sentKeys: Object.keys(pruned),
      originalKeys: Object.keys(protectedPatch || {}),
    });
    throw e;
  }
}

module.exports = { 
  getIntegrationSdk, 
  getTrustedSdk,
  txUpdateProtectedData,
  deepMerge // Export for testing
};

/**
 * Marketplace SDK Factory
 * 
 * Returns a Sharetribe Flex Marketplace SDK instance for queries and reads.
 * Use this for:
 * - Querying transactions, listings, users
 * - Reading public/protected data
 * - Non-privileged operations
 * 
 * For privileged operations (transitions, operator actions), use getFlexSdk()
 * which returns Integration SDK when available.
 * 
 * Environment Variables:
 * - REACT_APP_SHARETRIBE_SDK_CLIENT_ID (required)
 * - SHARETRIBE_SDK_CLIENT_SECRET (required for server-side use)
 * - SHARETRIBE_SDK_BASE_URL or REACT_APP_SHARETRIBE_SDK_BASE_URL (optional)
 */

/**
 * Create and return a Marketplace SDK instance
 * 
 * @returns {Object} Flex Marketplace SDK instance
 * @throws {Error} If credentials are missing
 */
function getMarketplaceSdk() {
  const baseUrl =
    process.env.SHARETRIBE_SDK_BASE_URL ||
    process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL ||
    'https://flex-api.sharetribe.com';

  const sharetribeSdk = require('sharetribe-flex-sdk');
  const clientId = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
  const clientSecret = process.env.SHARETRIBE_SDK_CLIENT_SECRET; // server-side use is ok in test

  if (!clientId || !clientSecret) {
    throw new Error('Missing marketplace SDK creds (REACT_APP_SHARETRIBE_SDK_CLIENT_ID / SHARETRIBE_SDK_CLIENT_SECRET).');
  }

  return sharetribeSdk.createInstance({
    clientId,
    clientSecret,
    baseUrl,
    tokenStore: sharetribeSdk.tokenStore.memoryStore(),
  });
}

module.exports = getMarketplaceSdk;


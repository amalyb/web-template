/**
 * Centralized Flex SDK Factory
 * 
 * Returns the appropriate Sharetribe Flex SDK instance:
 * - Integration SDK (preferred) if INTEGRATION_CLIENT_ID/SECRET are set
 * - Marketplace SDK (fallback) if only standard credentials are available
 * 
 * Integration SDK Benefits:
 * - No user/session context required
 * - Full admin/operator privileges
 * - Ideal for backend automation (cron jobs, webhooks)
 * 
 * Environment Variables:
 * Priority 1 (Integration SDK):
 * - INTEGRATION_CLIENT_ID
 * - INTEGRATION_CLIENT_SECRET
 * 
 * Priority 2 (Marketplace SDK):
 * - REACT_APP_SHARETRIBE_SDK_CLIENT_ID
 * - SHARETRIBE_SDK_CLIENT_SECRET
 * 
 * Both:
 * - SHARETRIBE_SDK_BASE_URL or REACT_APP_SHARETRIBE_SDK_BASE_URL
 *   (defaults to https://flex-api.sharetribe.com)
 */

const mask = v => (v ? v.slice(0, 6) + '…' + v.slice(-4) : '(not set)');

/**
 * Create and return a configured Flex SDK instance
 * 
 * @returns {Object} Flex SDK instance (Integration or Marketplace)
 * @throws {Error} If no credentials are configured
 */
function getFlexSdk() {
  const baseUrl =
    process.env.SHARETRIBE_SDK_BASE_URL ||
    process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL ||
    'https://flex-api.sharetribe.com';

  const integId = process.env.INTEGRATION_CLIENT_ID;
  const integSecret = process.env.INTEGRATION_CLIENT_SECRET;

  // Prefer Integration SDK for backend automations
  if (integId && integSecret) {
    const integrationSdk = require('sharetribe-flex-integration-sdk');
    const sdk = integrationSdk.createInstance({
      clientId: integId,
      clientSecret: integSecret,
      baseUrl, // no /v1 here; the SDK handles paths
      tokenStore: integrationSdk.tokenStore.memoryStore(),
    });
    console.log(`[FlexSDK] Using Integration SDK with clientId=${mask(integId)} baseUrl=${baseUrl}`);
    return sdk;
  }

  // Fallback to Marketplace SDK (server-side with clientSecret)
  const sharetribeSdk = require('sharetribe-flex-sdk');
  const clientId = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
  const clientSecret = process.env.SHARETRIBE_SDK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Flex SDK credentials. Set either:\n' +
      '  1. INTEGRATION_CLIENT_ID + INTEGRATION_CLIENT_SECRET (preferred for scripts), or\n' +
      '  2. REACT_APP_SHARETRIBE_SDK_CLIENT_ID + SHARETRIBE_SDK_CLIENT_SECRET'
    );
  }

  const sdk = sharetribeSdk.createInstance({
    clientId,
    clientSecret,
    baseUrl,
    tokenStore: sharetribeSdk.tokenStore.memoryStore(),
  });
  console.log(`[FlexSDK] Using Marketplace SDK with clientId=${mask(clientId)} baseUrl=${baseUrl}`);
  return sdk;
}

module.exports = getFlexSdk;


/**
 * URL Helper Functions
 *
 * Centralized URL building using ROOT_URL environment variable.
 * This ensures all application URLs (used in SMS, emails, etc.) use the correct domain
 * for the current environment (production, staging, development).
 *
 * Environment Variables:
 * - ROOT_URL: Base URL for the application (e.g., https://sherbrt.com, https://test.sherbrt.com)
 */

/**
 * Get the base URL from environment, removing trailing slashes
 * @returns {string} Base URL without trailing slash
 */
const getBaseUrl = () => {
  return (process.env.ROOT_URL || '').replace(/\/+$/, '');
};

/**
 * Build an absolute application URL from a relative path
 *
 * @param {string} path - Relative path (e.g., '/ship/123', 'ship/123')
 * @returns {string} Full absolute URL
 *
 * @example
 * // With ROOT_URL='https://sherbrt.com'
 * makeAppUrl('/ship/123') // => 'https://sherbrt.com/ship/123'
 * makeAppUrl('ship/123')  // => 'https://sherbrt.com/ship/123'
 * makeAppUrl()            // => 'https://sherbrt.com/'
 */
const makeAppUrl = (path = '/') => {
  const base = getBaseUrl();

  if (!base) {
    console.warn('[URL] ROOT_URL not set, falling back to relative path');
    return path.startsWith('/') ? path : `/${path}`;
  }

  // Ensure path starts with '/'
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${base}${normalizedPath}`;
};

/**
 * Get the SMS link strategy from environment
 * @returns {'app'|'shippo'} The link strategy to use
 */
const getSmsLinkStrategy = () => {
  const strategy = process.env.SMS_LINK_STRATEGY || 'app';
  if (!['app', 'shippo'].includes(strategy)) {
    console.warn(`[URL] Invalid SMS_LINK_STRATEGY: ${strategy}, defaulting to 'app'`);
    return 'app';
  }
  return strategy;
};

/**
 * Build a shipping label link using the configured strategy
 *
 * @param {string} transactionId - The transaction ID
 * @param {object} shippoData - Shippo response data containing label_url, qr_code_url
 * @param {object} options - Additional options
 * @param {boolean} options.preferQr - Prefer QR code URL over label URL (default: false)
 * @returns {object} { url, strategy }
 *
 * @example
 * const { url, strategy } = buildShipLabelLink(
 *   'tx-123',
 *   { label_url: 'https://shippo.com/...', qr_code_url: 'https://shippo.com/qr/...' }
 * );
 */
const buildShipLabelLink = (transactionId, shippoData = {}, options = {}) => {
  const strategy = getSmsLinkStrategy();
  const { preferQr = false } = options;

  if (strategy === 'shippo') {
    // Try to use Shippo's hosted URLs
    const shippoUrl = preferQr
      ? shippoData.qr_code_url || shippoData.label_url
      : shippoData.label_url || shippoData.qr_code_url;

    if (shippoUrl) {
      return { url: shippoUrl, strategy: 'shippo' };
    }

    // Fall back to app URL if Shippo URL not available
    console.warn(
      `[URL] SMS_LINK_STRATEGY=shippo but no Shippo URL available, falling back to app URL`
    );
  }

  // Default: use app URL
  return {
    url: makeAppUrl(`/ship/${transactionId}`),
    strategy: 'app',
  };
};

/**
 * Build a return label link using the configured strategy
 *
 * @param {string} transactionId - The transaction ID
 * @param {object} shippoData - Shippo response data containing label_url, qr_code_url
 * @returns {object} { url, strategy }
 */
const buildReturnLabelLink = (transactionId, shippoData = {}) => {
  const strategy = getSmsLinkStrategy();

  if (strategy === 'shippo' && shippoData.label_url) {
    return { url: shippoData.label_url, strategy: 'shippo' };
  }

  // Default: use app URL
  return {
    url: makeAppUrl(`/return/${transactionId}`),
    strategy: 'app',
  };
};

/**
 * Build an order page URL for a transaction
 *
 * @param {string|object} transactionId - Transaction ID (UUID string or object with .uuid)
 * @returns {string} Full order page URL (e.g., https://sherbrt.com/order/690bcaf8-...)
 *
 * @example
 * orderUrl('690bcaf8-daa7-4052-ac6d-cf22b0a49cd9')
 * // => 'https://sherbrt.com/order/690bcaf8-daa7-4052-ac6d-cf22b0a49cd9'
 */
const orderUrl = (transactionId) => {
  // Extract UUID if transactionId is an object
  const txId = transactionId?.uuid || transactionId;
  
  if (!txId) {
    console.warn('[URL] orderUrl called with invalid transactionId:', transactionId);
    return makeAppUrl('/'); // Fallback to site root
  }
  
  return makeAppUrl(`/order/${txId}`);
};

module.exports = {
  getBaseUrl,
  makeAppUrl,
  getSmsLinkStrategy,
  buildShipLabelLink,
  buildReturnLabelLink,
  orderUrl,
};

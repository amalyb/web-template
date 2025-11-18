/**
 * URL Helper Functions
 *
 * Centralized URL building using WEB_APP_URL, SERVER_BASE_URL, or ROOT_URL environment variable.
 * This ensures all application URLs (used in SMS, emails, etc.) use the correct domain
 * for the current environment (production, staging, development).
 *
 * Environment Variables (in order of preference):
 * - WEB_APP_URL: Base URL for web app (preferred, e.g., https://www.sherbrt.com)
 * - SERVER_BASE_URL: Base URL for server-generated absolute URLs (e.g., http://localhost:3500)
 * - ROOT_URL: Fallback base URL for the application (e.g., https://sherbrt.com, https://test.sherbrt.com)
 *
 * NOTE: SendGrid may wrap links in a branded tracking domain (e.g. url723.sherbrt.com).
 * If users see TLS errors like NET::ERR_CERT_COMMON_NAME_INVALID on that domain,
 * the fix is in SendGrid click-tracking SSL configuration, not in this codebase.
 */
/**
 * Get the base URL from environment, removing trailing slashes
 * Uses WEB_APP_URL if present, otherwise falls back to SERVER_BASE_URL or ROOT_URL
 * @returns {string} Base URL without trailing slash
 */
const getBaseUrl = () => {
  const baseUrl = process.env.WEB_APP_URL || process.env.SERVER_BASE_URL || process.env.ROOT_URL || 'https://www.sherbrt.com';
  const cleaned = baseUrl.replace(/\/+$/, '');
  // Ensure it's a valid URL (has protocol)
  if (cleaned && !cleaned.match(/^https?:\/\//)) {
    console.warn('[URL] Base URL missing protocol, prepending https://');
    return `https://${cleaned}`;
  }
  return cleaned || 'https://www.sherbrt.com';
};

/**
 * Build an absolute application URL from a relative path
 *
 * @param {string} path - Relative path (e.g., '/ship/123', 'ship/123')
 * @returns {string} Full absolute URL
 *
 * @example
 * // With SERVER_BASE_URL='http://localhost:3500' or ROOT_URL='https://sherbrt.com'
 * makeAppUrl('/ship/123') // => 'http://localhost:3500/ship/123' or 'https://sherbrt.com/ship/123'
 * makeAppUrl('ship/123')  // => 'http://localhost:3500/ship/123' or 'https://sherbrt.com/ship/123'
 * makeAppUrl()            // => 'http://localhost:3500/' or 'https://sherbrt.com/'
 */
const makeAppUrl = (path = '/') => {
  const base = getBaseUrl();

  if (!base) {
    console.warn('[URL] SERVER_BASE_URL and ROOT_URL not set, falling back to relative path');
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
 * Build an order page URL for a borrower transaction
 *
 * @param {string|object} transactionId - Transaction ID (UUID string or object with .uuid)
 * @returns {string} Full order page URL (e.g., https://www.sherbrt.com/order/690bcaf8-...)
 *
 * @example
 * orderUrl('690bcaf8-daa7-4052-ac6d-cf22b0a49cd9')
 * // => 'https://www.sherbrt.com/order/690bcaf8-daa7-4052-ac6d-cf22b0a49cd9'
 */
const orderUrl = (transactionId) => {
  // Extract UUID if transactionId is an object
  const txId = transactionId?.uuid || transactionId;
  
  if (!txId) {
    console.warn('[URL] orderUrl called with invalid transactionId:', transactionId);
    return makeAppUrl('/'); // Fallback to site root
  }
  
  const url = makeAppUrl(`/order/${txId}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log('[URL] orderUrl for borrower:', url);
  }
  return url;
};

/**
 * Build a sale page URL for a lender transaction
 *
 * @param {string|object} transactionId - Transaction ID (UUID string or object with .uuid)
 * @returns {string} Full sale page URL (e.g., https://www.sherbrt.com/sale/690bcaf8-...)
 *
 * @example
 * saleUrl('690bcaf8-daa7-4052-ac6d-cf22b0a49cd9')
 * // => 'https://www.sherbrt.com/sale/690bcaf8-daa7-4052-ac6d-cf22b0a49cd9'
 */
const saleUrl = (transactionId) => {
  // Extract UUID if transactionId is an object
  const txId = transactionId?.uuid || transactionId;
  
  if (!txId) {
    console.warn('[URL] saleUrl called with invalid transactionId:', transactionId);
    return makeAppUrl('/'); // Fallback to site root
  }
  
  const url = makeAppUrl(`/sale/${txId}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log('[URL] saleUrl for lender:', url);
  }
  return url;
};

/**
 * Build a shortlink URL for shipping labels
 * Uses SHORTLINK_BASE from env.js, which derives from PUBLIC_BASE_URL or SITE_URL
 *
 * @param {string} shortId - Short token ID (e.g., 'ABC123xyz4')
 * @returns {string} Full shortlink URL (e.g., https://www.sherbrt.com/r/ABC123xyz4)
 *
 * @example
 * labelShortUrl('ABC123xyz4')
 * // => 'https://www.sherbrt.com/r/ABC123xyz4'
 */
const labelShortUrl = (shortId) => {
  if (!shortId) {
    console.warn('[URL] labelShortUrl called with invalid shortId:', shortId);
    return '';
  }
  
  // Get base URL for shortlinks (includes /r already)
  const { SHORTLINK_BASE } = require('../lib/env');
  const base = SHORTLINK_BASE || 'https://www.sherbrt.com/r';
  
  // Ensure base doesn't have trailing slash and shortId doesn't have leading slash
  const cleanBase = base.replace(/\/+$/, '');
  const cleanShortId = shortId.replace(/^\/+/, '');
  
  const url = `${cleanBase}/${cleanShortId}`;
  if (process.env.NODE_ENV !== 'production') {
    console.log('[URL] labelShortUrl:', url);
  }
  return url;
};

module.exports = {
  getBaseUrl,
  makeAppUrl,
  getSmsLinkStrategy,
  buildShipLabelLink,
  buildReturnLabelLink,
  orderUrl,
  saleUrl,
  labelShortUrl,
};

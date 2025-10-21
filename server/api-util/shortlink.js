/**
 * Short Link System
 * 
 * Generates secure, compact short links for SMS to avoid Twilio 30019 errors.
 * Uses Redis for storage with HMAC-SHA256 verification for security.
 * 
 * Format: /r/{id}{hmac}
 * - id: 6-character alphanumeric ID (base62)
 * - hmac: 4-character HMAC signature for verification
 * 
 * Environment Variables:
 * - LINK_SECRET: Secret key for HMAC (required)
 * - SHORTLINK_BASE: Base URL for short links (from centralized env.js)
 */

const crypto = require('crypto');
const { SHORTLINK_ENABLED, SHORTLINK_BASE, SHORTLINK_TTL_DAYS } = require('../lib/env');

// Get Redis instance
let redis = null;
try {
  const { getRedis } = require('../redis');
  redis = getRedis();
} catch (e) {
  console.warn('[SHORTLINK] Redis not available, short links disabled');
}

// Base62 characters for compact IDs
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Get base URL for shortlinks from centralized env config
 * @returns {string} Base URL (e.g., 'https://www.sherbrt.com/r')
 */
function getBase() {
  return SHORTLINK_BASE; // already derived from PUBLIC_BASE_URL || SITE_URL in env.js
}

/**
 * Generate a random base62 ID
 * @param {number} length - Length of ID
 * @returns {string} Random base62 string
 */
function generateId(length = 6) {
  let id = '';
  for (let i = 0; i < length; i++) {
    id += BASE62[Math.floor(Math.random() * BASE62.length)];
  }
  return id;
}

/**
 * Generate HMAC-SHA256 signature (truncated for compactness)
 * @param {string} data - Data to sign
 * @param {string} secret - Secret key
 * @returns {string} HMAC signature (first 4 chars of base62)
 */
function generateHmac(data, secret) {
  if (!secret) {
    throw new Error('LINK_SECRET not configured');
  }
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  // Convert to base62 for compactness
  const hash = hmac.digest('hex');
  return hash.slice(0, 4);
}

/**
 * Create a short token for a URL
 * @param {string} url - Long URL to encode
 * @returns {Promise<string>} Short token (id+hmac)
 */
async function makeShortToken(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL for short token');
  }
  
  const secret = process.env.LINK_SECRET;
  if (!secret || !redis) {
    console.warn('[SHORTLINK] LINK_SECRET or Redis not available');
    return null;
  }
  
  // Generate a unique ID
  let id;
  let attempts = 0;
  const maxAttempts = 10;
  
  do {
    id = generateId(6);
    const exists = await redis.exists(`shortlink:${id}`);
    if (!exists) break;
    attempts++;
  } while (attempts < maxAttempts);
  
  if (attempts >= maxAttempts) {
    throw new Error('Failed to generate unique short link ID');
  }
  
  // Store URL in Redis with configurable TTL (default 21 days)
  const ttlSeconds = 60 * 60 * 24 * SHORTLINK_TTL_DAYS;
  await redis.set(`shortlink:${id}`, url, 'EX', ttlSeconds);
  
  // Generate HMAC for verification
  const hmac = generateHmac(id, secret);
  
  // Return token: id+hmac
  return `${id}${hmac}`;
}

/**
 * Expand a short token back to the original URL
 * @param {string} token - Short token (id+hmac)
 * @returns {Promise<string>} Original URL
 * @throws {Error} If token is invalid or HMAC verification fails
 */
async function expandShortToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token');
  }
  
  const secret = process.env.LINK_SECRET;
  if (!secret || !redis) {
    throw new Error('LINK_SECRET or Redis not configured');
  }
  
  // Token format: 6-char ID + 4-char HMAC = 10 chars
  if (token.length !== 10) {
    throw new Error('Invalid token format');
  }
  
  const id = token.slice(0, 6);
  const receivedHmac = token.slice(6);
  
  // Verify HMAC
  const expectedHmac = generateHmac(id, secret);
  if (receivedHmac !== expectedHmac) {
    throw new Error('Invalid token signature');
  }
  
  // Look up URL in Redis
  const url = await redis.get(`shortlink:${id}`);
  if (!url) {
    throw new Error('Link expired or not found');
  }
  
  return url;
}

/**
 * Generate a short link for a URL
 * @param {string} url - Long URL to shorten
 * @returns {Promise<string>|string} Short link (https://host/r/token) or original URL on error
 */
function shortLink(url) {
  if (!url || typeof url !== 'string') {
    console.warn('[SHORTLINK] Invalid URL, returning empty string');
    return '';
  }
  
  // Check if shortlinks are enabled
  if (!SHORTLINK_ENABLED) {
    console.log('[SHORTLINK] Shortlinks disabled, returning original URL');
    return url;
  }
  
  const secret = process.env.LINK_SECRET;
  if (!secret || !redis) {
    console.warn('[SHORTLINK] LINK_SECRET or Redis not available, returning original URL');
    return url;
  }
  
  // Get base URL from centralized env config
  const base = getBase(); // e.g., 'https://www.sherbrt.com/r'
  
  if (!base || base === '/r') {
    console.warn('[SHORTLINK] SHORTLINK_BASE not properly configured, returning original URL');
    return url;
  }
  
  // Generate short token asynchronously
  return makeShortToken(url)
    .then(token => {
      if (!token) return url;
      // SHORTLINK_BASE already includes /r, so just append the token
      return `${base}/${token}`;
    })
    .catch(err => {
      console.error('[SHORTLINK] Error generating short link:', err.message);
      return url;
    });
}

module.exports = {
  makeShortToken,
  expandShortToken,
  shortLink,
};


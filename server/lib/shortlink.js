/**
 * Shortlink utility for creating and resolving short URLs
 * 
 * This is a convenience wrapper around the core shortlink functionality
 * in server/api-util/shortlink.js, providing a simpler API for the
 * shipping and SMS modules.
 * 
 * @module shortlink
 */

const { shortLink: makeShortLinkCore } = require('../api-util/shortlink');

/**
 * Create a short link for a target URL
 * 
 * Returns a shortened URL like https://sherbrt.com/r/ABC123xyz4
 * Falls back to the original URL if shortlink generation fails.
 * 
 * @param {string} targetUrl - The long URL to shorten
 * @returns {Promise<string|null>} Shortened URL or null if targetUrl is empty
 * 
 * @example
 * const shortUrl = await makeShortLink('https://example.com/very/long/url');
 * // Returns: 'https://sherbrt.com/r/ABC123xyz4'
 */
async function makeShortLink(targetUrl) {
  if (!targetUrl) {
    return null;
  }

  try {
    // The core shortLink function returns a Promise
    const result = await makeShortLinkCore(targetUrl);
    return result || targetUrl; // fallback to original if shortlink fails
  } catch (error) {
    console.error('[shortlink] Error creating short link:', error.message);
    return targetUrl; // fallback to original URL on error
  }
}

module.exports = { 
  makeShortLink,
};


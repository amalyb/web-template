/**
 * Build lender "Ship by" SMS message with compliant shortlinks
 * 
 * For the initial shipment to the lender, this module:
 * 1. Picks the best compliant link (QR/label only, never tracking)
 * 2. Shortens the link to avoid SMS length issues
 * 3. Constructs a carrier-friendly SMS message
 * 
 * @module buildLenderShipByMessage
 */

const { pickShipmentLink } = require('../shipping/pickShipmentLink');
const { makeShortLink } = require('../shortlink');

/**
 * Build the lender "Ship by" SMS message
 * 
 * This function enforces the "QR/Label only, no tracking" policy for
 * initial lender shipments by failing loudly if no compliant link is available.
 * 
 * @param {Object} params - Message parameters
 * @param {string} params.itemTitle - Title of the item being shipped
 * @param {string} params.shipByDate - Formatted ship-by date (e.g., "Dec 15")
 * @param {Object} params.shippingArtifacts - Shipping artifacts from extractArtifacts()
 * @param {string} params.shippingArtifacts.carrier - Carrier name
 * @param {string|null} params.shippingArtifacts.upsQrUrl - UPS QR code URL
 * @param {string|null} params.shippingArtifacts.upsLabelUrl - UPS label URL
 * @param {string|null} params.shippingArtifacts.uspsLabelUrl - USPS label URL
 * @param {string|null} params.shippingArtifacts.trackingUrl - Tracking URL (NOT used for initial lender)
 * @returns {Promise<string>} SMS message text with shortlinked label
 * @throws {Error} If no compliant shipment link is available
 * 
 * @example
 * const message = await buildLenderShipByMessage({
 *   itemTitle: 'Canon EOS R5',
 *   shipByDate: 'Dec 15',
 *   shippingArtifacts: {
 *     carrier: 'UPS',
 *     upsQrUrl: 'https://shippo.com/qr/...',
 *     upsLabelUrl: 'https://shippo.com/label/...',
 *     uspsLabelUrl: null,
 *     trackingUrl: 'https://ups.com/track/...'
 *   }
 * });
 * // Returns: "Sherbrt 🍧: Ship "Canon EOS R5" by Dec 15. Label: https://sherbrt.com/r/ABC123"
 */
async function buildLenderShipByMessage({ itemTitle, shipByDate, shippingArtifacts }) {
  console.log('[buildLenderShipByMessage] Building SMS for initial lender shipment');

  // Pick the best compliant link (strict mode: initial-lender)
  const targetUrl = pickShipmentLink(shippingArtifacts, { phase: 'initial-lender' });

  if (!targetUrl) {
    // Fail closed: log loudly and throw error
    // This prevents accidentally sending a tracking link or broken link
    const errorDetails = {
      carrier: shippingArtifacts?.carrier,
      hasQr: !!shippingArtifacts?.upsQrUrl,
      hasUpsLabel: !!shippingArtifacts?.upsLabelUrl,
      hasUspsLabel: !!shippingArtifacts?.uspsLabelUrl,
      hasTracking: !!shippingArtifacts?.trackingUrl,
    };
    
    console.error('[buildLenderShipByMessage] CRITICAL: No compliant shipment link available', errorDetails);
    
    throw new Error(
      '[SMS] No compliant shipment link available for initial-lender SMS. ' +
      'Policy violation prevented: only QR/label links are allowed for initial lender shipment.'
    );
  }

  console.log('[buildLenderShipByMessage] Compliant link found, creating shortlink');

  // Shorten the link for SMS
  const shortUrl = await makeShortLink(targetUrl);

  if (!shortUrl) {
    console.error('[buildLenderShipByMessage] Failed to create shortlink, using original URL');
  }

  const finalLink = shortUrl || targetUrl;

  // Construct carrier-friendly SMS message
  // Keep it short to avoid carrier filtering and message splitting
  const message = `Sherbrt 🍧: Ship "${itemTitle}" by ${shipByDate}. Label: ${finalLink}`;

  console.log('[buildLenderShipByMessage] Message built', {
    length: message.length,
    hasShortlink: !!shortUrl,
    carrier: shippingArtifacts?.carrier,
  });

  return message;
}

module.exports = { buildLenderShipByMessage };


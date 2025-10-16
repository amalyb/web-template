// server/lib/trackingLinks.js
/**
 * Carrier-aware tracking link generator
 * 
 * Converts long Shippo tracking URLs into short public carrier tracking links
 * for SMS messages. This significantly reduces SMS character count.
 */

/**
 * Generate a public tracking URL for the given carrier and tracking number
 * 
 * @param {string} carrier - Carrier name (e.g., 'USPS', 'UPS', 'FedEx', 'DHL')
 * @param {string} trackingNumber - Tracking number
 * @returns {string} Public tracking URL
 * 
 * @example
 * getPublicTrackingUrl('USPS', '9405511234567890123456')
 * // => 'https://tools.usps.com/go/TrackConfirmAction_input?origTrackNum=9405511234567890123456'
 */
function getPublicTrackingUrl(carrier, trackingNumber) {
  if (!trackingNumber) {
    console.warn('[TRACKINGLINK] No tracking number provided, cannot generate public URL');
    return `https://goshippo.com/track/${trackingNumber || 'unknown'}`;
  }

  const normalizedCarrier = (carrier || '').toLowerCase();
  
  if (normalizedCarrier.includes('usps')) {
    return `https://tools.usps.com/go/TrackConfirmAction_input?origTrackNum=${trackingNumber}`;
  }
  
  if (normalizedCarrier.includes('ups')) {
    return `https://www.ups.com/track?loc=en_US&tracknum=${trackingNumber}`;
  }
  
  if (normalizedCarrier.includes('fedex')) {
    return `https://www.fedex.com/fedextrack/?tracknumbers=${trackingNumber}`;
  }
  
  if (normalizedCarrier.includes('dhl')) {
    return `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`;
  }

  // Fallback: Shippo's universal tracker
  console.warn(`[TRACKINGLINK] Unknown carrier "${carrier}", using Shippo fallback`);
  return `https://goshippo.com/track/${trackingNumber}`;
}

module.exports = { getPublicTrackingUrl };


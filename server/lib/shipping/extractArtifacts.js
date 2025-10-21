/**
 * Extract and normalize shipping artifacts from Shippo transaction
 * 
 * Shippo responses vary by carrier and label type. This module normalizes
 * the different field names and structures into a consistent format.
 * 
 * @module extractArtifacts
 */

/**
 * Extract shipping artifacts from Shippo transaction
 * 
 * @param {Object} params - Parameters
 * @param {string} params.carrier - Carrier name (e.g., 'UPS', 'USPS')
 * @param {string} [params.trackingNumber] - Tracking number (optional)
 * @param {Object} [params.shippoTx] - Shippo transaction object
 * @returns {Object} Normalized artifacts
 * @returns {string} return.carrier - Carrier name
 * @returns {string|null} return.trackingNumber - Tracking number
 * @returns {string|null} return.upsQrUrl - UPS QR code URL (if carrier is UPS)
 * @returns {string|null} return.upsLabelUrl - UPS label URL (if carrier is UPS)
 * @returns {string|null} return.uspsLabelUrl - USPS label URL (if carrier is USPS)
 * @returns {string|null} return.trackingUrl - Tracking URL (from Shippo or constructed)
 * @returns {Object|null} return.raw - Raw Shippo transaction for debugging
 */
function extractArtifacts({ carrier, trackingNumber, shippoTx }) {
  if (!shippoTx || typeof shippoTx !== 'object') {
    console.warn('[extractArtifacts] No shippoTx provided');
    return {
      carrier: carrier || 'UNKNOWN',
      trackingNumber: trackingNumber || null,
      upsQrUrl: null,
      upsLabelUrl: null,
      uspsLabelUrl: null,
      trackingUrl: null,
      raw: null,
    };
  }

  // Shippo exposes label/qr via various field names depending on the API version
  // Priority: top-level fields, then nested .label/.qr_code objects
  const labelUrl = 
    shippoTx.label_url || 
    shippoTx.label?.url || 
    shippoTx.labelUrl ||
    null;

  const qrUrl = 
    shippoTx.qr_code_url || 
    shippoTx.qr_code?.url || 
    shippoTx.qrCodeUrl ||
    null;

  const trackingUrlRaw = 
    shippoTx.tracking_url_provider || 
    shippoTx.tracking_url ||
    shippoTx.trackingUrlProvider ||
    null;

  const finalTrackingNumber = 
    trackingNumber || 
    shippoTx.tracking_number || 
    shippoTx.trackingNumber ||
    null;

  const carrierNormalized = (carrier || shippoTx.carrier || 'UNKNOWN').toUpperCase();

  // Carrier-specific artifact assignment
  const artifacts = {
    carrier: carrierNormalized,
    trackingNumber: finalTrackingNumber,
    upsQrUrl: null,
    upsLabelUrl: null,
    uspsLabelUrl: null,
    trackingUrl: trackingUrlRaw,
    raw: shippoTx,
  };

  if (carrierNormalized === 'UPS') {
    artifacts.upsQrUrl = qrUrl;
    artifacts.upsLabelUrl = labelUrl;
  } else if (carrierNormalized === 'USPS') {
    artifacts.uspsLabelUrl = labelUrl;
  }

  console.log('[extractArtifacts] Normalized:', {
    carrier: artifacts.carrier,
    hasQr: !!artifacts.upsQrUrl,
    hasLabel: !!(artifacts.upsLabelUrl || artifacts.uspsLabelUrl),
    hasTracking: !!artifacts.trackingUrl,
  });

  return artifacts;
}

module.exports = { extractArtifacts };


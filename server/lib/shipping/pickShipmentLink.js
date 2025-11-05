/**
 * Pick the best shipment link according to business rules and phase context
 * 
 * For initial-lender phase: strictly enforce QR/label only (no tracking)
 * For other phases: allow tracking if explicitly enabled
 * 
 * @module pickShipmentLink
 */

const { 
  UPS_LINK_MODE, 
  USPS_LINK_MODE, 
  ALLOW_TRACKING_IN_LENDER_SHIP 
} = require('../env');

/**
 * Pick the best shipment link based on context and business rules
 * 
 * Business rules:
 * 1. Initial lender shipment: NEVER return tracking URLs (QR/label only)
 * 2. UPS preferred order: QR > label > (tracking if allowed)
 * 3. USPS preferred order: QR > label > (tracking if allowed)
 * 4. Respect env-configured link mode preferences
 * 
 * @param {Object} artifacts - Shipping artifacts from extractArtifacts()
 * @param {string} artifacts.carrier - Carrier name (UPS, USPS, etc.)
 * @param {string|null} artifacts.upsQrUrl - UPS QR code URL
 * @param {string|null} artifacts.upsLabelUrl - UPS label URL
 * @param {string|null} artifacts.uspsQrUrl - USPS QR code URL
 * @param {string|null} artifacts.uspsLabelUrl - USPS label URL
 * @param {string|null} artifacts.trackingUrl - Tracking URL
 * @param {Object} [context] - Context for link selection
 * @param {string} [context.phase='initial-lender'] - Phase ('initial-lender' | 'return' | 'reminder')
 * @returns {string|null} Selected link URL or null if no compliant link available
 * 
 * @example
 * // Initial lender shipment - strict mode (no tracking)
 * const link = pickShipmentLink(artifacts, { phase: 'initial-lender' });
 * 
 * @example
 * // Return shipment or reminder - may allow tracking
 * const link = pickShipmentLink(artifacts, { phase: 'return' });
 */
function pickShipmentLink(artifacts, context = { phase: 'initial-lender' }) {
  if (!artifacts || typeof artifacts !== 'object') {
    console.warn('[pickShipmentLink] Invalid artifacts object');
    return null;
  }

  const phase = context.phase || 'initial-lender';
  const isInitialLender = phase === 'initial-lender';

  console.log('[pickShipmentLink] Context:', {
    phase,
    carrier: artifacts.carrier,
    isInitialLender,
  });

  const carrier = (artifacts.carrier || '').toUpperCase();

  // ---- UPS Carrier ----
  if (carrier === 'UPS') {
    // Try each mode in configured order
    for (const mode of UPS_LINK_MODE) {
      if (mode === 'qr' && artifacts.upsQrUrl) {
        console.log('[pickShipmentLink] Selected UPS QR code');
        return artifacts.upsQrUrl;
      }
      
      if (mode === 'label' && artifacts.upsLabelUrl) {
        console.log('[pickShipmentLink] Selected UPS label');
        return artifacts.upsLabelUrl;
      }
      
      // Tracking: only allowed if NOT initial-lender phase AND explicitly enabled
      if (mode === 'tracking' && !isInitialLender && ALLOW_TRACKING_IN_LENDER_SHIP) {
        if (artifacts.trackingUrl) {
          console.log('[pickShipmentLink] Selected UPS tracking (non-initial phase)');
          return artifacts.trackingUrl;
        }
      }
    }
  }

  // ---- USPS Carrier ----
  if (carrier === 'USPS') {
    // Try each mode in configured order
    for (const mode of USPS_LINK_MODE) {
      if (mode === 'qr' && artifacts.uspsQrUrl) {
        console.log('[pickShipmentLink] Selected USPS QR code');
        return artifacts.uspsQrUrl;
      }
      
      if (mode === 'label' && artifacts.uspsLabelUrl) {
        console.log('[pickShipmentLink] Selected USPS label');
        return artifacts.uspsLabelUrl;
      }
      
      // Tracking: only allowed if NOT initial-lender phase AND explicitly enabled
      if (mode === 'tracking' && !isInitialLender && ALLOW_TRACKING_IN_LENDER_SHIP) {
        if (artifacts.trackingUrl) {
          console.log('[pickShipmentLink] Selected USPS tracking (non-initial phase)');
          return artifacts.trackingUrl;
        }
      }
    }
  }

  // ---- Fallback for other carriers ----
  // Try label first, then tracking (if allowed)
  if (artifacts.upsLabelUrl) {
    console.log('[pickShipmentLink] Fallback: UPS label');
    return artifacts.upsLabelUrl;
  }
  
  if (artifacts.uspsLabelUrl) {
    console.log('[pickShipmentLink] Fallback: USPS label');
    return artifacts.uspsLabelUrl;
  }

  // Last resort: tracking URL (only if not initial-lender)
  if (!isInitialLender && ALLOW_TRACKING_IN_LENDER_SHIP && artifacts.trackingUrl) {
    console.log('[pickShipmentLink] Fallback: tracking URL (non-initial phase)');
    return artifacts.trackingUrl;
  }

  // If we got here in initial-lender phase, fail closed (no link)
  // This prevents accidentally sending tracking URLs in violation of policy
  console.warn('[pickShipmentLink] No compliant link available', {
    phase,
    carrier,
    hasQr: !!(artifacts.upsQrUrl || artifacts.uspsQrUrl),
    hasLabel: !!(artifacts.upsLabelUrl || artifacts.uspsLabelUrl),
    hasTracking: !!artifacts.trackingUrl,
  });

  return null;
}

module.exports = { pickShipmentLink };


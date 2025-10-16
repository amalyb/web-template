// server/lib/trackingLinks.js
function getPublicTrackingUrl(carrier, trackingNumber) {
  const c = (carrier || '').toLowerCase();
  if (!trackingNumber) return null;

  if (c.includes('usps')) {
    return `https://tools.usps.com/go/TrackConfirmAction_input?origTrackNum=${trackingNumber}`;
  }
  if (c.includes('ups')) {
    return `https://www.ups.com/track?loc=en_US&tracknum=${trackingNumber}`;
  }
  if (c.includes('fedex')) {
    return `https://www.fedex.com/fedextrack/?tracknumbers=${trackingNumber}`;
  }
  if (c.includes('dhl')) {
    return `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`;
  }
  // Fallback: Shippo universal tracker (still short)
  return `https://goshippo.com/track/${trackingNumber}`;
}

module.exports = { getPublicTrackingUrl };

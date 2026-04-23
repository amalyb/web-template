// server/config/shipping.js

module.exports = {
  defaultParcel: {
    // fallback if a listing doesn't specify its own parcel
    // (units: inches & ounces, match what your carrier lib expects)
    length: 12,
    width: 9,
    height: 3,
    weightOz: 16, // 1 lb
  },

  // Which services you allow for estimates and label purchases.
  // Must match exact Shippo format: "provider servicelevel.name"
  // e.g., "USPS Priority Mail" = "USPS" + " " + "Priority Mail"
  //
  // Expanded to 6 services (10.0 PR-1) so short-lead cross-country bookings
  // can land on expedited options instead of silently falling back to the
  // absolute-cheapest (too-slow) rate. Verify each string against a live
  // Shippo rate response before deploying — Shippo's exact strings win.
  preferredServices: [
    'USPS Priority Mail',
    'USPS Ground Advantage',
    'USPS Priority Mail Express',
    'UPS Ground',
    'UPS 2nd Day Air',
    'UPS Next Day Air Saver',
  ],

  // Toggle whether to include return label in the estimate
  includeReturn: true,

  // Verbose debugging (set DEBUG_SHIPPING_VERBOSE=1 in env)
  DEBUG_SHIPPING_VERBOSE: process.env.DEBUG_SHIPPING_VERBOSE === '1',
};


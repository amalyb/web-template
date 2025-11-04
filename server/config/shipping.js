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

  // Which services you allow for estimates
  // Must match exact Shippo format: "provider servicelevel.name"
  // e.g., "USPS Priority Mail" = "USPS" + " " + "Priority Mail"
  preferredServices: [
    'USPS Priority Mail',
    'USPS Ground Advantage',
    'UPS Ground',
  ],

  // Toggle whether to include return label in the estimate
  includeReturn: true,

  // Verbose debugging (set DEBUG_SHIPPING_VERBOSE=1 in env)
  DEBUG_SHIPPING_VERBOSE: process.env.DEBUG_SHIPPING_VERBOSE === '1',
};


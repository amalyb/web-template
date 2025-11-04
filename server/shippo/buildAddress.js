/**
 * buildAddress.js
 * 
 * Centralized helper for constructing Shippo-compatible address objects.
 * Supports optional email suppression to prevent UPS Quantum View notifications.
 * 
 * Usage:
 *   const address = buildShippoAddress(rawAddressData, { suppressEmail: true });
 */

/**
 * Builds a Shippo-compatible address object from raw address data.
 * 
 * @param {Object} rawAddress - Raw address data (e.g., from protectedData)
 * @param {string} rawAddress.name - Recipient name
 * @param {string} rawAddress.street1 - Street address line 1
 * @param {string} [rawAddress.street2] - Street address line 2 (optional)
 * @param {string} rawAddress.city - City
 * @param {string} rawAddress.state - State (2-letter code)
 * @param {string} rawAddress.zip - ZIP code
 * @param {string} [rawAddress.email] - Email address (optional, may be suppressed)
 * @param {string} [rawAddress.phone] - Phone number (optional)
 * @param {string} [rawAddress.country] - Country code (defaults to 'US')
 * 
 * @param {Object} options - Configuration options
 * @param {boolean} [options.suppressEmail=false] - Whether to exclude email from the address
 * 
 * @returns {Object} Shippo-compatible address object
 */
function buildShippoAddress(rawAddress, options = {}) {
  const { suppressEmail = false } = options;
  
  if (!rawAddress) {
    throw new Error('[buildShippoAddress] rawAddress is required');
  }
  
  // Construct base address with required fields
  const address = {
    name: rawAddress.name || 'Unknown',
    street1: rawAddress.street1,
    city: rawAddress.city,
    state: rawAddress.state,
    zip: rawAddress.zip,
    country: rawAddress.country || 'US'
  };
  
  // Add optional street2 if provided
  if (rawAddress.street2) {
    address.street2 = rawAddress.street2;
  }
  
  // Add phone if provided
  if (rawAddress.phone) {
    address.phone = rawAddress.phone;
  }
  
  // Add email only if not suppressed and email is provided
  if (!suppressEmail && rawAddress.email) {
    address.email = rawAddress.email;
  }
  
  return address;
}

module.exports = {
  buildShippoAddress
};


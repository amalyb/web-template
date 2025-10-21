// server/shippo/buildAddress.js

/**
 * Build a Shippo-compatible address object from raw address data
 * 
 * @param {Object} rawAddress - Raw address data with keys like name, street1, city, etc.
 * @param {Object} options - Configuration options
 * @param {boolean} options.suppressEmail - If true, omit email from the address
 * @returns {Object} Shippo-compatible address object
 * 
 * @example
 * const address = buildShippoAddress({
 *   name: 'John Doe',
 *   street1: '123 Main St',
 *   city: 'San Francisco',
 *   state: 'CA',
 *   zip: '94103',
 *   email: 'john@example.com',
 *   phone: '+14155551234'
 * }, { suppressEmail: true });
 * // Returns address without email field
 */
function buildShippoAddress(rawAddress, options = {}) {
  const { suppressEmail = false } = options;

  if (!rawAddress) {
    throw new Error('buildShippoAddress: rawAddress is required');
  }

  // Build the base address with required fields
  const address = {
    name: rawAddress.name || '',
    street1: rawAddress.street1 || '',
    city: rawAddress.city || '',
    state: rawAddress.state || '',
    zip: rawAddress.zip || '',
    country: rawAddress.country || 'US',
  };

  // Add optional street2 if present
  if (rawAddress.street2) {
    address.street2 = rawAddress.street2;
  }

  // Add optional phone if present
  if (rawAddress.phone) {
    address.phone = rawAddress.phone;
  }

  // Only include email when suppressEmail is false
  if (!suppressEmail && rawAddress.email) {
    address.email = rawAddress.email;
  }

  return address;
}

module.exports = { buildShippoAddress };


/**
 * validateAddress.js
 *
 * Pre-validates a Shippo address via the /addresses/?validate=true endpoint
 * BEFORE creating a shipment, then returns USPS's canonical normalization
 * (with ZIP+4) so the downstream /shipments/ payload uses the same address
 * the USPS pipeline already approved.
 *
 * Why: USPS in live mode at label-print (/transactions/) is stricter than
 * /addresses/?validate=true. Without ZIP+4, USPS can't disambiguate units
 * like "apt 7" against the building's delivery-point database, and rejects
 * with `failed_address_validation: Address not found.`. Pre-validating here
 * threads the canonical form through the rest of the flow so USPS sees
 * exactly what it just approved.
 *
 * Return shape:
 *   { valid: true,  normalized: {street1, street2, city, state, zip, name, ...}, messages: [] }
 *   { valid: false, normalized: null, messages: ['text', ...], transient: false }   ← hard fail (don't print label)
 *   { valid: false, normalized: null, messages: ['network/HTTP error: ...'], transient: true }   ← caller should fall back / proceed
 */

const axios = require('axios');

const SHIPPO_VALIDATE_URL = 'https://api.goshippo.com/addresses/';

/**
 * Validate and normalize an address via Shippo's /addresses/?validate=true.
 *
 * @param {Object} address - Shippo-shaped address (street1, city, state, zip, ...)
 * @returns {Promise<{valid: boolean, normalized: Object|null, messages: string[], transient?: boolean}>}
 */
async function validateAddress(address) {
  if (!address || !address.street1 || !address.city || !address.state || !address.zip) {
    return {
      valid: false,
      normalized: null,
      messages: ['address missing required fields (street1/city/state/zip)'],
      transient: false,
    };
  }

  const token = process.env.SHIPPO_API_TOKEN || process.env.SHIPPO_TOKEN || '';
  if (!token) {
    // No token = can't validate; treat as transient so caller proceeds with un-normalized.
    return {
      valid: false,
      normalized: null,
      messages: ['SHIPPO_API_TOKEN not set'],
      transient: true,
    };
  }

  // POST the address with validate:true. Shippo's /addresses/ endpoint
  // accepts the same shape as /shipments/ address_from/address_to plus a
  // boolean `validate` flag.
  const payload = { ...address, validate: true };

  let res;
  try {
    res = await axios.post(SHIPPO_VALIDATE_URL, payload, {
      headers: {
        'Authorization': `ShippoToken ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const detail = typeof data === 'object' ? JSON.stringify(data) : String(data || err.message);
    return {
      valid: false,
      normalized: null,
      messages: [`shippo /addresses error (${status || 'network'}): ${detail}`],
      transient: true,
    };
  }

  const body = res?.data || {};
  const validation = body.validation_results || {};
  const messages = Array.isArray(validation.messages)
    ? validation.messages.map(m => (typeof m === 'string' ? m : (m?.text || JSON.stringify(m))))
    : [];

  // is_valid:true with non-empty messages = soft warning. Pass through.
  if (validation.is_valid === true) {
    // Preserve the input's name/phone/email/country (Shippo's validate
    // endpoint sometimes drops these). Only override the address-line
    // fields with Shippo's canonical (which carries ZIP+4).
    const normalized = {
      ...address,
      street1: body.street1 || address.street1,
      street2: body.street2 || address.street2,
      city: body.city || address.city,
      state: body.state || address.state,
      zip: body.zip || address.zip,
    };
    return { valid: true, normalized, messages };
  }

  // is_valid:false — hard fail. Don't print a label.
  return {
    valid: false,
    normalized: null,
    messages: messages.length ? messages : ['shippo validation returned is_valid:false with no messages'],
    transient: false,
  };
}

module.exports = { validateAddress };

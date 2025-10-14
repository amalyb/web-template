/**
 * Server-side phone number normalization utilities
 * Mirrors client-side logic (src/util/phone.js) for consistency
 * No external dependencies - pure JavaScript
 */

/**
 * Normalizes a phone number to E.164 format (+country code + number)
 * 
 * @param {string} phone - Raw phone input (e.g., "5551234567", "+15551234567", "(555) 123-4567")
 * @param {string} defaultCountry - Default country for normalization (default: "US" = "1")
 * @returns {string} - E.164 formatted phone number (e.g., "+15551234567") or original if invalid
 * 
 * @example
 * normalizePhoneE164("5551234567") // "+15551234567"
 * normalizePhoneE164("+15551234567") // "+15551234567"
 * normalizePhoneE164("(555) 123-4567") // "+15551234567"
 */
function normalizePhoneE164(phone, defaultCountry = 'US') {
  if (!phone || typeof phone !== 'string') {
    return phone;
  }

  // Map country to country code
  const countryCodeMap = {
    'US': '1',
    'CA': '1',
    'UK': '44',
    'GB': '44',
  };
  const defaultCountryCode = countryCodeMap[defaultCountry.toUpperCase()] || '1';

  // Remove all non-digit characters except leading +
  const cleaned = String(phone).trim().replace(/[^\d+]/g, '');

  // If already in E.164 format (starts with +), validate and return
  if (cleaned.startsWith('+')) {
    // Basic validation: must have at least country code + 7 digits
    if (cleaned.length >= 8) {
      return cleaned;
    }
    return phone; // Return original if invalid E.164
  }

  // If 10 digits (US/CA format without country code), add +1
  if (cleaned.length === 10) {
    return `+${defaultCountryCode}${cleaned}`;
  }

  // If 11 digits starting with 1 (US/CA format with country code but no +), add +
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }

  // If other length but has digits, try to make it E.164 with default country code
  if (cleaned.length > 0) {
    // If it's longer than expected, might already have country code without +
    if (cleaned.length >= 10) {
      return `+${cleaned}`;
    }
    // Too short, add country code
    return `+${defaultCountryCode}${cleaned}`;
  }

  // Return original if we can't normalize it
  return phone;
}

/**
 * Validates if a phone number is in valid E.164 format or US 10-digit format
 * 
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid E.164 or 10-digit US format
 */
function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return false;
  }

  const cleaned = String(phone).trim().replace(/[^\d+]/g, '');

  // Valid E.164 format: +[country code][number] (min 8 chars, max ~15)
  if (/^\+\d{8,15}$/.test(cleaned)) {
    return true;
  }

  // Valid US 10-digit format
  if (/^\d{10}$/.test(cleaned)) {
    return true;
  }

  return false;
}

/**
 * Formats a phone number for display
 * 
 * @param {string} phone - E.164 formatted phone number
 * @returns {string} - Formatted phone number for display (e.g., "+1 (555) 123-4567")
 */
function formatPhoneForDisplay(phone) {
  if (!phone || typeof phone !== 'string') {
    return phone;
  }

  const cleaned = String(phone).trim().replace(/[^\d+]/g, '');

  // US numbers in E.164 format: +1XXXXXXXXXX
  if (cleaned.startsWith('+1') && cleaned.length === 12) {
    const number = cleaned.slice(2);
    return `+1 (${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6)}`;
  }

  // Other E.164 format: just add spacing
  if (cleaned.startsWith('+') && cleaned.length >= 8) {
    return cleaned;
  }

  // 10-digit US format
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }

  return phone;
}

module.exports = {
  normalizePhoneE164,
  isValidPhone,
  formatPhoneForDisplay,
};


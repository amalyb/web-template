/**
 * Phone number normalization utilities
 */

/**
 * Normalizes a phone number to E.164 format (+country code + number)
 * 
 * @param {string} phone - Raw phone input (e.g., "5551234567", "+15551234567", "(555) 123-4567")
 * @param {string} defaultCountryCode - Default country code if not provided (default: "1" for US)
 * @returns {string} - E.164 formatted phone number (e.g., "+15551234567") or original if invalid
 * 
 * @example
 * normalizePhoneE164("5551234567") // "+15551234567"
 * normalizePhoneE164("+15551234567") // "+15551234567"
 * normalizePhoneE164("(555) 123-4567") // "+15551234567"
 */
export const normalizePhoneE164 = (phone, defaultCountryCode = '1') => {
  if (!phone || typeof phone !== 'string') {
    return phone;
  }

  // Remove all non-digit characters except leading +
  const cleaned = phone.trim().replace(/[^\d+]/g, '');

  // If already in E.164 format (starts with +), validate and return
  if (cleaned.startsWith('+')) {
    // Basic validation: must have at least country code + 7 digits
    if (cleaned.length >= 8) {
      return cleaned;
    }
    return phone; // Return original if invalid E.164
  }

  // If 10 digits (US format without country code), add +1
  if (cleaned.length === 10) {
    return `+${defaultCountryCode}${cleaned}`;
  }

  // If 11 digits starting with 1 (US format with country code but no +), add +
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
};

/**
 * Validates if a phone number is in valid E.164 format or US 10-digit format
 * 
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid E.164 or 10-digit US format
 */
export const isValidPhone = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return false;
  }

  const cleaned = phone.trim().replace(/[^\d+]/g, '');

  // Valid E.164 format: +[country code][number] (min 8 chars, max ~15)
  if (/^\+\d{8,15}$/.test(cleaned)) {
    return true;
  }

  // Valid US 10-digit format
  if (/^\d{10}$/.test(cleaned)) {
    return true;
  }

  return false;
};

/**
 * Formats a phone number for display (UI-friendly, no "+" prefix)
 * 
 * @param {string} phone - E.164 formatted phone number or raw digits
 * @returns {string} - Formatted phone number for display (e.g., "(555) 123-4567")
 * 
 * Policy: UI never shows "+" prefix. Server normalizes to E.164 before SMS.
 */
export const formatPhoneForDisplay = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return phone;
  }

  const cleaned = phone.trim().replace(/[^\d+]/g, '');

  // US numbers in E.164 format: +1XXXXXXXXXX -> (555) 123-4567
  if (cleaned.startsWith('+1') && cleaned.length === 12) {
    const number = cleaned.slice(2);
    return `(${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6)}`;
  }

  // Other E.164 format with +: strip + and show digits only
  if (cleaned.startsWith('+') && cleaned.length >= 8) {
    const number = cleaned.slice(1);
    // For US numbers (11 digits starting with 1), format nicely
    if (number.startsWith('1') && number.length === 11) {
      const usNumber = number.slice(1);
      return `(${usNumber.slice(0, 3)}) ${usNumber.slice(3, 6)}-${usNumber.slice(6)}`;
    }
    // For other countries, just show digits without +
    return number;
  }

  // 10-digit US format
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }

  return phone;
};


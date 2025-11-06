/**
 * US Phone Number Formatter (digits only, no E.164 prefix)
 * 
 * Policy:
 * - UI never shows "+" prefix
 * - Stores raw digits only (e.g., "5103997781" or "15103997781")
 * - Displays friendly format while typing: (510) 399-7781
 * - Server normalizes to E.164 (+15103997781) before Twilio
 */

/**
 * Extract only digits from a string
 * @param {String} str - Input string
 * @returns {String} - String containing only digits
 */
const pickOnlyDigits = str => (str || '').replace(/\D/g, '');

/**
 * Format phone number for display (US format without +)
 * Shows: (510) 399-7781
 * 
 * @param {String} value - Raw digits or partially formatted number
 * @returns {String} - Formatted phone number for display
 */
export const format = value => {
  if (!value) {
    return '';
  }

  // Extract only digits
  const digits = pickOnlyDigits(value);
  
  // No formatting if empty
  if (!digits) {
    return '';
  }

  // Format based on length
  // 1-3 digits: "510"
  if (digits.length <= 3) {
    return digits;
  }
  
  // 4-6 digits: "(510) 399"
  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  
  // 7-10 digits: "(510) 399-7781"
  // Also handles 11 digits (with country code): "(510) 399-7781" (strips leading 1)
  const last10 = digits.slice(-10);
  return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6, 10)}`;
};

/**
 * Parse user input to store only digits
 * Strips all formatting characters, stores raw digits
 * 
 * @param {String} value - User input (may include formatting)
 * @returns {String} - Raw digits only
 */
export const parse = value => {
  if (!value) {
    return '';
  }

  // Store only digits (no +, no formatting)
  const digits = pickOnlyDigits(value);
  
  // Limit to 11 digits max (1 + 10 for US with country code)
  return digits.slice(0, 11);
};


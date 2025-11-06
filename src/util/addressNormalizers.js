/**
 * Address normalization utilities
 * Includes automatic unit extraction from street1 to street2
 */

/**
 * Extract unit/apartment number from street1 line
 * Detects patterns like: #7, Apt 4, Suite 200, Unit B, Ste 300, etc.
 * 
 * @param {string} street1 - Street address line 1
 * @returns {{street1Clean: string, unit: string|null}} - Cleaned street1 and extracted unit
 * 
 * @example
 * extractUnitFromStreet1("1745 Pacific Ave #7")
 * // { street1Clean: "1745 Pacific Ave", unit: "#7" }
 * 
 * extractUnitFromStreet1("101 Main St Apt 4")
 * // { street1Clean: "101 Main St", unit: "Apt 4" }
 * 
 * extractUnitFromStreet1("200 Oak St Suite 100")
 * // { street1Clean: "200 Oak St", unit: "Suite 100" }
 */
export function extractUnitFromStreet1(street1) {
  if (!street1 || typeof street1 !== 'string') {
    return { street1Clean: street1 || '', unit: null };
  }

  const trimmed = street1.trim();

  // Regex patterns for common unit indicators
  // Matches: #123, # 123, Apt 4, Apartment 4B, Unit A, Suite 200, Ste 300, etc.
  const unitPatterns = [
    // Hash patterns: #7, # 7, #123
    /[,\s]+#\s*([A-Z0-9]+(?:-[A-Z0-9]+)?)$/i,
    // Apartment patterns: Apt 4, Apartment 4B, apt. 4
    /[,\s]+(?:apt|apartment)\.?\s+([A-Z0-9]+(?:-[A-Z0-9]+)?)$/i,
    // Suite patterns: Suite 200, Ste 300, suite #100
    /[,\s]+(?:suite|ste)\.?\s+#?\s*([A-Z0-9]+(?:-[A-Z0-9]+)?)$/i,
    // Unit patterns: Unit B, unit 7
    /[,\s]+unit\.?\s+([A-Z0-9]+(?:-[A-Z0-9]+)?)$/i,
    // Building patterns: Bldg 3, Building A
    /[,\s]+(?:bldg|building)\.?\s+([A-Z0-9]+(?:-[A-Z0-9]+)?)$/i,
    // Floor patterns: Floor 3, Fl 2
    /[,\s]+(?:floor|fl)\.?\s+([A-Z0-9]+)$/i,
  ];

  for (const pattern of unitPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const unit = match[0].trim().replace(/^[,\s]+/, ''); // Remove leading comma/space
      const street1Clean = trimmed.substring(0, match.index).trim();
      return { street1Clean, unit };
    }
  }

  // No unit detected
  return { street1Clean: trimmed, unit: null };
}

/**
 * Normalize street1 and street2, automatically extracting unit from street1 if needed
 * Only moves unit to street2 if street2 is currently empty
 * 
 * @param {string} street1 - Street address line 1
 * @param {string} street2 - Street address line 2 (optional)
 * @returns {{street1: string, street2: string}} - Normalized addresses
 * 
 * @example
 * normalizeStreet1AndStreet2("1745 Pacific Ave #7", "")
 * // { street1: "1745 Pacific Ave", street2: "#7" }
 * 
 * normalizeStreet1AndStreet2("101 Main St Apt 4", "Suite 10")
 * // { street1: "101 Main St Apt 4", street2: "Suite 10" } // Doesn't overwrite existing street2
 * 
 * normalizeStreet1AndStreet2("123 Oak St", "")
 * // { street1: "123 Oak St", street2: "" } // No unit to extract
 */
export function normalizeStreet1AndStreet2(street1, street2) {
  const trimmedStreet2 = (street2 || '').trim();

  // If street2 already has content, don't touch it
  if (trimmedStreet2) {
    return {
      street1: (street1 || '').trim(),
      street2: trimmedStreet2
    };
  }

  // Try to extract unit from street1
  const { street1Clean, unit } = extractUnitFromStreet1(street1);

  return {
    street1: street1Clean,
    street2: unit || ''
  };
}

/**
 * Normalize phone number to E.164 format with validation
 * Re-exports from phone.js for convenience
 * 
 * @param {string} phone - Raw phone input
 * @param {string} defaultCountryCode - Default country code (default: "1")
 * @returns {string} - E.164 formatted phone or original if invalid
 */
export { normalizePhoneE164 } from './phone.js';

/**
 * Validate US ZIP code (5 digits or ZIP+4 format)
 * 
 * @param {string} zip - ZIP code to validate
 * @returns {boolean} - True if valid US ZIP
 * 
 * @example
 * isValidUSZip("94109") // true
 * isValidUSZip("94109-1234") // true
 * isValidUSZip("9410") // false
 */
export function isValidUSZip(zip) {
  if (!zip || typeof zip !== 'string') {
    return false;
  }

  const cleaned = zip.trim();
  // 5 digits or 5+4 digits with hyphen
  return /^\d{5}(-\d{4})?$/.test(cleaned);
}

/**
 * Normalize ZIP code (remove spaces, validate format)
 * 
 * @param {string} zip - Raw ZIP code
 * @returns {string} - Normalized ZIP code
 * 
 * @example
 * normalizeZip("94109 1234") // "94109-1234"
 * normalizeZip("94109") // "94109"
 */
export function normalizeZip(zip) {
  if (!zip || typeof zip !== 'string') {
    return '';
  }

  let cleaned = zip.trim().replace(/\s+/g, '');

  // If it has 9 digits without a hyphen, add one
  if (/^\d{9}$/.test(cleaned)) {
    cleaned = `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`;
  }

  return cleaned;
}


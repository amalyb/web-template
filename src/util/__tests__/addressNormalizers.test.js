/**
 * Tests for address normalizer utilities
 */

import {
  extractUnitFromStreet1,
  normalizeStreet1AndStreet2,
  isValidUSZip,
  normalizeZip,
} from '../addressNormalizers';

describe('extractUnitFromStreet1', () => {
  test('extracts hash-style unit numbers', () => {
    const result = extractUnitFromStreet1('1745 Pacific Ave #7');
    expect(result).toEqual({
      street1Clean: '1745 Pacific Ave',
      unit: '#7'
    });
  });

  test('extracts hash with space', () => {
    const result = extractUnitFromStreet1('123 Main St # 42');
    expect(result).toEqual({
      street1Clean: '123 Main St',
      unit: '# 42'
    });
  });

  test('extracts "Apt" style units', () => {
    const result = extractUnitFromStreet1('101 Main St Apt 4');
    expect(result).toEqual({
      street1Clean: '101 Main St',
      unit: 'Apt 4'
    });
  });

  test('extracts "Apartment" style units', () => {
    const result = extractUnitFromStreet1('456 Oak Ave Apartment 12B');
    expect(result).toEqual({
      street1Clean: '456 Oak Ave',
      unit: 'Apartment 12B'
    });
  });

  test('extracts "Suite" style units', () => {
    const result = extractUnitFromStreet1('200 Business Blvd Suite 300');
    expect(result).toEqual({
      street1Clean: '200 Business Blvd',
      unit: 'Suite 300'
    });
  });

  test('extracts "Ste" style units', () => {
    const result = extractUnitFromStreet1('789 Corporate Dr Ste 150');
    expect(result).toEqual({
      street1Clean: '789 Corporate Dr',
      unit: 'Ste 150'
    });
  });

  test('extracts "Unit" style', () => {
    const result = extractUnitFromStreet1('321 Elm St Unit B');
    expect(result).toEqual({
      street1Clean: '321 Elm St',
      unit: 'Unit B'
    });
  });

  test('extracts "Building" style', () => {
    const result = extractUnitFromStreet1('555 Campus Way Building A');
    expect(result).toEqual({
      street1Clean: '555 Campus Way',
      unit: 'Building A'
    });
  });

  test('extracts "Floor" style', () => {
    const result = extractUnitFromStreet1('100 Tower St Floor 3');
    expect(result).toEqual({
      street1Clean: '100 Tower St',
      unit: 'Floor 3'
    });
  });

  test('handles comma-separated units', () => {
    const result = extractUnitFromStreet1('1745 Pacific Ave, #7');
    expect(result).toEqual({
      street1Clean: '1745 Pacific Ave',
      unit: '#7'
    });
  });

  test('handles hyphenated unit numbers', () => {
    const result = extractUnitFromStreet1('222 Pine St Apt 4-B');
    expect(result).toEqual({
      street1Clean: '222 Pine St',
      unit: 'Apt 4-B'
    });
  });

  test('returns no unit when none detected', () => {
    const result = extractUnitFromStreet1('1745 Pacific Ave');
    expect(result).toEqual({
      street1Clean: '1745 Pacific Ave',
      unit: null
    });
  });

  test('handles empty string', () => {
    const result = extractUnitFromStreet1('');
    expect(result).toEqual({
      street1Clean: '',
      unit: null
    });
  });

  test('handles null/undefined', () => {
    expect(extractUnitFromStreet1(null)).toEqual({
      street1Clean: '',
      unit: null
    });
    expect(extractUnitFromStreet1(undefined)).toEqual({
      street1Clean: '',
      unit: null
    });
  });

  test('case insensitive matching', () => {
    const result1 = extractUnitFromStreet1('100 Main APT 5');
    expect(result1.unit).toBe('APT 5');

    const result2 = extractUnitFromStreet1('200 Oak SUITE 10');
    expect(result2.unit).toBe('SUITE 10');
  });

  test('handles periods in abbreviations', () => {
    const result1 = extractUnitFromStreet1('100 Main St Apt. 5');
    expect(result1).toEqual({
      street1Clean: '100 Main St',
      unit: 'Apt. 5'
    });

    const result2 = extractUnitFromStreet1('200 Oak Ave Ste. 10');
    expect(result2).toEqual({
      street1Clean: '200 Oak Ave',
      unit: 'Ste. 10'
    });
  });

  test('preserves alphanumeric unit codes', () => {
    const result = extractUnitFromStreet1('500 Park Pl Apt 2A');
    expect(result).toEqual({
      street1Clean: '500 Park Pl',
      unit: 'Apt 2A'
    });
  });
});

describe('normalizeStreet1AndStreet2', () => {
  test('moves unit from street1 to street2 when street2 is empty', () => {
    const result = normalizeStreet1AndStreet2('1745 Pacific Ave #7', '');
    expect(result).toEqual({
      street1: '1745 Pacific Ave',
      street2: '#7'
    });
  });

  test('moves apartment from street1 to street2', () => {
    const result = normalizeStreet1AndStreet2('101 Main St Apt 4', '');
    expect(result).toEqual({
      street1: '101 Main St',
      street2: 'Apt 4'
    });
  });

  test('does NOT overwrite existing street2', () => {
    const result = normalizeStreet1AndStreet2('101 Main St Apt 4', 'Suite 10');
    expect(result).toEqual({
      street1: '101 Main St Apt 4', // Keeps original
      street2: 'Suite 10' // Preserves existing
    });
  });

  test('handles street1 with no unit and empty street2', () => {
    const result = normalizeStreet1AndStreet2('123 Oak St', '');
    expect(result).toEqual({
      street1: '123 Oak St',
      street2: ''
    });
  });

  test('trims whitespace', () => {
    const result = normalizeStreet1AndStreet2('  100 Main St #5  ', '  ');
    expect(result).toEqual({
      street1: '100 Main St',
      street2: '#5'
    });
  });

  test('handles null/undefined inputs', () => {
    const result1 = normalizeStreet1AndStreet2(null, null);
    expect(result1).toEqual({
      street1: '',
      street2: ''
    });

    const result2 = normalizeStreet1AndStreet2(undefined, undefined);
    expect(result2).toEqual({
      street1: '',
      street2: ''
    });
  });

  test('handles comma-separated unit extraction', () => {
    const result = normalizeStreet1AndStreet2('1745 Pacific Ave, Suite 200', '');
    expect(result).toEqual({
      street1: '1745 Pacific Ave',
      street2: 'Suite 200'
    });
  });
});

describe('isValidUSZip', () => {
  test('validates 5-digit ZIP', () => {
    expect(isValidUSZip('94109')).toBe(true);
    expect(isValidUSZip('12345')).toBe(true);
    expect(isValidUSZip('00501')).toBe(true);
  });

  test('validates ZIP+4 format', () => {
    expect(isValidUSZip('94109-1234')).toBe(true);
    expect(isValidUSZip('12345-6789')).toBe(true);
  });

  test('rejects invalid formats', () => {
    expect(isValidUSZip('9410')).toBe(false); // Too short
    expect(isValidUSZip('941099')).toBe(false); // Too long
    expect(isValidUSZip('ABCDE')).toBe(false); // Letters
    expect(isValidUSZip('94109-123')).toBe(false); // Invalid ZIP+4
    expect(isValidUSZip('94109 1234')).toBe(false); // Space instead of hyphen
  });

  test('handles empty/null/undefined', () => {
    expect(isValidUSZip('')).toBe(false);
    expect(isValidUSZip(null)).toBe(false);
    expect(isValidUSZip(undefined)).toBe(false);
  });

  test('trims whitespace before validation', () => {
    expect(isValidUSZip('  94109  ')).toBe(true);
    expect(isValidUSZip('  94109-1234  ')).toBe(true);
  });
});

describe('normalizeZip', () => {
  test('removes spaces from ZIP+4', () => {
    expect(normalizeZip('94109 1234')).toBe('94109-1234');
    expect(normalizeZip('12345 6789')).toBe('12345-6789');
  });

  test('adds hyphen to 9-digit ZIP', () => {
    expect(normalizeZip('941091234')).toBe('94109-1234');
    expect(normalizeZip('123456789')).toBe('12345-6789');
  });

  test('preserves 5-digit ZIP', () => {
    expect(normalizeZip('94109')).toBe('94109');
    expect(normalizeZip('12345')).toBe('12345');
  });

  test('preserves already-formatted ZIP+4', () => {
    expect(normalizeZip('94109-1234')).toBe('94109-1234');
  });

  test('trims whitespace', () => {
    expect(normalizeZip('  94109  ')).toBe('94109');
    expect(normalizeZip('  94109-1234  ')).toBe('94109-1234');
  });

  test('removes multiple spaces', () => {
    expect(normalizeZip('94109   1234')).toBe('94109-1234');
  });

  test('handles empty/null/undefined', () => {
    expect(normalizeZip('')).toBe('');
    expect(normalizeZip(null)).toBe('');
    expect(normalizeZip(undefined)).toBe('');
  });
});

describe('integration: APT ZZ-TEST scenario', () => {
  test('end-to-end unit extraction for Shippo test case', () => {
    const street1Input = '1745 PACIFIC AVE APT ZZ-TEST';
    const street2Input = '';

    const result = normalizeStreet1AndStreet2(street1Input, street2Input);

    expect(result.street1).toBe('1745 PACIFIC AVE');
    expect(result.street2).toBe('APT ZZ-TEST');

    // Verify it would work in Shippo payload
    const shippoPayload = {
      address_from: {
        street1: result.street1,
        street2: result.street2,
      }
    };

    expect(shippoPayload.address_from.street2).toBe('APT ZZ-TEST');
  });

  test('real-world lender accept scenario', () => {
    // Lender types address with unit in street1
    const formValues = {
      streetAddress: '1745 Pacific Ave, Apt 4',
      streetAddress2: ''
    };

    // Normalize before sending to server
    const normalized = normalizeStreet1AndStreet2(
      formValues.streetAddress,
      formValues.streetAddress2
    );

    // Result should have clean street1 and unit in street2
    expect(normalized.street1).toBe('1745 Pacific Ave');
    expect(normalized.street2).toBe('Apt 4');
  });
});


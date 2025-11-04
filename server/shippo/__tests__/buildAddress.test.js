/**
 * Unit tests for buildAddress.js
 * 
 * Tests email suppression logic for Shippo address construction.
 */

const { buildShippoAddress } = require('../buildAddress');

describe('buildShippoAddress', () => {
  const mockAddressData = {
    name: 'John Doe',
    street1: '123 Main St',
    street2: 'Apt 4B',
    city: 'San Francisco',
    state: 'CA',
    zip: '94102',
    email: 'john@example.com',
    phone: '+14155551234',
    country: 'US'
  };

  describe('with suppressEmail: false', () => {
    it('should include email in the address', () => {
      const result = buildShippoAddress(mockAddressData, { suppressEmail: false });
      
      expect(result).toEqual({
        name: 'John Doe',
        street1: '123 Main St',
        street2: 'Apt 4B',
        city: 'San Francisco',
        state: 'CA',
        zip: '94102',
        country: 'US',
        phone: '+14155551234',
        email: 'john@example.com'
      });
    });
  });

  describe('with suppressEmail: true', () => {
    it('should exclude email from the address', () => {
      const result = buildShippoAddress(mockAddressData, { suppressEmail: true });
      
      expect(result).toEqual({
        name: 'John Doe',
        street1: '123 Main St',
        street2: 'Apt 4B',
        city: 'San Francisco',
        state: 'CA',
        zip: '94102',
        country: 'US',
        phone: '+14155551234'
      });
      
      // Explicitly verify email is not present
      expect(result.email).toBeUndefined();
    });
  });

  describe('with default options', () => {
    it('should include email by default (suppressEmail defaults to false)', () => {
      const result = buildShippoAddress(mockAddressData);
      
      expect(result.email).toBe('john@example.com');
    });
  });

  describe('with missing optional fields', () => {
    it('should omit street2 when not provided', () => {
      const addressWithoutStreet2 = {
        name: 'Jane Smith',
        street1: '456 Oak Ave',
        city: 'Los Angeles',
        state: 'CA',
        zip: '90001',
        email: 'jane@example.com'
      };
      
      const result = buildShippoAddress(addressWithoutStreet2, { suppressEmail: false });
      
      expect(result).toEqual({
        name: 'Jane Smith',
        street1: '456 Oak Ave',
        city: 'Los Angeles',
        state: 'CA',
        zip: '90001',
        country: 'US',
        email: 'jane@example.com'
      });
      
      expect(result.street2).toBeUndefined();
    });

    it('should omit phone when not provided', () => {
      const addressWithoutPhone = {
        name: 'Bob Johnson',
        street1: '789 Pine St',
        city: 'Seattle',
        state: 'WA',
        zip: '98101',
        email: 'bob@example.com'
      };
      
      const result = buildShippoAddress(addressWithoutPhone, { suppressEmail: false });
      
      expect(result.phone).toBeUndefined();
    });

    it('should omit email when not provided (even with suppressEmail: false)', () => {
      const addressWithoutEmail = {
        name: 'Alice Brown',
        street1: '321 Elm St',
        city: 'Portland',
        state: 'OR',
        zip: '97201'
      };
      
      const result = buildShippoAddress(addressWithoutEmail, { suppressEmail: false });
      
      expect(result.email).toBeUndefined();
    });
  });

  describe('with country field', () => {
    it('should use provided country code', () => {
      const addressWithCountry = {
        ...mockAddressData,
        country: 'CA'
      };
      
      const result = buildShippoAddress(addressWithCountry, { suppressEmail: false });
      
      expect(result.country).toBe('CA');
    });

    it('should default to US when country not provided', () => {
      const addressWithoutCountry = {
        name: 'Test User',
        street1: '111 Test St',
        city: 'Test City',
        state: 'TX',
        zip: '75001'
      };
      
      const result = buildShippoAddress(addressWithoutCountry, { suppressEmail: false });
      
      expect(result.country).toBe('US');
    });
  });

  describe('with default name', () => {
    it('should use "Unknown" when name not provided', () => {
      const addressWithoutName = {
        street1: '999 Test Ave',
        city: 'Test Town',
        state: 'NV',
        zip: '89101'
      };
      
      const result = buildShippoAddress(addressWithoutName, { suppressEmail: false });
      
      expect(result.name).toBe('Unknown');
    });
  });

  describe('error handling', () => {
    it('should throw error when rawAddress is null', () => {
      expect(() => buildShippoAddress(null, { suppressEmail: false }))
        .toThrow('[buildShippoAddress] rawAddress is required');
    });

    it('should throw error when rawAddress is undefined', () => {
      expect(() => buildShippoAddress(undefined, { suppressEmail: false }))
        .toThrow('[buildShippoAddress] rawAddress is required');
    });
  });

  describe('real-world scenarios', () => {
    it('should handle lender address with email included', () => {
      const lenderAddress = {
        name: 'Lender Shop',
        street1: '100 Business Blvd',
        city: 'San Diego',
        state: 'CA',
        zip: '92101',
        email: 'lender@shop.com',
        phone: '+16195551234'
      };
      
      const result = buildShippoAddress(lenderAddress, { suppressEmail: false });
      
      expect(result.email).toBe('lender@shop.com');
    });

    it('should handle borrower address with email suppressed (UPS prevention)', () => {
      const borrowerAddress = {
        name: 'Borrower Name',
        street1: '200 Residential St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        email: 'borrower@email.com',
        phone: '+15125551234'
      };
      
      const result = buildShippoAddress(borrowerAddress, { suppressEmail: true });
      
      expect(result.email).toBeUndefined();
      expect(result.name).toBe('Borrower Name');
      expect(result.phone).toBe('+15125551234');
    });
  });
});


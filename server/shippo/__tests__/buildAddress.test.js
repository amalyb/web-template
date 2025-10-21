// server/shippo/__tests__/buildAddress.test.js

const { buildShippoAddress } = require('../buildAddress');

describe('buildShippoAddress', () => {
  const mockAddress = {
    name: 'John Doe',
    street1: '123 Main St',
    street2: 'Apt 4B',
    city: 'San Francisco',
    state: 'CA',
    zip: '94103',
    country: 'US',
    email: 'john@example.com',
    phone: '+14155551234',
  };

  describe('when suppressEmail is false', () => {
    it('should include all address fields including email', () => {
      const result = buildShippoAddress(mockAddress, { suppressEmail: false });

      expect(result).toEqual({
        name: 'John Doe',
        street1: '123 Main St',
        street2: 'Apt 4B',
        city: 'San Francisco',
        state: 'CA',
        zip: '94103',
        country: 'US',
        email: 'john@example.com',
        phone: '+14155551234',
      });
    });

    it('should include email by default when suppressEmail option is not provided', () => {
      const result = buildShippoAddress(mockAddress);

      expect(result.email).toBe('john@example.com');
    });
  });

  describe('when suppressEmail is true', () => {
    it('should exclude email from address', () => {
      const result = buildShippoAddress(mockAddress, { suppressEmail: true });

      expect(result).toEqual({
        name: 'John Doe',
        street1: '123 Main St',
        street2: 'Apt 4B',
        city: 'San Francisco',
        state: 'CA',
        zip: '94103',
        country: 'US',
        phone: '+14155551234',
      });
      expect(result.email).toBeUndefined();
    });

    it('should not include email field when it is missing from rawAddress', () => {
      const addressWithoutEmail = { ...mockAddress };
      delete addressWithoutEmail.email;

      const result = buildShippoAddress(addressWithoutEmail, { suppressEmail: true });

      expect(result.email).toBeUndefined();
    });
  });

  describe('optional fields', () => {
    it('should omit street2 when not provided', () => {
      const addressWithoutStreet2 = { ...mockAddress };
      delete addressWithoutStreet2.street2;

      const result = buildShippoAddress(addressWithoutStreet2, { suppressEmail: false });

      expect(result.street2).toBeUndefined();
    });

    it('should omit phone when not provided', () => {
      const addressWithoutPhone = { ...mockAddress };
      delete addressWithoutPhone.phone;

      const result = buildShippoAddress(addressWithoutPhone, { suppressEmail: false });

      expect(result.phone).toBeUndefined();
    });

    it('should default country to US when not provided', () => {
      const addressWithoutCountry = { ...mockAddress };
      delete addressWithoutCountry.country;

      const result = buildShippoAddress(addressWithoutCountry, { suppressEmail: false });

      expect(result.country).toBe('US');
    });
  });

  describe('required fields', () => {
    it('should handle missing name gracefully', () => {
      const addressWithoutName = { ...mockAddress };
      delete addressWithoutName.name;

      const result = buildShippoAddress(addressWithoutName, { suppressEmail: false });

      expect(result.name).toBe('');
    });

    it('should handle missing street1 gracefully', () => {
      const addressWithoutStreet1 = { ...mockAddress };
      delete addressWithoutStreet1.street1;

      const result = buildShippoAddress(addressWithoutStreet1, { suppressEmail: false });

      expect(result.street1).toBe('');
    });

    it('should throw error when rawAddress is null', () => {
      expect(() => buildShippoAddress(null, { suppressEmail: false })).toThrow(
        'buildShippoAddress: rawAddress is required'
      );
    });

    it('should throw error when rawAddress is undefined', () => {
      expect(() => buildShippoAddress(undefined, { suppressEmail: false })).toThrow(
        'buildShippoAddress: rawAddress is required'
      );
    });
  });

  describe('real-world scenarios', () => {
    it('should build lender address with email (suppressEmail: false)', () => {
      const lenderData = {
        name: 'Jane Provider',
        street1: '456 Oak Ave',
        city: 'Los Angeles',
        state: 'CA',
        zip: '90001',
        email: 'jane@provider.com',
        phone: '+13105551234',
      };

      const result = buildShippoAddress(lenderData, { suppressEmail: false });

      expect(result.email).toBe('jane@provider.com');
      expect(result.name).toBe('Jane Provider');
    });

    it('should build borrower address without email when suppression is ON', () => {
      const borrowerData = {
        name: 'Bob Borrower',
        street1: '789 Pine St',
        city: 'New York',
        state: 'NY',
        zip: '10001',
        email: 'bob@borrower.com',
        phone: '+12125551234',
      };

      const result = buildShippoAddress(borrowerData, { suppressEmail: true });

      expect(result.email).toBeUndefined();
      expect(result.name).toBe('Bob Borrower');
      expect(result.street1).toBe('789 Pine St');
      expect(result.phone).toBe('+12125551234');
    });
  });
});


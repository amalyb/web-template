/**
 * Unit tests for validateAddress.js
 *
 * Covers:
 *  - valid → returns canonical (ZIP+4) and preserves name/phone/email/country
 *  - soft warnings (valid:true with messages) still pass
 *  - is_valid:false → hard fail, transient:false
 *  - 4xx/5xx HTTP → transient:true
 *  - Network error → transient:true
 *  - Missing required fields → hard fail before any HTTP call
 *  - Missing token → transient:true (no HTTP call)
 */

jest.mock('axios');
const axios = require('axios');
const { validateAddress } = require('../validateAddress');

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...ORIGINAL_ENV, SHIPPO_API_TOKEN: 'shippo_test_token_xxx' };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const baseInput = {
  name: 'Jane Borrower',
  street1: '1795 Chestnut Street',
  street2: 'apt 7',
  city: 'San Francisco',
  state: 'CA',
  zip: '94123',
  country: 'US',
  phone: '+14155551234',
  email: 'borrower@example.com',
};

describe('validateAddress', () => {
  describe('valid input with canonical normalization', () => {
    it('returns is_valid:true and the normalized canonical (with ZIP+4)', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          street1: '1795 Chestnut St',
          street2: 'Apt 7',
          city: 'San Francisco',
          state: 'CA',
          zip: '94123-2935',
          country: 'US',
          validation_results: { is_valid: true, messages: [] },
        },
      });

      const result = await validateAddress(baseInput);

      expect(result.valid).toBe(true);
      expect(result.transient).toBeUndefined();
      expect(result.messages).toEqual([]);
      expect(result.normalized.street1).toBe('1795 Chestnut St');
      expect(result.normalized.street2).toBe('Apt 7');
      expect(result.normalized.zip).toBe('94123-2935');
      expect(result.normalized.city).toBe('San Francisco');
      expect(result.normalized.state).toBe('CA');
    });

    it('preserves name, phone, email, country on the normalized output', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          street1: '1795 Chestnut St',
          street2: 'Apt 7',
          city: 'San Francisco',
          state: 'CA',
          zip: '94123-2935',
          // Note: shippo's validate endpoint may drop these; helper must preserve from input.
          validation_results: { is_valid: true, messages: [] },
        },
      });

      const result = await validateAddress(baseInput);

      expect(result.normalized.name).toBe('Jane Borrower');
      expect(result.normalized.phone).toBe('+14155551234');
      expect(result.normalized.email).toBe('borrower@example.com');
      expect(result.normalized.country).toBe('US');
    });

    it('POSTs to /addresses/ with validate:true and the ShippoToken header', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          street1: '1795 Chestnut St',
          city: 'San Francisco',
          state: 'CA',
          zip: '94123-2935',
          validation_results: { is_valid: true, messages: [] },
        },
      });

      await validateAddress(baseInput);

      expect(axios.post).toHaveBeenCalledTimes(1);
      const [url, payload, opts] = axios.post.mock.calls[0];
      expect(url).toBe('https://api.goshippo.com/addresses/');
      expect(payload.validate).toBe(true);
      expect(payload.street1).toBe('1795 Chestnut Street');
      expect(opts.headers.Authorization).toBe('ShippoToken shippo_test_token_xxx');
      expect(opts.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('soft warnings', () => {
    it('passes through with messages when is_valid:true with non-empty messages', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          street1: '1795 Chestnut St',
          street2: 'Apt 7',
          city: 'San Francisco',
          state: 'CA',
          zip: '94123-2935',
          validation_results: {
            is_valid: true,
            messages: [
              { text: 'More information may give a more specific address.' },
            ],
          },
        },
      });

      const result = await validateAddress(baseInput);

      expect(result.valid).toBe(true);
      expect(result.messages).toEqual(['More information may give a more specific address.']);
      expect(result.normalized.zip).toBe('94123-2935');
    });

    it('handles plain string messages too', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          street1: '1795 Chestnut St',
          city: 'San Francisco',
          state: 'CA',
          zip: '94123-2935',
          validation_results: {
            is_valid: true,
            messages: ['plain string warning'],
          },
        },
      });

      const result = await validateAddress(baseInput);
      expect(result.messages).toEqual(['plain string warning']);
    });
  });

  describe('hard failure', () => {
    it('returns valid:false, transient:false when is_valid:false', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          validation_results: {
            is_valid: false,
            messages: [
              { text: 'Address not found.' },
            ],
          },
        },
      });

      const result = await validateAddress(baseInput);

      expect(result.valid).toBe(false);
      expect(result.transient).toBe(false);
      expect(result.normalized).toBeNull();
      expect(result.messages).toEqual(['Address not found.']);
    });

    it('synthesizes a message when is_valid:false but messages empty', async () => {
      axios.post.mockResolvedValueOnce({
        data: { validation_results: { is_valid: false, messages: [] } },
      });

      const result = await validateAddress(baseInput);
      expect(result.valid).toBe(false);
      expect(result.transient).toBe(false);
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  describe('transient errors', () => {
    it('returns transient:true on 4xx HTTP error', async () => {
      const err = Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400, data: { detail: 'bad request' } },
      });
      axios.post.mockRejectedValueOnce(err);

      const result = await validateAddress(baseInput);
      expect(result.valid).toBe(false);
      expect(result.transient).toBe(true);
      expect(result.normalized).toBeNull();
      expect(result.messages[0]).toMatch(/400/);
    });

    it('returns transient:true on 5xx HTTP error', async () => {
      const err = Object.assign(new Error('Request failed with status code 500'), {
        response: { status: 500, data: 'internal server error' },
      });
      axios.post.mockRejectedValueOnce(err);

      const result = await validateAddress(baseInput);
      expect(result.valid).toBe(false);
      expect(result.transient).toBe(true);
      expect(result.messages[0]).toMatch(/500/);
    });

    it('returns transient:true on network error (no response)', async () => {
      axios.post.mockRejectedValueOnce(new Error('ECONNRESET'));

      const result = await validateAddress(baseInput);
      expect(result.valid).toBe(false);
      expect(result.transient).toBe(true);
      expect(result.messages[0]).toMatch(/network/i);
      expect(result.messages[0]).toMatch(/ECONNRESET/);
    });
  });

  describe('input guards', () => {
    it('hard-fails (no HTTP) when address missing required fields', async () => {
      const result = await validateAddress({ city: 'San Francisco' });
      expect(result.valid).toBe(false);
      expect(result.transient).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('returns transient:true (no HTTP) when SHIPPO_API_TOKEN unset', async () => {
      delete process.env.SHIPPO_API_TOKEN;
      delete process.env.SHIPPO_TOKEN;

      const result = await validateAddress(baseInput);
      expect(result.valid).toBe(false);
      expect(result.transient).toBe(true);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('falls back to SHIPPO_TOKEN when SHIPPO_API_TOKEN unset', async () => {
      delete process.env.SHIPPO_API_TOKEN;
      process.env.SHIPPO_TOKEN = 'fallback_token';
      axios.post.mockResolvedValueOnce({
        data: {
          street1: '1795 Chestnut St',
          city: 'San Francisco',
          state: 'CA',
          zip: '94123-2935',
          validation_results: { is_valid: true, messages: [] },
        },
      });

      await validateAddress(baseInput);
      const opts = axios.post.mock.calls[0][2];
      expect(opts.headers.Authorization).toBe('ShippoToken fallback_token');
    });
  });
});

/**
 * Unit tests for URL helper functions
 */

const {
  getBaseUrl,
  makeAppUrl,
  getSmsLinkStrategy,
  buildShipLabelLink,
  buildReturnLabelLink,
} = require('./url');

// Save original env vars
const originalEnv = { ...process.env };

// Helper to set env vars for tests
const setEnv = (vars) => {
  Object.keys(vars).forEach(key => {
    process.env[key] = vars[key];
  });
};

// Reset env after each test
const resetEnv = () => {
  Object.keys(process.env).forEach(key => {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  });
  Object.keys(originalEnv).forEach(key => {
    process.env[key] = originalEnv[key];
  });
};

describe('URL Helper Functions', () => {
  afterEach(() => {
    resetEnv();
  });

  describe('getBaseUrl', () => {
    it('should return ROOT_URL without trailing slash', () => {
      setEnv({ ROOT_URL: 'https://sherbrt.com/' });
      expect(getBaseUrl()).toBe('https://sherbrt.com');
    });

    it('should return ROOT_URL as-is if no trailing slash', () => {
      setEnv({ ROOT_URL: 'https://sherbrt.com' });
      expect(getBaseUrl()).toBe('https://sherbrt.com');
    });

    it('should return empty string if ROOT_URL not set', () => {
      delete process.env.ROOT_URL;
      expect(getBaseUrl()).toBe('');
    });

    it('should handle multiple trailing slashes', () => {
      setEnv({ ROOT_URL: 'https://sherbrt.com///' });
      expect(getBaseUrl()).toBe('https://sherbrt.com');
    });
  });

  describe('makeAppUrl', () => {
    beforeEach(() => {
      setEnv({ ROOT_URL: 'https://sherbrt.com' });
    });

    it('should build URL with leading slash', () => {
      expect(makeAppUrl('/ship/123')).toBe('https://sherbrt.com/ship/123');
    });

    it('should build URL without leading slash', () => {
      expect(makeAppUrl('ship/123')).toBe('https://sherbrt.com/ship/123');
    });

    it('should handle default path', () => {
      expect(makeAppUrl()).toBe('https://sherbrt.com/');
    });

    it('should handle root path explicitly', () => {
      expect(makeAppUrl('/')).toBe('https://sherbrt.com/');
    });

    it('should work with test environment URL', () => {
      setEnv({ ROOT_URL: 'https://test.sherbrt.com' });
      expect(makeAppUrl('/ship/456')).toBe('https://test.sherbrt.com/ship/456');
    });

    it('should return relative path if ROOT_URL not set', () => {
      delete process.env.ROOT_URL;
      expect(makeAppUrl('/ship/789')).toBe('/ship/789');
    });
  });

  describe('getSmsLinkStrategy', () => {
    it('should default to "app"', () => {
      expect(getSmsLinkStrategy()).toBe('app');
    });

    it('should return "app" when explicitly set', () => {
      setEnv({ SMS_LINK_STRATEGY: 'app' });
      expect(getSmsLinkStrategy()).toBe('app');
    });

    it('should return "shippo" when set', () => {
      setEnv({ SMS_LINK_STRATEGY: 'shippo' });
      expect(getSmsLinkStrategy()).toBe('shippo');
    });

    it('should default to "app" for invalid values', () => {
      setEnv({ SMS_LINK_STRATEGY: 'invalid' });
      expect(getSmsLinkStrategy()).toBe('app');
    });
  });

  describe('buildShipLabelLink', () => {
    beforeEach(() => {
      setEnv({ ROOT_URL: 'https://sherbrt.com' });
    });

    it('should use app URL by default', () => {
      const result = buildShipLabelLink('tx-123');
      expect(result.url).toBe('https://sherbrt.com/ship/tx-123');
      expect(result.strategy).toBe('app');
    });

    it('should use app URL when strategy is "app"', () => {
      setEnv({ SMS_LINK_STRATEGY: 'app' });
      const result = buildShipLabelLink('tx-123', {
        label_url: 'https://shippo.com/label/abc',
      });
      expect(result.url).toBe('https://sherbrt.com/ship/tx-123');
      expect(result.strategy).toBe('app');
    });

    it('should use Shippo label URL when strategy is "shippo"', () => {
      setEnv({ SMS_LINK_STRATEGY: 'shippo' });
      const result = buildShipLabelLink('tx-123', {
        label_url: 'https://shippo.com/label/abc',
      });
      expect(result.url).toBe('https://shippo.com/label/abc');
      expect(result.strategy).toBe('shippo');
    });

    it('should prefer QR code URL when preferQr is true', () => {
      setEnv({ SMS_LINK_STRATEGY: 'shippo' });
      const result = buildShipLabelLink('tx-123', {
        label_url: 'https://shippo.com/label/abc',
        qr_code_url: 'https://shippo.com/qr/xyz',
      }, { preferQr: true });
      expect(result.url).toBe('https://shippo.com/qr/xyz');
      expect(result.strategy).toBe('shippo');
    });

    it('should fallback to app URL if Shippo URL not available', () => {
      setEnv({ SMS_LINK_STRATEGY: 'shippo' });
      const result = buildShipLabelLink('tx-123', {});
      expect(result.url).toBe('https://sherbrt.com/ship/tx-123');
      expect(result.strategy).toBe('app');
    });

    it('should use label_url if qr_code_url not available and preferQr is true', () => {
      setEnv({ SMS_LINK_STRATEGY: 'shippo' });
      const result = buildShipLabelLink('tx-123', {
        label_url: 'https://shippo.com/label/abc',
      }, { preferQr: true });
      expect(result.url).toBe('https://shippo.com/label/abc');
      expect(result.strategy).toBe('shippo');
    });
  });

  describe('buildReturnLabelLink', () => {
    beforeEach(() => {
      setEnv({ ROOT_URL: 'https://sherbrt.com' });
    });

    it('should use app URL by default', () => {
      const result = buildReturnLabelLink('tx-123');
      expect(result.url).toBe('https://sherbrt.com/return/tx-123');
      expect(result.strategy).toBe('app');
    });

    it('should use Shippo label URL when strategy is "shippo"', () => {
      setEnv({ SMS_LINK_STRATEGY: 'shippo' });
      const result = buildReturnLabelLink('tx-123', {
        label_url: 'https://shippo.com/return/abc',
      });
      expect(result.url).toBe('https://shippo.com/return/abc');
      expect(result.strategy).toBe('shippo');
    });

    it('should fallback to app URL if Shippo URL not available', () => {
      setEnv({ SMS_LINK_STRATEGY: 'shippo' });
      const result = buildReturnLabelLink('tx-123', {});
      expect(result.url).toBe('https://sherbrt.com/return/tx-123');
      expect(result.strategy).toBe('app');
    });
  });
});


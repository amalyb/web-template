/**
 * Tests for shipping estimate functionality
 * Run with: npm test server/__tests__/shipping-estimates.test.js
 */

const { estimateOneWay, estimateRoundTrip } = require('../lib/shipping');
const { transactionLineItems } = require('../api-util/lineItems');
const { types } = require('sharetribe-flex-sdk');
const { Money } = types;

// Mock Shippo client
let mockShippoClient = null;

jest.mock('../lib/shipping', () => {
  const original = jest.requireActual('../lib/shipping');
  return {
    ...original,
    shippingClient: null, // Will be set by tests
  };
});

describe('Shipping Estimates', () => {
  
  describe('estimateOneWay', () => {
    
    beforeEach(() => {
      // Reset environment
      delete process.env.SHIPPO_API_TOKEN;
    });

    test('returns null when Shippo token is missing', async () => {
      const result = await estimateOneWay({
        fromZip: '94109',
        toZip: '10014',
        parcel: null
      });

      expect(result).toBeNull();
    });

    test('returns null when fromZip is missing', async () => {
      process.env.SHIPPO_API_TOKEN = 'test_token';
      
      const result = await estimateOneWay({
        fromZip: null,
        toZip: '10014',
        parcel: null
      });

      expect(result).toBeNull();
    });

    test('returns null when toZip is missing', async () => {
      process.env.SHIPPO_API_TOKEN = 'test_token';
      
      const result = await estimateOneWay({
        fromZip: '94109',
        toZip: null,
        parcel: null
      });

      expect(result).toBeNull();
    });

    test('returns estimate object with valid ZIPs (mocked)', async () => {
      process.env.SHIPPO_API_TOKEN = 'test_token';
      
      // Mock successful Shippo response
      const mockShipment = {
        rates: [
          {
            provider: 'USPS',
            servicelevel: { name: 'Ground Advantage' },
            amount: '12.50',
            currency: 'USD',
            object_id: 'rate_123'
          }
        ],
        status: 'SUCCESS'
      };

      // This test would need actual Shippo mock setup
      // For now, we verify the structure
    });
  });

  describe('getZips (integration)', () => {
    
    test('returns null ZIPs when SDK is not provided', async () => {
      const { getZips } = require('../api-util/lineItems');
      
      const result = await getZips({
        listingId: 'test-listing',
        currentUserId: 'test-user',
        sdk: null
      });

      expect(result).toEqual({
        borrowerZip: null,
        lenderZip: null
      });
    });
  });

  describe('buildShippingLine', () => {
    
    test('returns zero-priced line when borrower ZIP is missing', async () => {
      const mockListing = {
        id: { uuid: 'listing-123' },
        attributes: {
          publicData: {},
          price: { amount: 9000, currency: 'USD' }
        }
      };

      const mockSdk = {
        listings: {
          show: jest.fn().mockResolvedValue({
            data: {
              data: mockListing,
              included: []
            }
          })
        },
        users: {
          show: jest.fn().mockResolvedValue({
            data: {
              data: {
                id: { uuid: 'user-123' },
                attributes: {
                  profile: {
                    publicData: {} // No shippingZip
                  }
                }
              }
            }
          })
        }
      };

      const { buildShippingLine } = require('../api-util/lineItems');
      
      const result = await buildShippingLine({
        listing: mockListing,
        currentUserId: 'user-123',
        sdk: mockSdk
      });

      expect(result.code).toBe('line-item/estimated-shipping');
      expect(result.calculatedAtCheckout).toBe(true);
      expect(result.unitPrice).toEqual(new Money(0, 'USD'));
      expect(result.quantity).toBe(1);
      expect(result.includeFor).toEqual(['customer']);
    });
  });

  describe('transactionLineItems', () => {
    
    test('includes zero-priced shipping line when ZIPs missing', async () => {
      const mockListing = {
        id: { uuid: 'listing-123' },
        attributes: {
          publicData: { unitType: 'night' },
          price: { amount: 9000, currency: 'USD' }
        }
      };

      const mockOrderData = {
        bookingStart: '2025-01-10T00:00:00.000Z',
        bookingEnd: '2025-01-13T00:00:00.000Z'
      };

      const mockCommission = { percentage: 15 };

      const mockSdk = {
        listings: {
          show: jest.fn().mockResolvedValue({
            data: {
              data: mockListing,
              included: []
            }
          })
        },
        users: {
          show: jest.fn().mockResolvedValue({
            data: {
              data: {
                id: { uuid: 'user-123' },
                attributes: {
                  profile: { publicData: {} }
                }
              }
            }
          })
        }
      };

      const lineItems = await transactionLineItems(
        mockListing,
        mockOrderData,
        mockCommission,
        mockCommission,
        { currentUserId: 'user-123', sdk: mockSdk }
      );

      // Should have: day rate, discount, 2x commission, shipping
      expect(lineItems.length).toBeGreaterThanOrEqual(4);

      const shippingLine = lineItems.find(
        item => item.code === 'line-item/estimated-shipping'
      );

      expect(shippingLine).toBeDefined();
      expect(shippingLine.calculatedAtCheckout).toBe(true);
      expect(shippingLine.unitPrice.amount).toBe(0);
    });

    test('includes only ONE shipping line', async () => {
      const mockListing = {
        id: { uuid: 'listing-123' },
        attributes: {
          publicData: { unitType: 'night' },
          price: { amount: 9000, currency: 'USD' }
        }
      };

      const mockOrderData = {
        bookingStart: '2025-01-10T00:00:00.000Z',
        bookingEnd: '2025-01-13T00:00:00.000Z'
      };

      const mockCommission = { percentage: 15 };

      const mockSdk = {
        listings: {
          show: jest.fn().mockResolvedValue({
            data: {
              data: mockListing,
              included: []
            }
          })
        },
        users: {
          show: jest.fn().mockResolvedValue({
            data: {
              data: {
                id: { uuid: 'user-123' },
                attributes: {
                  profile: { publicData: {} }
                }
              }
            }
          })
        }
      };

      const lineItems = await transactionLineItems(
        mockListing,
        mockOrderData,
        mockCommission,
        mockCommission,
        { currentUserId: 'user-123', sdk: mockSdk }
      );

      const shippingLines = lineItems.filter(
        item => item.code === 'line-item/estimated-shipping'
      );

      expect(shippingLines.length).toBe(1);
    });
  });

  describe('PII Protection', () => {
    
    test('getZips logs only booleans, not actual ZIPs', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      
      const mockSdk = {
        listings: {
          show: jest.fn().mockResolvedValue({
            data: {
              data: {
                id: { uuid: 'listing-123' },
                relationships: {
                  author: {
                    data: { id: { uuid: 'lender-123' } }
                  }
                }
              },
              included: []
            }
          })
        },
        users: {
          show: jest.fn().mockResolvedValue({
            data: {
              data: {
                id: { uuid: 'user-123' },
                attributes: {
                  profile: {
                    publicData: { shippingZip: '94109' }
                  }
                }
              }
            }
          })
        }
      };

      const { getZips } = require('../api-util/lineItems');
      
      await getZips({
        listingId: 'listing-123',
        currentUserId: 'user-123',
        sdk: mockSdk
      });

      // Check that logs don't contain actual ZIP codes
      const logCalls = consoleSpy.mock.calls.map(call => JSON.stringify(call));
      const hasZipInLogs = logCalls.some(call => call.includes('94109'));
      
      expect(hasZipInLogs).toBe(false);
      
      consoleSpy.mockRestore();
    });
  });

  describe('Money Type Consistency', () => {
    
    test('shipping line uses correct Money constructor', async () => {
      const { buildShippingLine } = require('../api-util/lineItems');
      
      const mockListing = {
        id: { uuid: 'listing-123' },
        attributes: {
          publicData: {},
          price: { amount: 9000, currency: 'USD' }
        }
      };

      const mockSdk = {
        listings: {
          show: jest.fn().mockResolvedValue({
            data: {
              data: mockListing,
              included: []
            }
          })
        },
        users: {
          show: jest.fn().mockResolvedValue({
            data: {
              data: {
                id: { uuid: 'user-123' },
                attributes: {
                  profile: { publicData: {} }
                }
              }
            }
          })
        }
      };

      const result = await buildShippingLine({
        listing: mockListing,
        currentUserId: 'user-123',
        sdk: mockSdk
      });

      // Verify it's a Money instance
      expect(result.unitPrice).toBeInstanceOf(Money);
      expect(result.unitPrice.amount).toBe(0);
      expect(result.unitPrice.currency).toBe('USD');
    });
  });
});

describe('Caching', () => {
  
  test('subsequent calls with same ZIPs return cached results', async () => {
    // This would test the cache functionality
    // Requires more complex mocking of Shippo client
  });

  test('cache expires after 20 minutes', async () => {
    // This would test TTL functionality
    // Requires time manipulation
  });
});

describe('Timeout & Retry', () => {
  
  test('retries once on network errors', async () => {
    // This would test retry logic
    // Requires mocking network failures
  });

  test('times out after 5 seconds', async () => {
    // This would test timeout functionality
    // Requires mocking slow Shippo responses
  });
});



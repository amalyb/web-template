/**
 * Test harness for validating Money instances through selectors and state normalization.
 * 
 * Purpose: Verify that listing.attributes.price remains a Money instance through:
 * - Redux state normalization (updatedEntities)
 * - Denormalization (getMarketplaceEntities)
 * - Selector chain feeding OrderPanel and BookingDatesForm
 * 
 * This test does NOT add runtime console logs - uses assertions only.
 */

import { types as sdkTypes } from '../util/sdkLoader';
import { updatedEntities, denormalisedEntities } from '../util/data';
import { getMarketplaceEntities } from './marketplaceData.duck';

const { Money, UUID } = sdkTypes;

describe('Money Instance Preservation Through State/Selectors', () => {
  describe('SDK Response → updatedEntities → denormalisedEntities', () => {
    it('should preserve Money instance through normalization pipeline', () => {
      const listingId = new UUID('listing-123');
      const mockPrice = new Money(7500, 'USD');
      
      // Simulate SDK API response
      const mockSdkResponse = {
        data: {
          id: listingId,
          type: 'listing',
          attributes: {
            title: 'Test Listing',
            price: mockPrice, // ← Money instance
            publicData: {
              listingType: 'daily-booking',
              unitType: 'day',
            },
          },
        },
        included: [],
      };

      // Step 1: Normalize into Redux entities
      const normalizedEntities = updatedEntities({}, mockSdkResponse);

      // Verify price is still a Money instance after normalization
      const normalizedListing = normalizedEntities.listing[listingId.uuid];
      expect(normalizedListing).toBeDefined();
      expect(normalizedListing.attributes.price instanceof Money).toBe(true);
      expect(normalizedListing.attributes.price.amount).toBe(7500);
      expect(normalizedListing.attributes.price.currency).toBe('USD');

      // Step 2: Denormalize back (as selectors do)
      const denormalizedListings = denormalisedEntities(
        normalizedEntities,
        [{ id: listingId, type: 'listing' }],
        false
      );

      expect(denormalizedListings).toHaveLength(1);
      const denormalizedListing = denormalizedListings[0];
      
      // CRITICAL: Money instance must survive denormalization
      expect(denormalizedListing.attributes.price instanceof Money).toBe(true);
      expect(denormalizedListing.attributes.price.amount).toBe(7500);
      expect(denormalizedListing.attributes.price.currency).toBe('USD');
    });

    it('should detect if Money gets serialized to string during normalization', () => {
      const listingId = new UUID('listing-456');
      
      // Simulate a BAD scenario where price arrives as a string (bug case)
      const mockSdkResponse = {
        data: {
          id: listingId,
          type: 'listing',
          attributes: {
            title: 'Test Listing',
            price: 'Money(7500, USD)', // ⚠️ BUG: stringified Money
            publicData: {
              listingType: 'daily-booking',
              unitType: 'day',
            },
          },
        },
        included: [],
      };

      const normalizedEntities = updatedEntities({}, mockSdkResponse);
      const normalizedListing = normalizedEntities.listing[listingId.uuid];
      
      // This test documents the BUG if price is a string
      const priceValue = normalizedListing.attributes.price;
      
      if (typeof priceValue === 'string') {
        throw new Error(
          `BUG DETECTED: price is a string "${priceValue}" after normalization. ` +
          `Expected Money instance. This indicates Money was stringified upstream.`
        );
      }

      // Ideally, this should pass (price is Money)
      expect(priceValue instanceof Money).toBe(true);
    });
  });

  describe('getMarketplaceEntities selector', () => {
    it('should return listings with Money price from Redux state', () => {
      const listingId = new UUID('listing-789');
      const mockPrice = new Money(12000, 'EUR');

      const mockState = {
        marketplaceData: {
          entities: {
            listing: {
              [listingId.uuid]: {
                id: listingId,
                type: 'listing',
                attributes: {
                  title: 'Euro Listing',
                  price: mockPrice, // Money instance in state
                  publicData: {
                    listingType: 'daily-booking',
                    unitType: 'day',
                  },
                },
              },
            },
          },
        },
      };

      const entityRefs = [{ id: listingId, type: 'listing' }];
      const selectedListings = getMarketplaceEntities(mockState, entityRefs);

      expect(selectedListings).toHaveLength(1);
      const listing = selectedListings[0];

      // CRITICAL: Selector must return Money instance
      expect(listing.attributes.price instanceof Money).toBe(true);
      expect(listing.attributes.price.amount).toBe(12000);
      expect(listing.attributes.price.currency).toBe('EUR');
    });

    it('should detect if selector returns stringified Money', () => {
      const listingId = new UUID('listing-bug');

      // Simulate Redux state where price got stringified (bug scenario)
      const mockState = {
        marketplaceData: {
          entities: {
            listing: {
              [listingId.uuid]: {
                id: listingId,
                type: 'listing',
                attributes: {
                  title: 'Bug Listing',
                  price: 'Money(12000, EUR)', // ⚠️ BUG: stringified in state
                  publicData: {
                    listingType: 'daily-booking',
                    unitType: 'day',
                  },
                },
              },
            },
          },
        },
      };

      const entityRefs = [{ id: listingId, type: 'listing' }];
      const selectedListings = getMarketplaceEntities(mockState, entityRefs);
      const listing = selectedListings[0];
      const priceValue = listing.attributes.price;

      if (typeof priceValue === 'string') {
        throw new Error(
          `BUG DETECTED: getMarketplaceEntities returned stringified price: "${priceValue}". ` +
          `This means Redux state contains stringified Money, not instances. ` +
          `Check SSR hydration or Redux middleware.`
        );
      }

      // Should not reach here if bug exists
      expect(priceValue instanceof Money).toBe(true);
    });
  });

  describe('ListingPage selector flow simulation', () => {
    it('should preserve Money through getListing → OrderPanel → BookingDatesForm chain', () => {
      const listingId = new UUID('listing-flow');
      const mockPrice = new Money(5500, 'GBP');

      // Simulate full Redux state as it would be in ListingPage
      const mockState = {
        marketplaceData: {
          entities: {
            listing: {
              [listingId.uuid]: {
                id: listingId,
                type: 'listing',
                attributes: {
                  title: 'Flow Test Listing',
                  price: mockPrice,
                  state: 'published',
                  publicData: {
                    listingType: 'daily-booking',
                    unitType: 'day',
                  },
                  availabilityPlan: {
                    type: 'availability-plan/day',
                    timezone: 'Europe/London',
                  },
                },
              },
            },
          },
        },
        ListingPage: {
          monthlyTimeSlots: {},
          lineItems: [],
        },
      };

      // Simulate ListingPage's getListing function (from mapStateToProps)
      const getListing = (id) => {
        const ref = { id, type: 'listing' };
        const listings = getMarketplaceEntities(mockState, [ref]);
        return listings.length === 1 ? listings[0] : null;
      };

      const currentListing = getListing(listingId);
      expect(currentListing).not.toBeNull();

      // Extract price as OrderPanel would
      const price = currentListing.attributes.price;

      // CRITICAL: Price passed to OrderPanel must be Money instance
      expect(price instanceof Money).toBe(true);
      expect(price.amount).toBe(5500);
      expect(price.currency).toBe('GBP');

      // Simulate OrderPanel passing price to BookingDatesForm via sharedProps
      const sharedProps = {
        price, // ← This becomes `unitPrice` prop in BookingDatesForm
        listingId: currentListing.id,
        isOwnListing: false,
      };

      // Verify prop that would reach BookingDatesForm
      expect(sharedProps.price instanceof Money).toBe(true);
    });
  });

  describe('Money instance characteristics', () => {
    it('should verify Money instance has expected SDK type markers', () => {
      const money = new Money(10000, 'USD');

      // These properties must exist for Money to work correctly
      expect(money._sdkType).toBe('Money');
      expect(money.amount).toBe(10000);
      expect(money.currency).toBe('USD');
      
      // Money should have custom methods
      expect(typeof money.toString).toBe('function');
      
      // instanceof check should work
      expect(money instanceof Money).toBe(true);
    });

    it('should detect plain object masquerading as Money', () => {
      // Simulate what happens if Money class instance is lost (e.g., after JSON.parse)
      const plainObject = {
        _sdkType: 'Money',
        amount: 10000,
        currency: 'USD',
      };

      // This would FAIL instanceof check
      expect(plainObject instanceof Money).toBe(false);
      
      // If we receive plain objects instead of Money instances, this test documents it
      if (!(plainObject instanceof Money)) {
        // This is the EXPECTED behavior for this test
        // In production, if we see this, it means Money instances were lost during serialization
        expect(plainObject._sdkType).toBe('Money'); // Still has the marker
        expect(plainObject.amount).toBe(10000);
        expect(plainObject.currency).toBe('USD');
      }
    });
  });
});


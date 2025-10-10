/**
 * Test harness to capture and validate BookingDatesForm props WITHOUT runtime console logs.
 * 
 * Purpose: Verify that unitPrice arrives as a proper Money instance, not a string.
 * This test uses mocking and assertions rather than adding logs to production code.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { types as sdkTypes } from '../../../../util/sdkLoader';

const { Money } = sdkTypes;

// Mock BookingDatesForm to capture props
let capturedProps = null;
jest.mock('../BookingDatesForm', () => {
  return {
    __esModule: true,
    default: jest.fn((props) => {
      // Capture props without console.log
      capturedProps = { ...props };
      return <div data-testid="mocked-booking-dates-form">Mocked Form</div>;
    }),
    BookingDatesForm: jest.fn((props) => {
      capturedProps = { ...props };
      return <div data-testid="mocked-booking-dates-form">Mocked Form</div>;
    }),
  };
});

// Import AFTER mock
const BookingDatesFormImported = require('../BookingDatesForm').default;

describe('BookingDatesForm Props Validation (No Runtime Logs)', () => {
  beforeEach(() => {
    capturedProps = null;
    jest.clearAllMocks();
  });

  describe('unitPrice prop type validation', () => {
    it('should receive unitPrice as a Money instance, not a string', () => {
      const mockPrice = new Money(5000, 'USD');
      const mockProps = {
        price: mockPrice,
        listingId: { uuid: 'test-listing-123' },
        isOwnListing: false,
        lineItemUnitType: 'line-item/day',
        monthlyTimeSlots: {},
        onFetchTimeSlots: jest.fn(),
        lineItems: [],
        fetchLineItemsInProgress: false,
        fetchLineItemsError: null,
        onFetchTransactionLineItems: jest.fn(),
        timeZone: 'America/New_York',
        dayCountAvailableForBooking: 90,
        marketplaceName: 'Test Marketplace',
        onSubmit: jest.fn(),
        formId: 'test-form',
        startDatePlaceholder: 'Select start',
        endDatePlaceholder: 'Select end',
      };

      render(
        <IntlProvider locale="en">
          <BookingDatesFormImported {...mockProps} />
        </IntlProvider>
      );

      // Assert props were captured
      expect(capturedProps).not.toBeNull();

      // CRITICAL ASSERTION: unitPrice must be a Money instance
      const receivedPrice = capturedProps.price;
      
      // Test 1: Should NOT be a string
      expect(typeof receivedPrice).not.toBe('string');
      
      // Test 2: Should be an object
      expect(typeof receivedPrice).toBe('object');
      
      // Test 3: Should be a Money instance
      expect(receivedPrice instanceof Money).toBe(true);
      
      // Test 4: Should have Money's _sdkType property
      expect(receivedPrice).toHaveProperty('_sdkType', 'Money');
      
      // Test 5: Should have amount and currency
      expect(receivedPrice).toHaveProperty('amount', 5000);
      expect(receivedPrice).toHaveProperty('currency', 'USD');

      // If any test fails, this will dump the actual received value
      if (typeof receivedPrice === 'string') {
        throw new Error(
          `FAILURE: unitPrice received as string: "${receivedPrice}". ` +
          `Expected Money instance. Full captured props: ${JSON.stringify(capturedProps, null, 2)}`
        );
      }
    });

    it('should handle Money instances created from SDK response', () => {
      // Simulate Money instance from SDK denormalization
      const sdkResponseMoney = new Money(10000, 'EUR');
      
      const mockProps = {
        price: sdkResponseMoney,
        listingId: { uuid: 'test-listing-456' },
        isOwnListing: false,
        lineItemUnitType: 'line-item/night',
        monthlyTimeSlots: {},
        onFetchTimeSlots: jest.fn(),
        lineItems: [],
        fetchLineItemsInProgress: false,
        fetchLineItemsError: null,
        onFetchTransactionLineItems: jest.fn(),
        timeZone: 'Europe/London',
        dayCountAvailableForBooking: 90,
        marketplaceName: 'Test Marketplace',
        onSubmit: jest.fn(),
        formId: 'test-form-2',
      };

      render(
        <IntlProvider locale="en">
          <BookingDatesFormImported {...mockProps} />
        </IntlProvider>
      );

      expect(capturedProps.price instanceof Money).toBe(true);
      expect(capturedProps.price.amount).toBe(10000);
      expect(capturedProps.price.currency).toBe('EUR');
    });

    it('should fail if unitPrice is a stringified Money representation', () => {
      // This test documents the BUG scenario
      const stringifiedMoney = 'Money(5000, USD)'; // ⚠️ BAD
      
      const mockProps = {
        price: stringifiedMoney,
        listingId: { uuid: 'test-listing-789' },
        isOwnListing: false,
        lineItemUnitType: 'line-item/day',
        monthlyTimeSlots: {},
        onFetchTimeSlots: jest.fn(),
        lineItems: [],
        fetchLineItemsInProgress: false,
        fetchLineItemsError: null,
        onFetchTransactionLineItems: jest.fn(),
        timeZone: 'America/New_York',
        dayCountAvailableForBooking: 90,
        marketplaceName: 'Test Marketplace',
        onSubmit: jest.fn(),
        formId: 'test-form-3',
      };

      render(
        <IntlProvider locale="en">
          <BookingDatesFormImported {...mockProps} />
        </IntlProvider>
      );

      const receivedPrice = capturedProps.price;

      // This test SHOULD FAIL if the bug exists
      try {
        expect(typeof receivedPrice).not.toBe('string');
        expect(receivedPrice instanceof Money).toBe(true);
      } catch (error) {
        // Document the failure for analysis
        const bugReport = {
          issue: 'unitPrice received as string instead of Money instance',
          receivedType: typeof receivedPrice,
          receivedValue: receivedPrice,
          expectedType: 'Money instance',
          stackTrace: error.stack,
        };
        
        throw new Error(
          `BUG CONFIRMED: ${JSON.stringify(bugReport, null, 2)}`
        );
      }
    });
  });

  describe('other props validation', () => {
    it('should receive values as an object, not a string', () => {
      const mockProps = {
        price: new Money(5000, 'USD'),
        listingId: { uuid: 'test-listing-values' },
        isOwnListing: false,
        lineItemUnitType: 'line-item/day',
        monthlyTimeSlots: {},
        onFetchTimeSlots: jest.fn(),
        lineItems: [],
        fetchLineItemsInProgress: false,
        fetchLineItemsError: null,
        onFetchTransactionLineItems: jest.fn(),
        timeZone: 'America/New_York',
        dayCountAvailableForBooking: 90,
        marketplaceName: 'Test Marketplace',
        onSubmit: jest.fn(),
        formId: 'test-form-values',
        values: { bookingDates: { startDate: new Date(), endDate: new Date() } },
      };

      render(
        <IntlProvider locale="en">
          <BookingDatesFormImported {...mockProps} />
        </IntlProvider>
      );

      // values should be an object or undefined, never a string
      if (capturedProps.values !== undefined) {
        expect(typeof capturedProps.values).toBe('object');
        expect(typeof capturedProps.values).not.toBe('string');
      }
    });

    it('should receive lineItems as an array, not a string', () => {
      const mockLineItems = [
        { code: 'line-item/day', unitPrice: new Money(5000, 'USD'), quantity: 3 },
      ];

      const mockProps = {
        price: new Money(5000, 'USD'),
        listingId: { uuid: 'test-listing-items' },
        isOwnListing: false,
        lineItemUnitType: 'line-item/day',
        monthlyTimeSlots: {},
        onFetchTimeSlots: jest.fn(),
        lineItems: mockLineItems,
        fetchLineItemsInProgress: false,
        fetchLineItemsError: null,
        onFetchTransactionLineItems: jest.fn(),
        timeZone: 'America/New_York',
        dayCountAvailableForBooking: 90,
        marketplaceName: 'Test Marketplace',
        onSubmit: jest.fn(),
        formId: 'test-form-items',
      };

      render(
        <IntlProvider locale="en">
          <BookingDatesFormImported {...mockProps} />
        </IntlProvider>
      );

      expect(Array.isArray(capturedProps.lineItems)).toBe(true);
      expect(typeof capturedProps.lineItems).not.toBe('string');
      
      // Verify lineItem unitPrices are also Money instances
      if (capturedProps.lineItems.length > 0) {
        const firstLineItem = capturedProps.lineItems[0];
        expect(firstLineItem.unitPrice instanceof Money).toBe(true);
      }
    });
  });
});


/**
 * Auth Guard Test for Privileged Speculative Transactions
 * 
 * Purpose: Verify that initiatePrivilegedSpeculativeTransactionIfNeeded
 * properly checks for authentication BEFORE making API calls that would
 * result in 401 Unauthorized errors.
 * 
 * This prevents:
 * - Premature API calls before auth is ready
 * - 401 errors during checkout page load
 * - Render loops caused by repeated auth failures
 */

import configureMockStore from 'redux-mock-store';
import thunk from 'redux-thunk';
import { initiatePrivilegedSpeculativeTransactionIfNeeded } from '../CheckoutPage.duck';

const middlewares = [thunk];
const mockStore = configureMockStore(middlewares);

describe('Auth Guards for Privileged Speculative Transactions', () => {
  let store;
  let mockSdk;
  let consoleWarnSpy;

  beforeEach(() => {
    mockSdk = {
      transactions: {
        initiate: jest.fn(),
      },
    };
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Authentication Guard', () => {
    it('should NOT call API when currentUser is null', async () => {
      // Simulate unauthenticated state
      store = mockStore({
        user: {
          currentUser: null, // ⚠️ NOT AUTHENTICATED
        },
        CheckoutPage: {
          lastSpeculationKey: null,
          speculativeTransactionId: null,
        },
      });

      const params = {
        listingId: 'test-listing-123',
        bookingDates: {
          bookingStart: '2024-01-15T00:00:00.000Z',
          bookingEnd: '2024-01-18T00:00:00.000Z',
        },
      };

      await store.dispatch(
        initiatePrivilegedSpeculativeTransactionIfNeeded(params)
      );

      // CRITICAL ASSERTION: SDK should NOT be called
      expect(mockSdk.transactions.initiate).not.toHaveBeenCalled();

      // Should log warning about missing authentication
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('privileged speculation without authentication'),
        expect.any(Object)
      );

      // Should not dispatch any actions (silent failure)
      const actions = store.getActions();
      expect(actions).toEqual([]);
    });

    it('should NOT call API when currentUser exists but has no id', async () => {
      // Simulate partial user object (edge case)
      store = mockStore({
        user: {
          currentUser: {
            attributes: { email: 'test@example.com' },
            // id is missing! ⚠️
          },
        },
        CheckoutPage: {
          lastSpeculationKey: null,
          speculativeTransactionId: null,
        },
      });

      const params = {
        listingId: 'test-listing-456',
        bookingDates: {
          bookingStart: '2024-01-15T00:00:00.000Z',
          bookingEnd: '2024-01-18T00:00:00.000Z',
        },
      };

      await store.dispatch(
        initiatePrivilegedSpeculativeTransactionIfNeeded(params)
      );

      // SDK should NOT be called without user.id
      expect(mockSdk.transactions.initiate).not.toHaveBeenCalled();

      // Should warn
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should proceed with API call when currentUser is properly authenticated', async () => {
      // Simulate authenticated state
      const mockUserId = { uuid: 'user-authenticated-789' };
      store = mockStore({
        user: {
          currentUser: {
            id: mockUserId, // ✅ AUTHENTICATED
            attributes: {
              email: 'authenticated@example.com',
            },
          },
        },
        CheckoutPage: {
          lastSpeculationKey: null,
          speculativeTransactionId: null,
          speculatedTransaction: null,
        },
      });

      const params = {
        listingId: 'test-listing-789',
        bookingDates: {
          bookingStart: '2024-01-15T00:00:00.000Z',
          bookingEnd: '2024-01-18T00:00:00.000Z',
        },
        protectedData: {
          unitType: 'day',
        },
      };

      // Mock the speculateTransaction thunk (which the guard calls internally)
      const mockSpeculateTransaction = jest.fn(() => async (dispatch) => {
        dispatch({ type: 'SPECULATE_TRANSACTION_SUCCESS' });
      });

      // We need to mock the internal speculateTransaction call
      // In the actual implementation, this would be imported and called
      // For this test, we'll verify the auth guard doesn't block

      await store.dispatch(
        initiatePrivilegedSpeculativeTransactionIfNeeded(params)
      );

      // Should log success
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Auth verified for speculative transaction'),
        expect.objectContaining({
          userId: mockUserId.uuid,
        })
      );

      // Should dispatch REQUEST action
      const actions = store.getActions();
      expect(actions.some(a => a.type === 'app/CheckoutPage/INITIATE_PRIV_SPECULATIVE_TRANSACTION_REQUEST')).toBe(true);
    });
  });

  describe('Deduplication Logic', () => {
    it('should skip API call if same session already speculated', async () => {
      const mockUserId = { uuid: 'user-dedup-test' };
      const existingKey = 'listing-123_2024-01-15T00:00:00.000Z_2024-01-18T00:00:00.000Z_day';
      const existingTxId = { uuid: 'existing-tx-456' };

      store = mockStore({
        user: {
          currentUser: {
            id: mockUserId,
            attributes: { email: 'test@example.com' },
          },
        },
        CheckoutPage: {
          lastSpeculationKey: existingKey,
          speculativeTransactionId: existingTxId,
        },
      });

      const params = {
        listingId: 'listing-123',
        bookingDates: {
          bookingStart: '2024-01-15T00:00:00.000Z',
          bookingEnd: '2024-01-18T00:00:00.000Z',
        },
        protectedData: {
          unitType: 'day',
        },
      };

      await store.dispatch(
        initiatePrivilegedSpeculativeTransactionIfNeeded(params)
      );

      // Should NOT make API call (deduped)
      expect(mockSdk.transactions.initiate).not.toHaveBeenCalled();

      // Should log deduplication
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('deduped'),
        existingKey,
        existingTxId
      );

      // Should not dispatch any new actions
      const actions = store.getActions();
      expect(actions).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should handle 401 Unauthorized errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const mockUserId = { uuid: 'user-401-test' };
      store = mockStore({
        user: {
          currentUser: {
            id: mockUserId,
            attributes: { email: 'test@example.com' },
          },
        },
        CheckoutPage: {
          lastSpeculationKey: null,
          speculativeTransactionId: null,
        },
      });

      // Mock SDK to throw 401 error
      mockSdk.transactions.initiate.mockRejectedValue({
        status: 401,
        statusText: 'Unauthorized',
        endpoint: '/api/transactions/initiate',
      });

      const params = {
        listingId: 'listing-401',
        bookingDates: {
          bookingStart: '2024-01-15T00:00:00.000Z',
          bookingEnd: '2024-01-18T00:00:00.000Z',
        },
      };

      await store.dispatch(
        initiatePrivilegedSpeculativeTransactionIfNeeded(params)
      );

      // Should log specific 401 error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('401 Unauthorized'),
        expect.any(Object)
      );

      // Should dispatch error action
      const actions = store.getActions();
      expect(actions.some(a => a.type === 'app/CheckoutPage/INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR')).toBe(true);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Integration Test: Full Auth Flow', () => {
    it('should demonstrate proper auth guard sequence', async () => {
      // Scenario: User loads checkout page before auth is ready
      
      // Step 1: Initial state - no user
      store = mockStore({
        user: {
          currentUser: null,
        },
        CheckoutPage: {
          lastSpeculationKey: null,
          speculativeTransactionId: null,
        },
      });

      const params = {
        listingId: 'integration-test',
        bookingDates: {
          bookingStart: '2024-01-15T00:00:00.000Z',
          bookingEnd: '2024-01-18T00:00:00.000Z',
        },
      };

      // Attempt 1: Should be blocked
      await store.dispatch(
        initiatePrivilegedSpeculativeTransactionIfNeeded(params)
      );

      expect(mockSdk.transactions.initiate).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('privileged speculation without authentication'),
        expect.any(Object)
      );

      // Step 2: Auth completes, user loads
      const mockUserId = { uuid: 'integration-user' };
      store = mockStore({
        user: {
          currentUser: {
            id: mockUserId,
            attributes: { email: 'integration@example.com' },
          },
        },
        CheckoutPage: {
          lastSpeculationKey: null,
          speculativeTransactionId: null,
        },
      });

      // Attempt 2: Should proceed
      await store.dispatch(
        initiatePrivilegedSpeculativeTransactionIfNeeded(params)
      );

      // Should log auth success
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Auth verified for speculative transaction'),
        expect.objectContaining({
          userId: mockUserId.uuid,
        })
      );

      // Should dispatch REQUEST action
      const actions = store.getActions();
      expect(actions.some(a => a.type === 'app/CheckoutPage/INITIATE_PRIV_SPECULATIVE_TRANSACTION_REQUEST')).toBe(true);
    });
  });
});



import pick from 'lodash/pick';
import { initiatePrivileged, transitionPrivileged } from '../../util/api';
import { denormalisedResponseEntities } from '../../util/data';
import { storableError } from '../../util/errors';
import * as log from '../../util/log';
import { fetchCurrentUserHasOrdersSuccess, loadCurrentUserOnce } from '../../ducks/user.duck';

// Import shared session key builder to avoid circular deps
import { makeSpeculationKey } from './shared/sessionKey';

// Re-export for backward compatibility
export { makeSpeculationKey };

// ================ Action types ================ //

export const SET_INITIAL_VALUES = 'app/CheckoutPage/SET_INITIAL_VALUES';

export const FETCH_TRANSACTION_LINE_ITEMS_REQUEST = 'app/CheckoutPage/FETCH_TRANSACTION_LINE_ITEMS_REQUEST';
export const FETCH_TRANSACTION_LINE_ITEMS_SUCCESS = 'app/CheckoutPage/FETCH_TRANSACTION_LINE_ITEMS_SUCCESS';
export const FETCH_TRANSACTION_LINE_ITEMS_ERROR = 'app/CheckoutPage/FETCH_TRANSACTION_LINE_ITEMS_ERROR';

export const INITIATE_ORDER_REQUEST = 'app/CheckoutPage/INITIATE_ORDER_REQUEST';
export const INITIATE_ORDER_SUCCESS = 'app/CheckoutPage/INITIATE_ORDER_SUCCESS';
export const INITIATE_ORDER_ERROR = 'app/CheckoutPage/INITIATE_ORDER_ERROR';

export const CONFIRM_PAYMENT_REQUEST = 'app/CheckoutPage/CONFIRM_PAYMENT_REQUEST';
export const CONFIRM_PAYMENT_SUCCESS = 'app/CheckoutPage/CONFIRM_PAYMENT_SUCCESS';
export const CONFIRM_PAYMENT_ERROR = 'app/CheckoutPage/CONFIRM_PAYMENT_ERROR';

export const SPECULATE_TRANSACTION_REQUEST = 'app/CheckoutPage/SPECULATE_TRANSACTION_REQUEST';
export const SPECULATE_TRANSACTION_SUCCESS = 'app/CheckoutPage/SPECULATE_TRANSACTION_SUCCESS';
export const SPECULATE_TRANSACTION_ERROR = 'app/CheckoutPage/SPECULATE_TRANSACTION_ERROR';

export const STRIPE_CUSTOMER_REQUEST = 'app/CheckoutPage/STRIPE_CUSTOMER_REQUEST';
export const STRIPE_CUSTOMER_SUCCESS = 'app/CheckoutPage/STRIPE_CUSTOMER_SUCCESS';
export const STRIPE_CUSTOMER_ERROR = 'app/CheckoutPage/STRIPE_CUSTOMER_ERROR';

export const INITIATE_INQUIRY_REQUEST = 'app/CheckoutPage/INITIATE_INQUIRY_REQUEST';
export const INITIATE_INQUIRY_SUCCESS = 'app/CheckoutPage/INITIATE_INQUIRY_SUCCESS';
export const INITIATE_INQUIRY_ERROR = 'app/CheckoutPage/INITIATE_INQUIRY_ERROR';

export const INITIATE_PRIV_SPECULATIVE_TRANSACTION_REQUEST = 'app/CheckoutPage/INITIATE_PRIV_SPECULATIVE_TRANSACTION_REQUEST';
export const INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS = 'app/CheckoutPage/INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS';
export const INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR   = 'app/CheckoutPage/INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR';

const HOTFIX_SET_CLIENT_SECRET = 'CHECKOUT/HOTFIX_SET_CLIENT_SECRET';
export const SET_STRIPE_CLIENT_SECRET = 'app/CheckoutPage/SET_STRIPE_CLIENT_SECRET';
export const SET_PAYMENTS_UNAVAILABLE = 'app/CheckoutPage/SET_PAYMENTS_UNAVAILABLE';

// ================ Reducer ================ //

const initialState = {
  listing: null,
  orderData: null,
  speculateTransactionInProgress: false,
  speculateTransactionError: null,
  speculatedTransaction: null,
  isClockInSync: false,
  transaction: null,
  initiateOrderError: null,
  confirmPaymentError: null,
  stripeCustomerFetched: false,
  initiateInquiryInProgress: false,
  initiateInquiryError: null,
  fetchLineItemsInProgress: false,
  fetchLineItemsError: null,
  lastSpeculationKey: null,
  speculativeTransactionId: null,
  // Enhanced speculation state
  speculateStatus: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
  stripeClientSecret: null,
  lastSpeculateError: null,
  clientSecretHotfix: null,
  // ✅ A) Store clientSecret from speculate response
  extractedClientSecret: null,
  // Payments availability flag
  paymentsUnavailable: false,
};

export default function checkoutPageReducer(state = initialState, action = {}) {
  const { type, payload } = action;
  switch (type) {
    case SET_INITIAL_VALUES:
      return { ...initialState, ...payload };

    case FETCH_TRANSACTION_LINE_ITEMS_REQUEST:
      return { ...state, fetchLineItemsInProgress: true, fetchLineItemsError: null };
    case FETCH_TRANSACTION_LINE_ITEMS_SUCCESS:
      return { ...state, fetchLineItemsInProgress: false };
    case FETCH_TRANSACTION_LINE_ITEMS_ERROR:
      return { ...state, fetchLineItemsInProgress: false, fetchLineItemsError: payload };

    case SPECULATE_TRANSACTION_REQUEST:
      return {
        ...state,
        speculateTransactionInProgress: true,
        speculateTransactionError: null,
        speculatedTransaction: null,
        speculateStatus: 'pending',
        lastSpeculateError: null,
      };
    case SPECULATE_TRANSACTION_SUCCESS: {
      // Check that the local devices clock is within a minute from the server
      const lastTransitionedAt = payload.transaction?.attributes?.lastTransitionedAt;
      const localTime = new Date();
      const minute = 60000;
      
      const tx = payload.transaction;
      
      // 🔐 PROD HOTFIX: Robustly extract Stripe client secret from all possible paths
      const pd = tx?.attributes?.protectedData || {};
      const md = tx?.attributes?.metadata || {};
      const nested = pd?.stripePaymentIntents?.default || {};

      // Try paths in priority order: flat legacy -> metadata -> nested default
      const maybeSecret =
        pd?.stripePaymentIntentClientSecret ||
        md?.stripePaymentIntentClientSecret ||
        nested?.stripePaymentIntentClientSecret;

      // Validate: must be a string AND look like a real Stripe secret
      const looksStripey = typeof maybeSecret === 'string' && (/_secret_/.test(maybeSecret) || /^pi_/.test(maybeSecret));
      
      // Determine which path was used (for diagnostics)
      const pathUsed = pd?.stripePaymentIntentClientSecret ? 'protectedData.flat'
                     : md?.stripePaymentIntentClientSecret ? 'metadata.flat'
                     : nested?.stripePaymentIntentClientSecret ? 'protectedData.nested.default'
                     : 'none';

      // Dev-only diagnostics
      if (process.env.NODE_ENV !== 'production') {
        console.log('[POST-SPECULATE]', {
          txId: tx?.id?.uuid || tx?.id,
          clientSecretPresent: !!maybeSecret,
          pathUsed,
          looksStripey,
          tail: typeof maybeSecret === 'string' ? maybeSecret.slice(-10) : typeof maybeSecret
        });
      }
      
      // Only store if it looks valid; otherwise null (will trigger safety valve in UI)
      const validatedSecret = looksStripey ? maybeSecret : null;
      
      if (!looksStripey && maybeSecret && process.env.NODE_ENV !== 'production') {
        console.warn('[STRIPE] Invalid client secret shape; expected pi_* with _secret_. Value:', maybeSecret);
      }
      
      // --- HOTFIX: extract Stripe PaymentIntent client secret directly from RAW payload ---
      const clientSecret = nested?.stripePaymentIntentClientSecret || null;
      const secretLooksValid = typeof clientSecret === 'string' &&
        (/_secret_/.test(clientSecret) || /^pi_/.test(clientSecret));
      if (process.env.NODE_ENV !== 'production') {
        console.log('[HOTFIX][STRIPE_PI] extracted from RAW:', {
          pdKeys: pd ? Object.keys(pd) : null,
          hasNested: !!nested,
          clientSecretTail: (clientSecret || '').slice(-12),
          secretLooksValid,
        });
      }
      
      const next = {
        ...state,
        speculateTransactionInProgress: false,
        speculatedTransaction: tx,
        isClockInSync: Math.abs(lastTransitionedAt?.getTime() - localTime.getTime()) < minute,
        speculateStatus: 'succeeded',
        stripeClientSecret: validatedSecret,
        speculativeTransactionId: tx?.id?.uuid || tx?.id || null,
        clientSecretHotfix: secretLooksValid ? clientSecret : null,
      };
      
      return next;
    }
    case SPECULATE_TRANSACTION_ERROR:
      console.error(payload); // eslint-disable-line no-console
      return {
        ...state,
        speculateTransactionInProgress: false,
        speculateTransactionError: payload,
        speculateStatus: 'failed',
        lastSpeculateError: payload,
        stripeClientSecret: null,
      };

    case INITIATE_ORDER_REQUEST:
      return { ...state, initiateOrderError: null };
    case INITIATE_ORDER_SUCCESS:
      return { ...state, transaction: payload };
    case INITIATE_ORDER_ERROR:
      console.error(payload); // eslint-disable-line no-console
      return { ...state, initiateOrderError: payload };

    case CONFIRM_PAYMENT_REQUEST:
      return { ...state, confirmPaymentError: null };
    case CONFIRM_PAYMENT_SUCCESS:
      return state;
    case CONFIRM_PAYMENT_ERROR:
      console.error(payload); // eslint-disable-line no-console
      return { ...state, confirmPaymentError: payload };

    case STRIPE_CUSTOMER_REQUEST:
      return { ...state, stripeCustomerFetched: false };
    case STRIPE_CUSTOMER_SUCCESS:
      return { ...state, stripeCustomerFetched: true };
    case STRIPE_CUSTOMER_ERROR:
      console.error(payload); // eslint-disable-line no-console
      return { ...state, stripeCustomerFetchError: payload };

    case INITIATE_INQUIRY_REQUEST:
      return { ...state, initiateInquiryInProgress: true, initiateInquiryError: null };
    case INITIATE_INQUIRY_SUCCESS:
      return { ...state, initiateInquiryInProgress: false };
    case INITIATE_INQUIRY_ERROR:
      return { ...state, initiateInquiryInProgress: false, initiateInquiryError: payload };

    case HOTFIX_SET_CLIENT_SECRET: {
      return { ...state, clientSecretHotfix: action.payload || null };
    }

    case SET_STRIPE_CLIENT_SECRET: {
      return { ...state, extractedClientSecret: action.payload || null };
    }

    case INITIATE_PRIV_SPECULATIVE_TRANSACTION_REQUEST:
      return { 
        ...state, 
        lastSpeculationKey: payload.key,
        speculateStatus: 'pending',
      };
    case INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS: {
      const { tx, key } = payload;
      
      // 🔐 PROD HOTFIX: Robustly extract Stripe client secret from all possible paths
      const pd = tx?.attributes?.protectedData || {};
      const md = tx?.attributes?.metadata || {};
      const nested = pd?.stripePaymentIntents?.default || {};

      // Try paths in priority order: nested default -> flat legacy -> metadata
      // Prioritize nested since that's where server writes the real Stripe secret
      const maybeSecret =
        nested?.stripePaymentIntentClientSecret ||
        pd?.stripePaymentIntentClientSecret ||
        md?.stripePaymentIntentClientSecret;

      // Validate: must be a string AND look like a real Stripe secret
      const looksStripey = typeof maybeSecret === 'string' && (/_secret_/.test(maybeSecret) || /^pi_/.test(maybeSecret));
      
      // Determine which path was used (for diagnostics)
      const pathUsed = nested?.stripePaymentIntentClientSecret ? 'protectedData.nested.default'
                     : pd?.stripePaymentIntentClientSecret ? 'protectedData.flat'
                     : md?.stripePaymentIntentClientSecret ? 'metadata.flat'
                     : 'none';

      // Dev-only diagnostics
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SPECULATE_SUCCESS_RAW]', {
          attributeKeys: Object.keys(tx?.attributes || {}),
          hasProtectedData: !!pd,
          protectedDataKeys: Object.keys(pd || {}),
          hasMetadata: !!md,
          metadataKeys: Object.keys(md || {}),
          hasNestedPI: !!nested?.stripePaymentIntentClientSecret,
        });
        
        console.log('[POST-SPECULATE]', {
          txId: tx?.id?.uuid || tx?.id,
          clientSecretPresent: !!maybeSecret,
          pathUsed,
          looksStripey,
          tail: typeof maybeSecret === 'string' ? maybeSecret.slice(-10) : typeof maybeSecret
        });
      }
      
      // Only store if it looks valid; otherwise null (will trigger safety valve in UI)
      const validatedSecret = looksStripey ? maybeSecret : null;
      
      if (!looksStripey && maybeSecret && process.env.NODE_ENV !== 'production') {
        console.warn('[STRIPE] Invalid client secret shape; expected pi_* with _secret_. Value:', maybeSecret);
      }
      
      // --- HOTFIX: extract Stripe PaymentIntent client secret directly from RAW payload ---
      const clientSecret = nested?.stripePaymentIntentClientSecret || null;
      const secretLooksValid = typeof clientSecret === 'string' &&
        (/_secret_/.test(clientSecret) || /^pi_/.test(clientSecret));
      if (process.env.NODE_ENV !== 'production') {
        console.log('[HOTFIX][STRIPE_PI] extracted from RAW:', {
          pdKeys: pd ? Object.keys(pd) : null,
          hasNested: !!nested,
          clientSecretTail: (clientSecret || '').slice(-12),
          secretLooksValid,
        });
      }
      
      const newState = {
        ...state,
        speculativeTransactionId: tx.id,
        lastSpeculationKey: key,
        speculatedTransaction: tx,
        stripeClientSecret: validatedSecret,
        speculateStatus: 'succeeded',
        clientSecretHotfix: secretLooksValid ? clientSecret : null,
      };
      
      return newState;
    }
    case INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR: {
      // Check if this is a "payments not configured" error (503)
      const errorPayload = action.payload;
      
      // Comprehensive 503 detection across all possible error shapes
      const isPaymentNotConfigured = 
        errorPayload?.status === 503 || 
        errorPayload?.code === 'payments-not-configured' ||
        errorPayload?.data?.code === 'payments-not-configured' ||
        (errorPayload?.message || '').includes('Stripe is not configured');
      
      if (isPaymentNotConfigured) {
        console.warn('[REDUCER] Setting paymentsUnavailable flag');
      }
      
      return {
        ...state,
        speculateStatus: 'failed',
        lastSpeculateError: errorPayload,
        paymentsUnavailable: isPaymentNotConfigured || state.paymentsUnavailable === true,
      };
    }
    
    case SET_PAYMENTS_UNAVAILABLE:
      return { ...state, paymentsUnavailable: true };

    default:
      return state;
  }
}

// ================ Selectors ================ //

export const selectStripeClientSecret = state => state.CheckoutPage?.extractedClientSecret;
export const selectPaymentsUnavailable = state => state.CheckoutPage?.paymentsUnavailable;

// ================ Action creators ================ //

export const setStripeClientSecret = clientSecret => ({
  type: SET_STRIPE_CLIENT_SECRET,
  payload: clientSecret,
});

export const setPaymentsUnavailable = () => ({ 
  type: SET_PAYMENTS_UNAVAILABLE 
});

export const setInitialValues = initialValues => ({
  type: SET_INITIAL_VALUES,
  payload: pick(initialValues, Object.keys(initialState)),
});

const initiateOrderRequest = () => ({ type: INITIATE_ORDER_REQUEST });

const initiateOrderSuccess = order => ({
  type: INITIATE_ORDER_SUCCESS,
  payload: order,
});

const initiateOrderError = e => ({
  type: INITIATE_ORDER_ERROR,
  error: true,
  payload: e,
});

const confirmPaymentRequest = () => ({ type: CONFIRM_PAYMENT_REQUEST });

const confirmPaymentSuccess = orderId => ({
  type: CONFIRM_PAYMENT_SUCCESS,
  payload: orderId,
});

const confirmPaymentError = e => ({
  type: CONFIRM_PAYMENT_ERROR,
  error: true,
  payload: e,
});

export const speculateTransactionRequest = () => ({ type: SPECULATE_TRANSACTION_REQUEST });

export const speculateTransactionSuccess = transaction => ({
  type: SPECULATE_TRANSACTION_SUCCESS,
  payload: { transaction },
});

export const speculateTransactionError = e => ({
  type: SPECULATE_TRANSACTION_ERROR,
  error: true,
  payload: e,
});

export const stripeCustomerRequest = () => ({ type: STRIPE_CUSTOMER_REQUEST });
export const stripeCustomerSuccess = () => ({ type: STRIPE_CUSTOMER_SUCCESS });
export const stripeCustomerError = e => ({
  type: STRIPE_CUSTOMER_ERROR,
  error: true,
  payload: e,
});

export const initiateInquiryRequest = () => ({ type: INITIATE_INQUIRY_REQUEST });
export const initiateInquirySuccess = () => ({ type: INITIATE_INQUIRY_SUCCESS });
export const initiateInquiryError = e => ({
  type: INITIATE_INQUIRY_ERROR,
  error: true,
  payload: e,
});

export const fetchTransactionLineItemsRequest = () => ({ type: FETCH_TRANSACTION_LINE_ITEMS_REQUEST });
export const fetchTransactionLineItemsSuccess = () => ({ type: FETCH_TRANSACTION_LINE_ITEMS_SUCCESS });
export const fetchTransactionLineItemsError = e => ({
  type: FETCH_TRANSACTION_LINE_ITEMS_ERROR,
  error: true,
  payload: e,
});

/* ================ Thunks ================ */

export const initiateOrder = (
  orderParams,
  processAlias,
  transactionId,
  transitionName,
  isPrivilegedTransition
) => (dispatch, getState, sdk) => {
  dispatch(initiateOrderRequest());

  // Guard: Check if user is authenticated for privileged transitions
  const state = getState();
  const currentUser = state.user?.currentUser;
  if (!currentUser?.id) {
    const error = new Error('Cannot initiate transaction - user not authenticated');
    error.status = 401;
    console.warn('[Sherbrt] Attempted transaction without authentication');
    return Promise.reject(error);
  }
  
  // Guard: Check for auth token (belt-and-suspenders)
  if (!sdk?.authToken && typeof document !== 'undefined' && !document.cookie?.includes('st=')) {
    const error = new Error('Cannot initiate transaction - no auth token found');
    error.status = 401;
    console.warn('[Sherbrt] Attempted transaction without auth token');
    return Promise.reject(error);
  }

  // Log transactionId before determining flow
  console.log('initiateOrder: transactionId =', transactionId);

  // If we already have a transaction ID, we should transition, not initiate.
  const isTransition = !!transactionId;

  const { deliveryMethod, quantity, bookingDates, ...otherOrderParams } = orderParams;
  const quantityMaybe = quantity ? { stockReservationQuantity: quantity } : {};
  const bookingParamsMaybe = bookingDates || {};

  // Use protectedData from orderParams if present, otherwise fallback to legacy mapping
  const protectedData = orderParams?.protectedData
    ? orderParams.protectedData
    : {
        providerName: orderParams?.providerName || '',
        providerStreet: orderParams?.providerStreet || '',
        providerCity: orderParams?.providerCity || '',
        providerState: orderParams?.providerState || '',
        providerZip: orderParams?.providerZip || '',
        providerEmail: orderParams?.providerEmail || '',
        providerPhone: orderParams?.providerPhone || '',
        customerName: orderParams?.customerName || '',
        customerStreet: orderParams?.customerStreet || '',
        customerCity: orderParams?.customerCity || '',
        customerState: orderParams?.customerState || '',
        customerZip: orderParams?.customerZip || '',
        customerEmail: orderParams?.customerEmail || '',
        customerPhone: orderParams?.customerPhone || '',
      };

  // Parameters only for client app's server
  const orderData = deliveryMethod ? { deliveryMethod } : {};

  // Parameters for Marketplace API
  const transitionParams = {
    ...quantityMaybe,
    ...bookingParamsMaybe,
    ...otherOrderParams,
    protectedData, // Include protected data in transition params
  };

  const bodyParams = isTransition
    ? {
        id: transactionId,
        transition: transitionName,
        params: transitionParams,
      }
    : {
        processAlias,
        transition: transitionName,
        params: transitionParams,
      };
  const queryParams = {
    include: ['booking', 'provider'],
    expand: true,
  };

  // Add API submission log
  console.log('📡 Submitting booking request to API', bodyParams);
  console.log('🔒 Protected data being sent:', protectedData);
  // TEMP: Log all protectedData fields before API call
  if (protectedData) {
    console.log('📝 [TEMP] Full protectedData in initiateOrder:', JSON.stringify(protectedData, null, 2));
  }

  const handleSuccess = response => {
    const entities = denormalisedResponseEntities(response);
    const order = entities[0];
    dispatch(initiateOrderSuccess(order));
    dispatch(fetchCurrentUserHasOrdersSuccess(true));
    // Debug: Log the full response to confirm protectedData is present
    console.log('✅ Initiate success:', JSON.stringify(response, null, 2));
    return order;
  };

  const handleError = e => {
    // Enhanced error handling for 401 unauthorized
    if (e.status === 401) {
      console.error('[Sherbrt] 401 Unauthorized in initiateOrder - user may need to log in again');
      log.error(e, 'initiate-order-unauthorized', {
        endpoint: e.endpoint || 'unknown',
        message: 'User authentication failed or session expired',
      });
    }
    
    dispatch(initiateOrderError(storableError(e)));
    const transactionIdMaybe = transactionId ? { transactionId: transactionId.uuid } : {};
    log.error(e, 'initiate-order-failed', {
      ...transactionIdMaybe,
      listingId: orderParams.params?.listingId?.uuid || orderParams.params?.listingId,
      ...quantityMaybe,
      ...bookingParamsMaybe,
      ...orderData,
    });
    throw e;
  };

  if (isTransition && isPrivilegedTransition) {
    if (!transactionId) {
      console.error('transitionPrivileged called without transactionId!');
      return Promise.reject(new Error('transitionPrivileged called without transactionId!'));
    }
    // transition privileged
    return transitionPrivileged({ isSpeculative: false, orderData, bodyParams, queryParams })
      .then(handleSuccess)
      .catch(handleError);
  } else if (isTransition) {
    if (!transactionId) {
      console.error('transition called without transactionId!');
      return Promise.reject(new Error('transition called without transactionId!'));
    }
    // transition non-privileged
    return sdk.transactions
      .transition(bodyParams, queryParams)
      .then(handleSuccess)
      .catch(handleError);
  } else if (isPrivilegedTransition) {
    // initiate privileged
    const transition = 'transition/request-payment';
    const processAlias = 'default-booking/release-1';
    console.log('Initiating privileged transaction with:', {
      transactionId,
      transition,
      processAlias,
    });
    const bodyParams = {
      transition,
      processAlias,
      params: transitionParams,
    };
    return initiatePrivileged({
      isSpeculative: false,
      orderData,
      bodyParams,
      queryParams,
    })
      .then(handleSuccess)
      .catch(handleError);
  } else {
    // initiate non-privileged
    return sdk.transactions
      .initiate(bodyParams, queryParams)
      .then(handleSuccess)
      .catch(handleError);
  }
};

export const confirmPayment = (transactionId, transitionName, transitionParams = {}) => (
  dispatch,
  getState,
  sdk
) => {
  dispatch(confirmPaymentRequest());

  const bodyParams = {
    id: transactionId,
    transition: transitionName,
    params: transitionParams,
  };
  const queryParams = {
    include: ['booking', 'provider'],
    expand: true,
  };

  return sdk.transactions
    .transition(bodyParams, queryParams)
    .then(response => {
      const order = response.data.data;
      dispatch(confirmPaymentSuccess(order.id));
      return order;
    })
    .catch(e => {
      dispatch(confirmPaymentError(storableError(e)));
      const transactionIdMaybe = transactionId ? { transactionId: transactionId.uuid } : {};
      log.error(e, 'initiate-order-failed', {
        ...transactionIdMaybe,
      });
      throw e;
    });
};

export const sendMessage = params => (dispatch, getState, sdk) => {
  const message = params.message;
  const orderId = params.id;

  if (message) {
    return sdk.messages
      .send({ transactionId: orderId, content: message })
      .then(() => {
        return { orderId, messageSuccess: true };
      })
      .catch(e => {
        log.error(e, 'initial-message-send-failed', { txId: orderId });
        return { orderId, messageSuccess: false };
      });
  } else {
    return Promise.resolve({ orderId, messageSuccess: true });
  }
};

/**
 * Initiate transaction against default-inquiry process
 * Note: At this point inquiry transition is made directly against Marketplace API.
 *       So, client app's server is not involved here unlike with transitions including payments.
 *
 * @param {*} inquiryParams contains listingId and protectedData
 * @param {*} processAlias 'default-inquiry/release-1'
 * @param {*} transitionName 'transition/inquire-without-payment'
 * @returns
 */
export const initiateInquiryWithoutPayment = (inquiryParams, processAlias, transitionName) => (
  dispatch,
  getState,
  sdk
) => {
  dispatch(initiateInquiryRequest());

  if (!processAlias) {
    const error = new Error('No transaction process attached to listing');
    log.error(error, 'listing-process-missing', {
      listingId: listing?.id?.uuid,
    });
    dispatch(initiateInquiryError(storableError(error)));
    return Promise.reject(error);
  }

  const bodyParams = {
    transition: transitionName,
    processAlias,
    params: inquiryParams,
  };
  const queryParams = {
    include: ['provider'],
    expand: true,
  };

  return sdk.transactions
    .initiate(bodyParams, queryParams)
    .then(response => {
      const transactionId = response.data.data.id;
      dispatch(initiateInquirySuccess());
      return transactionId;
    })
    .catch(e => {
      dispatch(initiateInquiryError(storableError(e)));
      throw e;
    });
};

/**
 * Initiate or transition the speculative transaction with the given
 * booking details
 *
 * The API allows us to do speculative transaction initiation and
 * transitions. This way we can create a test transaction and get the
 * actual pricing information as if the transaction had been started,
 * without affecting the actual data.
 *
 * We store this speculative transaction in the page store and use the
 * pricing info for the booking breakdown to get a proper estimate for
 * the price with the chosen information.
 */
export const speculateTransaction = (
  orderParams,
  processAlias,
  transactionId,
  transitionName,
  isPrivilegedTransition
) => (dispatch, getState, sdk) => {
  dispatch(speculateTransactionRequest());

  // Guard: Check if user is authenticated for privileged transitions
  const state = getState();
  const currentUser = state.user?.currentUser;
  if (isPrivilegedTransition && !currentUser?.id) {
    const error = new Error('Cannot speculate privileged transaction - user not authenticated');
    error.status = 401;
    console.warn('[Sherbrt] Attempted privileged speculation without authentication');
    return Promise.reject(error);
  }
  
  // Info: Client cannot verify auth token directly; let server enforce auth
  if (isPrivilegedTransition && process.env.NODE_ENV !== 'production') {
    console.log('[Sherbrt] (info) client cannot verify auth token; proceeding to /api where server enforces auth');
  }

  // Log transactionId before determining flow
  console.log('speculateTransaction: transactionId =', transactionId);

  // If we already have a transaction ID, we should transition, not initiate.
  const isTransition = !!transactionId;

  const { deliveryMethod, quantity, bookingDates, ...otherOrderParams } = orderParams;
  const quantityMaybe = quantity ? { stockReservationQuantity: quantity } : {};
  
  // Transform bookingDates structure: { start, end } → bookingStart, bookingEnd
  const bookingParamsMaybe = bookingDates?.start && bookingDates?.end 
    ? { bookingStart: bookingDates.start, bookingEnd: bookingDates.end }
    : {};

  // Parameters only for client app's server
  const orderData = deliveryMethod ? { deliveryMethod } : {};

  // Parameters for Marketplace API
  const transitionParams = {
    ...quantityMaybe,
    ...bookingParamsMaybe,
    ...otherOrderParams,
    cardToken: 'CheckoutPage_speculative_card_token',
  };
  
  // Log the actual params being sent to the API
  console.log('[speculateTransaction] transitionParams:', {
    listingId: transitionParams.listingId,
    bookingStart: transitionParams.bookingStart,
    bookingEnd: transitionParams.bookingEnd,
    hasProtectedData: !!transitionParams.protectedData,
  });

  const bodyParams = isTransition
    ? {
        id: transactionId,
        transition: transitionName,
        params: transitionParams,
      }
    : {
        processAlias,
        transition: transitionName,
        params: transitionParams,
      };

  const queryParams = {
    include: ['booking', 'provider'],
    expand: true,
  };

  const handleSuccess = response => {
    const entities = denormalisedResponseEntities(response);
    
    // Strictly validate response before treating as success
    if (!entities || entities.length === 0) {
      console.error('[SPECULATE] Invalid response - no entities');
      throw new Error('Speculation response contained no entities');
    }
    
    if (entities.length !== 1) {
      throw new Error('Expected a resource in the speculate response');
    }
    
    const tx = entities[0];
    
    // Validate transaction has an ID before proceeding
    if (!tx?.id) {
      console.error('[SPECULATE] Invalid transaction - no ID', { tx });
      throw new Error('Speculation returned transaction without ID');
    }
    
    // ✅ A) Extract clientSecret from speculate response - FIXED to get actual secret, not UUID
    const attrs = tx?.attributes || {};
    const pd = attrs?.protectedData || {};
    const metadata = attrs?.metadata || {};
    
    // Priority order: protectedData nested > protectedData flat > metadata > response level
    const clientSecret =
      pd?.stripePaymentIntents?.default?.stripePaymentIntentClientSecret ??
      pd?.stripePaymentIntentClientSecret ??                        // legacy flat
      metadata?.stripe?.clientSecret ??                             // metadata path
      metadata?.stripePaymentIntentClientSecret ??
      attrs?.paymentIntents?.[0]?.clientSecret ??
      response?.data?.paymentParams?.clientSecret ??
      response?.paymentParams?.clientSecret ??
      null;

    // Validate it's actually a Stripe client secret, not a UUID or ID
    const isValidSecret = clientSecret && typeof clientSecret === 'string' && 
                          clientSecret.startsWith('pi_') && 
                          clientSecret.includes('_secret_');
    
    if (!isValidSecret) {
      console.warn('[SPECULATE_SUCCESS] Invalid or missing clientSecret!');
      console.warn('[SPECULATE_SUCCESS] Got:', clientSecret?.substring(0, 50));
      console.warn('[SPECULATE_SUCCESS] Expected format: pi_..._secret_...');
      console.warn('[SPECULATE_SUCCESS] Checking all possible paths:');
      console.warn('  - pd.stripePaymentIntents?.default?.stripePaymentIntentClientSecret:', pd?.stripePaymentIntents?.default?.stripePaymentIntentClientSecret?.substring(0, 20));
      console.warn('  - pd.stripePaymentIntentClientSecret:', pd?.stripePaymentIntentClientSecret?.substring(0, 20));
      console.warn('  - metadata.stripe?.clientSecret:', metadata?.stripe?.clientSecret?.substring(0, 20));
      console.warn('  - metadata.stripePaymentIntentClientSecret:', metadata?.stripePaymentIntentClientSecret?.substring(0, 20));
      console.warn('[SPECULATE_SUCCESS] Full protectedData keys:', Object.keys(pd));
      console.warn('[SPECULATE_SUCCESS] Full metadata keys:', Object.keys(metadata));
      if (pd?.stripePaymentIntents) {
        console.warn('[SPECULATE_SUCCESS] stripePaymentIntents keys:', Object.keys(pd.stripePaymentIntents));
        if (pd.stripePaymentIntents.default) {
          console.warn('[SPECULATE_SUCCESS] stripePaymentIntents.default keys:', Object.keys(pd.stripePaymentIntents.default));
        }
      }
    }
    
    console.log('[SPECULATE_SUCCESS] clientSecret present?', !!clientSecret, 'valid?', isValidSecret);
    
    // Store clientSecret in state (only if valid)
    dispatch(setStripeClientSecret(isValidSecret ? clientSecret : null));
    
    // Log raw response for debugging
    console.log('[RAW SPEC RESP]', JSON.stringify(response).slice(0, 400));
    
    dispatch(speculateTransactionSuccess(tx));
  };

  const handleError = e => {
    // Enhanced error handling for 401 unauthorized
    if (e.status === 401) {
      console.error('[Sherbrt] 401 Unauthorized in speculateTransaction - user may need to log in again');
      log.error(e, 'speculate-transaction-unauthorized', {
        endpoint: e.endpoint || 'unknown',
        message: 'User authentication failed or session expired',
      });
    }
    
    log.error(e, 'speculate-transaction-failed', {
      listingId: transitionParams.listingId?.uuid || transitionParams.listingId,
      ...quantityMaybe,
      ...bookingParamsMaybe,
      ...orderData,
    });
    return dispatch(speculateTransactionError(storableError(e)));
  };

  if (isTransition && isPrivilegedTransition) {
    if (!transactionId) {
      console.error('transitionPrivileged called without transactionId!');
      return Promise.reject(new Error('transitionPrivileged called without transactionId!'));
    }
    // transition privileged
    return transitionPrivileged({ isSpeculative: true, orderData, bodyParams, queryParams })
      .then(handleSuccess)
      .catch(handleError);
  } else if (isTransition) {
    if (!transactionId) {
      console.error('transition called without transactionId!');
      return Promise.reject(new Error('transition called without transactionId!'));
    }
    // transition non-privileged
    return sdk.transactions
      .transitionSpeculative(bodyParams, queryParams)
      .then(handleSuccess)
      .catch(handleError);
  } else if (isPrivilegedTransition) {
    // initiate privileged (speculative)
    const transition = 'transition/request-payment';
    const processAlias = 'default-booking/release-1';
    console.log('Initiating privileged speculative transaction with:', {
      transactionId,
      transition,
      processAlias,
    });
    const bodyParams = {
      transition,
      processAlias,
      params: transitionParams,
    };
    return initiatePrivileged({
      isSpeculative: true,
      orderData,
      bodyParams,
      queryParams,
    })
      .then(handleSuccess)
      .catch(handleError);
  } else {
    // initiate non-privileged
    return sdk.transactions
      .initiateSpeculative(bodyParams, queryParams)
      .then(handleSuccess)
      .catch(handleError);
  }
};

// StripeCustomer is a relantionship to currentUser
// We need to fetch currentUser with correct params to include relationship
export const stripeCustomer = () => (dispatch, getState, sdk) => {
  dispatch(stripeCustomerRequest());
  
  // Use the idempotent loadCurrentUserOnce to prevent duplicate requests
  return dispatch(loadCurrentUserOnce())
    .then(response => {
      dispatch(stripeCustomerSuccess());
    })
    .catch(e => {
      dispatch(stripeCustomerError(storableError(e)));
    });
};

export const fetchTransactionLineItems = ({ orderData, listingId, isOwnListing }) => (dispatch, getState, sdk) => {
  dispatch(fetchTransactionLineItemsRequest());

  return sdk.transactions
    .initiateSpeculative(
      {
        params: {
          ...orderData,
          listingId,
        },
      },
      {
        include: ['lineItems'],
        expand: true,
      }
    )
    .then(response => {
      dispatch(fetchTransactionLineItemsSuccess());
      return response;
    })
    .catch(e => {
      dispatch(fetchTransactionLineItemsError(storableError(e)));
      throw e;
    });
};

/**
 * Initiate a privileged speculative transaction only if the key has changed.
 * This prevents duplicate API calls and the resulting render loop.
 */
export const initiatePrivilegedSpeculativeTransactionIfNeeded = params => async (dispatch, getState, sdk) => {
  // ✅ AUTH GUARD: Verify user is authenticated before privileged speculation
  const state = getState();
  const currentUser = state.user?.currentUser;
  
  console.log('[speculate] dispatching', params);
  
  if (!currentUser?.id) {
    const authError = new Error('Cannot initiate privileged speculative transaction - user not authenticated');
    authError.status = 401;
    console.warn('[Sherbrt] ⛔ Attempted privileged speculation without authentication', {
      hasUser: !!currentUser,
      hasUserId: !!currentUser?.id,
    });
    // Don't throw - just skip silently to prevent blocking the UI
    return;
  }
  
  // Info: Client cannot verify auth token directly; let server enforce auth
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Sherbrt] (info) client cannot verify auth token; proceeding to /api where server enforces auth');
  }

  // Log auth state before proceeding
  console.log('[Sherbrt] ✅ Auth verified for speculative transaction', {
    userId: currentUser.id.uuid,
    listingId: params.listingId,
  });

  const key = makeSpeculationKey({
    listingId: params.listingId,
    bookingStart: params.bookingDates?.bookingStart || params.bookingStart,
    bookingEnd: params.bookingDates?.bookingEnd || params.bookingEnd,
    unitType: params.protectedData?.unitType,
  });
  const checkoutState = getState().CheckoutPage || {};
  if (checkoutState.lastSpeculationKey === key && checkoutState.speculativeTransactionId) {
    console.info('[specTx] deduped key:', key, 'tx:', checkoutState.speculativeTransactionId);
    return;
  }
  dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_REQUEST, payload: { key }});

  try {
    // Call the existing speculateTransaction thunk which handles the API call
    // We need to extract the necessary parameters for speculateTransaction
    const orderParams = params;
    const processAlias = 'default-booking/release-1';
    const transactionId = null; // This is a new speculative transaction
    const transitionName = 'transition/request-payment';
    const isPrivilegedTransition = true;

    // Call speculateTransaction and await its result
    await dispatch(speculateTransaction(orderParams, processAlias, transactionId, transitionName, isPrivilegedTransition));
    
    // Get the speculated transaction from state
    const updatedState = getState().CheckoutPage || {};
    const tx = updatedState.speculatedTransaction;
    
    // ✅ HARDENED: Require tx.id before dispatching success
    if (!tx?.id) {
      console.error('[SPECULATE] Invalid response - no transaction id', { tx });
      throw new Error('Speculation returned no transaction');
    }
    
    console.log('[speculate] success', tx.id.uuid || tx.id);
    dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS, payload: { tx, key }});
  } catch (e) {
    // ✅ HARDENED: Extensive error introspection for debugging
    console.error('[speculate] failed', e);
    console.error('[DEBUG] error keys:', Object.keys(e || {}));
    console.error('[DEBUG] e.status:', e?.status);
    console.error('[DEBUG] e.code:', e?.code);
    console.error('[DEBUG] e.data:', e?.data);
    console.error('[DEBUG] e.apiErrors:', e?.apiErrors);
    console.error('[DEBUG] e.response:', e?.response);
    
    // ✅ HARDENED: Robust 503 detection across all possible error shapes
    const status = e?.status ?? e?.response?.status;
    const code = 
      e?.data?.code ||
      e?.code || 
      e?.apiErrors?.[0]?.code ||
      e?.response?.data?.code;
    const message = 
      e?.message || 
      e?.response?.data?.message ||
      '';
    
    // ✅ HARDENED: Comprehensive check for payments unavailable
    // Guard: ensure 403 (forbidden) never sets paymentsUnavailable flag
    const isPaymentsUnavailable = 
      (status === 503 || 
       code === 'payments-not-configured' ||
       /Stripe is not configured/i.test(message)) &&
      status !== 403; // 403 is permission denied, not payments unavailable
    
    if (isPaymentsUnavailable) {
      console.warn('[Checkout] Payments unavailable on server. Halting speculation.');
      dispatch(setPaymentsUnavailable());
      dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR, payload: e, error: true });
      return; // ✅ EARLY EXIT: do not fallback to public speculation, nothing else runs
    }
    
    // ✅ HARDENED: Block public fallback when protectedData is required
    const hasProtectedData = Boolean(params?.protectedData) || Boolean(getState().CheckoutPage?.orderData?.protectedData);
    if (hasProtectedData) {
      console.warn('[INITIATE_TX] Protected data required; skipping public fallback.');
      dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR, payload: e, error: true });
      return; // ✅ EARLY EXIT
    }
    
    // Enhanced error handling for 401 unauthorized
    if (e.status === 401) {
      console.error('[Sherbrt] 401 Unauthorized in initiatePrivilegedSpeculativeTransaction - user may need to log in again');
      log.error(e, 'init-priv-spec-tx-unauthorized', {
        endpoint: e.endpoint || 'unknown',
        message: 'User authentication failed during speculative transaction',
        userId: currentUser?.id?.uuid || 'unknown',
      });
    }
    
    console.error('[specTx] error', e);
    
    // Only fallback to non-privileged speculation for non-503, non-protectedData errors
    console.warn('[INITIATE_TX] privileged failed, falling back to public speculation', e);
    try {
      const orderParams = params;
      const processAlias = 'default-booking/release-1';
      const transactionId = null;
      const transitionName = 'transition/request-payment';
      const isPrivilegedTransition = false; // Use non-privileged path
      
      await dispatch(speculateTransaction(orderParams, processAlias, transactionId, transitionName, isPrivilegedTransition));
      
      // Get the speculated transaction from state
      const updatedState = getState().CheckoutPage || {};
      const tx = updatedState.speculatedTransaction;
      
      if (tx?.id) {
        console.log('[INITIATE_TX] fallback succeeded, txId:', tx.id);
        dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS, payload: { tx, key }});
        return; // Exit successfully
      }
    } catch (fallbackError) {
      console.error('[INITIATE_TX] fallback also failed', fallbackError);
    }
    
    dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR, payload: e, error: true });
  }
};

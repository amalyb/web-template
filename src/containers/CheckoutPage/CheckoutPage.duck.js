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
      };
    case SPECULATE_TRANSACTION_SUCCESS: {
      // Check that the local devices clock is within a minute from the server
      const lastTransitionedAt = payload.transaction?.attributes?.lastTransitionedAt;
      const localTime = new Date();
      const minute = 60000;
      return {
        ...state,
        speculateTransactionInProgress: false,
        speculatedTransaction: payload.transaction,
        isClockInSync: Math.abs(lastTransitionedAt?.getTime() - localTime.getTime()) < minute,
      };
    }
    case SPECULATE_TRANSACTION_ERROR:
      console.error(payload); // eslint-disable-line no-console
      return {
        ...state,
        speculateTransactionInProgress: false,
        speculateTransactionError: payload,
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

    case INITIATE_PRIV_SPECULATIVE_TRANSACTION_REQUEST:
      return { ...state, lastSpeculationKey: payload.key };
    case INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS: {
      const { tx, key } = payload;
      return {
        ...state,
        speculativeTransactionId: tx.id,
        lastSpeculationKey: key,
        speculatedTransaction: tx,
      };
    }
    case INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR:
      return state;

    default:
      return state;
  }
}

// ================ Selectors ================ //

// ================ Action creators ================ //

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
  
  // Guard: Check for auth token (belt-and-suspenders)
  if (isPrivilegedTransition && !sdk?.authToken && typeof document !== 'undefined' && !document.cookie?.includes('st=')) {
    const error = new Error('Cannot speculate privileged transaction - no auth token found');
    error.status = 401;
    console.warn('[Sherbrt] Attempted privileged speculation without auth token');
    return Promise.reject(error);
  }

  // Log transactionId before determining flow
  console.log('speculateTransaction: transactionId =', transactionId);

  // If we already have a transaction ID, we should transition, not initiate.
  const isTransition = !!transactionId;

  const { deliveryMethod, quantity, bookingDates, ...otherOrderParams } = orderParams;
  const quantityMaybe = quantity ? { stockReservationQuantity: quantity } : {};
  const bookingParamsMaybe = bookingDates || {};

  // Parameters only for client app's server
  const orderData = deliveryMethod ? { deliveryMethod } : {};

  // Parameters for Marketplace API
  const transitionParams = {
    ...quantityMaybe,
    ...bookingParamsMaybe,
    ...otherOrderParams,
    cardToken: 'CheckoutPage_speculative_card_token',
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

  const handleSuccess = response => {
    const entities = denormalisedResponseEntities(response);
    if (entities.length !== 1) {
      throw new Error('Expected a resource in the speculate response');
    }
    const tx = entities[0];
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
  
  // Guard: Check for auth token (belt-and-suspenders)
  if (!sdk?.authToken && typeof document !== 'undefined' && !document.cookie?.includes('st=')) {
    console.warn('[Sherbrt] ⛔ Attempted privileged speculation without auth token');
    return;
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
    
    if (tx) {
      dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS, payload: { tx, key }});
    }
  } catch (e) {
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
    
    // Fallback to non-privileged speculation so UI can mount
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
      
      if (tx) {
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

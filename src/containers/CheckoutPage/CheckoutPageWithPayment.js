import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

// Import contexts and util modules
import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { pathByRouteName } from '../../util/routes';
import { isValidCurrencyForTransactionProcess } from '../../util/fieldHelpers.js';
import { propTypes } from '../../util/types';
import { ensureTransaction } from '../../util/data';
import { createSlug } from '../../util/urlHelpers';
import { isTransactionInitiateListingNotFoundError } from '../../util/errors';
import { getProcess, isBookingProcessAlias } from '../../transactions/transaction';

// Import shared components (direct imports to avoid circular deps via barrel)
import { H3, H4 } from '../../components/Heading/Heading';
import NamedLink from '../../components/NamedLink/NamedLink';
import OrderBreakdown from '../../components/OrderBreakdown/OrderBreakdown';
import Page from '../../components/Page/Page';

import {
  bookingDatesMaybe,
  getBillingDetails,
  getFormattedTotalPrice,
  getShippingDetailsMaybe,
  getTransactionTypeData,
  hasDefaultPaymentMethod,
  hasPaymentExpired,
  hasTransactionPassedPendingPayment,
  processCheckoutWithPayment,
  setOrderPageInitialValues,
} from './CheckoutPageTransactionHelpers.js';
import { getErrorMessages } from './ErrorMessages';

import CustomTopbar from './CustomTopbar';
import StripePaymentForm from './StripePaymentForm/StripePaymentForm';
import DetailsSideCard from './DetailsSideCard';
import MobileListingImage from './MobileListingImage';
import MobileOrderBreakdown from './MobileOrderBreakdown';

import css from './CheckoutPage.module.css';
import { __DEV__ } from '../../util/envFlags';

// Import shared modules to break circular dependencies and avoid TDZ
import { 
  extractListingId, 
  normalizeISO, 
  buildOrderParams, 
  normalizeBookingDates 
} from './shared/orderParamsCore';
import { buildCheckoutSessionKey } from './shared/sessionKey';

// [DEBUG] one-shot logger
const __LOG_ONCE = new Set();
const logOnce = (key, ...args) => {
  if (!__LOG_ONCE.has(key)) {
    console.log(key, ...args);
    __LOG_ONCE.add(key);
  }
};

// Stripe PaymentIntent statuses, where user actions are already completed
// https://stripe.com/docs/payments/payment-intents/status
const STRIPE_PI_USER_ACTIONS_DONE_STATUSES = ['processing', 'requires_capture', 'succeeded'];

// Payment charge options
const ONETIME_PAYMENT = 'ONETIME_PAYMENT';
const PAY_AND_SAVE_FOR_LATER_USE = 'PAY_AND_SAVE_FOR_LATER_USE';
const USE_SAVED_CARD = 'USE_SAVED_CARD';

function paymentFlow(selectedPaymentMethod, saveAfterOnetimePayment) {
  // Payment mode could be 'replaceCard', but without explicit saveAfterOnetimePayment flag,
  // we'll handle it as one-time payment
  return selectedPaymentMethod === 'defaultCard'
    ? USE_SAVED_CARD
    : saveAfterOnetimePayment
    ? PAY_AND_SAVE_FOR_LATER_USE
    : ONETIME_PAYMENT;
}

// Helper to build customer protectedData from shipping form
function buildCustomerPD(shipping, currentUser) {
  return {
    customerName: shipping?.recipientName || shipping?.name || '',
    customerStreet: shipping?.streetAddress || shipping?.street || '',
    customerStreet2: shipping?.streetAddress2 || shipping?.street2 || '',
    customerCity: shipping?.city || '',
    customerState: shipping?.state || '',
    customerZip: shipping?.zip || shipping?.postalCode || shipping?.zipCode || '',
    customerPhone: shipping?.phone || '',
    customerEmail: shipping?.email || currentUser?.attributes?.email || '',
  };
}

function capitalizeString(s) {
  return `${s.charAt(0).toUpperCase()}${s.substr(1)}`;
}

/**
 * Prefix the properties of the chosen price variant as first level properties for the protected data of the transaction
 *
 * @example
 * const priceVariant = {
 *   name: 'something',
 * }
 *
 * will be returned as:
 * const priceVariant = {
 *   priceVariantName: 'something',
 * }
 *
 * @param {Object} priceVariant - The price variant object
 * @returns {Object} The price variant object with the properties prefixed with priceVariant*
 */
function prefixPriceVariantProperties(priceVariant) {
  if (!priceVariant) {
    return {};
  }

  const entries = Object.entries(priceVariant).map(([key, value]) => {
    return [`priceVariant${capitalizeString(key)}`, value];
  });
  return Object.fromEntries(entries);
}

/**
 * Construct orderParams object using pageData from session storage, shipping details, and optional payment params.
 * Note: This is used for both speculate transition and real transition
 *       - Speculate transition is called, when the the component is mounted. It's used to test if the data can go through the API validation
 *       - Real transition is made, when the user submits the StripePaymentForm.
 *
 * @param {Object} pageData data that's saved to session storage.
 * @param {Object} shippingDetails shipping address if applicable.
 * @param {Object} optionalPaymentParams (E.g. paymentMethod or setupPaymentMethodForSaving)
 * @param {Object} config app-wide configs. This contains hosted configs too.
 * @param {Object} formValues form values containing customer data
 * @returns orderParams.
 */
function getOrderParams(pageData = {}, shippingDetails = {}, optionalPaymentParams = {}, config = {}, formValues = {}) {
  // Validate required parameters
  if (!pageData || !config) {
    console.error('[getOrderParams] Missing required parameters:', { hasPageData: !!pageData, hasConfig: !!config });
    return null;
  }
  const quantity = pageData.orderData?.quantity;
  const quantityMaybe = quantity ? { quantity } : {};
  const seats = pageData.orderData?.seats;
  const seatsMaybe = seats ? { seats } : {};
  const deliveryMethod = pageData.orderData?.deliveryMethod;
  const deliveryMethodMaybe = deliveryMethod ? { deliveryMethod } : {};
  // price variant data for fixed duration bookings
  const priceVariant = pageData.orderData?.priceVariant;
  const priceVariantMaybe = priceVariant ? prefixPriceVariantProperties(priceVariant) : {};

  const { listingType, unitType } = pageData?.listing?.attributes?.publicData || {};
  const currentUser = pageData?.currentUser;

  // Extract shipping details from the nested structure
  const shippingInfo = shippingDetails?.shippingDetails || {};
  const shippingAddress = shippingInfo?.address || {};

  // Manually construct protectedData with shipping and contact info
  const protectedDataMaybe = {
    protectedData: {
      // Customer info from formValues and shippingDetails (using correct field names)
      customerName: formValues.name || shippingInfo?.name || '',
      customerStreet: formValues.shipping?.street || shippingAddress?.line1 || '',
      customerStreet2: formValues.shipping?.street2 || '',
      customerCity: formValues.shipping?.city || shippingAddress?.city || '',
      customerState: formValues.shipping?.state || shippingAddress?.state || '',
      customerZip: formValues.shipping?.zip || shippingAddress?.postalCode || '',
      customerEmail: formValues.email || currentUser?.attributes?.email || '',
      customerPhone: formValues.phone || shippingInfo?.phoneNumber || '',

      // Provider info from currentUser
      providerName: currentUser?.attributes?.profile?.displayName || '',
      providerStreet: '', // Will be filled by provider in TransactionPanel
      providerCity: '',
      providerState: '',
      providerZip: '',
      providerEmail: currentUser?.attributes?.email || '',
      providerPhone: currentUser?.attributes?.profile?.protectedData?.phoneNumber || currentUser?.attributes?.profile?.publicData?.phoneNumber || '',

      // Additional transaction data
      ...getTransactionTypeData(listingType, unitType, config),
      ...deliveryMethodMaybe,
      ...priceVariantMaybe,
    },
  };

  // Log the constructed protected data for debugging
  console.log('[checkout] protectedData keys:', Object.keys(protectedDataMaybe.protectedData));
  console.log('📦 Raw shipping details:', shippingDetails);
  console.log('📦 Extracted shipping info:', shippingInfo);
  console.log('📦 Extracted shipping address:', shippingAddress);

  // These are the order parameters for the first payment-related transition
  const orderParams = {
    listingId: pageData?.listing?.id,
    ...deliveryMethodMaybe,
    ...quantityMaybe,
    ...seatsMaybe,
    ...bookingDatesMaybe(pageData.orderData?.bookingDates),
    ...protectedDataMaybe,
    ...optionalPaymentParams,
  };

  // Log the final orderParams for debugging
  console.log('📦 Final orderParams:', orderParams);

  return orderParams;
}

// Module-level cache to prevent speculation loops when loadInitialDataForStripePayments is called
const MODULE_SPEC_CACHE = { current: null };

function fetchSpeculatedTransactionIfNeeded(orderParams, pageData, fetchSpeculatedTransaction, prevKeyRef) {
  const tx = pageData ? pageData.transaction : null;
  const pageDataListing = pageData.listing;
  const processName =
    tx?.attributes?.processName ||
    pageDataListing?.attributes?.publicData?.transactionProcessAlias?.split('/')[0];
  const txProcess = processName ? getProcess(processName) : null;

  // If transaction has passed payment-pending state, speculated tx is not needed.
  const shouldFetchSpeculatedTransaction =
    !!pageData?.listing?.id &&
    !!pageData.orderData &&
    !!txProcess &&
    !hasTransactionPassedPendingPayment(tx, txProcess);

  if (shouldFetchSpeculatedTransaction) {
    // Create a stable key based on parameters that should trigger a new fetch
    const specParams = JSON.stringify({
      listingId: pageData.listing.id,
      startDate: orderParams?.bookingStart,
      endDate: orderParams?.bookingEnd,
      quantity: orderParams?.quantity,
      shippingZip: (orderParams?.shippingDetails?.postalCode || '').trim().toUpperCase(),
      country: (orderParams?.shippingDetails?.country || 'US').toUpperCase(),
      transactionId: tx?.id,
    });

    // Only fetch if the key has changed (prevents loops)
    if (prevKeyRef.current !== specParams) {
      prevKeyRef.current = specParams;
      
      const processAlias = pageData.listing.attributes.publicData?.transactionProcessAlias;
      const transactionId = tx ? tx.id : null;
      const isInquiryInPaymentProcess =
        tx?.attributes?.lastTransition === txProcess.transitions.INQUIRE;

      const requestTransition = isInquiryInPaymentProcess
        ? txProcess.transitions.REQUEST_PAYMENT_AFTER_INQUIRY
        : txProcess.transitions.REQUEST_PAYMENT;
      const isPrivileged = txProcess.isPrivileged(requestTransition);

      fetchSpeculatedTransaction(
        orderParams,
        processAlias,
        transactionId,
        requestTransition,
        isPrivileged
      );
    }
  }
}

/**
 * Load initial data for the page
 *
 * Since the data for the checkout is not passed in the URL (there
 * might be lots of options in the future), we must pass in the data
 * some other way. Currently the ListingPage sets the initial data
 * for the CheckoutPage's Redux store.
 *
 * For some cases (e.g. a refresh in the CheckoutPage), the Redux
 * store is empty. To handle that case, we store the received data
 * to window.sessionStorage and read it from there if no props from
 * the store exist.
 *
 * This function also sets of fetching the speculative transaction
 * based on this initial data.
 */
export function loadInitialDataForStripePayments({
  pageData,
  fetchSpeculatedTransaction,
  fetchStripeCustomer,
  config,
}) {
  // Fetch currentUser with stripeCustomer entity
  fetchStripeCustomer();

  // Fetch speculated transaction for showing price in order breakdown
  const shippingDetails = {};
  console.log('📬 shippingDetails in loadInitialData:', shippingDetails);
  const optionalPaymentParams = {};
  const orderParams = getOrderParams(pageData, shippingDetails, optionalPaymentParams, config);

  // Validate orderParams before proceeding
  if (!orderParams) {
    console.warn('[loadInitialData] getOrderParams returned null, skipping speculation');
    return;
  }

  // Use module-level cache to prevent duplicate calls across function invocations
  fetchSpeculatedTransactionIfNeeded(orderParams, pageData, fetchSpeculatedTransaction, MODULE_SPEC_CACHE);
}

async function handleSubmit(values, txProcess, props, stripe, submitting, setSubmitting) {
  if (submitting) {
    return;
  }
  setSubmitting(true);

  const {
    history,
    config,
    routeConfiguration,
    speculativeTransaction,  // ← FIXED: Use new prop name
    currentUser,
    stripeCustomerFetched,
    paymentIntent,
    dispatch,
    onInitiateOrder,
    onConfirmCardPayment,
    onConfirmPayment,
    onSendMessage,
    onSavePaymentMethod,
    onSubmitCallback,
    pageData,
    setPageData,
    sessionStorageKey,
    getDiscountedPriceFromVariants,
  } = props;

  const { card, message, paymentMethod: selectedPaymentMethod, formValues } = values;

  // 🌐 DEBUG: Check if pageData and booking dates are coming through
  console.log("🧪 DEBUG pageData:", pageData);
  console.log("🧪 DEBUG pageData.orderData:", pageData?.orderData);

  const bookingStart = pageData?.orderData?.bookingDates?.bookingStart;
  const bookingEnd = pageData?.orderData?.bookingDates?.bookingEnd;

  console.log("🕓 DEBUG bookingStart:", bookingStart);
  console.log("🕓 DEBUG bookingEnd:", bookingEnd);

  if (!bookingStart || !bookingEnd) {
    console.warn("⚠️ Booking dates are missing! Cannot continue with submission.");
    setSubmitting(false);
    return;
  }

  const saveAfterOnetimePayment =
    Array.isArray(formValues.saveAfterOnetimePayment) && formValues.saveAfterOnetimePayment.length > 0;
  const selectedPaymentFlow = paymentFlow(selectedPaymentMethod, saveAfterOnetimePayment);
  const hasDefaultPaymentMethodSaved = hasDefaultPaymentMethod(stripeCustomerFetched, currentUser);
  const stripePaymentMethodId = hasDefaultPaymentMethodSaved
    ? currentUser?.stripeCustomer?.defaultPaymentMethod?.attributes?.stripePaymentMethodId
    : null;

  const hasPaymentIntentUserActionsDone =
    paymentIntent && STRIPE_PI_USER_ACTIONS_DONE_STATUSES.includes(paymentIntent.status);

  // Log formValues for debugging
  console.log('Form values on submit:', formValues);

  // Build customer protectedData for request-payment
  // Filter out empty strings so you don't clobber later merges
  const protectedData = {};
  
  // Customer fields - only include if non-empty
  if (formValues.customerName?.trim()) protectedData.customerName = formValues.customerName.trim();
  if (formValues.customerStreet?.trim()) protectedData.customerStreet = formValues.customerStreet.trim();
  if (formValues.customerStreet2?.trim()) protectedData.customerStreet2 = formValues.customerStreet2.trim();
  if (formValues.customerCity?.trim()) protectedData.customerCity = formValues.customerCity.trim();
  if (formValues.customerState?.trim()) protectedData.customerState = formValues.customerState.trim();
  if (formValues.customerZip?.trim()) protectedData.customerZip = formValues.customerZip.trim();
  if (formValues.customerEmail?.trim()) protectedData.customerEmail = formValues.customerEmail.trim();
  else if (currentUser?.attributes?.email?.trim()) protectedData.customerEmail = currentUser.attributes.email.trim();
  if (formValues.customerPhone?.trim()) protectedData.customerPhone = formValues.customerPhone.trim();
  
  // Provider fields - only include if non-empty
  if (currentUser?.attributes?.profile?.displayName?.trim()) {
    protectedData.providerName = currentUser.attributes.profile.displayName.trim();
  }
  if (currentUser?.attributes?.email?.trim()) {
    protectedData.providerEmail = currentUser.attributes.email.trim();
  }
  const providerPhone = currentUser?.attributes?.profile?.protectedData?.phoneNumber || 
                       currentUser?.attributes?.profile?.publicData?.phoneNumber;
  if (providerPhone?.trim()) {
    protectedData.providerPhone = providerPhone.trim();
  }

  // Add customer protected data from form values (inline mapping)
  const customerPD = (function(v){
    const s = v?.shipping || {};
    const b = v?.billing || {};
    const use = v?.shipping && !v?.shippingSameAsBilling ? s : (Object.keys(s||{}).length ? s : b);
    return {
      customerName:   use?.name        || '',
      customerStreet: use?.line1       || '',
      customerStreet2:use?.line2       || '',
      customerCity:   use?.city        || '',
      customerState:  use?.state       || '',
      customerZip:    use?.postalCode  || '',
      customerPhone:  use?.phone       || '',
      customerEmail:  use?.email       || '',
    };
  })(formValues);

  const mergedPD = { ...protectedData, ...customerPD };
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[checkout→request-payment] Customer PD about to send:', mergedPD);
  }

  // Log the protected data for debugging (production-safe, browser-safe)
  if (__DEV__) {
    try {
      console.log('🔐 Protected data constructed from formValues:', mergedPD);
      console.log('📦 Raw formValues:', formValues);
      console.log('[checkout] sending protectedData:', Object.entries(mergedPD));
      
      // Verify customer fields are populated
      const customerFields = ['customerName', 'customerStreet', 'customerCity', 'customerState', 'customerZip', 'customerEmail', 'customerPhone'];
      const missingFields = customerFields.filter(field => !mergedPD[field]?.trim());
      if (missingFields.length > 0) {
        console.warn('⚠️ Missing customer fields:', missingFields);
      } else {
        console.log('✅ All customer fields populated:', customerFields.map(field => `${field}: "${mergedPD[field]}"`));
      }
    } catch (_) {
      // never block submission on logging
    }
  }

  // Calculate pricing and booking duration
  const unitPrice = pageData?.listing?.attributes?.price;
  const currency = unitPrice?.currency;
  const baseNightlyPrice = unitPrice?.amount;

  const start = new Date(bookingStart);
  const end = new Date(bookingEnd);
  const millisecondsPerNight = 1000 * 60 * 60 * 24;
  const nights = Math.round((end - start) / millisecondsPerNight);

  // Log pricing calculations for debugging
  console.log('💰 Pricing calculations:', {
    baseNightlyPrice,
    currency,
    nights,
    bookingStart: start.toISOString(),
    bookingEnd: end.toISOString()
  });

  // Calculate discount based on nights
  let discountPercent = 0;
  let discountCode = '';
  if (nights >= 4 && nights <= 5) {
    discountPercent = 0.25;
    discountCode = 'line-item/discount-25';
  } else if (nights >= 6 && nights <= 7) {
    discountPercent = 0.30;
    discountCode = 'line-item/discount-30';
  } else if (nights >= 8 && nights <= 10) {
    discountPercent = 0.40;
    discountCode = 'line-item/discount-40';
  } else if (nights >= 11) {
    discountPercent = 0.50;
    discountCode = 'line-item/discount-50';
  }

  const preDiscountTotal = baseNightlyPrice * nights;
  const discountAmount = Math.round(preDiscountTotal * discountPercent);
  
  // Log discount calculations
  console.log('🎯 Discount calculations:', {
    discountPercent,
    discountCode,
    preDiscountTotal,
    discountAmount
  });

  const discountLineItem = discountPercent > 0
    ? {
        code: 'line-item/discount',
        unitPrice: { amount: -discountAmount, currency },
        quantity: 1,
        includeFor: ['customer'],
        reversal: false,
        description: `${discountPercent * 100}% off`,
      }
    : null;

  const lineItems = [
    {
      code: 'line-item/day',
      unitPrice: { amount: baseNightlyPrice, currency },
      quantity: nights,
      includeFor: ['customer', 'provider'],
    },
    ...(discountLineItem ? [discountLineItem] : []),
  ];

  // Restore optionalPaymentParams definition
  const optionalPaymentParams =
    selectedPaymentFlow === USE_SAVED_CARD && hasDefaultPaymentMethodSaved
      ? { paymentMethod: stripePaymentMethodId }
      : selectedPaymentFlow === PAY_AND_SAVE_FOR_LATER_USE
      ? { setupPaymentMethodForSaving: true }
      : {};

  // Log line items for debugging
  console.log('🧾 Line items constructed:', lineItems);

  const orderParams = {
    listingId: pageData?.listing?.id,
    bookingStart,
    bookingEnd,
    lineItems,
    protectedData: mergedPD,  // Use merged protected data with customer fields
    ...optionalPaymentParams,
  };

  // Verify required address fields before API call
  if (__DEV__) {
    console.log('[checkout→request-payment] customerStreet:', mergedPD.customerStreet);
    console.log('[checkout→request-payment] customerZip:', mergedPD.customerZip);
  }
  
  // Assert required fields and abort if missing
  if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[checkout] Missing address fields for speculate — proceeding with minimal PD');
    }
    // continue without throwing; speculation should still run
  }

  // One-time logs right before the API call
  console.log('[checkout→request-payment] protectedData keys:', Object.keys(mergedPD));
  console.log('📝 Final orderParams being sent to initiateOrder:', orderParams);
  
  // Verify customer data is included in the request
  if (__DEV__) {
    try {
      const customerDataInRequest = orderParams.protectedData;
      const customerFields = ['customerName', 'customerStreet', 'customerCity', 'customerState', 'customerZip', 'customerEmail', 'customerPhone'];
      const populatedFields = customerFields.filter(field => customerDataInRequest[field]?.trim());
      console.log(`[checkout→request-payment] Customer fields in request: ${populatedFields.length}/${customerFields.length}`, populatedFields);
    } catch (_) {
      // never block submission on logging
    }
  }

  // Log line items for debugging
  console.log('🔍 Line item codes being sent:', lineItems.map(item => item.code));
  console.log('🔍 Full lineItems:', JSON.stringify(lineItems, null, 2));

  // Construct requestPaymentParams before calling processCheckoutWithPayment
  const requestPaymentParams = {
    pageData,
    speculativeTransaction,  // ← FIXED: Use new prop name
    stripe,
    card,
    billingDetails: getBillingDetails(formValues, currentUser),
    message,
    paymentIntent,
    hasPaymentIntentUserActionsDone,
    stripePaymentMethodId,
    txProcess,
    onInitiateOrder,
    onConfirmCardPayment,
    onConfirmPayment,
    onSendMessage,
    onSavePaymentMethod,
    sessionStorageKey,
    stripeCustomer: currentUser?.stripeCustomer,
    isPaymentFlowUseSavedCard: selectedPaymentFlow === USE_SAVED_CARD,
    isPaymentFlowPayAndSaveCard: selectedPaymentFlow === PAY_AND_SAVE_FOR_LATER_USE,
    setPageData,
  };

  console.log('🚦 processCheckoutWithPayment called:', { orderParams, requestPaymentParams });
  
  try {
    const response = await processCheckoutWithPayment(orderParams, requestPaymentParams);
    const { orderId, messageSuccess, paymentMethodSaved } = response;
    setSubmitting(false);

    const initialMessageFailedToTransaction = messageSuccess ? null : orderId;
    const orderDetailsPath = pathByRouteName('OrderDetailsPage', routeConfiguration, {
      id: orderId.uuid,
    });
    const initialValues = {
      initialMessageFailedToTransaction,
      savePaymentMethodFailed: !paymentMethodSaved,
    };

    setOrderPageInitialValues(initialValues, routeConfiguration, dispatch);
    onSubmitCallback();
    history.push(orderDetailsPath);
  } catch (err) {
    console.error('[Checkout] processCheckoutWithPayment failed:', err);
    setSubmitting(false);
    
    // Show error notification if available
    if (typeof props.addMarketplaceNotification === 'function') {
      props.addMarketplaceNotification({
        type: 'error',
        message: 'We couldn\'t start the checkout. Please check your info and try again.',
      });
    }
    
    // Re-throw to ensure form submission state is properly reset
    throw err;
  }
}

/**
 * A component that renders the checkout page with payment.
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.scrollingDisabled - Whether the page should scroll
 * @param {string} props.speculateTransactionError - The error message for the speculate transaction
 * @param {propTypes.transaction} props.speculativeTransaction - The speculative transaction (normalized name)
 * @param {boolean} props.isClockInSync - Whether the clock is in sync
 * @param {string} props.initiateOrderError - The error message for the initiate order
 * @param {string} props.confirmPaymentError - The error message for the confirm payment
 * @param {intlShape} props.intl - The intl object
 * @param {propTypes.currentUser} props.currentUser - The current user
 * @param {string} props.confirmCardPaymentError - The error message for the confirm card payment
 * @param {propTypes.paymentIntent} props.paymentIntent - The Stripe's payment intent
 * @param {boolean} props.stripeCustomerFetched - Whether the stripe customer has been fetched
 * @param {Object} props.pageData - The page data
 * @param {propTypes.listing} props.pageData.listing - The listing entity
 * @param {propTypes.transaction} props.pageData.transaction - The transaction entity
 * @param {Object} props.pageData.orderData - The order data
 * @param {string} props.processName - The process name
 * @param {string} props.listingTitle - The listing title
 * @param {string} props.title - The title
 * @param {Function} props.onInitiateOrder - The function to initiate the order
 * @param {Function} props.onConfirmCardPayment - The function to confirm the card payment
 * @param {Function} props.onConfirmPayment - The function to confirm the payment after Stripe call is made
 * @param {Function} props.onSendMessage - The function to send a message
 * @param {Function} props.onSavePaymentMethod - The function to save the payment method for later use
 * @param {Function} props.onSubmitCallback - The function to submit the callback
 * @param {propTypes.error} props.initiateOrderError - The error message for the initiate order
 * @param {propTypes.error} props.confirmPaymentError - The error message for the confirm payment
 * @param {propTypes.error} props.confirmCardPaymentError - The error message for the confirm card payment
 * @param {propTypes.paymentIntent} props.paymentIntent - The Stripe's payment intent
 * @param {boolean} props.stripeCustomerFetched - Whether the stripe customer has been fetched
 * @param {Object} props.config - The config
 * @param {Object} props.routeConfiguration - The route configuration
 * @param {Object} props.history - The history object
 * @param {Object} props.history.push - The push state function of the history object
 * @returns {JSX.Element}
 */
const CheckoutPageWithPayment = props => {
  // ✅ STEP 1: Extract ALL props at the very top before any hooks or state
  // This prevents TDZ errors in production builds where minification can reorder code
  const {
    scrollingDisabled,
    speculateTransactionError,
    speculativeTransaction, // ✅ normalized name from mapStateToProps
    speculativeInProgress, // ✅ normalized name from mapStateToProps
    isClockInSync,
    initiateOrderError,
    confirmPaymentError,
    intl,
    currentUser,
    confirmCardPaymentError,
    paymentIntent,
    retrievePaymentIntentError,
    stripeCustomerFetched,
    pageData,
    processName,
    listingTitle,
    title,
    config,
    onInitiatePrivilegedSpeculativeTransaction, // Extract callback here to avoid TDZ
    // New props for enhanced speculation state
    speculateStatus,
    stripeClientSecret: secretFromEntities,
    clientSecretHotfix: secretFromHotfix,
  } = props;
  
  // --- HOTFIX: Prefer hotfix secret over entity-derived one ---
  const stripeClientSecret = secretFromHotfix || secretFromEntities || null;
  if (process.env.NODE_ENV !== 'production') {
    console.log('[HOTFIX][STRIPE_PI] chosen secret tail:',
      (stripeClientSecret || '').slice(-12),
      { from: secretFromHotfix ? 'hotfix' : (secretFromEntities ? 'entities' : 'none') }
    );
  }

  // ✅ STEP 2: Initialize all state hooks
  const [submitting, setSubmitting] = useState(false);
  const [stripe, setStripe] = useState(null);
  const [paymentElementComplete, setPaymentElementComplete] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [formValid, setFormValid] = useState(false);
  const [stripeElementMounted, setStripeElementMounted] = useState(false);
  const [tokenTick, setTokenTick] = useState(0); // Force re-render when token appears via storage event
  const stripeReady = !!stripeElementMounted;

  // ✅ STEP 3: Initialize all refs
  const prevSpecKeyRef = useRef(null);
  const lastReasonRef = useRef(null);
  const initiatedSessionRef = useRef(null);
  const lastSessionKeyRef = useRef(null);
  const retrievedRef = useRef(null);
  
  // Keep a stable ref to the handler so effect doesn't depend on its identity
  const initiateRef = useRef(onInitiatePrivilegedSpeculativeTransaction);

  // ✅ STEP 4: Define callbacks
  const handleFormValuesChange = useCallback((next) => {
    const prev = JSON.stringify(formValues || {});
    const json = JSON.stringify(next || {});
    if (json !== prev) setFormValues(next || {});
  }, [formValues]);

  // Normalize booking dates from pageData (handles multiple shapes)
  // Use object assignment first to avoid minifier reordering TDZ issues
  const normalizedDates = useMemo(() => normalizeBookingDates(pageData), [pageData]);
  const startISO = normalizedDates?.startISO;
  const endISO = normalizedDates?.endISO;
  
  const pageDataListing = pageData?.listing;
  const listingIdRaw = pageData?.listing?.id;
  const unitTypeFromListing = pageData?.listing?.attributes?.publicData?.unitType;
  const userId = currentUser?.id?.uuid;
  const anonymousId = !userId && typeof window !== 'undefined' 
    ? window.sessionStorage?.getItem('anonymousId') || 'anonymous'
    : null;

  // Extract normalized listing ID
  const listingIdNormalized = extractListingId(pageDataListing, listingIdRaw);

  // Build order params with validation using new robust builder with normalized dates
  const orderResult = useMemo(() => {
    if (!startISO || !endISO) {
      // Log once for debugging (only in development)
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[Checkout] Missing booking dates in orderParams', { 
          startISO, 
          endISO, 
          pageDataKeys: Object.keys(pageData || {}) 
        });
      }
      return { ok: false, reason: 'missing-bookingDates', params: null };
    }
    
    return buildOrderParams({
      listing: pageDataListing,
      listingId: listingIdNormalized,
      start: startISO,
      end: endISO,
      protectedData: {}, // Will be populated later with form data
    });
  }, [pageDataListing, listingIdNormalized, startISO, endISO, pageData]);

  // Stable session key: includes user/listing/dates to identify unique checkout session
  // MUST be declared before any effects that use it in deps
  const sessionKey = useMemo(() => {
    return buildCheckoutSessionKey({
      userId,
      anonymousId,
      listingId: orderResult.params?.listingId,
      startISO: orderResult.params?.bookingDates?.start,
      endISO: orderResult.params?.bookingDates?.end,
    });
  }, [userId, anonymousId, orderResult.params]);

  // Dev-only diagnostics deferred to effect to avoid TDZ in minified builds
  // Consolidated logging with primitive deps only (no complex objects)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    try {
      // Log orderParams validity
      if (!orderResult?.ok) {
        console.debug('[Checkout] orderParams invalid:', orderResult?.reason, orderResult);
      } else {
        const p = orderResult.params || {};
        const lid = p.listingId;
        const bookingDates = p.bookingDates;
        console.debug('[Sherbrt] 🔍 Checkout render', {
          lid,
          hasBookingDates: Boolean(bookingDates && bookingDates.start && bookingDates.end),
          ok: orderResult.ok,
        });
      }
      
      // Log normalized dates
      if (startISO && endISO) {
        console.debug('[Checkout] Normalized dates:', { startISO, endISO });
      }
      
      // Log session key
      if (sessionKey) {
        console.debug('[Checkout] Session key:', sessionKey);
      }
    } catch (_) {
      // swallow dev-only diagnostics errors - never block component
    }
  }, [sessionKey, !!orderResult?.ok, startISO, endISO]);

  // Kill-switch: Allow disabling auto-initiation via env var
  // Set REACT_APP_INITIATE_ON_MOUNT_ENABLED=false in .env to disable auto-initiation
  // This is an emergency flag to quickly stop the initiation if issues occur in production
  const autoInitEnabled = process.env.REACT_APP_INITIATE_ON_MOUNT_ENABLED !== 'false';

  // Keep this lightweight boolean computed each render:
  const hasToken = Boolean(
    window.localStorage?.getItem('st-auth') ||
    window.sessionStorage?.getItem('st-auth') ||
    document.cookie?.includes('st=')
  );

  // Update the ref whenever the handler changes
  useEffect(() => {
    initiateRef.current = onInitiatePrivilegedSpeculativeTransaction;
  }, [onInitiatePrivilegedSpeculativeTransaction]);

  // Listen for storage events to force re-render when token appears (e.g., from login in another tab)
  useEffect(() => {
    const onStorage = e => {
      if (e.key === 'st-auth') {
        // Tiny state bump to force re-render and re-check hasToken
        setTokenTick(t => t + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ✅ Single initiation effect with ref-based guard
  // This triggers the speculative transaction AS SOON AS orderData is present
  // The orderResult.ok gate ensures we have valid booking dates from orderData
  // Note: Token/Stripe gates REMOVED - speculation fires immediately to get PaymentIntent
  useEffect(() => {
    // Get txProcess in this scope for gate checking
    const pageDataListing = pageData?.listing;
    const tx = pageData?.transaction;
    const processNameForGate = 
      tx?.attributes?.processName ||
      pageDataListing?.attributes?.publicData?.transactionProcessAlias?.split('/')[0];
    const txProcessForGate = processNameForGate ? getProcess(processNameForGate) : null;
    
    // Extract all gate values
    const hasUser = Boolean(currentUser && currentUser.id);
    const hasTxId = Boolean(props?.speculativeTransactionId);
    const hasProcess = Boolean(txProcessForGate);

    // Check all gates - orderResult.ok means we have valid orderData with booking dates
    // ✅ REMOVED hasToken gate - speculate fires immediately after orderData exists
    const allGatesPassed = hasUser && orderResult?.ok && !hasTxId && hasProcess;

    // Log orderData and listingId for debugging
    console.log('[CheckoutWithPayment] orderData from selector:', orderResult.params);
    console.log('[CheckoutWithPayment] listingId:', listingIdNormalized);

    // Log the exact gate state
    if (allGatesPassed) {
      console.log('[Checkout] triggering speculate…', { 
        listingId: listingIdNormalized, 
        orderData: orderResult.params 
      });
    } else {
      console.debug('[INIT_GATES]', { 
        hasUser: !!currentUser?.id, 
        orderOk: !!orderResult?.ok, 
        hasTxId, 
        hasProcess: !!txProcessForGate, 
        sessionKey 
      });
    }

    // ✅ Hard-gate #1: User must exist
    if (!hasUser) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[Checkout] ⛔ Skipping initiate - user not authenticated yet');
      }
      return;
    }

    // Never initiate with bad params
    if (!orderResult.ok) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[Checkout] ⛔ Skipping initiate - invalid params:', orderResult.reason);
      }
      return;
    }

    // ✅ Hard-gate #4: Wait for txProcess to exist
    if (!hasProcess) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[Checkout] ⛔ Skipping initiate - txProcess not ready yet');
      }
      return;
    }

    // ✅ Hard-gate #5: Skip if we already have a txId (success!)
    if (hasTxId) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[Checkout] ✅ Already have txId:', props?.speculativeTransactionId);
      }
      return;
    }

    // Reset the guard if sessionKey changed OR if we don't have a txId
    // This allows retries after auth appears even if sessionKey was previously used
    if (lastSessionKeyRef.current !== sessionKey || !hasTxId) {
      initiatedSessionRef.current = false;
      lastSessionKeyRef.current = sessionKey;
    }

    // ✅ Hard-gate #6: 1-shot guard per listing/session (but allow retry if no txId)
    if (initiatedSessionRef.current && hasTxId) {
      return;
    }

    // Mark as initiated before calling to prevent race conditions
    initiatedSessionRef.current = true;

    if (process.env.NODE_ENV !== 'production') {
      console.debug('[Checkout] 🚀 initiating once for', sessionKey);
    }

    // [DEBUG] about to dispatch (one-shot)
    logOnce('[INITIATE_TX] about to dispatch', { sessionKey, orderParams: orderResult.params });

    // Call the latest handler via ref (no identity in deps)
    const fn = initiateRef.current;
    if (typeof fn === 'function') {
      fn(orderResult.params)
        .then(res => {
          console.debug('[INITIATE_TX] success', { 
            id: res?.id || res?.payload?.id 
          });
        })
        .catch(err => {
          console.error('[INITIATE_TX] FAILED', err);
        });
    }
  }, [sessionKey, !!orderResult?.ok, currentUser?.id, props?.speculativeTransactionId, processName, listingIdNormalized]); // Removed hasToken dep, added listingIdNormalized

  // Verify the speculative transaction state lands in props
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[TX_STATE]', {
        hasTxId: !!props?.speculativeTransactionId,
        txId: props?.speculativeTransactionId,
        speculativeInProgress,
        hasUser: !!currentUser?.id,
      });
    }
  }, [props?.speculativeTransactionId, speculativeInProgress, currentUser?.id]);

  // Log after speculation success with enhanced data
  useEffect(() => {
    if (speculateStatus === 'succeeded') {
      console.log('[POST-SPECULATE]', {
        speculativeTransactionId: props?.speculativeTransactionId,
        clientSecretPresent: !!stripeClientSecret,
        clientSecretLength: stripeClientSecret?.length || 0,
      });
      
      // Add dev-only diagnostics (no secrets)
      if (process.env.NODE_ENV !== 'production') {
        const tx = props?.speculativeTransaction;
        const pd = tx?.attributes?.protectedData?.stripePaymentIntents?.default || {};
        console.log('[POST-SPECULATE] clientSecretPresent:%s clientSecretLength:%s',
          !!pd.stripePaymentIntentClientSecret,
          (pd.stripePaymentIntentClientSecret || '').length
        );
      }
    }
  }, [speculateStatus, props?.speculativeTransactionId, stripeClientSecret, props?.speculativeTransaction]);

  // 🔑 CRITICAL: Retrieve PaymentIntent after speculation succeeds
  // This populates state.stripe.paymentIntent which StripePaymentForm needs to mount Elements
  useEffect(() => {
    if (!stripe || !stripeClientSecret) return;
    if (retrievedRef.current === stripeClientSecret) return;

    // 🔐 PROD HOTFIX: Double-check secret looks valid before calling Stripe
    const looksStripey = typeof stripeClientSecret === 'string' && 
                         (/_secret_/.test(stripeClientSecret) || /^pi_/.test(stripeClientSecret));
    
    if (!looksStripey) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[STRIPE] Invalid client secret shape; expected pi_* with _secret_. Not retrieving PI.');
      }
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[STRIPE] Retrieving PaymentIntent with clientSecret');
    }
    
    props.onRetrievePaymentIntent({
      stripe,
      stripePaymentIntentClientSecret: stripeClientSecret,
    });

    retrievedRef.current = stripeClientSecret;
  }, [stripe, stripeClientSecret, props.onRetrievePaymentIntent]);

  // Retry speculation handler
  const handleRetrySpeculation = useCallback(() => {
    console.log('[Checkout] Retrying speculation...');
    // Reset the guard to allow re-triggering
    initiatedSessionRef.current = false;
    lastSessionKeyRef.current = null;
    
    // Call the speculation handler
    const fn = initiateRef.current;
    if (typeof fn === 'function' && orderResult?.ok) {
      fn(orderResult.params)
        .then(res => {
          console.log('[Checkout] Retry succeeded', { id: res?.id || res?.payload?.id });
        })
        .catch(err => {
          console.error('[Checkout] Retry failed', err);
        });
    }
  }, [orderResult]);

  // Comprehensive logging for submit gates (recomputes after each key state change)
  useEffect(() => {
    const hasSpeculativeTx = !!props.speculativeTransactionId;
    const canSubmit =
      hasSpeculativeTx &&
      stripeReady &&
      paymentElementComplete &&
      formValid &&
      !submitting;

    console.log('[SUBMIT_GATES]', {
      hasSpeculativeTx,
      stripeReady,
      paymentElementComplete,
      formValid,
      notSubmitting: !submitting,
      canSubmit,
    });
  }, [props.speculativeTransactionId, stripeReady, paymentElementComplete, formValid, submitting]);

  // Since the listing data is already given from the ListingPage
  // and stored to handle refreshes, it might not have the possible
  // deleted or closed information in it. If the transaction
  // initiate or the speculative initiate fail due to the listing
  // being deleted or closed, we should dig the information from the
  // errors and not the listing data.
  const listingNotFound =
    isTransactionInitiateListingNotFoundError(speculateTransactionError) ||
    isTransactionInitiateListingNotFoundError(initiateOrderError);

  const { listing, transaction, orderData } = pageData;
  const existingTransaction = ensureTransaction(transaction);
  const normalizedSpeculativeTransaction = ensureTransaction(speculativeTransaction, {}, null);

  // If existing transaction has line-items, it has gone through one of the request-payment transitions.
  // Otherwise, we try to rely on normalizedSpeculativeTransaction for order breakdown data.
  const tx =
    existingTransaction?.attributes?.lineItems?.length > 0
      ? existingTransaction
      : normalizedSpeculativeTransaction;
  const timeZone = listing?.attributes?.availabilityPlan?.timezone;
  const transactionProcessAlias = listing?.attributes?.publicData?.transactionProcessAlias;

  const txBookingMaybe = tx?.booking?.id ? { booking: tx.booking, timeZone } : {};

  if (tx && tx.attributes && tx.attributes.lineItems) {
    // Log the lineItems and total price for verification
    // eslint-disable-next-line no-console
    console.log('🧾 Checkout breakdown lineItems:', tx.attributes.lineItems);
    // eslint-disable-next-line no-console
    console.log('🧾 Checkout breakdown total price:', getFormattedTotalPrice(tx, intl));
  }

  // Show breakdown only when (speculated?) transaction is loaded
  // (i.e. it has an id and lineItems)
  const breakdown =
    tx.id && tx.attributes.lineItems?.length > 0 ? (
      <OrderBreakdown
        className={css.orderBreakdown}
        userRole="customer"
        transaction={tx}
        {...txBookingMaybe}
        currency={config.currency}
        marketplaceName={config.marketplaceName}
      />
    ) : null;

  const totalPrice =
    tx?.attributes?.lineItems?.length > 0 ? getFormattedTotalPrice(tx, intl) : null;

  const txProcess = processName ? getProcess(processName) : null;
  const transitions = txProcess?.transitions || {};
  const isPaymentExpired = hasPaymentExpired(existingTransaction, txProcess, isClockInSync);

  // Extract txId for gate checks
  const hasTxId = Boolean(props?.speculativeTransactionId);

  // [DEBUG] INIT gates snapshot (one-shot)
  logOnce('[INIT_GATES.hasToken]', hasToken);
  logOnce('[INIT_GATES.hasUser]', !!currentUser?.id);
  logOnce('[INIT_GATES.orderOk]', !!orderResult?.ok);
  logOnce('[INIT_GATES.hasProcess]', !!txProcess);
  logOnce('[INIT_GATES.hasTxId]', !!props?.speculativeTransactionId, props?.speculativeTransactionId);

  // [DEBUG] TX_STATE snapshot (one-shot)
  logOnce('[TX_STATE]', {
    hasTxId: !!props?.speculativeTransactionId,
    txId: props?.speculativeTransactionId,
  });

  // Allow showing page when currentUser is still being downloaded,
  // but show payment form only when user info is loaded.
  const showPaymentForm = !!(
    currentUser &&
    !listingNotFound &&
    !initiateOrderError &&
    !speculateTransactionError &&
    !retrievePaymentIntentError &&
    !isPaymentExpired
  );
  
  // Ensure Stripe form mounts once we have a speculative tx
  const hasSpeculativeTx = Boolean(props?.speculativeTransactionId);
  const showStripeForm = hasSpeculativeTx && !!txProcess;

  const firstImage = listing?.images?.length > 0 ? listing.images[0] : null;

  const listingLink = (
    <NamedLink
      name="ListingPage"
      params={{ id: listing?.id?.uuid, slug: createSlug(listingTitle) }}
    >
      <FormattedMessage id="CheckoutPage.errorlistingLinkText" />
    </NamedLink>
  );

  const errorMessages = getErrorMessages(
    listingNotFound,
    initiateOrderError,
    isPaymentExpired,
    retrievePaymentIntentError,
    speculateTransactionError,
    listingLink,
    handleRetrySpeculation
  );

  const txTransitions = existingTransaction?.attributes?.transitions || [];
  const hasInquireTransition = txTransitions.find(tr => tr.transition === transitions.INQUIRE);
  const showInitialMessageInput = !hasInquireTransition;

  // Get first and last name of the current user and use it in the StripePaymentForm to autofill the name field
  const userName = currentUser?.attributes?.profile
    ? `${currentUser.attributes.profile.firstName} ${currentUser.attributes.profile.lastName}`
    : null;

  // If paymentIntent status is not waiting user action,
  // confirmCardPayment has been called previously.
  const hasPaymentIntentUserActionsDone =
    paymentIntent && STRIPE_PI_USER_ACTIONS_DONE_STATUSES.includes(paymentIntent.status);

  // If your marketplace works mostly in one country you can use initial values to select country automatically
  // e.g. {country: 'FI'}

  // Note: StripePaymentForm handles its own comprehensive initialValues setup
  // We only pass userName for legacy compatibility
  const initialValuesForStripePayment = { 
    name: userName, 
    recipientName: userName
  };
  
  // Loosen form-mounting conditions to ensure UI appears
  // (Once working, can re-tighten if needed)
  const askShippingDetails = orderData?.deliveryMethod === 'shipping' && !!txProcess;

  // Check if the listing currency is compatible with Stripe for the specified transaction process.
  // This function validates the currency against the transaction process requirements and
  // ensures it is supported by Stripe, as indicated by the 'stripe' parameter.
  // If using a transaction process without any stripe actions, leave out the 'stripe' parameter.
  const isStripeCompatibleCurrency = isValidCurrencyForTransactionProcess(
    transactionProcessAlias,
    listing.attributes.price.currency,
    'stripe'
  );

  // Don't render if orderParams are invalid (prevents Stripe mounting with bad data)
  if (!orderResult.ok) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Checkout] Cannot render - invalid orderParams:', orderResult.reason);
    }
    return (
      <Page title={title} scrollingDisabled={scrollingDisabled}>
        <CustomTopbar intl={intl} linkToExternalSite={config?.topbar?.logoLink} />
        <div className={css.contentContainer}>
          <section className={css.incompatibleCurrency}>
            <H4 as="h1" className={css.heading}>
              <FormattedMessage id="CheckoutPage.incompleteBookingData" />
            </H4>
          </section>
        </div>
      </Page>
    );
  }

  // Render an error message if the listing is using a non Stripe supported currency
  // and is using a transaction process with Stripe actions (default-booking or default-purchase)
  if (!isStripeCompatibleCurrency) {
    return (
      <Page title={title} scrollingDisabled={scrollingDisabled}>
        <CustomTopbar intl={intl} linkToExternalSite={config?.topbar?.logoLink} />
        <div className={css.contentContainer}>
          <section className={css.incompatibleCurrency}>
            <H4 as="h1" className={css.heading}>
              <FormattedMessage id="CheckoutPage.incompatibleCurrency" />
            </H4>
          </section>
        </div>
      </Page>
    );
  }

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <CustomTopbar intl={intl} linkToExternalSite={config?.topbar?.logoLink} />
      <div className={css.contentContainer}>
        <MobileListingImage
          listingTitle={listingTitle}
          author={listing?.author}
          firstImage={firstImage}
          layoutListingImageConfig={config.layout.listingImage}
        />
        <div className={css.orderFormContainer}>
          <div className={css.headingContainer}>
            <H3 as="h1" className={css.heading}>
              {title}
            </H3>
            <H4 as="h2" className={css.detailsHeadingMobile}>
              <FormattedMessage id="CheckoutPage.listingTitle" values={{ listingTitle }} />
            </H4>
          </div>
          <MobileOrderBreakdown
            speculateTransactionErrorMessage={errorMessages.speculateTransactionErrorMessage}
            breakdown={breakdown}
          />
          <section className={css.paymentContainer}>
            {errorMessages.initiateOrderErrorMessage}
            {errorMessages.listingNotFoundErrorMessage}
            {errorMessages.speculateErrorMessage}
            {errorMessages.retrievePaymentIntentErrorMessage}
            {errorMessages.paymentExpiredMessage}
            
            {/* 🔐 PROD HOTFIX: Safety valve - show banner if PI secret is invalid */}
            {speculateStatus === 'succeeded' && props.speculativeTransactionId && !stripeClientSecret && (
              <div style={{ 
                padding: '16px', 
                marginBottom: '16px', 
                backgroundColor: '#FFF3CD', 
                borderRadius: '4px',
                border: '1px solid #FFEAA7',
                textAlign: 'center'
              }}>
                <p style={{ margin: 0, color: '#856404', fontSize: '14px' }}>
                  <FormattedMessage 
                    id="CheckoutPage.paymentTemporarilyUnavailable" 
                    defaultMessage="Payment is temporarily unavailable. Please try again shortly or contact support." 
                  />
                </p>
              </div>
            )}
            
            {/* Show loading indicator while speculation is in progress */}
            {speculativeInProgress && !props.speculativeTransactionId && (
              <div style={{ 
                padding: '16px', 
                marginBottom: '16px', 
                backgroundColor: '#f0f4f8', 
                borderRadius: '4px',
                textAlign: 'center'
              }}>
                <p style={{ margin: 0, color: '#4A5568' }}>
                  <FormattedMessage 
                    id="CheckoutPage.initializingTransaction" 
                    defaultMessage="Initializing transaction..." 
                  />
                </p>
              </div>
            )}

            {showPaymentForm ? (
              <>
                {(() => {
                  // Define submit gates clearly
                  const hasSpeculativeTx = Boolean(props?.speculativeTransactionId);
                  const canSubmit =
                    hasSpeculativeTx &&
                    stripeReady &&
                    paymentElementComplete &&
                    formValid &&
                    !submitting;

                  const disabled = !canSubmit;
                  const disabledReason = !hasSpeculativeTx ? 'Waiting for transaction initialization…'
                    : !stripeReady ? 'Setting up secure payment…'
                    : !paymentElementComplete ? 'Enter payment details…'
                    : !formValid ? 'Complete required fields…'
                    : submitting ? 'Processing…'
                    : null;

                  return (
                    <>
                      {disabled && (
                        <div style={{ 
                          fontSize: 12, 
                          opacity: 0.7, 
                          marginTop: 8, 
                          padding: '8px 12px',
                          backgroundColor: '#f7fafc',
                          borderRadius: '4px',
                          border: '1px solid #e2e8f0'
                        }}>
                          Can't submit yet: <code style={{ 
                            backgroundColor: '#fff', 
                            padding: '2px 6px', 
                            borderRadius: '3px',
                            fontSize: 11
                          }}>{disabledReason}</code>
                        </div>
                      )}
                    </>
                  );
                })()}
                {showStripeForm ? (
                <StripePaymentForm
                  className={css.paymentForm}
                  onSubmit={values =>
                    handleSubmit(values, txProcess, props, stripe, submitting, setSubmitting)
                  }
                  inProgress={submitting}
                  formId="CheckoutPagePaymentForm"
                  authorDisplayName={listing?.author?.attributes?.profile?.displayName}
                  showInitialMessageInput={showInitialMessageInput}
                  initialValues={initialValuesForStripePayment}
                  initiateOrderError={initiateOrderError}
                  confirmCardPaymentError={confirmCardPaymentError}
                  confirmPaymentError={confirmPaymentError}
                  hasHandledCardPayment={hasPaymentIntentUserActionsDone}
                  loadingData={!stripeCustomerFetched}
                  defaultPaymentMethod={
                    hasDefaultPaymentMethod(stripeCustomerFetched, currentUser)
                      ? currentUser.stripeCustomer.defaultPaymentMethod
                      : null
                  }
                  paymentIntent={paymentIntent}
                  onStripeInitialized={stripe => setStripe(stripe)}
                  onStripeElementMounted={(v) => { 
                    console.log('[Stripe] element mounted:', v);
                    setStripeElementMounted(!!v);
                  }}
                  onFormValuesChange={handleFormValuesChange}
                  onPaymentElementChange={setPaymentElementComplete}
                  onFormValidityChange={(v) => { 
                    console.log('[Form] parent sees valid:', v); 
                    setFormValid(v); 
                  }}
                  requireInPaymentForm={false}  // billing/shipping collected outside this form
                  submitInProgress={submitting}  // spinner only
                  submitDisabled={(() => {
                    // Use same gating logic as above
                    const hasSpeculativeTx = Boolean(props?.speculativeTransactionId);
                    const canSubmit =
                      hasSpeculativeTx &&
                      stripeReady &&
                      paymentElementComplete &&
                      formValid &&
                      !submitting;
                    return !canSubmit;
                  })()}
                  askShippingDetails={askShippingDetails}
                  showPickUplocation={orderData?.deliveryMethod === 'pickup'}
                  listingLocation={listing?.attributes?.publicData?.location}
                  totalPrice={totalPrice}
                  locale={config.localization.locale}
                  stripePublishableKey={config.stripe.publishableKey}
                  marketplaceName={config.marketplaceName}
                  isBooking={isBookingProcessAlias(transactionProcessAlias)}
                  isFuzzyLocation={config.maps.fuzzy.enabled}
                />
                ) : (
                  <div style={{ fontSize: 14, opacity: 0.7, marginTop: 16, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
                    Waiting for transaction initialization...
                  </div>
                )}
              </>
            ) : null}
          </section>
        </div>

        <DetailsSideCard
          listing={listing}
          listingTitle={listingTitle}
          author={listing?.author}
          firstImage={firstImage}
          layoutListingImageConfig={config.layout.listingImage}
          speculateTransactionErrorMessage={errorMessages.speculateTransactionErrorMessage}
          isInquiryProcess={false}
          processName={processName}
          breakdown={breakdown}
          intl={intl}
        />
      </div>
    </Page>
  );
};

// Export both named and default (loadInitialDataForStripePayments is already exported above at line 255)
export { CheckoutPageWithPayment };
export default CheckoutPageWithPayment;


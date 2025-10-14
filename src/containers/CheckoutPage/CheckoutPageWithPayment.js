import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Form as FinalForm, FormSpy } from 'react-final-form';
import deepEqual from 'fast-deep-equal';

// Import contexts and util modules
import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { pathByRouteName } from '../../util/routes';
import { isValidCurrencyForTransactionProcess } from '../../util/fieldHelpers.js';
import { propTypes } from '../../util/types';
import { ensureTransaction } from '../../util/data';
import { createSlug } from '../../util/urlHelpers';
import { isTransactionInitiateListingNotFoundError } from '../../util/errors';
import { getProcess, isBookingProcessAlias } from '../../transactions/transaction';
import { normalizePhoneE164 } from '../../util/phone';
import { IS_DEV, __DEV__, USE_PAYMENT_ELEMENT } from '../../util/envFlags';

// Import shared components
import { H3, H4, NamedLink, OrderBreakdown, Page, FieldTextInput, FieldCheckbox, InlineAlert } from '../../components';
import AddressForm from '../../components/AddressForm/AddressForm';

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

// Stripe PaymentIntent statuses, where user actions are already completed
// https://stripe.com/docs/payments/payment-intents/status
const STRIPE_PI_USER_ACTIONS_DONE_STATUSES = ['processing', 'requires_capture', 'succeeded'];

// Payment charge options
const ONETIME_PAYMENT = 'ONETIME_PAYMENT';
const PAY_AND_SAVE_FOR_LATER_USE = 'PAY_AND_SAVE_FOR_LATER_USE';
const USE_SAVED_CARD = 'USE_SAVED_CARD';

const paymentFlow = (selectedPaymentMethod, saveAfterOnetimePayment) => {
  // Payment mode could be 'replaceCard', but without explicit saveAfterOnetimePayment flag,
  // we'll handle it as one-time payment
  return selectedPaymentMethod === 'defaultCard'
    ? USE_SAVED_CARD
    : saveAfterOnetimePayment
    ? PAY_AND_SAVE_FOR_LATER_USE
    : ONETIME_PAYMENT;
};

// Helper to build customer protectedData from shipping form
const buildCustomerPD = (shipping, currentUser) => ({
  customerName: shipping?.recipientName || shipping?.name || '',
  customerStreet: shipping?.streetAddress || shipping?.street || '',
  customerStreet2: shipping?.streetAddress2 || shipping?.street2 || '',
  customerCity: shipping?.city || '',
  customerState: shipping?.state || '',
  customerZip: shipping?.zip || shipping?.postalCode || shipping?.zipCode || '',
  customerPhone: shipping?.phone || '',
  customerEmail: shipping?.email || currentUser?.attributes?.email || '',
});

const capitalizeString = s => `${s.charAt(0).toUpperCase()}${s.substr(1)}`;

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
const prefixPriceVariantProperties = priceVariant => {
  if (!priceVariant) {
    return {};
  }

  const entries = Object.entries(priceVariant).map(([key, value]) => {
    return [`priceVariant${capitalizeString(key)}`, value];
  });
  return Object.fromEntries(entries);
};

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
 * @returns orderParams.
 */
const getOrderParams = (pageData, shippingDetails, optionalPaymentParams, config, formValues = {}) => {
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
};

const fetchSpeculatedTransactionIfNeeded = (orderParams, pageData, fetchSpeculatedTransaction, prevKeyRef) => {
  const tx = pageData ? pageData.transaction : null;
  const pageDataListing = pageData.listing;
  const processName =
    tx?.attributes?.processName ||
    pageDataListing?.attributes?.publicData?.transactionProcessAlias?.split('/')[0];
  const process = processName ? getProcess(processName) : null;

  // If transaction has passed payment-pending state, speculated tx is not needed.
  const shouldFetchSpeculatedTransaction =
    !!pageData?.listing?.id &&
    !!pageData.orderData &&
    !!process &&
    !hasTransactionPassedPendingPayment(tx, process);

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
        tx?.attributes?.lastTransition === process.transitions.INQUIRE;

      const requestTransition = isInquiryInPaymentProcess
        ? process.transitions.REQUEST_PAYMENT_AFTER_INQUIRY
        : process.transitions.REQUEST_PAYMENT;
      const isPrivileged = process.isPrivileged(requestTransition);

      // 🔍 Log speculation trigger
      console.log('[CheckoutPage] Triggering speculation:', {
        listingId: pageData.listing.id?.uuid || pageData.listing.id,
        processAlias,
        processName,
        requestTransition,
        isPrivileged,
        hasBookingDates: !!(orderParams?.bookingStart && orderParams?.bookingEnd),
      });

      fetchSpeculatedTransaction(
        orderParams,
        processAlias,
        transactionId,
        requestTransition,
        isPrivileged
      );
    }
  }
};

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
export const loadInitialDataForStripePayments = ({
  pageData,
  fetchSpeculatedTransaction,
  fetchStripeCustomer,
  config,
}) => {
  // Fetch currentUser with stripeCustomer entity
  fetchStripeCustomer();

  // Fetch speculated transaction for showing price in order breakdown
  const shippingDetails = {};
  console.log('📬 shippingDetails in loadInitialData:', shippingDetails);
  const optionalPaymentParams = {};
  const orderParams = getOrderParams(pageData, shippingDetails, optionalPaymentParams, config);

  // Use a more robust guard to prevent duplicate calls
  const prevKeyRef = { current: null };
  fetchSpeculatedTransactionIfNeeded(orderParams, pageData, fetchSpeculatedTransaction, prevKeyRef);
};

const handleSubmit = async (values, process, props, stripe, submitting, setSubmitting, contactEmail, contactPhone) => {
  if (submitting) {
    return;
  }
  setSubmitting(true);

  const {
    history,
    config,
    routeConfiguration,
    speculatedTransaction,
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

  // Values now come from the unified form
  const { card, initialMessage, paymentMethod: selectedPaymentMethod, billing, shipping, shippingSameAsBilling } = values;
  const message = initialMessage; // Map initialMessage to message
  const formValues = values; // Use values directly as formValues

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

  // Normalize contact phone to E.164 format
  const normalizedContactPhone = normalizePhoneE164(contactPhone);
  console.log('📞 Contact phone normalized:', contactPhone, '→', normalizedContactPhone);

  // Determine which address to use (shipping or billing)
  const finalShipping = !!shippingSameAsBilling ? billing : shipping;
  
  // Determine which phone to use for this transaction
  // Priority: shipping.phone (if useDifferentPhone) > contactPhone
  const useShippingPhone = !shippingSameAsBilling && shipping?.useDifferentPhone;
  const normalizedShippingPhone = useShippingPhone ? normalizePhoneE164(shipping.phone) : null;
  const finalPhone = normalizedShippingPhone || normalizedContactPhone || '';
  
  console.log('📞 Phone decision:', {
    shippingSameAsBilling,
    useDifferentPhone: shipping?.useDifferentPhone,
    shippingPhone: shipping?.phone,
    normalizedShippingPhone,
    normalizedContactPhone,
    finalPhone
  });
  
  // Build customer protectedData for request-payment
  const protectedData = {
    // Contact info
    customerEmail: contactEmail?.trim() || '',
    customerPhone: finalPhone?.trim() || '',
    
    // Address fields from final shipping address (map line1->customerStreet, postalCode->customerZip)
    customerName: finalShipping?.name?.trim() || '',
    customerStreet: finalShipping?.line1?.trim() || '',
    customerStreet2: finalShipping?.line2?.trim() || '',
    customerCity: finalShipping?.city?.trim() || '',
    customerState: finalShipping?.state?.trim() || '',
    customerZip: finalShipping?.postalCode?.trim() || '',
    
    // Provider fields
    providerName: currentUser?.attributes?.profile?.displayName?.trim() || '',
    providerEmail: currentUser?.attributes?.email?.trim() || '',
    providerPhone: (currentUser?.attributes?.profile?.protectedData?.phoneNumber || 
                   currentUser?.attributes?.profile?.publicData?.phoneNumber || '').trim(),
  };

  const mergedPD = protectedData;
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
    const missingFields = [];
    if (!mergedPD.customerStreet?.trim()) missingFields.push('Street Address');
    if (!mergedPD.customerZip?.trim()) missingFields.push('ZIP Code');
    
    setSubmitting(false);
    throw new Error(`Please fill in the required address fields: ${missingFields.join(', ')}`);
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

  // Map form values to format expected by getBillingDetails
  const billingForGetBillingDetails = {
    name: billing?.name || '',
    addressLine1: billing?.line1 || '',
    addressLine2: billing?.line2 || '',
    postal: billing?.postalCode || '',
    city: billing?.city || '',
    state: billing?.state || '',
    country: billing?.country || 'US',
    email: contactEmail || '',
  };
  
  // Pre-submit logging for debugging
  console.log('[checkout][pre-submit]', {
    usePaymentElement,
    hasClientSecret: !!stripePaymentIntentClientSecret,
    hasElements: !!elements,
    paymentElementComplete,
  });

  // Construct requestPaymentParams before calling processCheckoutWithPayment
  const requestPaymentParams = {
    pageData,
    speculatedTransaction,
    stripe,
    card,
    elements, // Add elements instance for PaymentElement
    usePaymentElement, // Add flag for PaymentElement flow
    billingDetails: getBillingDetails(billingForGetBillingDetails, currentUser),
    message,
    paymentIntent,
    hasPaymentIntentUserActionsDone,
    stripePaymentMethodId,
    process,
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
    returnUrl: `${window.location.origin}/order/${pageData?.transaction?.id?.uuid || 'pending'}/details`,
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
};

/**
 * Validate checkout form values
 */
const validateCheckout = values => {
  const errors = {};
  
  // Validate contact info
  if (!values.contactEmail?.trim()) {
    errors.contactEmail = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contactEmail.trim())) {
    errors.contactEmail = 'Invalid email format';
  }
  
  if (!values.contactPhone?.trim()) {
    errors.contactPhone = 'Phone is required';
  } else if (!/^(\+1\d{10}|\d{10})$/.test(values.contactPhone.trim().replace(/[^\d+]/g, ''))) {
    errors.contactPhone = 'Phone must be 10 digits or +1 format';
  }
  
  // Validate billing address
  const b = values.billing || {};
  if (!b.name?.trim()) errors['billing.name'] = 'Name is required';
  if (!b.line1?.trim()) errors['billing.line1'] = 'Street is required';
  if (!b.city?.trim()) errors['billing.city'] = 'City is required';
  if (!b.state?.trim()) errors['billing.state'] = 'State is required';
  if (!b.postalCode?.trim()) {
    errors['billing.postalCode'] = 'ZIP is required';
  } else if (!/^\d{5,}$/.test(b.postalCode.trim())) {
    errors['billing.postalCode'] = 'ZIP must be at least 5 digits';
  }
  
  // Validate shipping address if different from billing
  const same = !!values.shippingSameAsBilling; // true when checked
  if (!same) {
    const s = values.shipping || {};
    if (!s.name?.trim()) errors['shipping.name'] = 'Name is required';
    if (!s.line1?.trim()) errors['shipping.line1'] = 'Street is required';
    if (!s.city?.trim()) errors['shipping.city'] = 'City is required';
    if (!s.state?.trim()) errors['shipping.state'] = 'State is required';
    if (!s.postalCode?.trim()) {
      errors['shipping.postalCode'] = 'ZIP is required';
    } else if (!/^\d{5,}$/.test(s.postalCode.trim())) {
      errors['shipping.postalCode'] = 'ZIP must be at least 5 digits';
    }
    
    // Validate shipping phone if "Use different phone for delivery" is checked
    if (s.useDifferentPhone) {
      const phoneDigits = (s.phone || '').trim().replace(/[^\d+]/g, '');
      if (!phoneDigits) {
        errors['shipping.phone'] = 'Delivery phone is required';
      } else if (!/^(\+1\d{10}|\d{10})$/.test(phoneDigits)) {
        errors['shipping.phone'] = 'Phone must be 10 digits or +1 format';
      }
    }
  }
  
  return errors;
};

/**
 * A component that renders the checkout page with payment.
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.scrollingDisabled - Whether the page should scroll
 * @param {string} props.speculateTransactionError - The error message for the speculate transaction
 * @param {propTypes.transaction} props.speculatedTransaction - The speculated transaction
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
export const CheckoutPageWithPayment = props => {
  const [submitting, setSubmitting] = useState(false);
  // Initialized stripe library is saved to state - if it's needed at some point here too.
  const [stripe, setStripe] = useState(null);
  // Elements instance (needed for PaymentElement)
  const [elements, setElements] = useState(null);
  // Flag to determine which Stripe flow to use (from env)
  const usePaymentElement = USE_PAYMENT_ELEMENT;
  // Payment element completion state
  const [paymentElementComplete, setPaymentElementComplete] = useState(false);
  const [stripeElementMounted, setStripeElementMounted] = useState(false);
  const stripeReady = !!stripeElementMounted;
  
  // Log which payment flow is active
  console.log('[checkout] Payment flow:', usePaymentElement ? 'PaymentElement' : 'CardElement');
  
  // Ref to prevent speculative transaction loops
  const prevSpecKeyRef = useRef(null);
  // Ref to throttle disabled gates logging
  const lastReasonRef = useRef(null);

  const {
    scrollingDisabled,
    speculateTransactionError,
    speculativeTransaction, // ✅ normalized name from mapStateToProps
    hasSpeculativeTx, // ✅ boolean flag for valid speculative tx
    speculateStatus, // ✅ 'idle' | 'running' | 'succeeded' | 'failed'
    speculateError, // ✅ { status, code, message }
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
    onReSpeculate,
  } = props;

  // Memoize initial values - only derive ONCE on mount to prevent form resets
  // Do NOT include volatile deps like clientSecret, speculateStatus, or pageData
  const seedInitialValues = useMemo(() => {
    // Build the initial values from existing protected data or defaults
    const existingPD = pageData?.transaction?.attributes?.protectedData || {};
    const prefillEmail = currentUser?.attributes?.email || '';
    const prefillPhone = currentUser?.attributes?.profile?.protectedData?.phoneNumber || 
                        currentUser?.attributes?.profile?.publicData?.phoneNumber || '';
    
    const initialValues = {
      contactEmail: prefillEmail || '',
      contactPhone: prefillPhone || '',
      shippingSameAsBilling: false,
      billing: {
        name: existingPD?.customerName || '',
        line1: existingPD?.customerStreet || '',
        line2: existingPD?.customerStreet2 || '',
        city: existingPD?.customerCity || '',
        state: existingPD?.customerState || '',
        postalCode: existingPD?.customerZip || '',
        country: 'US',
      },
      shipping: {
        name: existingPD?.customerName || '',
        line1: existingPD?.customerStreet || '',
        line2: existingPD?.customerStreet2 || '',
        city: existingPD?.customerCity || '',
        state: existingPD?.customerState || '',
        postalCode: existingPD?.customerZip || '',
        country: 'US',
        useDifferentPhone: false,
        phone: '',
      },
    };

    console.log('[QA] seedInitialValues created (should only happen once):', {
      billing_keys: Object.keys(initialValues.billing || {}),
      shipping_keys: Object.keys(initialValues.shipping || {}),
    });

    return initialValues;
  }, []); // Empty array - only derive once on mount

  // Handle speculative transaction initiation with proper guards (one-shot)
  useEffect(() => {
    const listingId = pageData?.listing?.id?.uuid || pageData?.listing?.id;
    const bookingDates = pageData?.orderData?.bookingDates;
    const hasRequiredData = listingId && bookingDates?.bookingStart && bookingDates?.bookingEnd;

    if (!hasRequiredData) {
      console.log('[CheckoutPage][useEffect] Missing required data for speculation:', {
        listingId: Boolean(listingId),
        bookingStart: Boolean(bookingDates?.bookingStart),
        bookingEnd: Boolean(bookingDates?.bookingEnd),
      });
      return;
    }

    // Only trigger speculation if we don't have a valid tx and we're not currently running
    // This allows retry after failure
    if (!hasSpeculativeTx && speculateStatus !== 'running') {
      const orderParams = getOrderParams(pageData, {}, {}, config, {});
      fetchSpeculatedTransactionIfNeeded(
        orderParams,
        pageData,
        props.fetchSpeculatedTransaction,
        prevSpecKeyRef // <-- use the stable ref
      );
    }
    // depend on listingId and bookingDates, so speculation triggers when data is ready
  }, [pageData?.listing?.id, pageData?.orderData?.bookingDates, hasSpeculativeTx, speculateStatus]);

  // Throttled logging for disabled gates
  useEffect(() => {
    const gates = { 
      hasSpeculativeTx, // ✅ Use the explicit flag from reducer
      stripeReady, 
      paymentElementComplete, 
      notSubmitting: !submitting, 
      notSpeculating: speculateStatus !== 'running'
    };
    const disabledReason = Object.entries(gates).find(([, ok]) => !ok)?.[0] || null;
    if (disabledReason !== lastReasonRef.current) {
      lastReasonRef.current = disabledReason;
      console.log('[Checkout] submit disabled gates:', gates, 'disabledReason:', disabledReason, 'speculateStatus:', speculateStatus);
    }
  }, [hasSpeculativeTx, stripeReady, paymentElementComplete, submitting, speculateStatus]);

  // QA logging: detect if PaymentElement changes trigger form resets (guard)
  useEffect(() => {
    if (paymentElementComplete) {
      console.debug('[QA] PaymentElement complete detected. If form values clear after this, investigate form reinitialization.');
    }
  }, [paymentElementComplete]);

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

  // Extract Stripe Payment Intent client secret for PaymentElement
  const hasPaymentIntents = existingTransaction?.attributes?.protectedData?.stripePaymentIntents;
  const stripePaymentIntentClientSecret = hasPaymentIntents
    ? existingTransaction.attributes.protectedData.stripePaymentIntents.default?.stripePaymentIntentClientSecret
    : null;

  const process = processName ? getProcess(processName) : null;
  const transitions = process.transitions;
  const isPaymentExpired = hasPaymentExpired(existingTransaction, process, isClockInSync);

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
    listingLink
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
  const askShippingDetails =
    orderData?.deliveryMethod === 'shipping' &&
    !hasTransactionPassedPendingPayment(existingTransaction, process);

  // Check if the listing currency is compatible with Stripe for the specified transaction process.
  // This function validates the currency against the transaction process requirements and
  // ensures it is supported by Stripe, as indicated by the 'stripe' parameter.
  // If using a transaction process without any stripe actions, leave out the 'stripe' parameter.
  const isStripeCompatibleCurrency = isValidCurrencyForTransactionProcess(
    transactionProcessAlias,
    listing.attributes.price.currency,
    'stripe'
  );

  // Handler for retrying speculation after failure
  const handleRetrySpeculation = useCallback(() => {
    const orderParams = getOrderParams(pageData, {}, {}, config, {});
    const processAlias = pageData.listing.attributes.publicData?.transactionProcessAlias;
    const transactionId = existingTransaction ? existingTransaction.id : null;
    const isInquiryInPaymentProcess =
      existingTransaction?.attributes?.lastTransition === process.transitions.INQUIRE;
    const requestTransition = isInquiryInPaymentProcess
      ? process.transitions.REQUEST_PAYMENT_AFTER_INQUIRY
      : process.transitions.REQUEST_PAYMENT;
    const isPrivileged = process.isPrivileged(requestTransition);
    
    onReSpeculate(orderParams, processAlias, transactionId, requestTransition, isPrivileged);
  }, [pageData, config, existingTransaction, process, onReSpeculate]);

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

            {/* Speculation Error Banner with Retry */}
            {speculateStatus === 'failed' && (
              <InlineAlert
                type="error"
                title="We couldn't prepare your payment"
                message={speculateError?.message || 'There was a problem preparing your booking. Please try again.'}
                actionText="Try again"
                onAction={handleRetrySpeculation}
              />
            )}

            {showPaymentForm ? (
              <>
                <FinalForm
                      initialValues={seedInitialValues}
                      keepDirtyOnReinitialize={true}
                      initialValuesEqual={deepEqual}
                      onSubmit={(values) => {
                        // This is the unified submit handler - extract contact and call Stripe payment
                        const contactEmail = values.contactEmail;
                        const contactPhone = values.contactPhone;
                        
                        // Call the existing handleSubmit with contact info
                        return handleSubmit(
                          values, 
                          process, 
                          props, 
                          stripe, 
                          submitting, 
                          setSubmitting, 
                          contactEmail, 
                          contactPhone
                        );
                      }}
                      validate={validateCheckout}
                      subscription={{ submitting: true, pristine: true, valid: true, values: true }}
                      render={({ handleSubmit, values, valid, submitting: formSubmitting, form }) => {
                        const stripeReady = !!stripeElementMounted;
                        
                        // ✅ Use hasSpeculativeTx from props/reducer instead of computing from transaction
                        const submitDisabled = !hasSpeculativeTx || !stripeReady || !paymentElementComplete || !valid || submitting || speculateStatus === 'running';

                        // QA Helper Line - only show when explicitly enabled
                        const showQa = 
                          (IS_DEV || __DEV__) && 
                          (typeof process !== 'undefined' && process?.env?.REACT_APP_SHOW_QA_STATE === '1');

                        return (
                          <form onSubmit={handleSubmit}>
                            {/* QA Helper Line (explicit opt-in only) */}
                            {showQa && (
                              <div style={{ 
                                padding: '8px 12px', 
                                marginBottom: '16px', 
                                backgroundColor: '#f3f4f6', 
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                color: '#6b7280'
                              }}>
                                <strong>QA State:</strong>{' '}
                                spec: {speculateStatus} | hasTx: {String(hasSpeculativeTx)} | stripeReady: {String(stripeReady)} | element: {String(paymentElementComplete)} | valid: {String(valid)}
                              </div>
                            )}
                            
                            {/* Contact Info Section */}
                            <div className={css.contactInfoSection}>
                              <H3 as="h3" className={css.sectionHeading}>
                                <FormattedMessage id="CheckoutPage.contactInfoHeading" defaultMessage="Contact Information" />
                              </H3>
                              <div className={css.contactFields}>
                                <FieldTextInput
                                  id="contactEmail"
                                  name="contactEmail"
                                  type="email"
                                  label={intl.formatMessage({ id: 'CheckoutPage.contactEmailLabel', defaultMessage: 'Email Address' })}
                                  placeholder={intl.formatMessage({ id: 'CheckoutPage.contactEmailPlaceholder', defaultMessage: 'your@email.com' })}
                                  autoComplete="email"
                                />
                                <FieldTextInput
                                  id="contactPhone"
                                  name="contactPhone"
                                  type="tel"
                                  label={intl.formatMessage({ id: 'CheckoutPage.contactPhoneLabel', defaultMessage: 'Phone Number' })}
                                  placeholder={intl.formatMessage({ id: 'CheckoutPage.contactPhonePlaceholder', defaultMessage: '(555) 123-4567' })}
                                  autoComplete="tel"
                                />
                              </div>
                            </div>

                            {/* Billing Address Section */}
                            <div className={css.billingSection}>
                              <H3 as="h3" className={css.sectionHeading}>
                                <FormattedMessage id="CheckoutPage.billingAddressHeading" defaultMessage="Billing Address" />
                              </H3>
                              <AddressForm
                                namespace="billing"
                                requiredFields={{ name: true, line1: true, city: true, state: true, postalCode: true, country: true }}
                                countryAfterZipForUSCA
                                showEmail={false}
                                showPhone={false}
                              />
                            </div>

                            {/* Shipping Address Section */}
                            <div className={css.shippingSection}>
                              <H3 as="h3" className={css.sectionHeading}>
                                <FormattedMessage id="CheckoutPage.shippingAddressHeading" defaultMessage="Shipping Address" />
                              </H3>
                              <FieldCheckbox
                                id="shippingSameAsBilling"
                                name="shippingSameAsBilling"
                                label={intl.formatMessage({ id: 'CheckoutPage.shippingSameAsBilling', defaultMessage: 'Same as billing address' })}
                              />
                              {!Boolean(values.shippingSameAsBilling) && (
                                <div className={css.shippingFields}>
                                  <AddressForm
                                    namespace="shipping"
                                    requiredFields={{ name: true, line1: true, city: true, state: true, postalCode: true, country: true }}
                                    countryAfterZipForUSCA
                                    showEmail={false}
                                    showPhone={false}
                                  />
                                  
                                  {/* Phone toggle + field */}
                                  <div className={css.deliveryPhoneSection}>
                                    <FieldCheckbox
                                      id="shipping.useDifferentPhone"
                                      name="shipping.useDifferentPhone"
                                      label={intl.formatMessage({ id: 'CheckoutPage.useDifferentPhoneForDelivery', defaultMessage: 'Use different phone for delivery' })}
                                    />
                                    {values.shipping?.useDifferentPhone && (
                                      <FieldTextInput
                                        id="shipping.phone"
                                        name="shipping.phone"
                                        type="tel"
                                        label={intl.formatMessage({ id: 'CheckoutPage.deliveryPhoneLabel', defaultMessage: 'Delivery Phone' })}
                                        placeholder={intl.formatMessage({ id: 'CheckoutPage.deliveryPhonePlaceholder', defaultMessage: '+14155550123' })}
                                        autoComplete="tel"
                                      />
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* QA FormSpy - Monitor for unexpected value changes */}
                            <FormSpy subscription={{ values: true }}>
                              {({ values }) => {
                                // Log field counts to detect clears
                                if (__DEV__) {
                                  const billingKeys = Object.keys(values?.billing || {}).filter(k => values.billing[k]);
                                  const shippingKeys = Object.keys(values?.shipping || {}).filter(k => values.shipping[k]);
                                  if (paymentElementComplete && (billingKeys.length < 3 || shippingKeys.length < 3)) {
                                    console.debug('[QA] Warning: Form values appear incomplete after PaymentElement complete:', {
                                      billing_filled: billingKeys,
                                      shipping_filled: shippingKeys,
                                    });
                                  }
                                }
                                return null;
                              }}
                            </FormSpy>

                            {/* Stripe Payment Form - receives form state via FormSpy */}
                            <FormSpy subscription={{ values: true, valid: true, submitting: true, errors: true, invalid: true }}>
                              {({ values: ffValues, valid: ffValid, submitting: ffSubmitting, errors: ffErrors, invalid: ffInvalid }) => (
                                <StripePaymentForm
                                  className={css.paymentForm}
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
                                  onElementsCreated={setElements}
                                  onStripeElementMounted={(v) => { 
                                    console.log('[Stripe] element mounted:', v);
                                    setStripeElementMounted(!!v);
                                  }}
                                  onPaymentElementChange={setPaymentElementComplete}
                                  usePaymentElement={usePaymentElement}
                                  elements={elements}
                                  stripe={stripe}
                                  clientSecret={stripePaymentIntentClientSecret}
                                  submitInProgress={submitting}
                                  submitDisabled={submitDisabled}
                                  askShippingDetails={askShippingDetails}
                                  showPickUplocation={orderData?.deliveryMethod === 'pickup'}
                                  listingLocation={listing?.attributes?.publicData?.location}
                                  totalPrice={totalPrice}
                                  locale={config.localization.locale}
                                  stripePublishableKey={config.stripe.publishableKey}
                                  marketplaceName={config.marketplaceName}
                                  isBooking={isBookingProcessAlias(transactionProcessAlias)}
                                  isFuzzyLocation={config.maps.fuzzy.enabled}
                                  contactEmail={ffValues?.contactEmail}
                                  contactPhone={ffValues?.contactPhone}
                                  values={ffValues}
                                  parentValid={ffValid}
                                  parentSubmitting={ffSubmitting}
                                  parentErrors={ffErrors}
                                  parentInvalid={ffInvalid}
                                />
                              )}
                            </FormSpy>
                          </form>
                        );
                      }}
                    />
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

export default CheckoutPageWithPayment;

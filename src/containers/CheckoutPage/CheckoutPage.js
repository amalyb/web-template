import React, { useEffect, useState, useRef } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { useHistory } from 'react-router-dom';
import { useIntl } from 'react-intl';
import { useSelector } from 'react-redux';
import Decimal from 'decimal.js';

import { useConfiguration } from '../../context/configurationContext';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { userDisplayNameAsString } from '../../util/data';
import { types as sdkTypes } from '../../util/sdkLoader';
import {
  NO_ACCESS_PAGE_INITIATE_TRANSACTIONS,
  NO_ACCESS_PAGE_USER_PENDING_APPROVAL,
} from '../../util/urlHelpers';
import { hasPermissionToInitiateTransactions, isUserAuthorized } from '../../util/userHelpers';
import { isErrorNoPermissionForInitiateTransactions } from '../../util/errors';
import { INQUIRY_PROCESS_NAME, resolveLatestProcessName } from '../../transactions/transaction';

import { isScrollingDisabled } from '../../ducks/ui.duck';
import { confirmCardPayment, retrievePaymentIntent } from '../../ducks/stripe.duck';
import { savePaymentMethod } from '../../ducks/paymentMethods.duck';
// Import from shared to break circular dependency
import { selectHasFetchedCurrentUser } from './shared/selectors';

// Direct imports to avoid circular deps via barrel
import NamedRedirect from '../../components/NamedRedirect/NamedRedirect';
import Page from '../../components/Page/Page';
import { storeData, clearData, handlePageData } from './CheckoutPageSessionHelpers';

import {
  initiateOrder,
  setInitialValues,
  speculateTransaction,
  stripeCustomer,
  confirmPayment,
  sendMessage,
  initiateInquiryWithoutPayment,
  initiatePrivilegedSpeculativeTransactionIfNeeded,
} from './CheckoutPage.duck';

import CustomTopbar from './CustomTopbar';
import CheckoutPageWithPayment, {
  loadInitialDataForStripePayments,
} from './CheckoutPageWithPayment';
import CheckoutPageWithInquiryProcess from './CheckoutPageWithInquiryProcess';

const STORAGE_KEY = 'CheckoutPage';
const NIGHT_IN_MINUTES = 1440;

const onSubmitCallback = () => {
  clearData(STORAGE_KEY);
};

const getProcessName = pageData => {
  const { transaction, listing } = pageData || {};
  const processName = transaction?.id
    ? transaction?.attributes?.processName
    : listing?.id
    ? listing?.attributes?.publicData?.transactionProcessAlias?.split('/')[0]
    : null;
  return resolveLatestProcessName(processName);
};

const getDiscountedPriceFromVariants = (priceVariants, nights) => {
  const minutes = nights * NIGHT_IN_MINUTES;
  const match = priceVariants?.find(v => v.bookingLengthInMinutes === minutes);
  return match?.priceInSubunits || null;
};

const EnhancedCheckoutPage = props => {
  const [pageData, setPageData] = useState({});
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const config = useConfiguration();
  const routeConfiguration = useRouteConfiguration();
  const intl = useIntl();
  const history = useHistory();

  // Use selector to check if current user with Stripe customer has been fetched
  const hasFetchedStripeCustomer = useSelector(selectHasFetchedCurrentUser);
  
  useEffect(() => {
    const {
      currentUser,
      orderData,
      listing,
      transaction,
      fetchSpeculatedTransaction,
      fetchStripeCustomer,
    } = props;
    
    // ✅ HYDRATE orderData from sessionStorage if missing from location.state
    const ORDER_KEY = 'sherbrt.checkout.orderData.v1';
    let hydratedOrderData = orderData;
    let hydratedListing = listing;
    let hydratedTransaction = transaction;
    
    if (!orderData || !listing) {
      try {
        const storedData = sessionStorage.getItem(ORDER_KEY);
        if (storedData) {
          // Use proper SDK deserialization to handle UUID, Money, and Decimal types
          const reviver = (k, v) => {
            if (v && typeof v === 'object' && v._serializedType === 'SerializableDate') {
              return new Date(v.date);
            } else if (v && typeof v === 'object' && v._serializedType === 'SerializableDecimal') {
              return new Decimal(v.decimal);
            }
            return sdkTypes.reviver(k, v);
          };
          const parsed = JSON.parse(storedData, reviver);
          hydratedOrderData = hydratedOrderData || parsed.orderData;
          hydratedListing = hydratedListing || parsed.listing;
          hydratedTransaction = hydratedTransaction || parsed.transaction;
          console.log('✅ Hydrated orderData from sessionStorage:', ORDER_KEY);
        }
      } catch (e) {
        console.warn('⚠️ Failed to hydrate orderData from sessionStorage:', e);
      }
    }
    
    const initialData = { 
      orderData: hydratedOrderData, 
      listing: hydratedListing, 
      transaction: hydratedTransaction 
    };
    console.log('🚨 orderData in CheckoutPage.js:', hydratedOrderData);
    const data = handlePageData(initialData, STORAGE_KEY, history);
    setPageData(data || {});
    setIsDataLoaded(true);

    // ⚠️ DISABLED: Moved to CheckoutPageWithPayment to prevent duplicate initiation
    // The child component now handles all initiation via onInitiatePrivilegedSpeculativeTransaction
    // This prevents the render loop caused by multiple initiation paths
    // if (isUserAuthorized(currentUser)) {
    //   if (getProcessName(data) !== INQUIRY_PROCESS_NAME) {
    //     loadInitialDataForStripePayments({
    //       pageData: data || {},
    //       fetchSpeculatedTransaction,
    //       fetchStripeCustomer,
    //       config,
    //     });
    //   }
    // }

    // Still need to fetch Stripe customer for saved payment methods
    // Guard: only fetch if we haven't already fetched the current user with stripe customer
    if (isUserAuthorized(currentUser) && !hasFetchedStripeCustomer) {
      fetchStripeCustomer();
    }
  }, [hasFetchedStripeCustomer]);

  const {
    currentUser,
    params,
    scrollingDisabled,
    speculateTransactionInProgress,
    onInquiryWithoutPayment,
    initiateOrderError,
  } = props;
  const processName = getProcessName(pageData);
  const isInquiryProcess = processName === INQUIRY_PROCESS_NAME;

  const listing = pageData?.listing;
  const isOwnListing = currentUser?.id && listing?.author?.id?.uuid === currentUser?.id?.uuid;
  const hasRequiredData = !!(listing?.id && listing?.author?.id && processName);
  const shouldRedirect = isDataLoaded && !(hasRequiredData && !isOwnListing);
  const shouldRedirectUnathorizedUser = isDataLoaded && !isUserAuthorized(currentUser);
  const shouldRedirectNoTransactionRightsUser =
    isDataLoaded &&
    (!hasPermissionToInitiateTransactions(currentUser) ||
      isErrorNoPermissionForInitiateTransactions(initiateOrderError));

  if (shouldRedirect) {
    console.error('Missing or invalid data for checkout, redirecting back to listing page.', {
      listing,
    });
    return <NamedRedirect name="ListingPage" params={params} />;
  } else if (shouldRedirectUnathorizedUser) {
    return (
      <NamedRedirect
        name="NoAccessPage"
        params={{ missingAccessRight: NO_ACCESS_PAGE_USER_PENDING_APPROVAL }}
      />
    );
  } else if (shouldRedirectNoTransactionRightsUser) {
    return (
      <NamedRedirect
        name="NoAccessPage"
        params={{ missingAccessRight: NO_ACCESS_PAGE_INITIATE_TRANSACTIONS }}
      />
    );
  }

  const listingTitle = listing?.attributes?.title;
  const authorDisplayName = userDisplayNameAsString(listing?.author, '');
  const title = processName
    ? intl.formatMessage(
        { id: `CheckoutPage.${processName}.title` },
        { listingTitle, authorDisplayName }
      )
    : 'Checkout page is loading data';

  return processName && isInquiryProcess ? (
    <CheckoutPageWithInquiryProcess
      config={config}
      routeConfiguration={routeConfiguration}
      intl={intl}
      history={history}
      processName={processName}
      pageData={pageData}
      listingTitle={listingTitle}
      title={title}
      onInquiryWithoutPayment={onInquiryWithoutPayment}
      onSubmitCallback={onSubmitCallback}
      {...props}
    />
  ) : processName && !isInquiryProcess && !speculateTransactionInProgress ? (
    <CheckoutPageWithPayment
      config={config}
      routeConfiguration={routeConfiguration}
      intl={intl}
      history={history}
      processName={processName}
      sessionStorageKey={STORAGE_KEY}
      pageData={pageData}
      setPageData={setPageData}
      listingTitle={listingTitle}
      title={title}
      onSubmitCallback={onSubmitCallback}
      getDiscountedPriceFromVariants={getDiscountedPriceFromVariants}
      {...props}
    />
  ) : (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <CustomTopbar intl={intl} linkToExternalSite={config?.topbar?.logoLink} />
    </Page>
  );
};

const mapStateToProps = state => {
  const {
    listing,
    orderData,
    stripeCustomerFetched,
    speculateTransactionInProgress,
    speculateTransactionError,
    speculatedTransaction,
    isClockInSync,
    transaction,
    initiateInquiryError,
    initiateOrderError,
    confirmPaymentError,
    lastSpeculationKey,
    speculativeTransactionId,
    speculateStatus,
    stripeClientSecret,
    lastSpeculateError,
  } = state.CheckoutPage;
  const { currentUser } = state.user;
  const { confirmCardPaymentError, paymentIntent, retrievePaymentIntentError } = state.stripe;
  return {
    scrollingDisabled: isScrollingDisabled(state),
    currentUser,
    stripeCustomerFetched,
    orderData,
    speculateTransactionInProgress,
    speculateTransactionError,
    speculatedTransaction,
    // Normalize names for CheckoutPageWithPayment
    speculativeTransaction: speculatedTransaction,
    speculativeInProgress: speculateTransactionInProgress,
    isClockInSync,
    transaction,
    listing,
    initiateInquiryError,
    initiateOrderError,
    confirmCardPaymentError,
    confirmPaymentError,
    paymentIntent,
    retrievePaymentIntentError,
    lastSpeculationKey,
    speculativeTransactionId,
    speculateStatus,
    stripeClientSecret,
    lastSpeculateError,
  };
};

const mapDispatchToProps = {
  fetchSpeculatedTransaction: speculateTransaction,
  fetchStripeCustomer: stripeCustomer,
  onInquiryWithoutPayment: initiateInquiryWithoutPayment,
  onInitiateOrder: initiateOrder,
  onRetrievePaymentIntent: retrievePaymentIntent,
  onConfirmCardPayment: confirmCardPayment,
  onConfirmPayment: confirmPayment,
  onSendMessage: sendMessage,
  onSavePaymentMethod: savePaymentMethod,
  onInitiatePrivilegedSpeculativeTransaction: initiatePrivilegedSpeculativeTransactionIfNeeded,
};

const CheckoutPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(EnhancedCheckoutPage);

CheckoutPage.setInitialValues = (initialValues, saveToSessionStorage = false) => {
  if (saveToSessionStorage) {
    const { listing, orderData } = initialValues;
    storeData(orderData, listing, null, STORAGE_KEY);
  }

  return setInitialValues(initialValues);
};

CheckoutPage.displayName = 'CheckoutPage';

export default CheckoutPage;

/**
 * Note: This form is using card from Stripe Elements https://stripe.com/docs/stripe-js#elements
 * Card is not a Final Form field so it's not available trough Final Form.
 * It's also handled separately in handleSubmit function.
 */
import React, { Component } from 'react';
import { Field } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, injectIntl } from '../../../util/reactIntl';
import { propTypes } from '../../../util/types';
import { ensurePaymentMethodCard } from '../../../util/data';
import { mapToStripeBilling, mapToShippo, normalizeAddress, normalizePhone, validateAddress } from '../../../util/addressHelpers';

import {
  Heading,
  PrimaryButton,
  FieldCheckbox,
  FieldTextInput,
  IconSpinner,
  SavedCardDetails,
} from '../../../components';

// NOTE: AddressForm and ShippingDetails no longer used - billing/shipping handled in parent

import css from './StripePaymentForm.module.css';
import { __DEV__ } from '../../../util/envFlags';

// Extract a single string from either shipping.* or billing.* based on shippingSameAsBilling
const pickFromShippingOrBilling = (values, field) => {
  const ship = values?.shipping || {};
  const bill = values?.shippingSameAsBilling ? (values?.billing || {}) : (values?.shipping || {});
  // preference: if user filled shipping block, use that; otherwise use billing
  const fromShipping = ship?.[field];
  const fromBilling  = (values?.shippingSameAsBilling ? (values?.billing || {}) : (values?.billing || {}))?.[field];
  return fromShipping ?? fromBilling ?? '';
};

// Build the flat customer* payload from form values
const mapToCustomerProtectedData = (values) => {
  // AddressForm typical keys: name, line1, line2, city, state, postalCode, phone, email
  const v = values || {};
  const customerName   = pickFromShippingOrBilling(v, 'name');
  const customerStreet = pickFromShippingOrBilling(v, 'line1');
  const customerStreet2= pickFromShippingOrBilling(v, 'line2');
  const customerCity   = pickFromShippingOrBilling(v, 'city');
  const customerState  = pickFromShippingOrBilling(v, 'state');
  const customerZip    = pickFromShippingOrBilling(v, 'postalCode');
  const customerPhone  = pickFromShippingOrBilling(v, 'phone');
  const customerEmail  = pickFromShippingOrBilling(v, 'email');

  const pd = {
    customerName,
    customerStreet,
    customerStreet2,
    customerCity,
    customerState,
    customerZip,
    customerPhone,
    customerEmail,
  };

  if (__DEV__) {
    const filled = Object.entries(pd).filter(([_, val]) => !!val).map(([k]) => k);
    // eslint-disable-next-line no-console
    console.log('[StripePaymentForm] mapped customer PD:', pd, 'filled:', filled.length, filled);
  }
  return pd;
};

/**
 * Summarize Stripe error for logging and user display
 * Prevents logging massive nested objects
 */
const summarizeStripeError = (err) => {
  if (!err) return { message: 'Unknown error' };
  const { message, code, type, decline_code, payment_intent } = err;
  return { 
    message, 
    code, 
    type, 
    decline_code, 
    payment_intent_id: payment_intent?.id 
  };
};

/**
 * Translate a Stripe API error object.
 *
 * To keep up with possible keys from the Stripe API, see:
 *
 * https://stripe.com/docs/api#errors
 *
 * Note that at least at moment, the above link doesn't list all the
 * error codes that the API returns.
 *
 * @param {Object} intl - react-intl object from injectIntl
 * @param {Object} stripeError - error object from Stripe API
 *
 * @return {String} translation message for the specific Stripe error,
 * or the given error message (not translated) if the specific error
 * type/code is not defined in the translations
 *
 */
const stripeErrorTranslation = (intl, stripeError) => {
  const { message, code, type } = stripeError;

  if (!code || !type) {
    // Not a proper Stripe error object
    return intl.formatMessage({ id: 'StripePaymentForm.genericError' });
  }

  const translationId =
    type === 'validation_error'
      ? `StripePaymentForm.stripe.validation_error.${code}`
      : `StripePaymentForm.stripe.${type}`;

  return intl.formatMessage({
    id: translationId,
    defaultMessage: message,
  });
};

const stripeElementsOptions = {
  fonts: [
    {
      cssSrc: 'https://fonts.googleapis.com/css?family=Inter',
    },
  ],
};

// card (being a Stripe Elements component), can have own styling passed to it.
// However, its internal width-calculation seems to break if font-size is too big
// compared to component's own width.
const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
const cardStyles = {
  base: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", Helvetica, Arial, sans-serif',
    fontSize: isMobile ? '14px' : '16px',
    fontSmoothing: 'antialiased',
    lineHeight: '24px',
    letterSpacing: '-0.1px',
    color: '#4A4A4A',
    '::placeholder': {
      color: '#B2B2B2',
    },
  },
};

const OneTimePaymentWithCardElement = props => {
  const {
    cardClasses,
    formId,
    handleStripeElementRef,
    hasCardError,
    error,
    label,
    intl,
    marketplaceName,
  } = props;
  const labelText =
    label || intl.formatMessage({ id: 'StripePaymentForm.saveAfterOnetimePayment' });
  return (
    <React.Fragment>
      <label className={css.paymentLabel} htmlFor={`${formId}-card`}>
        <FormattedMessage id="StripePaymentForm.paymentCardDetails" />
      </label>
      <div className={cardClasses} id={`${formId}-card`} ref={handleStripeElementRef} />
      {hasCardError ? <span className={css.error}>{error}</span> : null}
      <div className={css.saveForLaterUse}>
        <FieldCheckbox
          className={css.saveForLaterUseCheckbox}
          textClassName={css.saveForLaterUseLabel}
          id="saveAfterOnetimePayment"
          name="saveAfterOnetimePayment"
          label={labelText}
          value="saveAfterOnetimePayment"
          useSuccessColor
        />
        <span className={css.saveForLaterUseLegalInfo}>
          <FormattedMessage
            id="StripePaymentForm.saveforLaterUseLegalInfo"
            values={{ marketplaceName }}
          />
        </span>
      </div>
    </React.Fragment>
  );
};

const PaymentMethodSelector = props => {
  const {
    cardClasses,
    formId,
    changePaymentMethod,
    defaultPaymentMethod,
    handleStripeElementRef,
    hasCardError,
    error,
    paymentMethod,
    intl,
    marketplaceName,
  } = props;
  const last4Digits = defaultPaymentMethod.attributes.card.last4Digits;
  const labelText = intl.formatMessage(
    { id: 'StripePaymentForm.replaceAfterOnetimePayment' },
    { last4Digits }
  );

  return (
    <React.Fragment>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id="StripePaymentForm.payWithHeading" />
      </Heading>
      <SavedCardDetails
        className={css.paymentMethodSelector}
        card={defaultPaymentMethod.attributes.card}
        onChange={changePaymentMethod}
      />
      {paymentMethod === 'replaceCard' ? (
        <OneTimePaymentWithCardElement
          cardClasses={cardClasses}
          formId={formId}
          handleStripeElementRef={handleStripeElementRef}
          hasCardError={hasCardError}
          error={error}
          label={labelText}
          intl={intl}
          marketplaceName={marketplaceName}
        />
      ) : null}
    </React.Fragment>
  );
};

const getPaymentMethod = (selectedPaymentMethod, hasDefaultPaymentMethod) => {
  return selectedPaymentMethod == null && hasDefaultPaymentMethod
    ? 'defaultCard'
    : selectedPaymentMethod == null
    ? 'onetimeCardPayment'
    : selectedPaymentMethod;
};

// Should we show onetime payment fields and does StripeElements card need attention
const checkOnetimePaymentFields = (
  cardValueValid,
  selectedPaymentMethod,
  hasDefaultPaymentMethod,
  hasHandledCardPayment
) => {
  const useDefaultPaymentMethod =
    selectedPaymentMethod === 'defaultCard' && hasDefaultPaymentMethod;
  // Billing details are known if we have already handled card payment or existing default payment method is used.
  const billingDetailsKnown = hasHandledCardPayment || useDefaultPaymentMethod;

  // If onetime payment is used, check that the StripeElements card has valid value.
  const oneTimePaymentMethods = ['onetimeCardPayment', 'replaceCard'];
  const useOnetimePaymentMethod = oneTimePaymentMethods.includes(selectedPaymentMethod);
  const onetimePaymentNeedsAttention =
    !billingDetailsKnown && !(useOnetimePaymentMethod && cardValueValid);

  return {
    onetimePaymentNeedsAttention,
    showOnetimePaymentFields: useOnetimePaymentMethod,
  };
};

// NOTE: LocationOrShippingDetails, ShippingSection, and address form components 
// are no longer used here - all billing/shipping fields are rendered in parent CheckoutPageWithPayment

const initialState = {
  error: null,
  cardValueValid: false,
  // The mode can be 'onetimePayment', 'defaultCard', or 'replaceCard'
  // Check SavedCardDetails component for more information
  paymentMethod: null,
};

/**
 * Payment form that asks for credit card info using Stripe Elements.
 *
 * When the card is valid and the user submits the form, a request is
 * sent to the Stripe API to handle payment. `stripe.confirmCardPayment`
 * may ask more details from cardholder if 3D security steps are needed.
 *
 * See: https://stripe.com/docs/payments/payment-intents
 *      https://stripe.com/docs/elements
 *
 * @component
 * @param {Object} props
 * @param {string} props.className - The class name for the payment form
 * @param {string} props.rootClassName - The root class that overrides the default class for the payment form
 * @param {boolean} props.inProgress - Whether the form is in progress
 * @param {boolean} props.loadingData - Whether the data is loading
 * @param {propTypes.error} props.initiateOrderError - The error that occurs when initiating the order
 * @param {propTypes.error} props.confirmCardPaymentError - The error that occurs when confirming the card payment
 * @param {propTypes.error} props.confirmPaymentError - The error that occurs when confirming the payment
 * @param {string} props.formId - The form ID
 * @param {Function} props.onSubmit - The function to call when the form is submitted
 * @param {string} props.authorDisplayName - The author display name
 * @param {boolean} props.showInitialMessageInput - Whether to show the initial message input
 * @param {string} props.stripePublishableKey - The Stripe publishable key
 * @param {Function} props.onStripeInitialized - The function to call when Stripe is initialized
 * @param {boolean} props.hasHandledCardPayment - Whether the card payment has been handled
 * @param {Object} props.defaultPaymentMethod - The default payment method
 * @param {boolean} props.askShippingDetails - Whether to ask for shipping details
 * @param {boolean} props.showPickUplocation - Whether to show the pickup location
 * @param {string} props.totalPrice - The total price
 * @param {string} props.locale - The locale
 * @param {Object} props.listingLocation - The listing location
 * @param {Object} props.listingLocation.building - The building
 * @param {Object} props.listingLocation.address - The address
 * @param {boolean} props.isBooking - Whether the booking is in progress
 * @param {boolean} props.isFuzzyLocation - Whether the location is fuzzy
 * @param {Object} props.intl - The intl object
 */
class StripePaymentForm extends Component {
  constructor(props) {
    super(props);
    this.state = initialState;
    this.updateBillingDetailsToMatchShippingAddress = this.updateBillingDetailsToMatchShippingAddress.bind(
      this
    );
    this.handleCardValueChange = this.handleCardValueChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.paymentForm = this.paymentForm.bind(this);
    this.initializeStripeElement = this.initializeStripeElement.bind(this);
    this.initializePaymentElement = this.initializePaymentElement.bind(this);
    this.handleStripeElementRef = this.handleStripeElementRef.bind(this);
    this.changePaymentMethod = this.changePaymentMethod.bind(this);
    this.cardContainer = null;
    this.paymentElement = null;
    this.elements = null;
    this.reportedMounted = false;
  }

  componentDidMount() {
    // SSR/boot safety: gate Stripe init
    if (typeof window !== 'undefined' && window.Stripe && this.props.stripePublishableKey) {
      const publishableKey = this.props.stripePublishableKey;
      const {
        onStripeInitialized,
        onElementsCreated,
        hasHandledCardPayment,
        defaultPaymentMethod,
        loadingData,
        usePaymentElement,
        clientSecret,
      } = this.props;
      this.stripe = window.Stripe(publishableKey);
      onStripeInitialized(this.stripe);

      // Skip element initialization if payment is already handled or data is loading
      if (hasHandledCardPayment || defaultPaymentMethod || loadingData) {
        console.log('[Stripe] Skipping element initialization:', { 
          hasHandledCardPayment, 
          defaultPaymentMethod: !!defaultPaymentMethod, 
          loadingData 
        });
        return;
      }

      // If using PaymentElement and we have a clientSecret, create Elements with it
      if (usePaymentElement) {
        if (!clientSecret) {
          console.warn('[Stripe] PaymentElement enabled but no clientSecret provided');
          return;
        }
        
        console.log('[Stripe] Creating Elements with clientSecret for PaymentElement');
        this.elements = this.stripe.elements({ 
          clientSecret,
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: '#4A4A4A',
            }
          }
        });
        
        if (onElementsCreated) {
          onElementsCreated(this.elements);
        }

        this.initializePaymentElement();
      } else {
        // Use CardElement for legacy flow
        console.log('[Stripe] Initializing CardElement (legacy flow)');
        this.initializeStripeElement();
      }
    }
  }

  componentWillUnmount() {
    if (this.card) {
      this.card.removeEventListener('change', this.handleCardValueChange);
      this.card.unmount();
      this.card = null;
    }
    
    if (this.paymentElement) {
      this.paymentElement.unmount();
      this.paymentElement = null;
    }
    
    // Notify parent that Stripe element is unmounted and reset guard
    if (this.props.onStripeElementMounted) {
      this.props.onStripeElementMounted(false);
    }
    this.reportedMounted = false;
  }

  initializeStripeElement(element) {
    const elements = this.stripe.elements(stripeElementsOptions);

    if (!this.card) {
      this.card = elements.create('card', { style: cardStyles });
      
      // Ensure the target element exists before mounting
      const targetElement = element || this.cardContainer;
      if (!targetElement) {
        console.warn('[Stripe] No target element available for mounting');
        return;
      }
      
      this.card.mount(targetElement);
      this.card.addEventListener('change', this.handleCardValueChange);
      
      // Notify parent that Stripe element is mounted (only once)
      if (!this.reportedMounted) {
        this.reportedMounted = true;
        this.props.onStripeElementMounted?.(true);
      }
      
      // EventListener is the only way to simulate breakpoints with Stripe.
      window.addEventListener('resize', () => {
        if (this.card) {
          if (window.innerWidth < 768) {
            this.card.update({ style: { base: { fontSize: '14px', lineHeight: '24px' } } });
          } else {
            this.card.update({ style: { base: { fontSize: '18px', lineHeight: '24px' } } });
          }
        }
      });
    }
  }

  initializePaymentElement(element) {
    console.log('[Stripe] Initializing PaymentElement');
    if (!this.elements) {
      console.warn('[Stripe] Elements instance not available for PaymentElement');
      return;
    }

    if (!this.paymentElement) {
      this.paymentElement = this.elements.create('payment', {
        layout: 'tabs',
      });
      
      // Ensure the target element exists before mounting
      const targetElement = element || this.cardContainer;
      if (!targetElement) {
        console.warn('[Stripe] No target element available for mounting PaymentElement');
        return;
      }
      
      this.paymentElement.mount(targetElement);
      this.paymentElement.on('change', this.handleCardValueChange);
      
      // Notify parent that Stripe element is mounted (only once)
      if (!this.reportedMounted) {
        this.reportedMounted = true;
        this.props.onStripeElementMounted?.(true);
      }
      
      console.log('[Stripe] PaymentElement mounted successfully');
    }
  }

  updateBillingDetailsToMatchShippingAddress(shouldFill) {
    // Note: This method is deprecated in the new implementation
    // Billing/shipping synchronization is handled in the parent form
  }

  changePaymentMethod(changedTo) {
    if (this.card && changedTo === 'defaultCard') {
      this.card.removeEventListener('change', this.handleCardValueChange);
      this.card.unmount();
      this.card = null;
      this.setState({ cardValueValid: false });
    }
    this.setState({ paymentMethod: changedTo });
    // Note: Form updates removed - handled by parent form
  }

  handleStripeElementRef(el) {
    this.cardContainer = el;
    if (this.stripe && el) {
      const { usePaymentElement, clientSecret } = this.props;
      if (usePaymentElement && clientSecret && this.elements) {
        this.initializePaymentElement(el);
      } else {
        this.initializeStripeElement(el);
      }
    }
  }

  handleCardValueChange(event) {
    const { intl, onPaymentElementChange } = this.props;
    const { error, complete } = event;

    // Note: postal code update removed - handled by parent form if needed

    // Call payment element change callback
    if (onPaymentElementChange) {
      onPaymentElementChange(!!complete);
      console.log('[Stripe] PaymentElement complete:', complete);
    }

    this.setState(prevState => {
      return {
        error: error ? stripeErrorTranslation(intl, error) : null,
        cardValueValid: complete,
      };
    });
  }
  handleSubmit(values) {
    const {
      onSubmit,
      inProgress,
      formId,
      hasHandledCardPayment,
      defaultPaymentMethod,
      submitDisabled,
      contactEmail,
      contactPhone,
    } = this.props;
    const { initialMessage } = values;
    const { cardValueValid, paymentMethod } = this.state;
    const hasDefaultPaymentMethod = defaultPaymentMethod?.id;
    const selectedPaymentMethod = getPaymentMethod(paymentMethod, hasDefaultPaymentMethod);
    const { onetimePaymentNeedsAttention } = checkOnetimePaymentFields(
      cardValueValid,
      selectedPaymentMethod,
      hasDefaultPaymentMethod,
      hasHandledCardPayment
    );

    // Prevent double submit: early-return if submitDisabled (belt & suspenders)
    if (submitDisabled) {
      return;
    }

    if (inProgress || onetimePaymentNeedsAttention) {
      // Already submitting or card value incomplete/invalid
      return;
    }

    // Extract raw form values and add contact info
    const rawBilling = { ...(values.billing || {}), email: contactEmail, phone: contactPhone };
    const rawShipping = { ...(values.shipping || {}), email: contactEmail, phone: values.shipping?.phone || contactPhone };
    
    // Normalize addresses (happens before mapping & submit)
    const billing = normalizeAddress(rawBilling);
    const shipping = values.shippingSameAsBilling
      ? normalizeAddress({ ...rawBilling, phone: rawBilling.phone })
      : normalizeAddress(rawShipping);
    
    // Optional: block PO Boxes for couriers (UPS/FedEx). Route to USPS if needed.
    const isPOBox = /^(P(OST)?\.?\s*O(FFICE)?\.?\s*BOX)\b/i.test((shipping.line1 || '').toUpperCase());
    if (isPOBox) {
      throw new Error('PO Boxes are not supported for courier shipping. Please enter a street address.');
    }
    
    // Map to service-specific formats
    const billingForStripe = mapToStripeBilling(billing);
    const shippingForCourier = mapToShippo({ ...shipping, line2: shipping.line2 || undefined });

    // Map nested form values to flat structure expected by CheckoutPageWithPayment
    const mappedFormValues = {
      // Customer fields from shipping (primary) or billing (fallback)
      customerName: shipping.name || billing.name || '',
      customerStreet: shipping.line1 || billing.line1 || '',
      customerStreet2: shipping.line2 || billing.line2 || '',
      customerCity: shipping.city || billing.city || '',
      customerState: shipping.state || billing.state || '',
      customerZip: shipping.postalCode || billing.postalCode || '',
      customerEmail: shipping.email || billing.email || '',
      customerPhone: shipping.phone || billing.phone || '',
      
      // Include original nested structure for backward compatibility
      billing: rawBilling,
      shipping: rawShipping,
      shippingSameAsBilling: values.shippingSameAsBilling || false,
    };

    // Debug logging for form submission
    if (__DEV__) {
      console.log('[StripePaymentForm] Submit - Raw form values:', {
        billing: rawBilling,
        shipping: rawShipping,
        shippingSameAsBilling: values.shippingSameAsBilling
      });
      console.log('[StripePaymentForm] Submit - Normalized values:', {
        billing: billing,
        shipping: shipping
      });
      console.log('[StripePaymentForm] Submit - Mapped customer values:', {
        customerName: mappedFormValues.customerName,
        customerStreet: mappedFormValues.customerStreet,
        customerZip: mappedFormValues.customerZip,
        customerPhone: mappedFormValues.customerPhone
      });
    }

    // Build customer protected data and merge into params
    const customerPD = mapToCustomerProtectedData(values);
    const nextProtectedData = { ...customerPD };
    
    // Verify required address fields are present
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[StripePaymentForm] onSubmit protectedData keys:', Object.keys(nextProtectedData));
      console.log('[StripePaymentForm] customerStreet:', nextProtectedData.customerStreet);
      console.log('[StripePaymentForm] customerZip:', nextProtectedData.customerZip);
    }
    
    // Assert required fields and abort if missing
    if (!nextProtectedData.customerStreet?.trim() || !nextProtectedData.customerZip?.trim()) {
      const missingFields = [];
      if (!nextProtectedData.customerStreet?.trim()) missingFields.push('Street Address');
      if (!nextProtectedData.customerZip?.trim()) missingFields.push('ZIP Code');
      
      throw new Error(`Please fill in the required address fields: ${missingFields.join(', ')}`);
    }

    const params = {
      message: initialMessage ? initialMessage.trim() : null,
      card: this.card,
      formId,
      formValues: mappedFormValues,
      protectedData: nextProtectedData,
      paymentMethod: getPaymentMethod(
        paymentMethod,
        ensurePaymentMethodCard(defaultPaymentMethod).id
      ),
      billingAddress: billingForStripe,
      shippingAddress: shippingForCourier,
      // Also provide normalized objects for any custom logic
      normalizedBilling: billing,
      normalizedShipping: shipping,
    };
    onSubmit(params);
  }

  paymentForm(props) {
    const {
      className,
      rootClassName,
      inProgress: submitInProgress,
      loadingData,
      formId,
      authorDisplayName,
      showInitialMessageInput,
      intl,
      initiateOrderError,
      confirmCardPaymentError,
      confirmPaymentError,
      hasHandledCardPayment,
      defaultPaymentMethod,
      listingLocation,
      askShippingDetails,
      showPickUplocation,
      totalPrice,
      locale,
      stripePublishableKey,
      marketplaceName,
      isBooking,
      isFuzzyLocation,
      values = {},
      parentValid = false,
      parentInvalid = false,
      parentErrors = {},
    } = props;

    // Use values from props (passed down via FormSpy)
    const errors = parentErrors || {};
    const invalid = parentInvalid;

    // Detailed form validation logging (avoid printing huge objects)
    console.log('[Form] invalid:', invalid, 'errors keys:', Object.keys(errors||{}));

    // Note: formApi access removed - we don't need to update parent form from here
    // Card and paymentMethod are handled in handleSubmit

    const ensuredDefaultPaymentMethod = ensurePaymentMethodCard(defaultPaymentMethod);
    const billingDetailsNeeded = !(hasHandledCardPayment || confirmPaymentError);

    const { cardValueValid, paymentMethod } = this.state;
    const hasDefaultPaymentMethod = ensuredDefaultPaymentMethod.id;
    const selectedPaymentMethod = getPaymentMethod(paymentMethod, hasDefaultPaymentMethod);
    const { onetimePaymentNeedsAttention, showOnetimePaymentFields } = checkOnetimePaymentFields(
      cardValueValid,
      selectedPaymentMethod,
      hasDefaultPaymentMethod,
      hasHandledCardPayment
    );

    const submitDisabled = this.props.submitDisabled;   // single source of truth
    const hasCardError = this.state.error && !submitInProgress;
    const hasPaymentErrors = confirmCardPaymentError || confirmPaymentError;
    const classes = classNames(rootClassName || css.root, className);
    const cardClasses = classNames(css.card, {
      [css.cardSuccess]: this.state.cardValueValid,
      [css.cardError]: hasCardError,
    });

    // Note: totalPrice might not be available initially
    // when speculateTransaction call is in progress.
    const totalPriceMaybe = totalPrice || '';

    // TODO: confirmCardPayment can create all kinds of errors.
    // Currently, we provide translation support for one:
    // https://stripe.com/docs/error-codes
    const piAuthenticationFailure = 'payment_intent_authentication_failure';
    const paymentErrorMessage =
      confirmCardPaymentError && confirmCardPaymentError.code === piAuthenticationFailure
        ? intl.formatMessage({ id: 'StripePaymentForm.confirmCardPaymentError' })
        : confirmCardPaymentError
        ? confirmCardPaymentError.message
        : confirmPaymentError
        ? intl.formatMessage({ id: 'StripePaymentForm.confirmPaymentError' })
        : intl.formatMessage({ id: 'StripePaymentForm.genericError' });

    const billingDetailsNameLabel = intl.formatMessage({
      id: 'StripePaymentForm.billingDetailsNameLabel',
    });

    const billingDetailsNamePlaceholder = intl.formatMessage({
      id: 'StripePaymentForm.billingDetailsNamePlaceholder',
    });

    const messagePlaceholder = intl.formatMessage(
      { id: 'StripePaymentForm.messagePlaceholder' },
      { name: authorDisplayName }
    );

    const messageOptionalText = intl.formatMessage({
      id: 'StripePaymentForm.messageOptionalText',
    });

    const initialMessageLabel = intl.formatMessage(
      { id: 'StripePaymentForm.messageLabel' },
      { messageOptionalText: messageOptionalText }
    );

    // NOTE: Billing/shipping address fields are now rendered in parent CheckoutPageWithPayment.
    // StripePaymentForm no longer consumes Final Form context directly.

    const hasStripeKey = stripePublishableKey;
    const isBookingYesNo = isBooking ? 'yes' : 'no';

    return hasStripeKey ? (
      <div className={classes}>
        {billingDetailsNeeded && !loadingData ? (
          <React.Fragment>
            {hasDefaultPaymentMethod ? (
              <PaymentMethodSelector
                cardClasses={cardClasses}
                formId={formId}
                defaultPaymentMethod={ensuredDefaultPaymentMethod}
                changePaymentMethod={this.changePaymentMethod}
                handleStripeElementRef={this.handleStripeElementRef}
                hasCardError={hasCardError}
                error={this.state.error}
                paymentMethod={selectedPaymentMethod}
                intl={intl}
                marketplaceName={marketplaceName}
              />
            ) : (
              <React.Fragment>
                <Heading as="h3" rootClassName={css.heading}>
                  <FormattedMessage id="StripePaymentForm.paymentHeading" />
                </Heading>
                <OneTimePaymentWithCardElement
                  cardClasses={cardClasses}
                  formId={formId}
                  handleStripeElementRef={this.handleStripeElementRef}
                  hasCardError={hasCardError}
                  error={this.state.error}
                  intl={intl}
                  marketplaceName={marketplaceName}
                />
              </React.Fragment>
            )}

            {/* Note: Billing and shipping address forms moved to parent CheckoutPageWithPayment */}
          </React.Fragment>
        ) : loadingData ? (
          <p className={css.spinner}>
            <IconSpinner />
          </p>
        ) : null}

        {initiateOrderError ? (
          <span className={css.errorMessage}>{initiateOrderError.message}</span>
        ) : null}
        {showInitialMessageInput ? (
          <div>
            <Heading as="h3" rootClassName={css.heading}>
              <FormattedMessage id="StripePaymentForm.messageHeading" />
            </Heading>

            <FieldTextInput
              type="textarea"
              id={`${formId}-message`}
              name="initialMessage"
              label={initialMessageLabel}
              placeholder={messagePlaceholder}
              className={css.message}
            />
          </div>
        ) : null}
        <div className={css.submitContainer}>
          {hasPaymentErrors ? (
            <span className={css.errorMessage}>{paymentErrorMessage}</span>
          ) : null}
          <PrimaryButton
            className={classNames(css.submitButton, { [css.submitButtonDisabled]: submitDisabled })}
            type="submit"
            inProgress={this.props.submitInProgress}  // just a spinner flag, not a gate
            disabled={submitDisabled}
            aria-disabled={submitDisabled}
          >
            {billingDetailsNeeded ? (
              <FormattedMessage
                id="StripePaymentForm.submitPaymentInfo"
                values={{ totalPrice: totalPriceMaybe, isBooking: isBookingYesNo }}
              />
            ) : (
              <FormattedMessage
                id="StripePaymentForm.submitConfirmPaymentInfo"
                values={{ totalPrice: totalPriceMaybe, isBooking: isBookingYesNo }}
              />
            )}
          </PrimaryButton>
          
          {/* Customer field validation errors */}
          {invalid && errors ? (
            <div style={{ marginTop: 8, fontSize: 12, color: '#d32f2f' }}>
              {errors.customerName && <div>• {errors.customerName}</div>}
              {errors.customerStreet && <div>• {errors.customerStreet}</div>}
              {errors.customerCity && <div>• {errors.customerCity}</div>}
              {errors.customerState && <div>• {errors.customerState}</div>}
              {errors.customerZip && <div>• {errors.customerZip}</div>}
              {errors.customerEmail && <div>• {errors.customerEmail}</div>}
              {errors.customerPhone && <div>• {errors.customerPhone}</div>}
              {/* Show other errors if no customer field errors */}
              {!errors.customerName && !errors.customerStreet && !errors.customerCity && 
               !errors.customerState && !errors.customerZip && !errors.customerEmail && 
               !errors.customerPhone && Object.keys(errors).length > 0 && (
                <div>Form invalid. First error: <code>{Object.keys(errors)[0]}</code> → <code>{errors[Object.keys(errors)[0]]}</code></div>
              )}
            </div>
          ) : null}
          
          <p className={css.paymentInfo}>
            <FormattedMessage
              id="StripePaymentForm.submitConfirmPaymentFinePrint"
              values={{ isBooking: isBookingYesNo, name: authorDisplayName }}
            />
          </p>
        </div>
      </div>
    ) : (
      <div className={css.missingStripeKey}>
        <FormattedMessage id="StripePaymentForm.missingStripeKey" />
      </div>
    );
  }

  render() {
    // No longer wrapping in FinalForm - consuming parent context instead
    return this.paymentForm(this.props);
  }
}

export default injectIntl(StripePaymentForm);

/**
 * Note: This form is using card from Stripe Elements https://stripe.com/docs/stripe-js#elements
 * Card is not a Final Form field so it's not available trough Final Form.
 * It's also handled separately in handleSubmit function.
 */
import React, { Component, useEffect } from 'react';
import { Form as FinalForm, Field, useForm, useFormState } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, injectIntl } from '../../../util/reactIntl';
import { propTypes } from '../../../util/types';
import { ensurePaymentMethodCard } from '../../../util/data';
import { mapToStripeBilling, mapToShippo, normalizeAddress, normalizePhone, validateAddress } from '../../../util/addressHelpers';

import {
  Heading,
  Form,
  PrimaryButton,
  FieldCheckbox,
  FieldTextInput,
  IconSpinner,
  SavedCardDetails,
  StripePaymentAddress,
} from '../../../components';
import AddressForm from '../../../components/AddressForm/AddressForm';

import ShippingDetails from '../ShippingDetails/ShippingDetails';

import css from './StripePaymentForm.module.css';

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

const LocationOrShippingDetails = props => {
  const {
    askShippingDetails,
    showPickUplocation,
    listingLocation,
    formApi,
    locale,
    isBooking,
    isFuzzyLocation,
    intl,
  } = props;

  const locationDetails = listingLocation?.building
    ? `${listingLocation.building}, ${listingLocation.address}`
    : listingLocation?.address
    ? listingLocation.address
    : intl.formatMessage({ id: 'StripePaymentForm.locationUnknown' });

  return askShippingDetails ? (
    <ShippingDetails intl={intl} formApi={formApi} locale={locale} />
  ) : !isBooking && showPickUplocation ? (
    <div className={css.locationWrapper}>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id="StripePaymentForm.pickupDetailsTitle" />
      </Heading>
      <p className={css.locationDetails}>{locationDetails}</p>
    </div>
  ) : isBooking && !isFuzzyLocation ? (
    <div className={css.locationWrapper}>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id="StripePaymentForm.locationDetailsTitle" />
      </Heading>
      <p className={css.locationDetails}>{locationDetails}</p>
    </div>
  ) : null;
};

// Utility to copy billing fields to shipping fields
const copyBillingToShipping = (form) => {
  const values = form.getState().values || {};
  const b = values.billing || {};
  const mapping = {
    'shipping.name': b.name || '',
    'shipping.line1': b.line1 || '',
    'shipping.line2': b.line2 || '',
    'shipping.city': b.city || '',
    'shipping.state': b.state || '',
    'shipping.postalCode': b.postalCode || '',
    'shipping.country': b.country || '',
    'shipping.email': b.email || '',
    'shipping.phone': b.phone || '',
  };
  Object.entries(mapping).forEach(([k, v]) => form.change(k, v));
};

// Shipping section component with checkbox at top
const ShippingSection = ({ intl, css }) => {
  const form = useForm();
  const { values } = useFormState({ subscription: { values: true } });

  const onSameAsBillingChange = (e) => {
    const checked = !!e.target.checked;
    form.change('shippingSameAsBilling', checked);
    if (checked) copyBillingToShipping(form);
  };

  // Keep shipping in sync when billing changes while checkbox is checked
  React.useEffect(() => {
    if (values.shippingSameAsBilling) copyBillingToShipping(form);
  }, [
    values.shippingSameAsBilling,
    values.billing?.name,
    values.billing?.line1,
    values.billing?.line2,
    values.billing?.city,
    values.billing?.state,
    values.billing?.postalCode,
    values.billing?.country,
    values.billing?.email,
    values.billing?.phone,
  ]);

  return (
    <section aria-labelledby="shippingTitle">
      <h2 id="shippingTitle" className={css.heading}>
        <FormattedMessage id="StripePaymentForm.shippingDetails.title" />
      </h2>

      <div className={css.sameAsBillingRow}>
        <label className={css.inlineCheckbox} htmlFor="shippingSameAsBilling">
          <Field
            id="shippingSameAsBilling"
            name="shippingSameAsBilling"
            component="input"
            type="checkbox"
            onChange={onSameAsBillingChange}
          />
          <span>{intl.formatMessage({ id: 'StripePaymentForm.shippingSameAsBilling' })}</span>
        </label>
      </div>

      {!values.shippingSameAsBilling && (
        <div className={css.fieldStack}>
          <AddressForm
            namespace="shipping"
            requiredFields={{ name: true, line1: true, city: true, state: true, postalCode: true, country: true, email: true, phone: true }}
            countryAfterZipForUSCA
          />
        </div>
      )}
    </section>
  );
};

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
    this.handleStripeElementRef = this.handleStripeElementRef.bind(this);
    this.changePaymentMethod = this.changePaymentMethod.bind(this);
    this.finalFormAPI = null;
    this.cardContainer = null;
  }

  componentDidMount() {
    // SSR/boot safety: gate Stripe init
    if (typeof window !== 'undefined' && window.Stripe && this.props.stripePublishableKey) {
      const publishableKey = this.props.stripePublishableKey;
      const {
        onStripeInitialized,
        hasHandledCardPayment,
        defaultPaymentMethod,
        loadingData,
      } = this.props;
      this.stripe = window.Stripe(publishableKey);
      onStripeInitialized(this.stripe);
      
      // Notify parent that Stripe element is mounted
      if (this.props.onStripeElementMounted) {
        this.props.onStripeElementMounted(true);
      }

      if (!(hasHandledCardPayment || defaultPaymentMethod || loadingData)) {
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
  }

  initializeStripeElement(element) {
    const elements = this.stripe.elements(stripeElementsOptions);

    if (!this.card) {
      this.card = elements.create('card', { style: cardStyles });
      this.card.mount(element || this.cardContainer);
      this.card.addEventListener('change', this.handleCardValueChange);
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

  updateBillingDetailsToMatchShippingAddress(shouldFill) {
    const formApi = this.finalFormAPI;
    const values = formApi.getState()?.values || {};
    formApi.batch(() => {
      formApi.change('name', shouldFill ? values.recipientName : '');
      formApi.change('addressLine1', shouldFill ? values.recipientAddressLine1 : '');
      formApi.change('addressLine2', shouldFill ? values.recipientAddressLine2 : '');
      formApi.change('postal', shouldFill ? values.recipientPostal : '');
      formApi.change('city', shouldFill ? values.recipientCity : '');
      formApi.change('state', shouldFill ? values.recipientState : '');
      formApi.change('country', shouldFill ? values.recipientCountry : '');
    });
  }

  changePaymentMethod(changedTo) {
    if (this.card && changedTo === 'defaultCard') {
      this.card.removeEventListener('change', this.handleCardValueChange);
      this.card.unmount();
      this.card = null;
      this.setState({ cardValueValid: false });
    }
    this.setState({ paymentMethod: changedTo });
    if (changedTo === 'defaultCard' && this.finalFormAPI) {
      this.finalFormAPI.change('sameAddressCheckbox', undefined);
    } else if (changedTo === 'replaceCard' && this.finalFormAPI) {
      this.finalFormAPI.change('sameAddressCheckbox', ['sameAddress']);
      this.updateBillingDetailsToMatchShippingAddress(true);
    }
  }

  handleStripeElementRef(el) {
    this.cardContainer = el;
    if (this.stripe && el) {
      this.initializeStripeElement(el);
    }
  }

  handleCardValueChange(event) {
    const { intl, onPaymentElementChange } = this.props;
    const { error, complete } = event;

    const postalCode = event.value.postalCode;
    if (this.finalFormAPI) {
      this.finalFormAPI.change('postal', postalCode);
    }

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

    // Extract raw form values
    const rawBilling = values.billing || {};
    const rawShipping = values.shipping || {};
    
    // Normalize addresses (happens before mapping & submit)
    const billing = normalizeAddress(rawBilling);
    const shipping = values.shippingSameAsBilling
      ? normalizeAddress({ ...values.billing, phone: values.billing?.phone || values.shipping?.phone })
      : normalizeAddress(rawShipping);
    
    // Optional: block PO Boxes for couriers (UPS/FedEx). Route to USPS if needed.
    const isPOBox = /^(P(OST)?\.?\s*O(FFICE)?\.?\s*BOX)\b/i.test((shipping.line1 || '').toUpperCase());
    if (isPOBox) {
      throw new Error('PO Boxes are not supported for courier shipping. Please enter a street address.');
    }
    
    // Map to service-specific formats
    const billingForStripe = mapToStripeBilling(billing);
    const shippingForCourier = mapToShippo({ ...shipping, line2: shipping.line2 || undefined });

    const params = {
      message: initialMessage ? initialMessage.trim() : null,
      card: this.card,
      formId,
      formValues: values,
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

  paymentForm(formRenderProps) {
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
      invalid,
      handleSubmit,
      form: formApi,
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
      values,
    } = formRenderProps;

    this.finalFormAPI = formApi;

    // Bubble up form validity to parent
    if (this.props.onFormValidityChange) {
      this.props.onFormValidityChange(!invalid);
    }

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

    const submitDisabled = props.submitDisabled;   // single source of truth
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

    // Asking billing address is recommended in PaymentIntent flow.
    // In CheckoutPage, we send name and email as billing details, but address only if it exists.
    const billingAddress = (
      <StripePaymentAddress
        intl={intl}
        form={formApi}
        fieldId={formId}
        card={this.card}
        locale={locale}
      />
    );

    const hasStripeKey = stripePublishableKey;

    const handleSameAddressCheckbox = event => {
      const checked = event.target.checked;
      this.updateBillingDetailsToMatchShippingAddress(checked);
    };
    const isBookingYesNo = isBooking ? 'yes' : 'no';

    return hasStripeKey ? (
      <Form className={classes} onSubmit={handleSubmit} enforcePagePreloadFor="OrderDetailsPage">
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

            {showOnetimePaymentFields ? (
              <div className={css.billingDetails}>
                {/* Billing Address */}
                <AddressForm
                  namespace="billing"
                  title="Billing details"
                  requiredFields={{ name: true, line1: true, city: true, state: true, postalCode: true, country: true, email: true, phone: false }}
                  countryAfterZipForUSCA
                />

                {/* Shipping Address */}
                <ShippingSection intl={intl} css={css} />
              </div>
            ) : null}
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
            inProgress={props.submitInProgress}  // just a spinner flag, not a gate
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
          <p className={css.paymentInfo}>
            <FormattedMessage
              id="StripePaymentForm.submitConfirmPaymentFinePrint"
              values={{ isBooking: isBookingYesNo, name: authorDisplayName }}
            />
          </p>
        </div>
      </Form>
    ) : (
      <div className={css.missingStripeKey}>
        <FormattedMessage id="StripePaymentForm.missingStripeKey" />
      </div>
    );
  }

  render() {
    const { onSubmit, ...rest } = this.props;
    
    // Deep merge initial values to avoid nuking nested fields from previous drafts
    const defaultInitialValues = {
      sameAsBilling: false,
      shippingSameAsBilling: false,
      billing: {
        country: 'US',
        state: '',
        postalCode: '',
        name: '',
        line1: '',
        line2: '',
        city: '',
        email: '',
        phone: ''
      },
      shipping: {
        country: 'US',
        state: '',
        postalCode: '',
        name: '',
        line1: '',
        line2: '',
        city: '',
        email: '',
        phone: ''
      },
      // Legacy fields for backward compatibility
      customerName: '',
      customerStreet: '',
      customerStreet2: '',
      customerCity: '',
      customerState: '',
      customerZip: '',
      customerEmail: '',
      customerPhone: '',
    };
    
    // Deep merge with any existing initial values
    const initialValues = {
      ...defaultInitialValues,
      ...(rest.initialValues || {}),
      billing: {
        ...defaultInitialValues.billing,
        ...(rest.initialValues?.billing || {})
      },
      shipping: {
        ...defaultInitialValues.shipping,
        ...(rest.initialValues?.shipping || {})
      }
    };
    
    const validate = values => {
      const errors = {};
      const billErr = validateAddress(values.billing || {}, { requirePhone: false });
      if (Object.keys(billErr).length) errors.billing = billErr;
      if (!values.shippingSameAsBilling) {
        const shipErr = validateAddress(values.shipping || {}, { requirePhone: true });
        if (Object.keys(shipErr).length) errors.shipping = shipErr;
      }
      return errors;
    };

    return <FinalForm onSubmit={this.handleSubmit} validate={validate} initialValues={initialValues} {...rest} render={this.paymentForm} />;
  }
}

export default injectIntl(StripePaymentForm);

# Stripe PaymentElement Implementation

## Overview

This implementation adds support for Stripe's modern **PaymentElement** API while maintaining backward compatibility with the legacy **CardElement** API. The system now intelligently chooses which Stripe flow to use based on configuration flags.

## Key Changes

### 1. New Redux Action: `confirmPayment` (stripe.duck.js)

Added a new Redux action that handles the PaymentElement flow using `stripe.confirmPayment()`:

```javascript
export const confirmPayment = params => dispatch => {
  const { stripe, elements, stripePaymentIntentClientSecret, billingDetails, returnUrl } = params;
  // ... handles PaymentElement confirmation with proper error handling
};
```

**Key differences from `confirmCardPayment`:**
- Requires `elements` instance (created with clientSecret) instead of `card` element
- Uses `confirmPayment()` API instead of `confirmCardPayment()`
- Passes billing details via `payment_method_data` in `confirmParams`
- Supports 3DS authentication with `redirect: 'if_required'`

### 2. Conditional Payment Flow (CheckoutPageTransactionHelpers.js)

Updated `fnConfirmCardPayment` to branch based on `usePaymentElement` flag:

```javascript
if (usePaymentElement && elements) {
  // ✅ PaymentElement flow
  return onConfirmPayment({
    stripe,
    elements,
    stripePaymentIntentClientSecret,
    orderId: order?.id,
    billingDetails,
    returnUrl,
  });
} else {
  // ✅ CardElement flow (legacy)
  return onConfirmCardPayment({
    stripe,
    card,
    stripePaymentIntentClientSecret,
    // ...
  });
}
```

### 3. PaymentElement Support in CheckoutPageWithPayment.js

**Added state management:**
```javascript
const [elements, setElements] = useState(null);
const [usePaymentElement, setUsePaymentElement] = useState(false);
```

**Extracted client secret:**
```javascript
const stripePaymentIntentClientSecret = existingTransaction
  ?.attributes?.protectedData?.stripePaymentIntents?.default?.stripePaymentIntentClientSecret;
```

**Passed new props to StripePaymentForm:**
- `usePaymentElement` - Flag to enable PaymentElement
- `elements` - Elements instance with clientSecret
- `stripe` - Stripe instance
- `clientSecret` - Payment Intent client secret
- `onElementsCreated` - Callback to capture Elements instance

### 4. Enhanced StripePaymentForm.js

**Dual initialization logic:**
```javascript
componentDidMount() {
  if (usePaymentElement && clientSecret) {
    // Create Elements with clientSecret
    this.elements = this.stripe.elements({ 
      clientSecret,
      appearance: { theme: 'stripe' }
    });
    onElementsCreated(this.elements);
    this.initializePaymentElement();
  } else {
    // Legacy CardElement flow
    this.initializeStripeElement();
  }
}
```

**New `initializePaymentElement` method:**
```javascript
initializePaymentElement(element) {
  this.paymentElement = this.elements.create('payment', {
    layout: 'tabs',
  });
  this.paymentElement.mount(targetElement);
  this.paymentElement.on('change', this.handleCardValueChange);
}
```

## How to Enable PaymentElement

### Option 1: Global Toggle (Recommended for testing)

In `CheckoutPageWithPayment.js`, change the default state:

```javascript
const [usePaymentElement, setUsePaymentElement] = useState(true); // Enable PaymentElement
```

### Option 2: Feature Flag

Add a config option in `config/configDefault.js`:

```javascript
export const stripeConfig = {
  publishableKey: process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY,
  usePaymentElement: process.env.REACT_APP_USE_PAYMENT_ELEMENT === 'true',
};
```

Then in `CheckoutPageWithPayment.js`:

```javascript
const [usePaymentElement, setUsePaymentElement] = useState(
  config?.stripe?.usePaymentElement || false
);
```

### Option 3: User-Based Toggle

Enable PaymentElement for specific users or conditions:

```javascript
const [usePaymentElement, setUsePaymentElement] = useState(
  currentUser?.attributes?.profile?.protectedData?.usePaymentElement || false
);
```

## Testing Checklist

### PaymentElement Flow (when enabled)
- [ ] Elements created with `clientSecret`
- [ ] PaymentElement mounts successfully
- [ ] Card input works and validates
- [ ] `confirmPayment` is called (check console logs)
- [ ] Payment succeeds with test card
- [ ] 3DS authentication works if required
- [ ] Error handling displays properly

### CardElement Flow (legacy)
- [ ] CardElement mounts as before
- [ ] `confirmCardPayment` is called
- [ ] Existing functionality unchanged

### Console Logging

The implementation includes helpful debug logs:

**PaymentElement flow:**
```
[Stripe] Creating Elements with clientSecret for PaymentElement
[Stripe] Initializing PaymentElement
[Stripe] PaymentElement mounted successfully
[stripe] Using PaymentElement flow (confirmPayment)
[stripe] confirmPayment called with PaymentElement
```

**CardElement flow:**
```
[stripe] Using CardElement flow (confirmCardPayment)
```

## Benefits of PaymentElement

1. **Modern API**: Uses Stripe's latest payment flow
2. **Better UX**: Automatic card detection and improved styling
3. **More Payment Methods**: Easier to add alternative payment methods later
4. **Reduced Errors**: Elements instance handles payment method creation internally
5. **3DS Optimized**: Better handling of authentication flows

## Backward Compatibility

The implementation maintains full backward compatibility:
- **Default behavior**: Uses CardElement (existing flow)
- **No breaking changes**: All existing code paths work unchanged
- **Progressive enhancement**: Enable PaymentElement per customer/environment

## Error That Was Fixed

**Before:**
```
Invalid value for confirmCardPayment.payment_method: 
value should be a string or should have type as 'object'. You specified: undefined.
```

**Root Cause:** 
Using `confirmCardPayment()` API with PaymentElement UI, but PaymentElement doesn't expose a `card` element to pass to the API.

**After:**
The correct API (`confirmPayment`) is now called when using PaymentElement, which accepts an `elements` instance instead of individual card details.

## Migration Path

1. **Phase 1 (Current)**: CardElement enabled by default
2. **Phase 2**: Enable PaymentElement for beta testers
3. **Phase 3**: Enable PaymentElement for all users
4. **Phase 4**: Remove CardElement code (optional)

## Related Files

- `src/ducks/stripe.duck.js` - Redux actions for Stripe API calls
- `src/containers/CheckoutPage/CheckoutPageTransactionHelpers.js` - Payment flow orchestration
- `src/containers/CheckoutPage/CheckoutPageWithPayment.js` - Main checkout page component
- `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js` - Stripe UI component

## Additional Resources

- [Stripe PaymentElement Docs](https://stripe.com/docs/payments/payment-element)
- [Stripe confirmPayment API](https://stripe.com/docs/js/payment_intents/confirm_payment)
- [Migration Guide: CardElement → PaymentElement](https://stripe.com/docs/payments/payment-element#migrate-from-elements)


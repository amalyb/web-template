# Stripe PaymentElement Feature Flag Implementation

## Overview

Stripe payment processing now supports both modern **PaymentElement** and legacy **CardElement** via an environment-controlled feature flag. The system defaults to CardElement (production-stable) and can be switched to PaymentElement for testing.

## Feature Flag Configuration

### Environment Variable

**Variable:** `REACT_APP_USE_STRIPE_PAYMENT_ELEMENT`  
**Type:** String (`"true"` or `"false"`)  
**Default:** `false` (CardElement - production stable)

### Setting the Flag

**Development (local `.env`):**
```bash
# Enable PaymentElement
REACT_APP_USE_STRIPE_PAYMENT_ELEMENT=true

# Disable PaymentElement (default, uses CardElement)
REACT_APP_USE_STRIPE_PAYMENT_ELEMENT=false
```

**Render Environment Variables:**
```
Key: REACT_APP_USE_STRIPE_PAYMENT_ELEMENT
Value: false  # or true
```

**Exported Flag:**
```javascript
// src/util/envFlags.js
export const USE_PAYMENT_ELEMENT =
  (typeof process !== 'undefined' &&
   process.env &&
   String(process.env.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT).toLowerCase() === 'true');
```

## Implementation Details

### 1. CheckoutPageWithPayment.js

**Flag Usage:**
```javascript
import { USE_PAYMENT_ELEMENT } from '../../util/envFlags';

const usePaymentElement = USE_PAYMENT_ELEMENT;
```

**Pre-Submit Logging:**
```javascript
console.log('[checkout][pre-submit]', {
  usePaymentElement,
  hasClientSecret: !!stripePaymentIntentClientSecret,
  hasElements: !!elements,
  paymentElementComplete,
});
```

**Props Passed to StripePaymentForm:**
- `usePaymentElement` - Feature flag value
- `stripe` - Stripe instance
- `elements` - Elements instance (for PaymentElement)
- `clientSecret` - Payment Intent client secret
- `onElementsCreated` - Callback to capture Elements instance

### 2. CheckoutPageTransactionHelpers.js

**Branching Logic:**
```javascript
if (usePaymentElement && elements) {
  console.log('[stripe] flow: PaymentElement/confirmPayment', {
    hasElements: !!elements,
    hasClientSecret: !!stripePaymentIntentClientSecret,
    orderId: order?.id?.uuid
  });
  return onConfirmPayment(params);
} else {
  console.log('[stripe] flow: CardElement/confirmCardPayment', {
    hasCard: !!card,
    hasClientSecret: !!stripePaymentIntentClientSecret,
    orderId: order?.id?.uuid
  });
  return onConfirmCardPayment(params);
}
```

### 3. stripe.duck.js

**New Redux Action: `confirmPayment`**
```javascript
export const confirmPayment = params => dispatch => {
  // Uses stripe.confirmPayment() for PaymentElement
  // Includes detailed logging and error summarization
};
```

**Enhanced Logging:**
- Entry: `[stripe] confirmPayment called with PaymentElement`
- Success: `[stripe] confirmPayment success`
- Error: `[stripe] confirmPayment failed:` + summarized error
- Already confirmed: `[stripe] Payment Intent already confirmed, status: {status}`

### 4. StripePaymentForm.js

**Element Initialization:**
```javascript
componentDidMount() {
  if (usePaymentElement) {
    if (!clientSecret) {
      console.warn('[Stripe] PaymentElement enabled but no clientSecret provided');
      return;
    }
    
    console.log('[Stripe] Creating Elements with clientSecret for PaymentElement');
    this.elements = this.stripe.elements({ clientSecret, appearance });
    this.initializePaymentElement();
  } else {
    console.log('[Stripe] Initializing CardElement (legacy flow)');
    this.initializeStripeElement();
  }
}
```

**Error Summarization:**
```javascript
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
```

## Console Log Reference

### CardElement Flow (Default)
```
[checkout] Payment flow: CardElement
[Stripe] Initializing CardElement (legacy flow)
[checkout][pre-submit] { usePaymentElement: false, ... }
[stripe] flow: CardElement/confirmCardPayment
[stripe] confirmCardPayment called with CardElement
[stripe] confirmCardPayment success
```

### PaymentElement Flow (When Enabled)
```
[checkout] Payment flow: PaymentElement
[Stripe] Creating Elements with clientSecret for PaymentElement
[Stripe] Initializing PaymentElement
[checkout][pre-submit] { usePaymentElement: true, ... }
[stripe] flow: PaymentElement/confirmPayment
[stripe] confirmPayment called with PaymentElement
[stripe] Confirming payment with PaymentElement, PI status: requires_payment_method
[stripe] confirmPayment success
```

### Error Logging
```
[stripe] confirmPayment error: {
  message: "Your card was declined",
  code: "card_declined",
  type: "card_error",
  decline_code: "generic_decline"
}
[stripe] confirmPayment failed: {
  code: "card_declined",
  type: "card_error",
  message: "Your card was declined",
  decline_code: "generic_decline",
  paymentIntentId: "pi_xxx"
}
```

## Testing Procedure

### Step 1: Test CardElement (Production Flow)

1. **Set flag to false:**
   ```bash
   REACT_APP_USE_STRIPE_PAYMENT_ELEMENT=false
   ```

2. **Verify logs show CardElement:**
   ```
   [checkout] Payment flow: CardElement
   [Stripe] Initializing CardElement (legacy flow)
   ```

3. **Complete test booking:**
   - Use Stripe test card: `4242 4242 4242 4242`
   - Expiry: Any future date
   - CVC: Any 3 digits
   - ZIP: Any 5 digits

4. **Verify successful payment:**
   ```
   [stripe] confirmCardPayment success
   ```

### Step 2: Test PaymentElement (New Flow)

1. **Set flag to true:**
   ```bash
   REACT_APP_USE_STRIPE_PAYMENT_ELEMENT=true
   ```

2. **Rebuild and restart:**
   ```bash
   npm run build
   # or
   npm start
   ```

3. **Verify logs show PaymentElement:**
   ```
   [checkout] Payment flow: PaymentElement
   [Stripe] Creating Elements with clientSecret for PaymentElement
   ```

4. **Complete test booking:**
   - Same test card details
   - Verify PaymentElement UI loads
   - Complete payment

5. **Verify successful payment:**
   ```
   [stripe] confirmPayment success
   ```

### Step 3: Test Error Handling

**Test declined card:** `4000 0000 0000 0002`

**Expected logs:**
```
[stripe] confirmPayment error: {
  message: "Your card was declined",
  code: "card_declined",
  type: "card_error"
}
```

## Deployment Strategy

### Render Test Environment
```
REACT_APP_USE_STRIPE_PAYMENT_ELEMENT=false
```
Keep stable on CardElement until PaymentElement is fully verified.

### Render Production Environment
```
REACT_APP_USE_STRIPE_PAYMENT_ELEMENT=false
```
Production stays on CardElement until testing complete.

### Migration Timeline

1. **Phase 1 (Current):** CardElement default (flag OFF)
2. **Phase 2:** Enable PaymentElement in test env (flag ON for test)
3. **Phase 3:** A/B test in production with user-based rollout
4. **Phase 4:** Full migration to PaymentElement (flag ON everywhere)
5. **Phase 5:** Remove CardElement code (future cleanup)

## Troubleshooting

### Issue: "PaymentElement enabled but no clientSecret provided"

**Cause:** PaymentElement enabled but transaction doesn't have a Payment Intent yet.

**Solution:** Ensure transaction has been initiated and has a client secret before enabling PaymentElement.

### Issue: "Invalid value for confirmCardPayment.payment_method"

**Cause:** Using wrong Stripe API for the active element type.

**Solution:** Check logs for correct flow:
- `[stripe] flow: PaymentElement/confirmPayment` → should call `confirmPayment`
- `[stripe] flow: CardElement/confirmCardPayment` → should call `confirmCardPayment`

### Issue: Elements not mounting

**Cause:** Race condition or initialization order issue.

**Solution:** Check logs:
```
[Stripe] Skipping element initialization: { hasHandledCardPayment, defaultPaymentMethod, loadingData }
```

## Benefits of This Approach

✅ **Zero Risk:** Default behavior unchanged (CardElement)  
✅ **Easy Testing:** Flip one env var to test PaymentElement  
✅ **Clear Logging:** Console shows which flow is active  
✅ **Error Safety:** Summarized errors prevent circular ref issues  
✅ **Gradual Rollout:** Can enable per-environment or per-user  
✅ **Rollback Ready:** Switch back instantly if issues arise  

## Files Modified

1. `src/util/envFlags.js` - Feature flag definition
2. `src/containers/CheckoutPage/CheckoutPageWithPayment.js` - Flag consumption
3. `src/containers/CheckoutPage/CheckoutPageTransactionHelpers.js` - Branching logic
4. `src/ducks/stripe.duck.js` - New `confirmPayment` action + enhanced logging
5. `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js` - Dual element support

## Commit Message

```
chore(stripe): add PaymentElement feature flag (default off); fix submit branching; improve error logging

- Add REACT_APP_USE_STRIPE_PAYMENT_ELEMENT env flag (default: false)
- Export USE_PAYMENT_ELEMENT from util/envFlags.js
- Branch correctly: confirmPayment (PaymentElement) vs confirmCardPayment (CardElement)
- Add detailed console logging for both flows
- Summarize Stripe errors to prevent circular ref issues
- Elements only created with clientSecret when PaymentElement enabled
- Pre-submit logging shows flag state and ready status
- Stable on CardElement for production/test environments
```


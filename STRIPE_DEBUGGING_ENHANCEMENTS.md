# Stripe Debugging Enhancements Implementation

## Summary
Implemented 4 critical debugging and enhancement steps to diagnose and fix the Stripe PaymentIntent/Elements mounting flow in the checkout process.

## Changes Made

### 1. Enhanced Logging for Speculate Success
**File:** `src/containers/CheckoutPage/CheckoutPage.duck.js`

#### In the Thunk (speculateTransaction)
Added `[SPECULATE_SUCCESS_RAW]` log in the `handleSuccess` callback (line 675):
```javascript
console.log('[SPECULATE_SUCCESS_RAW]', {
  keys: Object.keys(response || {}),
  txKeys: Object.keys(tx || {}),
  attrKeys: Object.keys(tx?.attributes || {}),
  protectedDataKeys: Object.keys(tx?.attributes?.protectedData || {}),
  metadataKeys: Object.keys(tx?.attributes?.metadata || {}),
});
```

#### In the Reducer (SPECULATE_TRANSACTION_SUCCESS)
Updated reducer to construct state and log after construction (lines 107-124):
```javascript
const tx = payload.transaction;

// Extract Stripe client secret from transaction attributes
const clientSecret =
  tx?.attributes?.protectedData?.stripePaymentIntentClientSecret ||
  tx?.attributes?.metadata?.stripePaymentIntentClientSecret ||
  null;

const next = {
  ...state,
  speculateTransactionInProgress: false,
  speculatedTransaction: tx,
  isClockInSync: Math.abs(lastTransitionedAt?.getTime() - localTime.getTime()) < minute,
  speculateStatus: 'succeeded',
  stripeClientSecret: clientSecret,
  speculativeTransactionId: tx?.id?.uuid || tx?.id || null,
};

// Log after state construction
console.log('[POST-SPECULATE]', {
  txId: next.speculativeTransactionId,
  clientSecretPresent: !!next.stripeClientSecret,
  clientSecretLen: next.stripeClientSecret?.length || 0,
});

return next;
```

**Why:** If `[POST-SPECULATE]` shows `clientSecretPresent: false`, it means the backend isn't placing the secret in protectedData/metadata on speculation. This is the critical diagnostic to identify the blocker.

---

### 2. Force Retrieve Effect with Idempotent Guard
**File:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

Updated the retrieve PaymentIntent effect (lines 965-976):
```javascript
useEffect(() => {
  if (!stripe || !stripeClientSecret) return;
  if (retrievedRef.current === stripeClientSecret) return;

  console.log('[STRIPE] Retrieving PaymentIntent with clientSecret');
  props.onRetrievePaymentIntent({
    stripe,
    stripePaymentIntentClientSecret: stripeClientSecret,
  });

  retrievedRef.current = stripeClientSecret;
}, [stripe, stripeClientSecret, props.onRetrievePaymentIntent]);
```

**Key Features:**
- **Exact dependencies:** `[stripe, stripeClientSecret, props.onRetrievePaymentIntent]`
- **Idempotent guard:** `retrievedRef` prevents duplicate calls for the same clientSecret
- **Early returns:** Ensures all prerequisites are met before calling

---

### 3. Readable Submit Gates Logging
**File:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

Updated submit gates logging (lines 998-1016):
```javascript
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
```

**Output Example:**
```
[SUBMIT_GATES] {
  hasSpeculativeTx: true,
  stripeReady: true,
  paymentElementComplete: false,  // ← The blocker
  formValid: true,
  notSubmitting: true,
  canSubmit: false
}
```

---

### 4. Enhanced Stripe Duck Success Handler
**File:** `src/ducks/stripe.duck.js`

Updated `RETRIEVE_PAYMENT_INTENT_SUCCESS` logging (lines 136-141):
```javascript
case RETRIEVE_PAYMENT_INTENT_SUCCESS:
  console.log('[STRIPE] PaymentIntent retrieved successfully', {
    hasPI: !!payload,
    tail: payload?.client_secret?.slice(-6),
  });
  return { ...state, paymentIntent: payload, retrievePaymentIntentInProgress: false };
```

---

## Diagnostic Flow

When running the checkout flow, you'll now see this sequence in the console:

1. **`[SPECULATE_SUCCESS_RAW]`** - Shows what the backend returned
2. **`[POST-SPECULATE]`** - Shows if clientSecret was extracted and stored
   - **If `clientSecretPresent: false`** → Backend issue (not writing secret to protectedData/metadata)
   - **If `clientSecretPresent: true`** → Continue to next step
3. **`[STRIPE] Retrieving PaymentIntent`** - Should trigger once secret is available
4. **`[STRIPE] PaymentIntent retrieved successfully`** - Confirms PaymentIntent is in Redux state
5. **`[SUBMIT_GATES]`** - Shows why submit button is disabled

## What to Do If clientSecret Is Missing

If `[POST-SPECULATE]` shows `clientSecretPresent: false`, the backend isn't creating/returning the PaymentIntent during speculation. Options:

### Option A: Fix Backend (Recommended)
Ensure your backend transition that runs during speculation:
1. Creates a Stripe PaymentIntent
2. Writes the client secret into one of:
   - `transaction.attributes.protectedData.stripePaymentIntentClientSecret`
   - `transaction.attributes.metadata.stripePaymentIntentClientSecret`
3. Returns this even on public (non-privileged) speculate calls

### Option B: Add Backend Endpoint
Create a new endpoint that:
1. Accepts the speculative transaction data
2. Creates the PaymentIntent server-side
3. Returns the client secret to the frontend
4. Frontend sets it in Redux (but keeps it server-originated)

**Until the secret exists, the retrieve effect won't run, Elements won't mount, and submit stays disabled.**

---

## Testing Checklist

- [ ] Navigate to checkout page
- [ ] Check console for `[SPECULATE_SUCCESS_RAW]` - verify structure
- [ ] Check console for `[POST-SPECULATE]` - verify `clientSecretPresent: true`
- [ ] Check console for `[STRIPE] Retrieving PaymentIntent` - should appear once
- [ ] Check console for `[STRIPE] PaymentIntent retrieved successfully`
- [ ] Check console for `[SUBMIT_GATES]` - all gates should be `true` when form is complete
- [ ] Verify Stripe Elements mount and accept card input
- [ ] Verify submit button enables when all gates pass
- [ ] Complete a test transaction

---

## Files Modified

1. `src/containers/CheckoutPage/CheckoutPage.duck.js` - Enhanced speculation logging and state handling
2. `src/containers/CheckoutPage/CheckoutPageWithPayment.js` - Fixed retrieve effect and submit gates logging
3. `src/ducks/stripe.duck.js` - Enhanced PaymentIntent retrieval logging

---

## Next Steps

1. **Test the flow** in your local/dev environment
2. **Monitor console logs** to identify exactly where the flow breaks
3. **If clientSecret is missing:** Check your backend speculation transition
4. **If clientSecret exists but retrieval fails:** Check Stripe publishable key and network
5. **If retrieval succeeds but Elements don't mount:** Check StripePaymentForm component

---

## Related Documentation

- [Stripe PaymentIntents API](https://stripe.com/docs/payments/payment-intents)
- [Stripe Elements](https://stripe.com/docs/stripe-js)
- [Speculation Transitions](/docs/transaction-processes.md)



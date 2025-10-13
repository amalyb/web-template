# Speculation → ClientSecret → PaymentIntent Wiring Implementation

## Objective
Wire the checkout flow so that speculation success properly extracts the Stripe client secret, stores it in Redux, triggers PaymentIntent retrieval, and enables the submit button.

## Changes Made

### 1. Enhanced Client Secret Extraction (CheckoutPage.duck.js)

#### SPECULATE_TRANSACTION_SUCCESS Reducer (Lines 93-124)
- **Try both paths** for client secret:
  - `tx?.attributes?.protectedData?.stripePaymentIntentClientSecret`
  - `tx?.attributes?.metadata?.stripePaymentIntentClientSecret`
- **Enhanced logging** to show payload structure:
  ```javascript
  console.log('[SPECULATE_SUCCESS_PAYLOAD]', {
    keys: Object.keys(payload.transaction?.attributes || {}),
    hasProtectedData: !!payload.transaction?.attributes?.protectedData,
    protectedDataKeys: Object.keys(payload.transaction?.attributes?.protectedData || {}),
    hasMetadata: !!payload.transaction?.attributes?.metadata,
    metadataKeys: Object.keys(payload.transaction?.attributes?.metadata || {}),
    hasClientSecret: !!clientSecret,
    clientSecretLength: clientSecret?.length || 0,
  });
  ```

#### INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS Reducer (Lines 166-207)
- **Added payload structure logging** to diagnose missing client secrets:
  ```javascript
  console.log('[SPECULATE_SUCCESS_PAYLOAD_KEYS]', {
    attributeKeys: Object.keys(tx?.attributes || {}),
    hasProtectedData: !!tx?.attributes?.protectedData,
    protectedDataKeys: Object.keys(tx?.attributes?.protectedData || {}),
    hasMetadata: !!tx?.attributes?.metadata,
    metadataKeys: Object.keys(tx?.attributes?.metadata || {}),
  });
  ```
- **Try both paths** for client secret extraction (same as above)
- **Verification log** immediately after state update:
  ```javascript
  console.log('[POST-SPECULATE]', {
    speculativeTransactionId: newState.speculativeTransactionId,
    clientSecretPresent: !!newState.stripeClientSecret,
    clientSecretLen: newState.stripeClientSecret?.length || 0,
  });
  ```
- This log fires **in the reducer** to verify state is being set correctly

#### speculateTransaction Thunk Success Handler (Lines 667-689)
- **Enhanced logging** with both paths checked:
  ```javascript
  console.log('[speculate] success', {
    txId: tx?.id?.uuid || tx?.id,
    hasClientSecret: !!clientSecret,
    clientSecretLength: clientSecret?.length || 0,
    protectedDataKeys: Object.keys(tx?.attributes?.protectedData || {}),
    metadataKeys: Object.keys(tx?.attributes?.metadata || {}),
  });
  ```

### 2. Enhanced PaymentIntent Retrieval Logging (stripe.duck.js)

#### RETRIEVE_PAYMENT_INTENT_SUCCESS Reducer (Lines 136-142)
- **Enhanced success logging**:
  ```javascript
  console.log('[STRIPE] PaymentIntent retrieved successfully', {
    hasPI: !!payload,
    clientSecretTail: payload?.client_secret?.slice(-6),
    status: payload?.status,
  });
  ```

### 3. Component Effects (CheckoutPageWithPayment.js)

These were already in place (no changes needed):

#### POST-SPECULATE Effect (Lines 953-961)
- Logs when speculation succeeds:
  ```javascript
  useEffect(() => {
    if (speculateStatus === 'succeeded') {
      console.log('[POST-SPECULATE]', {
        speculativeTransactionId: props?.speculativeTransactionId,
        clientSecretPresent: !!stripeClientSecret,
        clientSecretLength: stripeClientSecret?.length || 0,
      });
    }
  }, [speculateStatus, props?.speculativeTransactionId, stripeClientSecret]);
  ```

#### Retrieve PaymentIntent Effect (Lines 965-979)
- Automatically retrieves PaymentIntent when clientSecret becomes available:
  ```javascript
  useEffect(() => {
    if (!stripeClientSecret) return;
    if (retrievedRef.current === stripeClientSecret) return;
    if (!stripe || !props.onRetrievePaymentIntent) return;
    
    console.log('[STRIPE] Retrieving PaymentIntent with clientSecret');
    props.onRetrievePaymentIntent({ 
      stripe, 
      stripePaymentIntentClientSecret: stripeClientSecret 
    })
      .catch(err => {
        console.error('[STRIPE] Failed to retrieve PaymentIntent:', err);
      });
    retrievedRef.current = stripeClientSecret;
  }, [stripeClientSecret, stripe, props.onRetrievePaymentIntent]);
  ```

#### Submit Gates Logging (Lines 1002-1014)
- Logs all gate states for debugging:
  ```javascript
  useEffect(() => {
    const hasSpeculativeTx = !!props.speculativeTransactionId;
    const canSubmit = hasSpeculativeTx && stripeReady && paymentElementComplete && formValid && !submitting;
    
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

### 4. Form PaymentIntent Logging (StripePaymentForm.js)

Already in place (no changes needed):

#### Render Method (Lines 1042-1045)
- Logs when paymentIntent prop is first received:
  ```javascript
  if (!this.loggedPaymentIntent && paymentIntent) {
    console.log('[STRIPE_FORM] paymentIntent present:', !!paymentIntent);
    this.loggedPaymentIntent = true;
  }
  ```

## Expected Console Log Sequence

After these changes, you should see the following logs in order:

```
1. [Checkout] triggering speculate…
2. [INITIATE_TX] about to dispatch
3. [speculate] dispatching { … }
4. [Sherbrt] ⛔ Attempted privileged speculation without auth token (warning only, not blocking)
5. [SPECULATE_SUCCESS_PAYLOAD_KEYS] { attributeKeys: […], protectedDataKeys: […], … }
6. [speculate] success { hasClientSecret: true, clientSecretLength: 75, … }
7. [INITIATE_TX] success { hasClientSecret: true, clientSecretLength: 75 }
8. [POST-SPECULATE] { clientSecretPresent: true ✅, clientSecretLen: 75 }
9. [STRIPE] Retrieving PaymentIntent with clientSecret
10. [STRIPE] PaymentIntent retrieved successfully { hasPI: true, clientSecretTail: '…abc123' }
11. [STRIPE_FORM] paymentIntent present: true
12. [Stripe] 🎯 Elements mounted with clientSecret: …abc123
13. [SUBMIT_GATES] { hasSpeculativeTx: true, stripeReady: true, … canSubmit: true }
```

## Troubleshooting

### If `[POST-SPECULATE]` shows `clientSecretPresent: false`:

Check the `[SPECULATE_SUCCESS_PAYLOAD_KEYS]` log to see:
1. Does `protectedDataKeys` include `stripePaymentIntentClientSecret`?
2. Does `metadataKeys` include `stripePaymentIntentClientSecret`?
3. If neither, the **server** is not returning the client secret - fix server-side code

### If `[STRIPE] Retrieving PaymentIntent…` never appears:

1. Check that `stripeClientSecret` is truthy in Redux state
2. Check that `stripe` instance is initialized (from Stripe.js)
3. Check that `props.onRetrievePaymentIntent` is defined (should be mapped from `retrievePaymentIntent` action)

### If `[SUBMIT_GATES]` shows `stripeReady: false`:

1. Check that Elements mounted successfully
2. Check that `onStripeElementMounted(true)` was called
3. Check that `paymentIntent` is present in StripePaymentForm props

## Auth Guard Behavior

The warning `[Sherbrt] ⛔ Attempted privileged speculation without auth token` may appear but **does not block** the speculation flow. The code has multiple auth checks:

1. **Primary check**: `currentUser?.id` exists (sufficient for authenticated users)
2. **Secondary check**: `sdk?.authToken` and cookie check (may fail due to SDK internals)

The SDK manages authentication internally via HTTP-only cookies. The `sdk?.authToken` property is not exposed, so this check may produce false warnings for authenticated users. However, the flow continues because:
- The primary `currentUser?.id` check passes
- The fallback speculation path succeeds
- The API accepts the request (user is actually authenticated)

## Files Modified

1. **src/containers/CheckoutPage/CheckoutPage.duck.js**
   - Enhanced client secret extraction (try both paths)
   - Added payload structure logging
   - Added reducer-level POST-SPECULATE verification log
   - Enhanced thunk success logging

2. **src/ducks/stripe.duck.js**
   - Enhanced RETRIEVE_PAYMENT_INTENT_SUCCESS logging

3. **No changes needed** (already correct):
   - src/containers/CheckoutPage/CheckoutPageWithPayment.js
   - src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js

## Testing Checklist

- [ ] Speculation succeeds and logs show `hasClientSecret: true`
- [ ] `[POST-SPECULATE]` log shows `clientSecretPresent: true`
- [ ] `[STRIPE] Retrieving PaymentIntent with clientSecret` appears
- [ ] `[STRIPE] PaymentIntent retrieved successfully` appears
- [ ] `[STRIPE_FORM] paymentIntent present: true` appears
- [ ] Stripe Elements mount successfully
- [ ] `[SUBMIT_GATES]` shows `canSubmit: true` after filling form
- [ ] Submit button becomes enabled
- [ ] Payment completes successfully

## Next Steps

1. Test the checkout flow end-to-end
2. Monitor console logs to verify the sequence
3. If `clientSecretPresent: false`, check server-side transaction creation
4. If PaymentIntent retrieval fails, check Stripe API keys and network



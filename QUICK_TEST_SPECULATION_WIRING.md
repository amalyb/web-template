# Quick Test: Speculation → ClientSecret → PaymentIntent Wiring

## What Was Fixed

Enhanced the checkout flow to properly capture and log the Stripe client secret from speculation responses, with dual-path extraction and comprehensive diagnostics.

## Changes Summary

### ✅ CheckoutPage.duck.js
- Try **both paths** for clientSecret extraction:
  - `protectedData.stripePaymentIntentClientSecret`
  - `metadata.stripePaymentIntentClientSecret`
- Added `[SPECULATE_SUCCESS_PAYLOAD_KEYS]` log to show response structure
- Added reducer-level `[POST-SPECULATE]` verification log
- Enhanced all logging with clientSecret length tracking

### ✅ stripe.duck.js  
- Enhanced `RETRIEVE_PAYMENT_INTENT_SUCCESS` logging with PaymentIntent status

### ✅ Already Working (No Changes)
- CheckoutPageWithPayment.js effects
- StripePaymentForm.js logging
- Submit gates logging

## Test Procedure

### 1. Start Development Server
```bash
npm run dev
```

### 2. Navigate to Listing Page
- Go to any listing with booking capability
- Select booking dates
- Click "Request to book"

### 3. Monitor Console Logs

You should see this sequence:

```
✅ [Checkout] triggering speculate…
✅ [INITIATE_TX] about to dispatch
✅ [speculate] dispatching
⚠️  [Sherbrt] ⛔ Attempted privileged speculation without auth token
   (This is a warning only - doesn't block the flow)
   
🔍 [SPECULATE_SUCCESS_PAYLOAD_KEYS] {
     attributeKeys: […],
     hasProtectedData: true,
     protectedDataKeys: ['stripePaymentIntentClientSecret', …],
     hasMetadata: false,
     metadataKeys: []
   }
   
✅ [speculate] success {
     hasClientSecret: true,
     clientSecretLength: 75
   }
   
✅ [INITIATE_TX] success {
     hasClientSecret: true,
     clientSecretLength: 75
   }
   
✅ [POST-SPECULATE] {
     clientSecretPresent: true ✅,
     clientSecretLen: 75
   }
   
✅ [STRIPE] Retrieving PaymentIntent with clientSecret

✅ [STRIPE] PaymentIntent retrieved successfully {
     hasPI: true,
     clientSecretTail: '…abc123',
     status: 'requires_payment_method'
   }
   
✅ [STRIPE_FORM] paymentIntent present: true

✅ [Stripe] 🎯 Elements mounted with clientSecret: …abc123

✅ [SUBMIT_GATES] {
     hasSpeculativeTx: true,
     stripeReady: true,
     paymentElementComplete: false,  // ← changes to true after filling card
     formValid: false,                // ← changes to true after filling form
     notSubmitting: true,
     canSubmit: false                 // ← changes to true when all gates pass
   }
```

### 4. Fill Payment Form
- Enter test card: 4242 4242 4242 4242
- Enter any future expiry date
- Enter any 3-digit CVC
- Fill billing address

### 5. Verify Submit Button Enables

After filling all required fields, you should see:
```
✅ [SUBMIT_GATES] {
     hasSpeculativeTx: true,
     stripeReady: true,
     paymentElementComplete: true,
     formValid: true,
     notSubmitting: true,
     canSubmit: true ✅  // Submit button should now be enabled!
   }
```

## Troubleshooting

### ❌ Issue: `clientSecretPresent: false`

**Check the `[SPECULATE_SUCCESS_PAYLOAD_KEYS]` log:**

If you see:
```javascript
{
  protectedDataKeys: [],  // ← Empty!
  metadataKeys: []        // ← Also empty!
}
```

**Root Cause:** The server is not returning the Stripe client secret in the transaction response.

**Fix:** Update your server-side transaction creation code to include the client secret:
- Check `server/api-util/lineItems.js` or similar
- Ensure Stripe PaymentIntent is created during speculation
- Ensure `stripePaymentIntentClientSecret` is added to `protectedData` or `metadata`

### ❌ Issue: `[STRIPE] Retrieving PaymentIntent…` never appears

**Possible causes:**
1. `stripeClientSecret` is null (see above)
2. `stripe` instance not initialized
3. Effect dependencies not triggering

**Debug:**
```javascript
// In CheckoutPageWithPayment.js effect (line 965)
console.log('Debug retrieve effect:', {
  hasClientSecret: !!stripeClientSecret,
  hasStripe: !!stripe,
  hasHandler: !!props.onRetrievePaymentIntent,
  alreadyRetrieved: retrievedRef.current === stripeClientSecret,
});
```

### ❌ Issue: `stripeReady` stays false

**Possible causes:**
1. PaymentIntent not retrieved
2. StripePaymentForm not receiving `paymentIntent` prop
3. Elements not mounting

**Debug:**
Check for `[STRIPE_FORM] paymentIntent present: true` log.
Check for `[Stripe] 🎯 Elements mounted` log.

### ⚠️ Warning: Auth token message

The warning:
```
[Sherbrt] ⛔ Attempted privileged speculation without auth token
```

**Is expected and does NOT block the flow.** This warning occurs because:
- The SDK doesn't expose `authToken` property
- Auth is managed via HTTP-only cookies
- The primary `currentUser?.id` check passes
- Speculation succeeds via fallback path

## Success Criteria

- [x] Build completes successfully
- [ ] Speculation succeeds with `hasClientSecret: true`
- [ ] `[POST-SPECULATE]` shows `clientSecretPresent: true`
- [ ] PaymentIntent is retrieved
- [ ] Stripe Elements mount
- [ ] Submit button becomes enabled after filling form
- [ ] Payment can be completed

## Quick Verification Commands

### Check if server includes client secret:
```bash
# Look for Stripe PaymentIntent creation in server code
grep -r "stripePaymentIntentClientSecret" server/
```

### Check Redux state in browser console:
```javascript
// In browser console
window.app.store.getState().CheckoutPage.stripeClientSecret
// Should show: "pi_xxx_secret_yyy" (75 characters)

window.app.store.getState().stripe.paymentIntent
// Should show: { id: "pi_xxx", client_secret: "...", status: "..." }
```

## Production Deployment

Before deploying:
1. ✅ Test entire checkout flow end-to-end
2. ✅ Verify logs show correct sequence
3. ✅ Test with real Stripe test keys
4. ✅ Test payment completion
5. ✅ Verify transaction is created correctly

After these verifications, the changes are safe to deploy.



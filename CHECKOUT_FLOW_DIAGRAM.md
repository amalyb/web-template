# Checkout Flow: Speculation → ClientSecret → PaymentIntent

## Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ USER ACTION: Click "Request to book"                                    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPageWithPayment.js                                               │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ useEffect: Initiate speculation when orderParams ready            │   │
│ │ Calls: onInitiatePrivilegedSpeculativeTransaction(params)         │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [Checkout] triggering speculate…                                   │
│ LOG: [INITIATE_TX] about to dispatch                                    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPage.duck.js                                                     │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ initiatePrivilegedSpeculativeTransactionIfNeeded()                │   │
│ │ ✓ Check: currentUser?.id exists (AUTH GUARD #1)                  │   │
│ │ ⚠️  Check: sdk?.authToken (AUTH GUARD #2 - may produce warning)  │   │
│ │ → Calls: speculateTransaction(params, …, isPrivileged=true)      │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [speculate] dispatching                                            │
│ LOG: ⚠️  [Sherbrt] ⛔ Attempted… (if auth guard #2 triggers warning)    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ SDK API Call                                                             │
│ POST /transactions/speculate                                             │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ Body: { processAlias, transition, params: { listingId, dates } } │   │
│ │ Headers: { Authorization: "Bearer <token from cookie>" }         │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│ SERVER RESPONSE:                                                         │
│ {                                                                         │
│   id: "tx-uuid",                                                          │
│   attributes: {                                                           │
│     protectedData: {                                                      │
│       stripePaymentIntentClientSecret: "pi_xxx_secret_yyy"  ← KEY!      │
│     }                                                                     │
│   }                                                                       │
│ }                                                                         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPage.duck.js - handleSuccess()                                   │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ Extract clientSecret (try both paths):                            │   │
│ │   1. tx.attributes.protectedData.stripePaymentIntentClientSecret │   │
│ │   2. tx.attributes.metadata.stripePaymentIntentClientSecret      │   │
│ │                                                                    │   │
│ │ → Dispatch: speculateTransactionSuccess(tx)                       │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [speculate] success { hasClientSecret: true, length: 75 }          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPage.duck.js - SPECULATE_TRANSACTION_SUCCESS Reducer            │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ Update Redux State:                                                │   │
│ │   speculatedTransaction: tx                                        │   │
│ │   stripeClientSecret: clientSecret  ← STORED IN REDUX             │   │
│ │   speculateStatus: 'succeeded'                                     │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [SPECULATE_SUCCESS_PAYLOAD] (shows response structure)             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPage.duck.js - INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS    │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ Update Redux State:                                                │   │
│ │   speculativeTransactionId: tx.id                                  │   │
│ │   stripeClientSecret: clientSecret  ← VERIFIED                    │   │
│ │   speculateStatus: 'succeeded'                                     │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [SPECULATE_SUCCESS_PAYLOAD_KEYS] (diagnostic structure)            │
│ LOG: [INITIATE_TX] success { hasClientSecret: true }                    │
│ LOG: [POST-SPECULATE] { clientSecretPresent: true } ← VERIFICATION      │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPageWithPayment.js - Redux props update                          │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ mapStateToProps receives new state:                                │   │
│ │   stripeClientSecret: "pi_xxx_secret_yyy"                          │   │
│ │   speculativeTransactionId: "tx-uuid"                              │   │
│ │   speculateStatus: 'succeeded'                                     │   │
│ └───────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPageWithPayment.js - useEffect (POST-SPECULATE logging)          │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ if (speculateStatus === 'succeeded') {                            │   │
│ │   console.log('[POST-SPECULATE]', ...)                            │   │
│ │ }                                                                   │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [POST-SPECULATE] { clientSecretPresent: true, length: 75 }         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPageWithPayment.js - useEffect (retrieve PaymentIntent)          │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ if (stripeClientSecret && !retrievedRef.current) {                │   │
│ │   props.onRetrievePaymentIntent({                                 │   │
│ │     stripe,                                                        │   │
│ │     stripePaymentIntentClientSecret                               │   │
│ │   })                                                               │   │
│ │ }                                                                   │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [STRIPE] Retrieving PaymentIntent with clientSecret                │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ stripe.duck.js - retrievePaymentIntent()                                 │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ Call Stripe.js API:                                                │   │
│ │   stripe.retrievePaymentIntent(clientSecret)                      │   │
│ │                                                                    │   │
│ │ Returns: Full PaymentIntent object with status, etc.              │   │
│ └───────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ stripe.duck.js - RETRIEVE_PAYMENT_INTENT_SUCCESS Reducer                │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ Update Redux State:                                                │   │
│ │   paymentIntent: {                                                 │   │
│ │     id: "pi_xxx",                                                  │   │
│ │     client_secret: "pi_xxx_secret_yyy",                           │   │
│ │     status: "requires_payment_method"                             │   │
│ │   }                                                                │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [STRIPE] PaymentIntent retrieved successfully                       │
│      { hasPI: true, clientSecretTail: '…yyy', status: '…' }             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ StripePaymentForm.js - receives paymentIntent prop                       │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ render() {                                                         │   │
│ │   const { paymentIntent } = this.props                            │   │
│ │                                                                    │   │
│ │   // paymentIntent is now available for Stripe Elements           │   │
│ │ }                                                                   │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [STRIPE_FORM] paymentIntent present: true                           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ StripePaymentForm.js - initializeStripeElement()                         │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ const elements = stripe.elements(options)                         │   │
│ │ const card = elements.create('card', { style })                   │   │
│ │ card.mount(containerElement)                                       │   │
│ │                                                                    │   │
│ │ → Call: onStripeElementMounted(true)                              │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [Stripe] 🎯 Elements mounted with clientSecret: …yyy                │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPageWithPayment.js - State Update                                │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ setStripeElementMounted(true)                                     │   │
│ │ → stripeReady = true                                               │   │
│ └───────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPageWithPayment.js - Submit Gates Update                         │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ const canSubmit =                                                  │   │
│ │   hasSpeculativeTx      = true  ✓                                 │   │
│ │   && stripeReady        = true  ✓                                 │   │
│ │   && paymentElementComplete     (waiting for user input)          │   │
│ │   && formValid                  (waiting for user input)          │   │
│ │   && !submitting        = true  ✓                                 │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [SUBMIT_GATES] { …, stripeReady: true, canSubmit: false }          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ USER ACTION: Fill card details & billing form                            │
│ - Card: 4242 4242 4242 4242                                             │
│ - Expiry: Any future date                                                │
│ - CVC: Any 3 digits                                                      │
│ - Billing address: Complete form                                         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CheckoutPageWithPayment.js - All Gates Pass                              │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ const canSubmit =                                                  │   │
│ │   hasSpeculativeTx      = true  ✓                                 │   │
│ │   && stripeReady        = true  ✓                                 │   │
│ │   && paymentElementComplete = true  ✓                             │   │
│ │   && formValid          = true  ✓                                 │   │
│ │   && !submitting        = true  ✓                                 │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│ LOG: [SUBMIT_GATES] { …, canSubmit: true }                              │
│                                                                           │
│ SUBMIT BUTTON: ENABLED ✅                                                │
└───────────────────────────────────────────────────────────────────────┘
```

## Critical Success Points

### 1. Client Secret Extraction
**Location:** CheckoutPage.duck.js reducers
**Verification:** `[POST-SPECULATE] { clientSecretPresent: true }`
**If fails:** Check `[SPECULATE_SUCCESS_PAYLOAD_KEYS]` to see response structure

### 2. PaymentIntent Retrieval
**Location:** CheckoutPageWithPayment.js effect → stripe.duck.js thunk
**Verification:** `[STRIPE] PaymentIntent retrieved successfully`
**If fails:** Check that `stripeClientSecret` and `stripe` instance are truthy

### 3. Elements Mount
**Location:** StripePaymentForm.js initializeStripeElement()
**Verification:** `[Stripe] 🎯 Elements mounted`
**If fails:** Check that `paymentIntent` prop is present

### 4. Submit Button Enable
**Location:** CheckoutPageWithPayment.js canSubmit calculation
**Verification:** `[SUBMIT_GATES] { canSubmit: true }`
**If fails:** Check which gate is false in the log

## Key Enhancement: Dual-Path Extraction

```javascript
// Before (single path)
const clientSecret = tx?.attributes?.protectedData?.stripePaymentIntentClientSecret;

// After (dual path - more robust)
const clientSecret =
  tx?.attributes?.protectedData?.stripePaymentIntentClientSecret ||
  tx?.attributes?.metadata?.stripePaymentIntentClientSecret ||
  null;
```

This ensures compatibility regardless of where the server places the client secret.



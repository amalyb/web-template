# Stripe PaymentIntent Flow - Visual Diagram

## 🔄 Complete Flow with Fix

```
┌─────────────────────────────────────────────────────────────────┐
│                      USER ACTION                                 │
│  User clicks "Book Now" → Selects dates → Fills checkout form  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CLIENT: CheckoutPage                           │
│  - User fills form → onChange → speculateTransaction()          │
│  - Calls: initiatePrivilegedSpeculativeTransaction()            │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP POST
                             │ /api/initiate-privileged
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              SERVER: initiate-privileged.js                      │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐          │
│  │ 1. Extract orderData & protectedData from req    │          │
│  │    console.log('[initiate] forwarding PD keys')  │          │
│  └────────────────────┬─────────────────────────────┘          │
│                       │                                          │
│                       ▼                                          │
│  ┌──────────────────────────────────────────────────┐          │
│  │ 2. Fetch listing & calculate lineItems           │          │
│  │    console.log('🌙 Calculated nights')           │          │
│  └────────────────────┬─────────────────────────────┘          │
│                       │                                          │
│                       ▼                                          │
│  ┌──────────────────────────────────────────────────┐          │
│  │ 3. ✅ NEW: Create Stripe PaymentIntent           │          │
│  │                                                   │          │
│  │    // Calculate payin total                      │          │
│  │    const payinTotal = lineItems.reduce(...)      │          │
│  │    const currency = 'usd'                        │          │
│  │    console.log('[PI] Calculated payment:', ...)  │          │
│  │                                                   │          │
│  │    // Create or update with Stripe API           │          │
│  │    const intent = await stripe                   │          │
│  │      .paymentIntents.create({                    │          │
│  │        amount: payinTotal,                       │          │
│  │        currency,                                 │          │
│  │        automatic_payment_methods: {              │          │
│  │          enabled: true                           │          │
│  │        }                                         │          │
│  │      })                                          │          │
│  │                                                   │          │
│  │    // Extract real values                        │          │
│  │    const paymentIntentId = intent.id             │          │
│  │    const clientSecret = intent.client_secret     │          │
│  │                                                   │          │
│  │    console.log('[PI]', {                         │          │
│  │      idTail: 'pi_...1234',                       │          │
│  │      secretLooksRight: true                      │          │
│  │    })                                            │          │
│  │                                                   │          │
│  │    // ✅ Merge into protectedData                │          │
│  │    updatedProtectedData = {                      │          │
│  │      ...finalProtectedData,                      │          │
│  │      stripePaymentIntents: {                     │          │
│  │        default: {                                │          │
│  │          stripePaymentIntentId: 'pi_...',        │          │
│  │          stripePaymentIntentClientSecret:        │          │
│  │            'pi_3XXX_secret_YYY'  ← REAL SECRET   │          │
│  │        }                                         │          │
│  │      }                                           │          │
│  │    }                                             │          │
│  └────────────────────┬─────────────────────────────┘          │
│                       │                                          │
│                       ▼                                          │
│  ┌──────────────────────────────────────────────────┐          │
│  │ 4. Call Flex SDK with updated protectedData      │          │
│  │                                                   │          │
│  │    const body = {                                │          │
│  │      ...bodyParams,                              │          │
│  │      params: {                                   │          │
│  │        protectedData: updatedProtectedData,      │          │
│  │        lineItems                                 │          │
│  │      }                                           │          │
│  │    }                                             │          │
│  │                                                   │          │
│  │    apiResponse = await sdk.transactions          │          │
│  │      .initiateSpeculative(body, queryParams)     │          │
│  └────────────────────┬─────────────────────────────┘          │
│                       │                                          │
│                       ▼                                          │
│  ┌──────────────────────────────────────────────────┐          │
│  │ 5. Log PI tails for verification                 │          │
│  │                                                   │          │
│  │    console.log('[PI_TAILS]', {                   │          │
│  │      idTail: 'pi_...1234',                       │          │
│  │      secretTail: 'pi_...cret',                   │          │
│  │      looksLikePI: true,                          │          │
│  │      looksLikeSecret: true,                      │          │
│  │      secretPrefix: 'pi_'                         │          │
│  │    })                                            │          │
│  └────────────────────┬─────────────────────────────┘          │
└────────────────────────┼────────────────────────────────────────┘
                         │ HTTP Response
                         │ (includes tx with protectedData)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│           CLIENT: CheckoutPage.duck.js Reducer                   │
│                                                                  │
│  INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐          │
│  │ 1. Extract protectedData from transaction        │          │
│  │                                                   │          │
│  │    const pd = tx?.attributes?.protectedData      │          │
│  │    const nested = pd?.stripePaymentIntents       │          │
│  │                     ?.default                    │          │
│  │                                                   │          │
│  │    console.log('[SPECULATE_SUCCESS_RAW]', {      │          │
│  │      hasProtectedData: true,                     │          │
│  │      protectedDataKeys: [...],                   │          │
│  │      hasNestedPI: true                           │          │
│  │    })                                            │          │
│  └────────────────────┬─────────────────────────────┘          │
│                       │                                          │
│                       ▼                                          │
│  ┌──────────────────────────────────────────────────┐          │
│  │ 2. ✅ Extract client secret (prioritize nested)  │          │
│  │                                                   │          │
│  │    // Priority order:                            │          │
│  │    const maybeSecret =                           │          │
│  │      nested?.stripePaymentIntentClientSecret ||  │          │
│  │      pd?.stripePaymentIntentClientSecret ||      │          │
│  │      md?.stripePaymentIntentClientSecret         │          │
│  │                                                   │          │
│  │    // Validate                                   │          │
│  │    const looksStripey =                          │          │
│  │      /_secret_/.test(maybeSecret) ||             │          │
│  │      /^pi_/.test(maybeSecret)                    │          │
│  │                                                   │          │
│  │    const validatedSecret = looksStripey          │          │
│  │      ? maybeSecret                               │          │
│  │      : null                                      │          │
│  │                                                   │          │
│  │    console.log('[POST-SPECULATE]', {             │          │
│  │      pathUsed: 'protectedData.nested.default',   │          │
│  │      looksStripey: true,                         │          │
│  │      tail: '...cret_...'                         │          │
│  │    })                                            │          │
│  └────────────────────┬─────────────────────────────┘          │
│                       │                                          │
│                       ▼                                          │
│  ┌──────────────────────────────────────────────────┐          │
│  │ 3. Store in Redux state                          │          │
│  │                                                   │          │
│  │    return {                                      │          │
│  │      ...state,                                   │          │
│  │      extractedClientSecret: validatedSecret,     │          │
│  │      speculateStatus: 'succeeded'                │          │
│  │    }                                             │          │
│  └────────────────────┬─────────────────────────────┘          │
└────────────────────────┼────────────────────────────────────────┘
                         │
                         │ Redux state update
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│         CLIENT: CheckoutPageWithPayment.js                       │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐          │
│  │ 1. Extract clientSecret from props               │          │
│  │                                                   │          │
│  │    const stripeClientSecret =                    │          │
│  │      extractedClientSecret || ...                │          │
│  │                                                   │          │
│  │    console.log('[Stripe] clientSecret:', cs)     │          │
│  │    const hasValidSecret =                        │          │
│  │      cs?.startsWith('pi_') &&                    │          │
│  │      cs?.includes('_secret_')                    │          │
│  │    console.log('[Stripe] clientSecret valid?',   │          │
│  │      hasValidSecret)                             │          │
│  └────────────────────┬─────────────────────────────┘          │
│                       │                                          │
│                       ▼                                          │
│  ┌──────────────────────────────────────────────────┐          │
│  │ 2. ✅ Mount Elements with valid secret           │          │
│  │                                                   │          │
│  │    {hasValidSecret ? (                           │          │
│  │      <Elements                                   │          │
│  │        stripe={stripePromise}                    │          │
│  │        options={{ clientSecret: cs }}            │          │
│  │        key={cs}  ← Force remount                 │          │
│  │      >                                           │          │
│  │        <StripePaymentForm ... />                 │          │
│  │      </Elements>                                 │          │
│  │    ) : (                                         │          │
│  │      <Banner text="Setting up..." />             │          │
│  │    )}                                            │          │
│  └────────────────────┬─────────────────────────────┘          │
└────────────────────────┼────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│            CLIENT: StripePaymentForm.js                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐          │
│  │ Elements mounts → initializes Stripe SDK         │          │
│  │                                                   │          │
│  │    onStripeElementMounted(element)               │          │
│  │    console.log('[Stripe] element mounted:', true)│          │
│  └────────────────────┬─────────────────────────────┘          │
└────────────────────────┼────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                         UI STATE                                 │
│  ✅ Stripe payment form visible                                 │
│  ✅ Card input field active                                     │
│  ✅ Submit button enabled (when form valid)                     │
│  ❌ NO "Setting up secure payment" banner                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Critical Checkpoints

### Checkpoint 1: Server Creates PaymentIntent
**Log**: `[PI] Creating new PaymentIntent`  
**Validates**: Stripe SDK initialized, API call succeeds  
**If missing**: Check `STRIPE_SECRET_KEY` environment variable

---

### Checkpoint 2: Server Writes Real Secret
**Log**: `[PI] { secretLooksRight: true }`  
**Validates**: Real `pi_..._secret_...` obtained from Stripe  
**If false**: Stripe API error or invalid response

---

### Checkpoint 3: Server Logs PI Tails
**Log**: `[PI_TAILS] looksLikeSecret=true secretPrefix=pi_`  
**Validates**: ProtectedData contains real secret before Flex call  
**If false**: Secret not properly merged into protectedData

---

### Checkpoint 4: Flex Stores Secret
**Log**: `[SERVER_PROXY] PI data from Flex: { secretLooksRight: true }`  
**Validates**: Flex SDK stored secret correctly  
**If false**: Flex SDK mutation or storage issue

---

### Checkpoint 5: Client Extracts Secret
**Log**: `[POST-SPECULATE] { looksStripey: true, pathUsed: '...' }`  
**Validates**: Client reducer finds and validates secret  
**If false**: Secret not in expected path or validation failed

---

### Checkpoint 6: Client Validates Before Render
**Log**: `[Stripe] clientSecret valid? true`  
**Validates**: Secret passes format checks before Elements mount  
**If false**: Secret corrupted or wrong format

---

### Checkpoint 7: Elements Mounts
**Log**: `[Stripe] element mounted: true`  
**Validates**: Stripe SDK initialized with valid secret  
**If false**: Elements component couldn't mount (invalid secret)

---

## 🚨 Failure Points & Fixes

### ❌ Break at Checkpoint 1
**Symptom**: No `[PI] Creating...` log

**Possible Causes**:
- `STRIPE_SECRET_KEY` not set
- `stripe` package not installed
- Transition not `transition/request-payment`
- LineItems empty or missing

**Fix**:
```bash
npm install stripe
echo "STRIPE_SECRET_KEY=sk_..." >> .env
```

---

### ❌ Break at Checkpoint 2
**Symptom**: `secretLooksRight: false`

**Possible Causes**:
- Invalid Stripe API key
- Network error to Stripe API
- Stripe account issue

**Fix**: Check Stripe dashboard, verify key format, check server internet access

---

### ❌ Break at Checkpoint 5
**Symptom**: `looksStripey: false`

**Possible Causes**:
- Flex SDK not storing secret properly
- Secret in different path than expected
- UUID instead of real secret

**Fix**: Check Network tab → Response → Verify `stripePaymentIntents.default.stripePaymentIntentClientSecret` value

---

### ❌ Break at Checkpoint 7
**Symptom**: `element mounted: false`

**Possible Causes**:
- Environment mismatch (live key + test secret)
- Invalid publishable key
- Stripe.js failed to load

**Fix**: Verify `pk_live_...` or `pk_test_...` matches server key mode

---

## 📊 Data Shape at Each Stage

### Stage 1: Server Input
```javascript
{
  lineItems: [
    { code: 'line-item/day', unitPrice: { amount: 2000, currency: 'USD' }, quantity: 3 }
  ]
}
```

### Stage 2: Stripe API Response
```javascript
{
  id: 'pi_3XXX',
  client_secret: 'pi_3XXX_secret_YYY',
  amount: 6000,
  currency: 'usd'
}
```

### Stage 3: Updated ProtectedData
```javascript
{
  customerStreet: '123 Main St',
  customerZip: '12345',
  stripePaymentIntents: {
    default: {
      stripePaymentIntentId: 'pi_3XXX',
      stripePaymentIntentClientSecret: 'pi_3XXX_secret_YYY'
    }
  }
}
```

### Stage 4: Flex Response
```javascript
{
  data: {
    data: {
      id: { uuid: 'tx-123' },
      attributes: {
        protectedData: {
          stripePaymentIntents: {
            default: {
              stripePaymentIntentId: 'pi_3XXX',
              stripePaymentIntentClientSecret: 'pi_3XXX_secret_YYY'
            }
          }
        }
      }
    }
  }
}
```

### Stage 5: Redux State
```javascript
{
  extractedClientSecret: 'pi_3XXX_secret_YYY',
  speculateStatus: 'succeeded'
}
```

### Stage 6: Elements Props
```javascript
<Elements
  stripe={stripePromise}
  options={{
    clientSecret: 'pi_3XXX_secret_YYY'
  }}
  key="pi_3XXX_secret_YYY"
>
```

---

## ✅ Success Flow Summary

1. ✅ Server creates PaymentIntent → `[PI] Creating...`
2. ✅ Stripe returns real secret → `secretLooksRight: true`
3. ✅ Server merges into protectedData → `[PI_TAILS] looksLikeSecret=true`
4. ✅ Flex stores transaction → `[SERVER_PROXY] secretLooksRight: true`
5. ✅ Client extracts secret → `[POST-SPECULATE] looksStripey: true`
6. ✅ Client validates format → `[Stripe] clientSecret valid? true`
7. ✅ Elements mounts → `[Stripe] element mounted: true`
8. ✅ UI renders payment form

**Result**: User can complete checkout! 🎉



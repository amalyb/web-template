# Server-Side PaymentIntent Creation - Implementation Note

## 🎯 Current Architecture

The server **does NOT manually create PaymentIntents**. Instead, Flex automatically creates them via the transaction process action:

```clojure
{:name :action/stripe-create-payment-intent}
```

**Location:** `ext/transaction-processes/default-booking/process.edn:17`

**Flow:**
1. Client calls `/api/initiate-privileged`
2. Server calls Flex SDK: `sdk.transactions.initiate()` or `sdk.transactions.initiateSpeculative()`
3. Flex automatically runs `:action/stripe-create-payment-intent`
4. Flex creates PaymentIntent via Stripe API (using configured `STRIPE_SECRET_KEY`)
5. Flex stores PI data in `transaction.attributes.protectedData.stripePaymentIntents.default`
6. Server receives and returns transaction to client

**This is the CORRECT architecture** - we don't bypass Flex's payment handling.

---

## ⚠️ Current Production Issue

**Problem:** Flex is returning UUIDs instead of real Stripe PaymentIntent data.

**Example response:**
```json
{
  "stripePaymentIntents": {
    "default": {
      "stripePaymentIntentId": "abc-123-def-456",          // ❌ UUID, not pi_*
      "stripePaymentIntentClientSecret": "xyz-789-ghi-012" // ❌ UUID, not *_secret_*
    }
  }
}
```

**Root cause possibilities:**
1. Flex Stripe integration not configured
2. Invalid `STRIPE_SECRET_KEY` in Flex environment
3. Stripe account issue (restricted, expired, etc.)
4. Flex bug or edge case

---

## 🔐 Why We Don't Manually Create PaymentIntents

### 1. **Architecture Violation**
Flex manages the payment lifecycle. Manually creating PIs bypasses:
- Flex's transaction state machine
- Flex's payment reconciliation
- Flex's webhook handling
- Flex's refund/dispute flow

### 2. **Double Payment Risk**
If we create a PI AND Flex creates one:
- Two PaymentIntents for same transaction
- Potential double-charge
- Transaction state mismatch

### 3. **Security Concerns**
- Server would need direct Stripe API access (another secret to manage)
- Bypasses Flex's PCI compliance layer
- More attack surface

---

## ✅ Current Hotfix Approach (Correct)

**Client-side:**
- ✅ Robust extraction from all possible paths
- ✅ Validate secret format before using
- ✅ Show user-friendly error if invalid
- ✅ Dev diagnostics for debugging

**Server-side:**
- ✅ Log what Flex returns (helps diagnose config issues)
- ✅ Validate PI format in dev mode
- ✅ No manual PI creation (respects Flex architecture)

**This allows us to:**
1. Handle the issue gracefully in production
2. Provide diagnostics to identify root cause
3. Maintain Flex architectural integrity
4. Avoid introducing new risks

---

## 🚀 If Manual PI Creation Were Required

**Only implement if Flex support confirms it's necessary:**

```javascript
// ⚠️ NOT RECOMMENDED - Only if Flex cannot create PIs
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// After Flex API call
const tx = apiResponse?.data?.data;
const pd = tx?.attributes?.protectedData || {};
const nested = pd?.stripePaymentIntents?.default || {};

// Check if Flex failed to create PI
if (!nested?.stripePaymentIntentClientSecret || !/^pi_/.test(nested?.stripePaymentIntentId)) {
  console.warn('[FALLBACK] Flex PI invalid, creating manually...');
  
  // Create PaymentIntent directly
  const paymentIntent = await stripe.paymentIntents.create({
    amount: calculateTotalCents(tx), // from line items
    currency: listing.attributes.price.currency,
    automatic_payment_methods: { enabled: true },
    metadata: { transactionId: tx.id.uuid }
  });
  
  // Update transaction via Integration API
  const integrationSdk = getIntegrationSdk();
  await integrationSdk.transactions.updateMetadata({
    id: tx.id,
    metadata: {
      stripePaymentIntentId: paymentIntent.id,
      stripePaymentIntentClientSecret: paymentIntent.client_secret
    }
  });
  
  // Also write to protectedData (requires Integration SDK with special permissions)
  // Note: protectedData write requires operator-level permissions
}
```

**Risks of this approach:**
- ⚠️ Requires direct Stripe access (new secret)
- ⚠️ Bypasses Flex payment flow
- ⚠️ May conflict with Flex's PI if it creates one later
- ⚠️ Need to handle all PI states (requires_action, succeeded, etc.)
- ⚠️ Must manually sync with Flex transaction state

**Only use if:**
1. Flex support confirms `:action/stripe-create-payment-intent` is broken
2. No Flex-level fix available
3. Approved by technical lead
4. Thoroughly tested in staging

---

## 🎯 Recommended Next Steps

### 1. **Diagnose with Hotfix Logs**
Deploy current hotfix and monitor:
```
[SERVER_PROXY] PI data from Flex: { 
  looksLikePI: false,      // ❌ indicates issue
  secretLooksRight: false  // ❌ indicates issue
}
```

### 2. **Check Flex Configuration**
- Flex Console → Payment settings
- Verify Stripe integration enabled
- Confirm `STRIPE_SECRET_KEY` is set
- Test in Flex sandbox first

### 3. **Review Flex Logs**
- Check Flex error logs for Stripe API failures
- Look for PI creation errors
- Verify `:action/stripe-create-payment-intent` is executing

### 4. **Contact Flex Support**
Provide:
- Server diagnostic logs showing UUID instead of PI
- Transaction ID with issue
- Flex environment (production/sandbox)
- Screenshot of Stripe integration config

### 5. **Only If Necessary**
If Flex confirms they cannot create PIs:
- Implement manual PI creation as fallback
- Add extensive error handling
- Test thoroughly in staging
- Monitor for double-payment issues

---

## 📊 Summary

**Current implementation (correct):**
- ✅ Relies on Flex to create PaymentIntents (as designed)
- ✅ Validates what Flex returns
- ✅ Handles errors gracefully
- ✅ Provides diagnostics

**Do NOT manually create PIs unless:**
- ❌ Flex support confirms it's broken
- ❌ No Flex-level fix available
- ❌ Approved by technical/security team
- ❌ Thoroughly tested for payment conflicts

**The hotfix solves the immediate problem without architectural violations.**


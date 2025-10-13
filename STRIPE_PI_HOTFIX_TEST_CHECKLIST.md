# Stripe PaymentIntent Hotfix - Test Checklist

## 🎯 Goal
Ensure the client robustly extracts and validates Stripe PaymentIntent client secrets, and the server properly creates/returns real Stripe PaymentIntent data.

---

## ✅ Test Steps

### 1. Network Tab Verification
**Action:** Load checkout page → Open DevTools → Network tab → Filter for `initiate-privileged`

**Expected Response Structure:**
```json
{
  "data": {
    "data": {
      "id": "...",
      "attributes": {
        "protectedData": {
          // ✅ FLAT (legacy compatibility)
          "stripePaymentIntentClientSecret": "pi_..._secret_...",
          
          // ✅ NESTED (current structure)
          "stripePaymentIntents": {
            "default": {
              "stripePaymentIntentId": "pi_...",
              "stripePaymentIntentClientSecret": "pi_..._secret_..."
            }
          }
        }
      }
    }
  }
}
```

**Validation:**
- [ ] `stripePaymentIntentClientSecret` starts with `pi_` and contains `_secret_`
- [ ] `stripePaymentIntentId` starts with `pi_`
- [ ] **NOT** UUIDs (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

---

### 2. Console Logs (Dev Mode Only)

**Expected Logs:**

#### A. After Speculation Success
```
[SPECULATE_SUCCESS_RAW] {
  attributeKeys: [...],
  hasProtectedData: true,
  protectedDataKeys: [...],
  hasNestedPI: true
}

[POST-SPECULATE] {
  txId: "...",
  clientSecretPresent: true,
  pathUsed: "protectedData.nested.default", // or other path
  looksStripey: true,
  tail: "...secret_XXX"
}
```

**Validation:**
- [ ] `looksStripey: true`
- [ ] `pathUsed` shows which path was used (flat, metadata, or nested)
- [ ] NO warning: `Invalid client secret shape`

#### B. Server Response
```
[SERVER_PROXY] PI data from Flex: {
  isSpeculative: true,
  txId: "...",
  piId: "pi_xxxxxxx...",
  piSecret: "***...secret_XXX",
  looksLikePI: true,
  secretLooksRight: true,
  hasNested: true,
  hasFlat: true
}
```

**Validation:**
- [ ] `looksLikePI: true`
- [ ] `secretLooksRight: true`
- [ ] NO warning: `PaymentIntent data may be invalid`

#### C. Stripe Retrieve
```
[STRIPE] Retrieving PaymentIntent with clientSecret
```

**Validation:**
- [ ] Log appears (means validation passed)
- [ ] NO warning about invalid secret shape

---

### 3. UI Validation

#### A. Normal Flow (Valid PI)
**Expected:**
- [ ] Stripe Elements loads successfully
- [ ] Payment form fields appear
- [ ] Submit button enables after form is complete
- [ ] NO warning banner about "Payment temporarily unavailable"

#### B. Error Flow (Invalid PI - if testing with bad data)
**Expected:**
- [ ] Yellow warning banner appears: "Payment is temporarily unavailable. Please try again shortly or contact support."
- [ ] Stripe Elements does NOT load
- [ ] Submit button stays disabled
- [ ] Console shows: `[STRIPE] Invalid client secret shape; expected pi_* with _secret_. Not retrieving PI.`

---

### 4. Payment Submission

**Action:** Fill out payment form → Click submit

**Expected Flow:**
1. [ ] Submit button shows "Processing..."
2. [ ] Network request to confirm payment
3. [ ] PaymentIntent status transitions correctly
4. [ ] Success: Redirect to order page
5. [ ] Order confirmation shows in inbox

---

## 🔧 Troubleshooting

### Issue: UUIDs instead of real Stripe secrets

**Root Cause:** Flex Integration is not properly configured with Stripe credentials

**Check:**
1. Flex Console → Payment settings → Stripe integration
2. Verify `STRIPE_SECRET_KEY` is set correctly
3. Check if `:action/stripe-create-payment-intent` is in the transaction process
4. Review Flex logs for PaymentIntent creation errors

**Temporary Workaround:**
- Client validates and shows safety banner
- Dev logs help diagnose the exact issue

### Issue: "Payment temporarily unavailable" banner shows

**Diagnosis:**
1. Check server logs for `[SERVER_PROXY] PI data from Flex`
2. Look for `looksLikePI: false` or `secretLooksRight: false`
3. This confirms Flex is returning invalid data

**Next Steps:**
- Review Flex Stripe configuration
- Check Stripe dashboard for failed PaymentIntent creations
- Verify marketplace currency is Stripe-compatible

---

## 🚀 Production Deployment

**Pre-Deploy:**
- [ ] Test with real Stripe test keys
- [ ] Verify all 3 client secret paths work
- [ ] Confirm logging shows valid PI data
- [ ] Test error banner with intentionally invalid data

**Post-Deploy:**
- [ ] Monitor server logs for PI warnings
- [ ] Check error tracking for client-side warnings
- [ ] Review first 10 transactions for successful payments
- [ ] If issues persist, escalate to Flex support with logs

---

## 📊 Success Metrics

- ✅ PaymentIntent ID starts with `pi_`
- ✅ Client secret contains `_secret_`
- ✅ Stripe Elements loads successfully
- ✅ Payment flow completes without errors
- ✅ No "Payment temporarily unavailable" banners for valid transactions
- ✅ Dev logs show `looksStripey: true` consistently


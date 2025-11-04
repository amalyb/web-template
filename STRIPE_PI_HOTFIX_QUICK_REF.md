# Stripe PaymentIntent Hotfix - Quick Reference

## 🔥 What This Fixes

**Problem:** Production returns UUID instead of real Stripe PaymentIntent secret
**Result:** Checkout breaks because Stripe can't retrieve PaymentIntent

---

## ⚡ What Changed

### Client (`CheckoutPage.duck.js`)
```javascript
// OLD: Only checked 2 paths
const clientSecret = 
  tx?.attributes?.protectedData?.stripePaymentIntentClientSecret ||
  tx?.attributes?.metadata?.stripePaymentIntentClientSecret;

// NEW: Checks 3 paths + validates format
const maybeSecret =
  pd?.stripePaymentIntentClientSecret ||                           // flat
  md?.stripePaymentIntentClientSecret ||                           // metadata
  nested?.stripePaymentIntentClientSecret;                         // nested

const looksStripey = /_secret_/.test(maybeSecret) || /^pi_/.test(maybeSecret);
const validatedSecret = looksStripey ? maybeSecret : null;
```

### Client (`CheckoutPageWithPayment.js`)
```javascript
// NEW: Guard before calling Stripe
if (!looksStripey) {
  console.warn('[STRIPE] Invalid secret; not retrieving PI.');
  return; // Don't call Stripe with bad data
}

// NEW: UI safety banner (shows if secret invalid)
{!stripeClientSecret && <WarningBanner />}
```

### Server (`initiate-privileged.js`)
```javascript
// NEW: Log what Flex returns (dev-only)
console.log('[SERVER_PROXY] PI data from Flex:', {
  looksLikePI: /^pi_/.test(piId),
  secretLooksRight: /_secret_/.test(piSecret),
  // ... diagnostics
});
```

---

## 🧪 Quick Test

1. **Load checkout** → Network → `initiate-privileged` response
2. **Check:** `stripePaymentIntentClientSecret` = `"pi_..._secret_..."` ✅
3. **NOT:** `"abc-123-def-456"` ❌

**Console logs (dev mode):**
```
[POST-SPECULATE] { looksStripey: true, pathUsed: "..." }
[SERVER_PROXY] PI data from Flex: { looksLikePI: true, secretLooksRight: true }
[STRIPE] Retrieving PaymentIntent with clientSecret
```

**UI:**
- ✅ Stripe Elements loads
- ✅ Submit button enables
- ❌ NO "Payment temporarily unavailable" banner

---

## 🚨 If UUIDs Still Appear

**Not a code issue** - Flex integration misconfigured:

1. Check Flex Console → Payments → Stripe
2. Verify `STRIPE_SECRET_KEY` is set
3. Check Flex logs for Stripe API errors
4. Ensure `:action/stripe-create-payment-intent` in process

**Hotfix handles it gracefully:**
- Shows user-friendly error banner
- Keeps submit disabled
- Logs diagnostics for debugging

---

## 📁 Files Changed

- `src/containers/CheckoutPage/CheckoutPage.duck.js` (extraction + validation)
- `src/containers/CheckoutPage/CheckoutPageWithPayment.js` (guard + UI banner)
- `server/api/initiate-privileged.js` (diagnostics)

**Test checklist:** `STRIPE_PI_HOTFIX_TEST_CHECKLIST.md`
**Full details:** `STRIPE_PI_HOTFIX_SUMMARY.md`

---

## 🎯 Expected Format

### Valid PaymentIntent
```json
{
  "stripePaymentIntentId": "pi_3ABC123def456",
  "stripePaymentIntentClientSecret": "pi_3ABC123def456_secret_XYZ789"
}
```

### Invalid (Current Prod Issue)
```json
{
  "stripePaymentIntentId": "abc-123-def-456",  // ❌ UUID
  "stripePaymentIntentClientSecret": "xyz-789-ghi-012"  // ❌ UUID
}
```

**Validation regex:**
- ID: `/^pi_/` (starts with "pi_")
- Secret: `/_secret_/` (contains "_secret_")


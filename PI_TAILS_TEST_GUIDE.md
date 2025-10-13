# PI_TAILS Logging Test Guide

## Quick Test (Local)

### 1. Start Server in Dev Mode

```bash
NODE_ENV=development PORT=3000 npm start
```

### 2. Go to Checkout

1. Open browser to `http://localhost:3000`
2. Find a listing
3. Click "Book"
4. Fill in checkout details
5. Proceed to payment

### 3. Check Server Logs

Look for this output in your terminal:

```
[PI_TAILS] idTail=pi_...AbCdE secretTail=pi_..._secret_XyZ looksLikePI=true looksLikeSecret=true
```

**Expected Values:**
- `looksLikePI=true` ✅
- `looksLikeSecret=true` ✅

**If you see:**
- `looksLikePI=false` ❌ - PI ID doesn't start with `pi_`
- `looksLikeSecret=false` ❌ - Secret doesn't contain `_secret_`

---

## Browser Network Tab Verification

### 1. Open DevTools (F12)

Go to **Network** tab

### 2. Filter for initiate-privileged

Type: `initiate-privileged` in the filter

### 3. Find the POST Request

Click on the `/api/initiate-privileged` request

### 4. Check Response

Go to **Response** or **Preview** tab

Look for:
```json
{
  "data": {
    "data": {
      "attributes": {
        "protectedData": {
          "stripePaymentIntents": {
            "default": {
              "stripePaymentIntentId": "pi_3...",
              "stripePaymentIntentClientSecret": "pi_3..._secret_..."
            }
          }
        }
      }
    }
  }
}
```

**Validation Checklist:**
- [ ] `stripePaymentIntentId` starts with `pi_`
- [ ] `stripePaymentIntentClientSecret` contains `_secret_`
- [ ] No UUID-like strings (e.g., `123e4567-e89b-12d3-a456-426614174000`)

---

## Production Test

### 1. Check Render Logs

Go to your Render dashboard → Service → Logs

### 2. Filter for PI_TAILS

Search for: `[PI_TAILS]`

### 3. Trigger a Checkout

Have a user (or yourself) proceed to checkout

### 4. Verify Log Output

Should see:
```
[PI_TAILS] idTail=pi_...xxxxx secretTail=pi_...et_yyy looksLikePI=true looksLikeSecret=true
```

---

## Diagnostic Script (Optional)

If you have a listing ID, run:

```bash
# Replace with an actual listing UUID
export VERIFY_LISTING_ID=<your-listing-uuid>

# Run the verification script
node scripts/verify-flex-request-payment.js
```

**Expected Output:**
```
[VERIFY] transition: transition/request-payment (speculative)
[VERIFY] secretTail: ...et_AbCdE looksStripey: true
[VERIFY] idLooksStripey: true
VERDICT: PASS — PaymentIntent created by Flex on request-payment
```

---

## Troubleshooting

### If looksLikePI=false

**Problem:** Payment Intent ID doesn't start with `pi_`

**Possible Causes:**
1. Flex integration not configured correctly
2. Stripe keys not set in Flex Console
3. Transaction process not calling Stripe integration

**Fix:**
- Check Flex Console → Integrations → Stripe
- Verify Stripe publishable/secret keys are set
- Verify transaction process includes `stripe-create-payment-intent` action

### If looksLikeSecret=false

**Problem:** Client secret doesn't contain `_secret_`

**Possible Causes:**
1. Flex returning incomplete PI data
2. Server stripping/modifying the secret (now ruled out)
3. Client-side state corruption

**Fix:**
- Check client-side state in Redux DevTools
- Look for `stripeClientSecret` in state
- Verify no client-side code is modifying the secret

### If Both are false

**Critical Issue:** Stripe Payment Intent not being created by Flex

**Immediate Actions:**
1. Check Flex Console logs for errors
2. Verify Stripe integration is active
3. Test with Flex API Explorer
4. Contact Sharetribe support

---

## Success Criteria

✅ **All checks pass when:**

1. Server logs show `[PI_TAILS]` with both `looksLikePI=true` and `looksLikeSecret=true`
2. Network response shows `pi_` prefix on ID
3. Network response shows `_secret_` in client secret
4. Checkout flow completes successfully
5. Stripe Elements loads the payment form

---

## What to Share

When reporting results, include:

1. **Server Log Line:**
   ```
   [PI_TAILS] idTail=... secretTail=... looksLikePI=... looksLikeSecret=...
   ```

2. **Network Response Structure:**
   ```json
   {
     "stripePaymentIntents": {
       "default": {
         "stripePaymentIntentId": "pi_...",
         "stripePaymentIntentClientSecret": "pi_..._secret_..."
       }
     }
   }
   ```

3. **Any Errors:**
   - Console errors
   - Network errors
   - Stripe Elements errors

---

**Last Updated:** October 13, 2025


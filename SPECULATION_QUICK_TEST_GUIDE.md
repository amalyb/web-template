# Speculation - Quick Test Guide

## 🎯 What to Look For Immediately

### 1. Open Browser Console (F12)
Navigate to your checkout page and watch for these logs **in order**:

```
✅ [CheckoutWithPayment] orderData from selector: {listingId: "...", bookingDates: {...}, protectedData: {...}}
✅ [CheckoutWithPayment] listingId: "uuid-here"
✅ [Checkout] triggering speculate… {listingId: "...", orderData: {...}}
✅ [speculate] dispatching {listingId: "...", bookingDates: {...}, ...}
✅ [speculateTransaction] transitionParams: {listingId: "...", bookingStart: "2025-10-14T00:00:00.000Z", bookingEnd: "2025-10-17T00:00:00.000Z", hasProtectedData: true}
✅ [speculate] success "transaction-uuid"
```

**⚠️ Red Flag**: If you DON'T see these logs, the effect isn't firing!

### 2. Open Network Tab (F12 → Network)
**Expected Request:**

```
POST /integration_api/transactions/initiate_speculative
Status: 200 OK (or 401 if auth issue)
Timing: Should appear within 1-2 seconds of page load
```

**Request Payload Should Contain:**
```json
{
  "processAlias": "default-booking/release-1",
  "transition": "transition/request-payment",
  "params": {
    "listingId": "uuid-here",
    "bookingStart": "2025-10-14T00:00:00.000Z",
    "bookingEnd": "2025-10-17T00:00:00.000Z",
    "protectedData": { ... },
    "cardToken": "CheckoutPage_speculative_card_token"
  },
  "include": ["booking", "provider"],
  "expand": true
}
```

**⚠️ Critical Check**: `bookingStart` and `bookingEnd` must be at the root of `params`, NOT nested in `bookingDates`!

**Response Should Contain:**
```json
{
  "data": {
    "id": { "uuid": "transaction-uuid" },
    "type": "transaction",
    "attributes": {
      "protectedData": {
        "stripePaymentIntents": [{
          "stripePaymentIntentClientSecret": "pi_xxx_secret_yyy"
        }]
      },
      ...
    }
  }
}
```

### 3. UI Indicators

**While Loading:**
```
┌─────────────────────────────────────┐
│ Initializing transaction...         │
└─────────────────────────────────────┘
```

**On Error:**
```
┌─────────────────────────────────────┐
│ ⚠️ We couldn't start checkout.      │
│    Please check your info and       │
│    try again.                        │
│                                      │
│    [ Retry ]                         │
└─────────────────────────────────────┘
```

**On Success:**
- Loading indicator disappears
- Stripe payment form appears with fields
- "Request Payment" button becomes enabled (once form is valid)

## 🔍 Common Issues & Quick Fixes

### Issue: No logs appear at all
**Cause**: Effect not running or orderData missing

**Check:**
1. Is `orderData` being set from ListingPage?
2. Are booking dates present?
3. Is user authenticated?

**Fix**: Check `pageData.orderData` in console

---

### Issue: Logs appear but no Network request
**Cause**: Speculation call blocked before API

**Check console for:**
```
[Checkout] ⛔ Skipping initiate - user not authenticated yet
```
or
```
[Sherbrt] ⛔ Attempted privileged speculation without authentication
```

**Fix**: Ensure user is logged in BEFORE navigating to checkout

---

### Issue: 401 Unauthorized
**Cause**: Auth cookie not being sent with request

**Check:**
1. DevTools → Application → Cookies → Look for `st` cookie
2. Cookie domain should match your site (e.g., `.sherbrt.com`)
3. Cookie must have `SameSite=None; Secure` if cross-domain

**Quick Fix (Development):**
```javascript
// Temporarily add to CheckoutPage.duck.js
console.log('Auth token:', sdk?.authToken);
console.log('Has cookie:', document.cookie.includes('st='));
```

**Permanent Fix**: Implement backend proxy (see SPECULATION_GATE_REMOVAL_SUMMARY.md)

---

### Issue: 400 Bad Request / Invalid params
**Cause**: Wrong parameter format

**Check Network request payload:**
- ✅ `bookingStart` and `bookingEnd` at root of `params`
- ❌ NOT `bookingDates: { start, end }`

**Check console:**
```
[speculateTransaction] transitionParams: {...}
```

Should show `bookingStart` and `bookingEnd`, not nested `bookingDates`.

**If wrong format**: The date transformation fix didn't apply. Verify CheckoutPage.duck.js lines 556-559.

---

### Issue: Infinite speculation loop
**Cause**: Deduplication guard not working

**Check console for repeated:**
```
[speculate] dispatching
[speculate] dispatching
[speculate] dispatching
...
```

**Fix**: Verify `lastSpeculationKey` logic in duck reducer

---

### Issue: Stripe not mounting after success
**Cause**: PaymentIntent client_secret missing

**Check Network response:**
```json
response.data.attributes.protectedData.stripePaymentIntents[0].stripePaymentIntentClientSecret
```

Must exist and start with `pi_`

**Fix**: Backend needs to return PaymentIntent. Check server/api/initiate-privileged.js

## ✅ Success Criteria

Your speculation is working correctly if:

1. ✅ Logs appear in console in correct order
2. ✅ Network request appears within 1-2 seconds
3. ✅ Request status is 200 OK
4. ✅ Response contains transaction with client_secret
5. ✅ Stripe form mounts and shows payment fields
6. ✅ No infinite loops
7. ✅ Retry button works on errors
8. ✅ No 401 auth errors

## 🚀 Next Steps After Verification

Once speculation works:

1. **Test booking flow end-to-end**
   - Select dates
   - Navigate to checkout
   - Fill payment form
   - Submit booking
   - Verify transaction completes

2. **Test error handling**
   - Disconnect network → should show error + retry
   - Invalid dates → should show validation error
   - Expired session → should redirect to login

3. **Performance check**
   - Measure time from page load to Stripe form ready
   - Should be < 3 seconds for good UX

4. **Production deployment**
   - Test on staging first
   - Monitor for 401 errors
   - Have backend proxy ready as fallback

## 📞 Need Help?

**Still not working?** Provide these details:

1. Console logs (full output)
2. Network request/response (screenshot or JSON)
3. Browser/OS version
4. Environment (dev/staging/prod)
5. Error messages

Good luck! 🎉



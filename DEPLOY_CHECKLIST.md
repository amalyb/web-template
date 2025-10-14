# Checkout Fix - Deployment Checklist

## ✅ Pre-Deployment Verification

- [x] Build succeeds (`npm run build`) ✅
- [x] No linter errors ✅
- [x] Backwards compatible with old API format ✅
- [x] Data flow verified for speculation AND final submit ✅
- [x] Early return removed (primary fix) ✅
- [x] Thunk handles both old and new formats ✅

---

## 📦 Files Ready to Commit (5 total)

```bash
git status --short
 M server/api/initiate-privileged.js              # Added presence check logs
 M server/api/transaction-line-items.js           # Enhanced API response with breakdown
 M src/containers/CheckoutPage/CheckoutPageWithPayment.js  # Removed early return
 M src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js  # Added diagnostic logs
 M src/containers/ListingPage/ListingPage.duck.js  # Fixed thunk for new format
```

---

## 🚀 Deployment Commands

### Option 1: One-Line Deploy (Recommended)
```bash
cd /Users/amaliabornstein/shop-on-sherbet-cursor && \
git add server/api/initiate-privileged.js server/api/transaction-line-items.js src/containers/CheckoutPage/CheckoutPageWithPayment.js src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js src/containers/ListingPage/ListingPage.duck.js && \
git commit -m "fix: unblock checkout render and stabilize booking flow

- Remove early return blocking page render when orderParams invalid
- Enhance line-items API to return breakdownData and bookingDates  
- Fix thunk to handle both old and new API response formats
- Add comprehensive logging for debugging data flow
- Verify address fields flow correctly on final submit

Fixes: checkout 'Payment temporarily unavailable' issue" && \
git push origin main
```

### Option 2: Step-by-Step
```bash
# 1. Stage files
git add server/api/initiate-privileged.js
git add server/api/transaction-line-items.js
git add src/containers/CheckoutPage/CheckoutPageWithPayment.js
git add src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js
git add src/containers/ListingPage/ListingPage.duck.js

# 2. Commit (message in CHECKOUT_FIX_COMMIT_MESSAGE.md)
git commit -F CHECKOUT_FIX_COMMIT_MESSAGE.md

# 3. Push
git push origin main
```

---

## 🧪 Post-Deploy Testing (5 minutes)

### Test 1: Page Renders ✅
```
1. Go to any listing
2. Select dates
3. Click "Request to book"
✅ Page renders with form (no "Cannot render" error)
```

### Test 2: Console Logs ✅
```
Open DevTools console, look for:
✅ [Checkout] rendering regardless of orderResult.ok
✅ [SPECULATE_SUCCESS] { txId: '...', lineItems: 3 }
✅ [StripePaymentForm] mapped -> [...]
```

### Test 3: Form Submission ✅
```
1. Fill all billing/shipping fields
2. Click "Complete booking"
✅ Submit button enables
✅ Booking completes successfully
```

### Test 4: Server Logs ✅
```
Check Render logs for:
✅ [initiate] presence check { hasStreet: true, hasZip: true, ... }
✅ All fields show 'true' on final submit
```

---

## 🔍 Monitoring Commands

### Watch Render Logs
```bash
# In Render dashboard, filter for:
[initiate] presence check
[SPECULATE_SUCCESS]
[Checkout] rendering
```

### Expected Good Logs
```
[Checkout] rendering regardless of orderResult.ok; collecting form values...
[SPECULATE_SUCCESS] { txId: 'abc-123', lineItems: 3 }
[initiate] presence check { hasStreet: true, hasZip: true, hasPhone: true, hasEmail: true, hasName: true }
[checkout→request-payment] Customer fields in request: 7/7
```

### Warnings to Ignore
```
⚠️ Source map 404s - non-blocking
⚠️ Mapbox token warnings - non-blocking
⚠️ presence check with some 'false' during speculation - OK
```

---

## 🛟 Rollback Plan (if needed)

### Full Rollback
```bash
git revert HEAD
git push origin main
```

### Partial Rollback (restore early return only)
```bash
# Only if absolutely necessary
# Better to fix forward than rollback
```

---

## 📊 Success Metrics

After 24 hours, check:
- [ ] 0 "Cannot render" errors in Sentry/logs
- [ ] Booking completion rate back to normal
- [ ] No customer support tickets about checkout
- [ ] All presence checks show 'true' in production logs

---

## 🎯 Quick Reference

### What Changed
1. **CheckoutPageWithPayment.js** - Removed early return that blocked render
2. **transaction-line-items.js** - API now returns breakdown + dates
3. **ListingPage.duck.js** - Thunk + reducer handle both formats
4. **Logging** - Added diagnostic logs throughout flow

### What Didn't Change
- Pricing logic (discounts, fees, line items)
- Form validation rules
- Stripe integration
- Transaction process workflow

### Risk Level: LOW
- Mostly removal of blocking code
- Backwards compatible
- Well-tested build
- Easy rollback if needed

---

## 📞 Next Steps After Deploy

1. [ ] Monitor Render logs for 15 minutes
2. [ ] Test checkout flow end-to-end
3. [ ] Verify presence checks in logs
4. [ ] Notify customer support team
5. [ ] Update incident ticket as resolved

---

**Ready to deploy?** Run the commands above! 🚀

*See CHECKOUT_FIX_FINAL_SUMMARY.md for comprehensive details.*


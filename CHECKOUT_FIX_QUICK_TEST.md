# Quick Test Guide - Checkout Page Fix

## 🚀 Quick Verification (5 minutes)

### 1. Start the App
```bash
npm run dev
```

### 2. Navigate to Checkout
1. Go to any listing page
2. Select booking dates (start + end)
3. Click **"Request to book"** button

### 3. ✅ Expected Behavior

#### Page Should Render Immediately
- ❌ **OLD:** Shows "Cannot render - invalid orderParams"
- ✅ **NEW:** Page renders with billing form visible

#### Console Logs (Chrome DevTools)
Open console (F12) and look for:
```
[Checkout] rendering regardless of orderResult.ok; collecting form values...
[INIT_GATES] { hasUser: true, orderOk: true, hasTxId: false, hasProcess: true }
[SPECULATE_SUCCESS] { txId: '...', lineItems: 3 }
```

#### Fill Out Form
1. Enter billing address
2. Watch console for:
```
[StripePaymentForm] mapped -> ['customerName', 'customerStreet', 'customerZip', ...]
[Form] parent sees valid: true
```

#### Submit Button
- Should be **disabled** initially
- Should **enable** once all fields filled
- Shows reason when disabled: "Waiting for transaction initialization…" → "Enter payment details…" → "Complete required fields…"

### 4. Server Logs (Terminal)

#### During Page Load (Speculation)
Look for:
```
[initiate] presence check { hasStreet: true, hasZip: true, hasPhone: true, hasEmail: true, hasName: true }
```
**Note:** Some fields may be `false` during speculation if user hasn't filled form yet. This is OK.

#### During Final Submit (Real Booking)
After clicking "Complete booking", look for:
```
[initiate] presence check { hasStreet: true, hasZip: true, hasPhone: true, hasEmail: true, hasName: true }
```
**Important:** ALL fields MUST be `true` on final submit. If any are `false`, booking will fail.

---

## 🐛 If Something Goes Wrong

### Issue: Page still shows "Cannot render"
**Check:** Did you restart the dev server after changes?
```bash
# Kill the server (Ctrl+C) and restart
npm run dev
```

### Issue: Form doesn't appear
**Check console for:**
- `orderResult.ok: false` - OK, page should still render
- Look for `[Checkout] rendering regardless of orderResult.ok` log

### Issue: Submit button stays disabled
**Check:**
1. Are all 7 fields filled? (name, street, city, state, zip, email, phone)
2. Console shows `[Form] invalid: true` → look at error keys
3. Check for `[SUBMIT_GATES]` log showing which gate is failing

### Issue: "Payment temporarily unavailable" banner
**Check:**
1. Did speculation succeed? Look for `[SPECULATE_SUCCESS]` log
2. Is `stripeClientSecret` present? Check `[POST-SPECULATE]` log
3. Server logs show PaymentIntent creation?

---

## 📋 Acceptance Criteria Checklist

- [ ] **AC1:** Page renders without "Cannot render" error
- [ ] **AC2:** Form shows `invalid: false` when all fields filled
- [ ] **AC3:** Server logs show `{ hasStreet: true, hasZip: true, hasPhone: true }`
- [ ] **AC4:** Console shows `[SPECULATE_SUCCESS]` with txId and lineItems
- [ ] **AC5:** Breakdown shows correct pricing (no regression)

---

## 🎯 Success Indicators

✅ **All Green** = Fix is working
1. Page renders immediately
2. Form is visible and accepts input
3. Submit button enables when ready
4. Logs show data flowing correctly
5. Booking completes successfully

---

## 🔍 One-Liner Test

```bash
# Watch server logs while testing
npm run dev 2>&1 | grep -E '\[initiate\]|\[SPECULATE|presence check'
```

Then navigate to checkout in browser and watch for logs.

**Expected output:**
1. On page load: `[initiate] presence check { ... }` (some fields may be false - OK for speculation)
2. After submit: `[initiate] presence check { hasStreet: true, hasZip: true, ... }` (all must be true!)

**Note:** You'll see source-map 404s and Mapbox token warnings - these are non-blocking, ignore them for this fix.

---

## 📞 Need Help?

If the fix isn't working:
1. Check `CHECKOUT_FIX_SUMMARY.md` for detailed changes
2. Verify all 5 files were modified correctly
3. Ensure no merge conflicts or stale builds
4. Check browser console AND server terminal for errors

# Stripe Init Guard - Quick Reference

**Goal**: Safe server startup when `STRIPE_SECRET_KEY` missing

---

## ⚡ Quick Test (30 seconds)

### Test 1: Without Stripe Key
```bash
unset STRIPE_SECRET_KEY
npm start
```

**Expected**:
```
[ENV CHECK][Stripe] No key found. Payments will return 503.
```
✅ Server starts (no crash)

---

### Test 2: With Stripe Key
```bash
export STRIPE_SECRET_KEY=sk_test_...
npm start
```

**Expected**:
```
[ENV CHECK][Stripe] Key found. Mode: TEST (sk_test_...)
```
✅ Server starts + ready for payments

---

### Test 3: Checkout Without Key
**Load checkout page** → Try to book

**Server logs**:
```
[PI] Stripe not configured. Returning 503 for payment request.
```

**Client sees**: Error banner "Payments temporarily unavailable"

✅ No crash, clear error

---

## 🔍 Key Changes

### 1. Server: Lazy Stripe Init
**File**: `server/api/initiate-privileged.js`

```javascript
// ❌ OLD (crashed if key missing)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ✅ NEW (safe, lazy, memoized)
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY || null;
  if (!key) return null;  // No crash
  if (_stripeSingleton) return _stripeSingleton;  // Cached
  _stripeSingleton = new Stripe(key, { apiVersion: '2024-06-20' });
  return _stripeSingleton;
}

// In route handler
const stripe = getStripe();
if (!stripe) {
  return res.status(503).json({
    error: 'payments-not-configured',
    message: 'Stripe not configured. Please contact support.'
  });
}
```

---

### 2. Package.json: Auto-Update Browserslist
```json
"postinstall": "patch-package && npx --yes update-browserslist-db@latest --update-db || true"
```

**Result**: Fewer "browsers data 6 months old" warnings in CI

---

### 3. Health Endpoints
```javascript
// Both available now
GET /healthz   → 200 OK
GET /_healthz  → 200 OK
```

---

## 🎯 Behavior Summary

| STRIPE_SECRET_KEY | Server Startup | Checkout | Client |
|-------------------|----------------|----------|--------|
| Missing | ✅ Starts | 503 error | Error banner |
| Valid | ✅ Starts | ✅ Works | Payment form |

---

## 📝 Startup Logs to Check

### Without Stripe Key
```
[ENV CHECK][Stripe] No key found. Payments will return 503.
🚦 initiate-privileged endpoint is wired up
```

### With Stripe Key (not yet used)
```
[ENV CHECK][Stripe] Key found. Mode: TEST (sk_test_...)
🚦 initiate-privileged endpoint is wired up
```

### First Payment Request (Stripe initialized)
```
[ENV CHECK][Stripe] Initialized successfully. Mode: TEST (sk_test_...)
[PI] Calculated payment: { amount: 6001, currency: 'usd' }
[PI] Creating new PaymentIntent
[PI] { secretLooksRight: true }
```

---

## 🐛 Common Issues

### "Server crashes on startup"
**Cause**: Still using old top-level `const stripe = require('stripe')(...)`  
**Fix**: Ensure all Stripe usage calls `getStripe()` function

### "503 errors in production"
**Cause**: `STRIPE_SECRET_KEY` not set in production env  
**Fix**: Add env var in hosting platform

### "Browserslist warnings during build"
**Cause**: DB not updated yet  
**Fix**: Run `npm install` to trigger postinstall script

---

## ✅ Files Modified

- `server/api/initiate-privileged.js` - Safe Stripe init + 503 handling
- `server/index.js` - Added `/_healthz` endpoint  
- `src/containers/CheckoutPage/CheckoutPage.duck.js` - 503 error handling
- `package.json` - Browserslist auto-update

**Total**: 4 files, ~55 lines

---

## 🚀 Deploy Checklist

- [ ] Build succeeds: `npm run build`
- [ ] Test without Stripe key: `unset STRIPE_SECRET_KEY && npm start`
- [ ] Test with Stripe key: `export STRIPE_SECRET_KEY=sk_test_... && npm start`
- [ ] Verify health endpoint: `curl http://localhost:3000/_healthz`
- [ ] Set `STRIPE_SECRET_KEY` in production environment
- [ ] Monitor startup logs after deploy

---

## 📞 Quick Debug Commands

```bash
# Check if Stripe key is set
echo $STRIPE_SECRET_KEY | cut -c1-8

# Test health endpoint
curl -i http://localhost:3000/_healthz

# Test Browserslist update
npx update-browserslist-db@latest --update-db

# Check server logs for Stripe status
# Look for: [ENV CHECK][Stripe] ...
```

---

**Status**: ✅ Complete  
**Ready**: ✅ Yes  
**Safe to Deploy**: ✅ Yes



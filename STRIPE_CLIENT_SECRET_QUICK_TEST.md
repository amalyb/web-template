# Stripe Client Secret Fix - Quick Test Guide

**Goal**: Verify real Stripe PaymentIntent secrets are being created and used

---

## ⚡ Quick Test (2 Minutes)

### Step 1: Clear Browser State
```javascript
// Browser console
localStorage.clear();
sessionStorage.clear();
// Hard refresh (Cmd+Shift+R / Ctrl+F5)
```

### Step 2: Load Checkout
1. Navigate to any listing
2. Click "Book Now"
3. Select dates (3+ nights)
4. Fill checkout form

### Step 3: Check 3 Key Logs

#### ✅ Server Log 1: PaymentIntent Creation
```
[PI] Calculated payment: { amount: 6001, currency: 'usd' }
[PI] Creating new PaymentIntent
[PI] { idTail: 'pi_...1234', secretLooksRight: true }
```
**If missing**: Check `STRIPE_SECRET_KEY` env var

---

#### ✅ Server Log 2: PI Tails
```
[PI_TAILS] secretPrefix=pi_ looksLikeSecret=true
```
**If `looksLikeSecret=false`**: Secret is UUID, not real Stripe secret

---

#### ✅ Browser Log: Validation
```
[Stripe] clientSecret: pi_3XXX_secret_YYY
[Stripe] clientSecret valid? true
[Stripe] element mounted: true
```
**If `valid? false`**: Check Network tab → `initiate-privileged` response

---

## 🔍 Quick Probes

### Probe 1: Server Creating PaymentIntent?
**Look for**: `[PI] Creating new PaymentIntent` in server logs

**If missing**: 
- Verify `stripe` package installed: `npm ls stripe`
- Check `STRIPE_SECRET_KEY` starts with `sk_`

---

### Probe 2: Real Secret in Response?
**Network Tab** → `initiate-privileged` → **Response** → Search for:
```json
"stripePaymentIntents": {
  "default": {
    "stripePaymentIntentId": "pi_3...",
    "stripePaymentIntentClientSecret": "pi_3XXX_secret_YYY"
  }
}
```

**If UUID instead of `pi_`**: Server Stripe call failed (check server logs for errors)

---

### Probe 3: Elements Mounting?
**Browser Console**:
- ✅ `[Stripe] element mounted: true`
- ✅ No "Setting up secure payment" banner
- ✅ Card input visible

**If not mounted**: Check `[Stripe] clientSecret valid?` log

---

## 🎯 Success Criteria

| Check | Expected | Actual |
|-------|----------|--------|
| Server log shows `[PI] Creating...` | ✅ | |
| `secretLooksRight: true` | ✅ | |
| `[PI_TAILS] looksLikeSecret=true` | ✅ | |
| Browser: `clientSecret valid? true` | ✅ | |
| Browser: `element mounted: true` | ✅ | |
| UI: Card input visible | ✅ | |
| UI: No setup banner | ✅ | |

---

## 🚨 Common Issues

### Issue: Server Logs Silent (No `[PI]` logs)
**Cause**: Code path not executing

**Check**:
1. Is transition `transition/request-payment`?
2. Are lineItems present?
3. Check server logs for any errors before PaymentIntent code

**Fix**: Verify `bodyParams?.transition === 'transition/request-payment'`

---

### Issue: `[PI] { secretLooksRight: false }`
**Cause**: Stripe API returned invalid response

**Check**:
1. Server logs for Stripe API errors
2. `STRIPE_SECRET_KEY` format (should be `sk_live_...` or `sk_test_...`)
3. Stripe account status (dashboard.stripe.com)

**Fix**: Verify Stripe key is active and has correct permissions

---

### Issue: `[Stripe] clientSecret valid? false`
**Cause**: Client validation rejecting secret

**Check**:
1. Network response has real `pi_..._secret_...`
2. If network shows real secret but client shows UUID: Check reducer is using correct path
3. Browser console: check `[POST-SPECULATE]` log for `pathUsed`

**Fix**: Ensure client reads from `protectedData.stripePaymentIntents.default.stripePaymentIntentClientSecret`

---

## 🔧 Environment Sanity Check

### Server Env
```bash
echo $STRIPE_SECRET_KEY | cut -c1-8
# Should print: sk_live_ or sk_test_
```

### Client Env
```bash
echo $REACT_APP_STRIPE_PUBLISHABLE_KEY | cut -c1-8
# Should print: pk_live_ or pk_test_
```

### ⚠️ CRITICAL: Both Must Match
- ✅ Both LIVE or both TEST
- ❌ Live + Test mix = FAILURE

---

## 📋 Copy-Paste Test Commands

```bash
# 1. Check Stripe package installed
npm ls stripe

# 2. Verify environment (in server shell)
node -e "console.log(process.env.STRIPE_SECRET_KEY?.slice(0,8))"

# 3. Start dev server and watch logs
npm run dev

# 4. In browser console (after loading checkout):
console.log('[TEST] Valid secret?', 
  typeof extractedClientSecret === 'string' && 
  extractedClientSecret?.startsWith('pi_') && 
  extractedClientSecret?.includes('_secret_')
);
```

---

## ✅ Expected Flow

```
User clicks "Book Now"
  ↓
Client calls initiate-privileged (speculative)
  ↓
Server: [PI] Calculated payment: { amount: 6001 }
  ↓
Server: [PI] Creating new PaymentIntent
  ↓
Stripe API: Returns pi_3XXX_secret_YYY
  ↓
Server: [PI] { secretLooksRight: true }
  ↓
Flex SDK: Stores in protectedData.stripePaymentIntents.default
  ↓
Server: [PI_TAILS] looksLikeSecret=true
  ↓
Client: [POST-SPECULATE] { pathUsed: 'protectedData.nested.default' }
  ↓
Client: [Stripe] clientSecret valid? true
  ↓
Client: [Stripe] element mounted: true
  ↓
UI: Payment form visible ✅
```

---

## 🎉 If All Checks Pass

You should see:
1. ✅ Server creating PaymentIntents with Stripe API
2. ✅ Real `pi_..._secret_...` in protectedData
3. ✅ Client extracting and validating correctly
4. ✅ Elements mounting successfully
5. ✅ Users can enter payment details

**Status**: Fix is working! 🚀

---

## 📞 Need Help?

If any probe fails, share:
1. Complete server log from `[PI]` through `[PI_TAILS]`
2. Browser console log from `[POST-SPECULATE]` through `[Stripe] element mounted`
3. Network tab → `initiate-privileged` → Response → `stripePaymentIntents` section

This will pinpoint exactly where the flow breaks.


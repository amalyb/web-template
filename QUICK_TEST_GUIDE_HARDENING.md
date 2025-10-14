# Quick Test Guide - Checkout/Stripe Hardening

## Quick Test Scenarios

### Scenario 1: Test 503 Behavior (Missing Stripe Key)

**Setup:**
```bash
# Temporarily remove Stripe key from server
mv .env .env.backup  # or just comment out STRIPE_SECRET_KEY
```

**Expected Behavior:**
1. **Server logs on startup:**
   ```
   [ENV CHECK][Stripe] No key found. Payments will return 503.
   ```

2. **Browser console when reaching checkout:**
   ```
   [speculate] failed Error: Service unavailable
   [DEBUG] e.status: 503
   [DEBUG] e.code: payments-not-configured
   [Checkout] Payments unavailable on server. Halting speculation.
   ```

3. **UI shows red banner:**
   > Payments are temporarily unavailable. Please try again later or contact support.

4. **Stripe Elements DO NOT mount**

5. **No public fallback attempted**

**Restore:**
```bash
mv .env.backup .env  # Restore Stripe key
```

---

### Scenario 2: Test Normal Flow (Stripe Configured)

**Setup:**
```bash
# Ensure STRIPE_SECRET_KEY is set in .env
# Ensure REACT_APP_STRIPE_PUBLISHABLE_KEY matches (same mode: test or live)
```

**Expected Behavior:**
1. **Server logs on startup:**
   ```
   [ENV CHECK][Stripe] Initialized successfully. Mode: TEST (sk_test_...)
   ```

2. **Browser console when reaching checkout:**
   ```
   [Checkout] triggering speculate…
   [SPECULATE_SUCCESS] clientSecret present? true valid? true
   [speculate] success [tx-uuid]
   ```

3. **UI shows:**
   - No error banner
   - Stripe payment form loads
   - Submit button enabled when form complete

4. **Checkout completes successfully**

---

### Scenario 3: Test Protected Data Guard

**Setup:**
```bash
# Normal Stripe configuration
# Navigate to checkout and fill in address/contact info
```

**Test:**
1. Open DevTools → Network tab
2. Find the `/api/initiate-privileged` request
3. Modify response to return error (not 503)
4. Watch console logs

**Expected Behavior:**
```
[INITIATE_TX] Protected data required; skipping public fallback.
```

No public speculation call should occur.

---

### Scenario 4: Test 403 Handling (Does NOT Set Banner)

**Setup:**
```bash
# Temporarily set wrong process alias
REACT_APP_FLEX_PROCESS_ALIAS=wrong-process/release-1
```

**Expected Behavior:**
1. **Browser console shows 403 error:**
   ```
   [speculate] failed
   [DEBUG] e.status: 403
   ```

2. **Red "Payments unavailable" banner DOES NOT appear**

3. **Redux DevTools shows:**
   - `paymentsUnavailable: false` (NOT set to true)

4. **Normal error message appears** (not payment unavailability banner)

5. **Restore correct process alias:**
   ```bash
   REACT_APP_FLEX_PROCESS_ALIAS=default-booking/release-1
   ```

**Why This Matters:**
- 403 = permission/config issue (process mismatch, transition not allowed, etc.)
- 503 = payment system unavailable (missing Stripe key)
- Must NOT confuse these two error types
- 403 guard prevents incorrect "Payments unavailable" banner

---

## Console Logs to Look For

### ✅ Success Case:
```
[speculate] success [tx-id]
[POST-SPECULATE] { txId: '...', clientSecretPresent: true, ... }
[Stripe] clientSecret: pi_...
```

### ❌ 503 Case:
```
[speculate] failed
[DEBUG] e.status: 503
[DEBUG] e.code: payments-not-configured
[Checkout] Payments unavailable on server. Halting speculation.
[REDUCER] Setting paymentsUnavailable flag
```

### ❌ Protected Data Guard:
```
[INITIATE_TX] Protected data required; skipping public fallback.
```

### ⚠️ 403 Case (Normal Error Handling):
```
[speculate] failed
[DEBUG] e.status: 403
[specTx] error
```
**No banner, no paymentsUnavailable flag set**

---

## What to Check

### Server Side:
- [ ] Server logs Stripe status on startup
- [ ] Returns 503 when key missing
- [ ] Creates PaymentIntent when key present

### Client Side:
- [ ] No `{id: undefined}` success logs
- [ ] Red banner shows when payments unavailable
- [ ] Elements don't mount when payments unavailable
- [ ] Speculation stops when paymentsUnavailable flag set
- [ ] No public fallback when protectedData present
- [ ] No public fallback when 503 error

### UI:
- [ ] Banner visible when payments unavailable
- [ ] Payment form hidden when payments unavailable
- [ ] Submit button properly gated

---

## Environment Check

### Server (.env):
```bash
# Must have:
STRIPE_SECRET_KEY=sk_test_xxx  # or sk_live_xxx
NODE_ENV=production            # or development

# Verify mode matches:
echo $STRIPE_SECRET_KEY | grep -o "sk_[^_]*"  # Should show sk_test or sk_live
```

### Client (.env.local or .env):
```bash
# Must have:
REACT_APP_STRIPE_PUBLISHABLE_KEY=pk_test_xxx  # or pk_live_xxx

# Verify mode matches server:
echo $REACT_APP_STRIPE_PUBLISHABLE_KEY | grep -o "pk_[^_]*"  # Should match server mode
```

### Mode Mismatch Test:
Set server to `sk_test_xxx` and client to `pk_live_xxx` → Should fail with Stripe API error

---

## Quick Verification Commands

```bash
# Check if Stripe key is set (server)
grep STRIPE_SECRET_KEY .env

# Check if publishable key is set (client)
grep REACT_APP_STRIPE_PUBLISHABLE_KEY .env.local

# Verify keys are same mode
grep STRIPE_SECRET_KEY .env | grep -o "sk_[^_]*"
grep REACT_APP_STRIPE_PUBLISHABLE_KEY .env.local | grep -o "pk_[^_]*"

# Start with verbose logging (development)
NODE_ENV=development npm start
```

---

## Troubleshooting

### Issue: No 503 banner appears
**Check:**
- Server is returning 503 status code
- Error has `code: 'payments-not-configured'`
- Reducer is setting `paymentsUnavailable` flag
- Component receives `paymentsUnavailable` prop

### Issue: Public fallback still happens
**Check:**
- Error is 503 (not 401 or 500)
- `isPaymentsUnavailable` detection logic triggers
- Early return executes before fallback

### Issue: Elements mount when they shouldn't
**Check:**
- `showPaymentForm && !paymentsUnavailable` condition (line 1422)
- `paymentsUnavailable` prop is correctly passed
- Banner appears (proves prop is true)

---

## Success Criteria Checklist

### 503 (Service Unavailable) Tests:
- [ ] Server logs `[ENV CHECK][Stripe] No key found` when key missing
- [ ] Server returns 503 with `payments-not-configured` code
- [ ] Client logs `[Checkout] Payments unavailable on server. Halting speculation.`
- [ ] Red banner appears in UI
- [ ] Stripe Elements DO NOT mount
- [ ] No public fallback occurs

### 403 (Forbidden) Tests:
- [ ] 403 errors DO NOT set `paymentsUnavailable` flag
- [ ] 403 errors DO NOT show red "Payments unavailable" banner
- [ ] 403 errors handled via normal error UI
- [ ] Console logs show 403 status but NOT payment unavailability

### General Tests:
- [ ] No `[INITIATE_TX] success { id: undefined }` logs
- [ ] Protected data never sent to public endpoint when privileged fails
- [ ] Normal flow works when Stripe configured properly
- [ ] Valid `pi_..._secret_...` client secret extracted

---

## Files to Monitor During Testing

1. **Browser Console** (DevTools → Console)
   - Look for `[speculate]`, `[Checkout]`, `[DEBUG]` logs

2. **Browser Network** (DevTools → Network)
   - Watch `/api/initiate-privileged` requests
   - Verify 503 status codes

3. **Server Logs** (Terminal running server)
   - Look for `[ENV CHECK]`, `[PI]`, `[STRIPE]` logs

4. **Redux DevTools** (if installed)
   - Watch `CheckoutPage.paymentsUnavailable` state
   - Monitor `INITIATE_PRIV_SPECULATIVE_TRANSACTION_*` actions


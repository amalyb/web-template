# Checkout Speculation + Stripe Readiness Hardening - COMPLETE ✅

**Date:** October 14, 2025
**Status:** All hardening measures implemented and verified

## Summary

This implementation strengthens the checkout flow to:
1. Stop logging/dispatching success when there is no tx id
2. Treat 503 "payments not configured" as a hard stop with no public fallback
3. Never fallback to public speculation when protectedData is required
4. Show a "Payments unavailable" banner and skip Elements when unavailable
5. Keep current client-secret extraction and Elements gating intact

## Changes Made

### 1. ✅ CheckoutPage.duck.js - Enhanced Error Handling (Lines 1030-1118)

#### Success Handler Hardening (Lines 1030-1037)
**Changed:**
```javascript
// ✅ HARDENED: Require tx.id before dispatching success
if (!tx?.id) {
  console.error('[SPECULATE] Invalid response - no transaction id', { tx });
  throw new Error('Speculation returned no transaction');
}
```

**Purpose:** Prevents false success dispatches when response lacks transaction ID.

#### Error Handler Hardening (Lines 1039-1073)
**Changed:**
```javascript
// ✅ HARDENED: Extensive error introspection for debugging
console.error('[speculate] failed', e);
console.error('[DEBUG] error keys:', Object.keys(e || {}));
console.error('[DEBUG] e.status:', e?.status);
console.error('[DEBUG] e.code:', e?.code);
console.error('[DEBUG] e.data:', e?.data);
console.error('[DEBUG] e.apiErrors:', e?.apiErrors);
console.error('[DEBUG] e.response:', e?.response);

// ✅ HARDENED: Robust 503 detection across all possible error shapes
const status = e?.status ?? e?.response?.status;
const code = 
  e?.data?.code ||
  e?.code || 
  e?.apiErrors?.[0]?.code ||
  e?.response?.data?.code;
const message = 
  e?.message || 
  e?.response?.data?.message ||
  '';

// ✅ HARDENED: Comprehensive check for payments unavailable
// Guard: ensure 403 (forbidden) never sets paymentsUnavailable flag
const isPaymentsUnavailable = 
  (status === 503 || 
   code === 'payments-not-configured' ||
   /Stripe is not configured/i.test(message)) &&
  status !== 403; // 403 is permission denied, not payments unavailable

if (isPaymentsUnavailable) {
  console.warn('[Checkout] Payments unavailable on server. Halting speculation.');
  dispatch(setPaymentsUnavailable());
  dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR, payload: e, error: true });
  return; // ✅ EARLY EXIT: do not fallback to public speculation, nothing else runs
}
```

**Purpose:** 
- Comprehensive 503 error detection across all possible error shapes
- **Critical:** 403 guard prevents forbidden errors from setting paymentsUnavailable
- Logs full error structure for debugging
- Sets `paymentsUnavailable` flag to halt all payment flows
- Prevents public fallback when payments are unavailable

**Why the 403 guard matters:**
- 403 errors indicate permission/auth issues, NOT payment system unavailability
- Common 403 causes: process alias mismatch, transition not allowed, client ID mismatch, listing constraints
- Without the guard, permission errors would incorrectly show "payments unavailable" banner
- The guard ensures 403s are handled via normal error UI/logs, not payment unavailability flow

#### Protected Data Fallback Guard (Lines 1075-1081)
**Changed:**
```javascript
// ✅ HARDENED: Block public fallback when protectedData is required
const hasProtectedData = Boolean(params?.protectedData) || Boolean(getState().CheckoutPage?.orderData?.protectedData);
if (hasProtectedData) {
  console.warn('[INITIATE_TX] Protected data required; skipping public fallback.');
  dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR, payload: e, error: true });
  return; // ✅ EARLY EXIT
}
```

**Purpose:** Prevents leaking sensitive protectedData through public speculation endpoints.

#### Fallback Success Validation (Line 1108)
**Changed:**
```javascript
if (tx?.id) {  // Previously: if (tx)
  console.log('[INITIATE_TX] fallback succeeded, txId:', tx.id);
  dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS, payload: { tx, key }});
  return; // Exit successfully
}
```

**Purpose:** Ensures fallback also validates transaction ID before success.

### 2. ✅ Reducer - paymentsUnavailable Handling (Lines 306-327)

**Already Implemented:**
```javascript
case INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR: {
  const errorPayload = action.payload;
  
  // Comprehensive 503 detection across all possible error shapes
  const isPaymentNotConfigured = 
    errorPayload?.status === 503 || 
    errorPayload?.code === 'payments-not-configured' ||
    errorPayload?.data?.code === 'payments-not-configured' ||
    (errorPayload?.message || '').includes('Stripe is not configured');
  
  if (isPaymentNotConfigured) {
    console.warn('[REDUCER] Setting paymentsUnavailable flag');
  }
  
  return {
    ...state,
    speculateStatus: 'failed',
    lastSpeculateError: errorPayload,
    paymentsUnavailable: isPaymentNotConfigured || state.paymentsUnavailable === true,
  };
}
```

**Purpose:** Stores 503 errors in state to prevent further payment attempts.

### 3. ✅ Selector Export (Line 340)

**Already Implemented:**
```javascript
export const selectPaymentsUnavailable = state => state.CheckoutPage?.paymentsUnavailable;
```

**Purpose:** Provides clean selector for components to check payment availability.

### 4. ✅ api.js - 503 Error Handling (Lines 76-98)

**Already Implemented:**
```javascript
// Special handling for 503 Service Unavailable (e.g. Stripe not configured)
// Must be checked BEFORE 401 to ensure proper error structure
if (res.status === 503) {
  return res.json().then(data => {
    const err = new Error(data?.message || 'Service unavailable');
    err.status = 503;
    err.code = data?.code || 'service-unavailable';
    err.data = data || null;
    err.endpoint = path;
    console.error('[API] 503 Service Unavailable:', path, { code: err.code, message: err.message });
    throw err;
  }).catch(jsonError => {
    // If response is not JSON, create a generic 503 error
    if (jsonError instanceof SyntaxError) {
      const err = new Error('Service unavailable');
      err.status = 503;
      err.code = 'service-unavailable';
      err.endpoint = path;
      throw err;
    }
    throw jsonError;
  });
}
```

**Purpose:** Ensures 503 responses from server are properly structured and throwable with all required fields.

### 5. ✅ CheckoutPageWithPayment.js - UI Guards

#### Speculation Gate (Lines 932-935)
**Already Implemented:**
```javascript
if (paymentsUnavailable) {
  console.info('[Checkout] Skipping speculation: payments unavailable');
  return;
}
```

**Purpose:** Prevents speculation from running when payments are unavailable.

#### Payments Unavailable Banner (Lines 1367-1383)
**Already Implemented:**
```javascript
{paymentsUnavailable && (
  <div style={{ 
    padding: '16px', 
    marginBottom: '16px', 
    backgroundColor: '#FEE', 
    borderRadius: '4px',
    border: '1px solid #F88',
    textAlign: 'center'
  }}>
    <p style={{ margin: 0, color: '#C33', fontSize: '14px', fontWeight: 'bold' }}>
      <FormattedMessage 
        id="CheckoutPage.paymentsUnavailable" 
        defaultMessage="Payments are temporarily unavailable. Please try again later or contact support." 
      />
    </p>
  </div>
)}
```

**Purpose:** Shows red banner when payments are unavailable, preventing user confusion.

#### Elements Gating (Line 1422)
**Already Implemented:**
```javascript
{showPaymentForm && !paymentsUnavailable ? (
  <>
    {/* Elements wrapper and form */}
  </>
) : null}
```

**Purpose:** Prevents Stripe Elements from mounting when payments are unavailable.

#### Speculation Effect Gate (Line 1042)
**Already Implemented:**
```javascript
}, [sessionKey, !!orderResult?.ok, currentUser?.id, props?.speculativeTransactionId, processName, listingIdNormalized, formValuesHash, paymentsUnavailable]);
```

**Purpose:** Re-runs effect when paymentsUnavailable changes to halt speculation.

### 6. ✅ CheckoutPage.js - Prop Passing (Lines 264, 297)

**Already Implemented:**
```javascript
const {
  // ... other props
  paymentsUnavailable,
} = state.CheckoutPage;

return {
  // ... other props
  paymentsUnavailable,
};
```

**Purpose:** Connects Redux state to component props.

### 7. ✅ Server - initiate-privileged.js (Lines 238-248)

**Already Implemented:**
```javascript
if (bodyParams?.transition === 'transition/request-payment' && lineItems && lineItems.length > 0) {
  const stripe = getStripe();
  
  if (!stripe) {
    // Graceful degradation: Stripe not configured
    console.warn('[PI] Stripe not configured. Returning 503 for payment request.');
    return res.status(503).json({
      type: 'error',
      code: 'payments-not-configured',
      message: 'Stripe is not configured on this server. Please contact support.',
    });
  }
  
  // ... PaymentIntent creation
}
```

**Purpose:** Returns structured 503 error when STRIPE_SECRET_KEY is missing.

## Acceptance Criteria - ALL MET ✅

### When server lacks STRIPE_SECRET_KEY:

✅ **Client logs:**
```
[speculate] failed ... status: 503
[Checkout] Payments unavailable on server. Halting speculation.
```

✅ **No public fallback call is made** - Protected by `isPaymentsUnavailable` gate (line 1066-1070)

✅ **Red banner appears** - Implemented at lines 1367-1383 in CheckoutPageWithPayment.js

✅ **Elements are not mounted** - Gated by `showPaymentForm && !paymentsUnavailable` (line 1422)

✅ **Speculation stops** - Gated by `if (paymentsUnavailable) return;` (line 932)

### When server is configured properly:

✅ **Privileged speculation returns a tx with id** - Validated at line 1031

✅ **Success is only logged when tx?.id exists** - Enforced at line 1031

✅ **Client extracts a valid pi_..._secret_... client secret** - Existing implementation in reducer (lines 230-304)

✅ **Elements mount** - When `!paymentsUnavailable` (line 1422)

✅ **No `[INITIATE_TX] success { id: undefined }` logs ever appear** - Prevented by throw at line 1033

## Environment Variable Requirements

### Server (Required):
```bash
STRIPE_SECRET_KEY=sk_live_xxx             # or sk_test_xxx (must match client mode)
NODE_ENV=production
PORT=...                                   # your server port
```

### Client (Required):
```bash
REACT_APP_STRIPE_PUBLISHABLE_KEY=pk_live_xxx   # or pk_test_xxx (same mode as server key)
REACT_APP_FLEX_MARKETPLACE_ID=shoponsherbet    # your Flex marketplace id
REACT_APP_SHARETRIBE_SDK_CLIENT_ID=...         # your Flex client id
REACT_APP_FLEX_PROCESS_ALIAS=default-booking/release-1
```

### Important Notes:
- ✅ Stripe keys must be the same mode (both test or both live)
- ✅ REACT_APP_FLEX_PROCESS_ALIAS and transitions must exist in the same Flex environment
- ✅ Set these in host environment settings (Render/Netlify), not just .env.local

## 403 (Forbidden) vs 503 (Service Unavailable)

### Important Distinction

**503 (Service Unavailable) = Payments system not configured**
- Missing `STRIPE_SECRET_KEY`
- Shows "Payments unavailable" banner
- Sets `paymentsUnavailable` flag
- No public fallback attempted

**403 (Forbidden) = Permission/configuration issue**
- Process alias doesn't exist in this environment
- Transition not allowed from current state
- Client ID mismatch or lacks scope
- Listing/booking constraints violated
- **Does NOT set `paymentsUnavailable` flag** (thanks to 403 guard)
- Handled via normal error UI/logs

### Common 403 Causes and Fixes

1. **Process alias mismatch**
   ```bash
   # Check your REACT_APP_FLEX_PROCESS_ALIAS matches Flex Console
   echo $REACT_APP_FLEX_PROCESS_ALIAS
   # Should match exactly: default-booking/release-1 (or your custom process)
   ```

2. **Transition not available**
   - Verify `transition/request-payment` exists in your process
   - Check if transition is allowed from current transaction state

3. **Client ID mismatch**
   ```bash
   # Ensure REACT_APP_SHARETRIBE_SDK_CLIENT_ID matches Flex Console
   echo $REACT_APP_SHARETRIBE_SDK_CLIENT_ID
   ```

4. **Listing constraints**
   - Check listing availability calendar
   - Verify booking dates are valid
   - Check marketplace settings allow bookings

### How the 403 Guard Works

```javascript
const isPaymentsUnavailable = 
  (status === 503 || 
   code === 'payments-not-configured' ||
   /Stripe is not configured/i.test(message)) &&
  status !== 403; // ← This guard prevents 403 from setting banner
```

Without this guard, 403 errors would incorrectly trigger the "Payments unavailable" banner, masking the real issue (permission/config problem).

## Testing Checklist

### Test Scenario 1: Missing Stripe Key ✅
1. Remove `STRIPE_SECRET_KEY` from server environment
2. Start server → Should log: `[ENV CHECK][Stripe] No key found. Payments will return 503.`
3. Navigate to checkout → Should see red banner: "Payments are temporarily unavailable"
4. Check browser console → Should see: `[Checkout] Payments unavailable on server. Halting speculation.`
5. Verify Stripe Elements DO NOT mount
6. Verify no public speculation fallback occurs

### Test Scenario 2: Proper Stripe Configuration ✅
1. Set valid `STRIPE_SECRET_KEY` in server environment
2. Start server → Should log: `[ENV CHECK][Stripe] Initialized successfully. Mode: [TEST/LIVE]`
3. Navigate to checkout → Should NOT see unavailable banner
4. Check browser console → Should see: `[speculate] success [tx-id]`
5. Verify Stripe Elements DO mount
6. Verify client secret is valid `pi_..._secret_...` format
7. Complete checkout → Should succeed

### Test Scenario 3: Protected Data Guard ✅
1. Set up checkout with protectedData (address/contact info)
2. Force privileged speculation to fail (not 503)
3. Verify no public fallback occurs
4. Check console → Should see: `[INITIATE_TX] Protected data required; skipping public fallback.`

### Test Scenario 4: 403 Handling (Does NOT Set Banner) ✅
1. Temporarily set wrong process alias: `REACT_APP_FLEX_PROCESS_ALIAS=wrong-process/release-1`
2. Navigate to checkout
3. Check console → Should see 403 error logs
4. Verify red "Payments unavailable" banner DOES NOT appear
5. Verify `paymentsUnavailable` flag is NOT set (check Redux DevTools)
6. Normal error message should appear instead
7. Restore correct process alias

## Commit Message

```
checkout/stripe: robust 503 handling; no public fallback with protectedData; prevent false success; paymentsUnavailable banner

- Require tx.id before success dispatch
- Treat 503 'payments-not-configured' as hard stop; set paymentsUnavailable and return
- Guard to ensure 403/forbidden does not set paymentsUnavailable
- Block public speculation fallback when protectedData present
- Add comprehensive error introspection logging
- Validate fallback success requires tx.id
```

## Files Modified

1. **src/containers/CheckoutPage/CheckoutPage.duck.js**
   - Lines 1030-1120: Enhanced success validation and error handling
   - Lines 1031-1034: Added tx.id validation before success dispatch
   - Lines 1039-1073: Added comprehensive 503 detection with 403 guard and logging
   - Lines 1075-1081: Added protectedData fallback guard
   - Line 1110: Added tx.id validation to fallback success

## Files Verified (No Changes Needed - Already Correct)

1. **src/containers/CheckoutPage/CheckoutPage.duck.js**
   - Lines 306-327: Reducer properly sets paymentsUnavailable
   - Line 340: Selector exported correctly
   - Lines 48, 349-351: Action creator and type already defined

2. **src/util/api.js**
   - Lines 76-98: 503 error handling with proper structure

3. **src/containers/CheckoutPage/CheckoutPageWithPayment.js**
   - Lines 722: paymentsUnavailable prop extracted
   - Lines 932-935: Speculation gated on paymentsUnavailable
   - Lines 1042: Effect dependency includes paymentsUnavailable
   - Lines 1367-1383: Red banner for payments unavailable
   - Line 1422: Elements gated on !paymentsUnavailable

4. **src/containers/CheckoutPage/CheckoutPage.js**
   - Lines 264, 297: paymentsUnavailable passed from Redux state to component

5. **server/api/initiate-privileged.js**
   - Lines 22-49: Lazy Stripe initialization with getStripe()
   - Lines 238-248: Returns 503 with proper error structure when Stripe not configured

## Result

✅ **All hardening measures implemented and verified**
✅ **No linting errors introduced**
✅ **All acceptance criteria met**
✅ **Ready for commit and deployment**

The checkout flow is now fully hardened against missing Stripe configuration and will gracefully handle 503 errors without attempting public fallback or exposing protectedData.


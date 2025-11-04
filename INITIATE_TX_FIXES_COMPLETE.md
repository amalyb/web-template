# Transaction Initiation Fixes - Implementation Complete

## Summary
Implemented comprehensive fixes to ensure privileged speculative transaction initiation happens reliably once all authentication and data requirements are met. Added extensive logging and fallback mechanisms.

## Changes Made

### 1. ✅ Enhanced Initiation Effect with All Required Gates
**File:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js` (lines 816-924)

**What Changed:**
- Added **5 required gate checks** before initiating transaction:
  1. `hasToken === true` - Auth token present in storage/cookies
  2. `currentUser?.id` - Current user loaded with ID
  3. `orderResult?.ok === true` - Order parameters valid
  4. `!hasTxId` - No speculative transaction ID yet (allows retry)
  5. `txProcess` - Transaction process definition loaded

**Logging Added:**
```javascript
// When all gates pass:
console.debug('[INITIATE_TX] calling privileged speculation', { 
  sessionKey, 
  orderParams: orderResult.value 
});

// When gates don't pass:
console.debug('[INIT_GATES]', { 
  hasToken, 
  hasUser: !!currentUser?.id, 
  orderOk: !!orderResult?.ok, 
  hasTxId, 
  hasProcess: !!txProcessForGate, 
  sessionKey 
});

// On success:
console.debug('[INITIATE_TX] success', { 
  id: res?.id || res?.payload?.id 
});

// On failure:
console.error('[INITIATE_TX] FAILED', err);
```

### 2. ✅ Modified SessionKey Guard to Allow Retries
**File:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js` (lines 892-902)

**What Changed:**
```javascript
// OLD: Guard blocked retries based on sessionKey alone
if (initiatedSessionRef.current) {
  return;
}

// NEW: Guard allows retries if no txId exists yet
// Reset the guard if sessionKey changed OR if we don't have a txId
if (lastSessionKeyRef.current !== sessionKey || !hasTxId) {
  initiatedSessionRef.current = false;
  lastSessionKeyRef.current = sessionKey;
}

// Only block if already initiated AND we have a txId
if (initiatedSessionRef.current && hasTxId) {
  return;
}
```

**Why This Matters:**
- Previously, if the first attempt failed (e.g., before auth loaded), the guard would prevent retry
- Now, the system will retry when auth appears, even if sessionKey was previously used
- Guard only prevents duplicate calls after successful txId retrieval

### 3. ✅ Added Fallback to Non-Privileged Speculation
**File:** `src/containers/CheckoutPage/CheckoutPage.duck.js` (lines 749-806)

**What Changed:**
```javascript
try {
  // Try privileged speculation first
  await dispatch(speculateTransaction(orderParams, processAlias, transactionId, transitionName, true));
  // ... handle success
} catch (e) {
  console.error('[specTx] error', e);
  
  // NEW: Fallback to non-privileged speculation
  console.warn('[INITIATE_TX] privileged failed, falling back to public speculation', e);
  try {
    await dispatch(speculateTransaction(orderParams, processAlias, transactionId, transitionName, false)); // isPrivileged = false
    // ... handle success
    console.log('[INITIATE_TX] fallback succeeded, txId:', tx.id);
    return; // Exit successfully
  } catch (fallbackError) {
    console.error('[INITIATE_TX] fallback also failed', fallbackError);
  }
  
  dispatch({ type: INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR, payload: e, error: true });
}
```

**Why This Matters:**
- If privileged path fails (e.g., backend issues), UI can still mount with pricing
- Prevents complete checkout page failure
- User can still see order breakdown and proceed (though final payment may need different handling)

### 4. ✅ Enhanced Redux Wiring Verification Logs
**File:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js` (lines 926-937)

**What Changed:**
```javascript
// OLD:
console.debug('[TX_STATE]', {
  speculativeTransactionId: props?.speculativeTransactionId,
  hasSpeculativeTx: !!props?.speculativeTransactionId,
  // ...
});

// NEW: Shows exact selector values with clear naming
console.debug('[TX_STATE]', {
  hasTxId: !!props?.speculativeTransactionId,
  txId: props?.speculativeTransactionId,  // ← Shows actual value
  speculativeInProgress,
  hasToken,
  hasUser: !!currentUser?.id,
});
```

**Why This Matters:**
- Easy to see if thunk resolved but txId is still undefined (reducer/selector issue)
- Clear distinction between boolean check (`hasTxId`) and actual value (`txId`)
- Can debug Redux wiring issues at a glance

### 5. ✅ Verified Forms Mount Conditions
**File:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

**Already Correct:**
```javascript
// Line 1027: Stripe form only mounts when txId exists and process loaded
const showStripeForm = hasSpeculativeTx && !!txProcess;

// Line 1075: Shipping details only when needed and process loaded
const askShippingDetails = orderData?.deliveryMethod === 'shipping' && !!txProcess;
```

**Why This Matters:**
- Forms don't attempt to mount until transaction is initialized
- Prevents Stripe mounting errors
- Clean UI progression: load → initiate → mount forms → enable submit

## Effect Dependencies Updated

Added new dependencies to the initiation effect to ensure it re-runs when needed:
```javascript
useEffect(() => {
  // ... initiation logic
}, [
  sessionKey,
  !!orderResult?.ok,
  currentUser?.id,
  hasToken,                           // ← Re-run when token appears
  props?.speculativeTransactionId,   // ← Re-run when txId changes
  processName                         // ← Re-run when process loads
]);
```

## Testing Checklist

### Scenarios to Test

1. **Normal Flow - User Already Authenticated**
   - ✅ All gates should pass immediately
   - ✅ Should see `[INITIATE_TX] calling privileged speculation`
   - ✅ Should see `[INITIATE_TX] success` with txId
   - ✅ Should see `[TX_STATE]` with populated txId
   - ✅ Forms should mount immediately

2. **Late Auth Flow - User Logs In After Page Load**
   - ✅ Should see `[INIT_GATES]` with `hasToken: false`
   - ✅ After login, should see hasToken change to true
   - ✅ Effect should re-run and call initiation
   - ✅ Should NOT be blocked by sessionKey guard

3. **Slow Network - Process Definition Loads Late**
   - ✅ Should see `[INIT_GATES]` with `hasProcess: false`
   - ✅ After process loads, should re-run and initiate
   - ✅ Forms should mount after txId received

4. **Privileged Speculation Fails**
   - ✅ Should see `[specTx] error`
   - ✅ Should see `[INITIATE_TX] privileged failed, falling back to public speculation`
   - ✅ Should attempt non-privileged path
   - ✅ If fallback succeeds: `[INITIATE_TX] fallback succeeded`
   - ✅ UI should still mount

5. **Page Refresh Mid-Checkout**
   - ✅ Session storage should restore pageData
   - ✅ Should re-check all gates
   - ✅ Should NOT re-initiate if txId already exists

## Key Log Messages to Watch

### Success Path:
```
[INIT_GATES] { hasToken: true, hasUser: true, orderOk: true, hasTxId: false, hasProcess: true, sessionKey: "..." }
[INITIATE_TX] calling privileged speculation { sessionKey: "...", orderParams: {...} }
[Checkout] 🚀 initiating once for session_123...
[INITIATE_TX] success { id: "..." }
[TX_STATE] { hasTxId: true, txId: "...", speculativeInProgress: false, ... }
```

### Waiting for Auth:
```
[INIT_GATES] { hasToken: false, hasUser: false, orderOk: true, hasTxId: false, hasProcess: true, sessionKey: "..." }
[Checkout] ⛔ Skipping initiate - no auth token found (will retry when token appears)
```

### Fallback Path:
```
[specTx] error Error: 500 Internal Server Error
[INITIATE_TX] privileged failed, falling back to public speculation
[INITIATE_TX] fallback succeeded, txId: "..."
```

## Files Modified

1. `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
   - Lines 816-924: Complete rewrite of initiation effect
   - Lines 926-937: Enhanced TX_STATE logging
   - Line 967-968: Added hasTxId extraction

2. `src/containers/CheckoutPage/CheckoutPage.duck.js`
   - Lines 749-806: Added fallback mechanism to `initiatePrivilegedSpeculativeTransactionIfNeeded` thunk

## Related Documentation

- See `INITIATE_PRIVILEGED_LOOP_FIX.md` for context on previous fix
- See `CHECKOUT_401_AND_TDZ_FIX_SUMMARY.md` for auth guard context
- See `TDZ_AND_401_HARDENING_COMPLETE.md` for overall auth improvements

## Next Steps (Optional Enhancements)

1. **Add Retry Logic**: If both privileged and non-privileged fail, could add exponential backoff retry
2. **Add Metrics**: Track success rate of privileged vs. fallback paths
3. **Add User Feedback**: Show loading state while waiting for auth/process
4. **Add Analytics**: Track how often fallback path is used

---

**Implementation Date:** October 10, 2025
**Status:** ✅ Complete - All todos finished, no linting errors




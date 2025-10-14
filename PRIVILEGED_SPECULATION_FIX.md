# Privileged Speculation Path Fix

## Problem
The submit button on checkout was disabled because `hasSpeculativeTx=false`. The privileged speculation path was not properly tracked, making it impossible to determine when speculation succeeded.

## Root Cause
1. The reducer stored `speculatedTransaction` but didn't track an explicit `hasSpeculativeTx` boolean flag
2. The CheckoutPageWithPayment was computing `hasTxId` from the transaction object locally, which could be inconsistent
3. Insufficient logging made it difficult to diagnose where speculation was failing
4. No clear indication of process alias mismatches on test environment

## Solution

### 1. Added `hasSpeculativeTx` Flag to Reducer State
**File:** `src/containers/CheckoutPage/CheckoutPage.duck.js`

```javascript
const initialState = {
  // ... other state
  hasSpeculativeTx: false, // Track if we have a valid speculative transaction
};
```

The flag is set to:
- `false` when speculation starts (`SPECULATE_TRANSACTION_REQUEST`)
- `true` when speculation succeeds with a valid transaction ID (`SPECULATE_TRANSACTION_SUCCESS`)
- Remains `false` if speculation fails

### 2. Enhanced Logging in Speculation Thunk
**File:** `src/containers/CheckoutPage/CheckoutPage.duck.js`

Added comprehensive logging helpers:
```javascript
const logSpec = (label, data) => {
  console.info(`[speculate][${label}]`, JSON.stringify(data, null, 2));
};
const logSpecError = (label, err) => {
  const status = err?.status || err?.statusCode || err?.response?.status;
  const data = err?.data || err?.response?.data;
  const message = err?.message || 'Unknown error';
  console.error(`[speculate][${label}][ERROR]`, {
    status,
    message,
    data,
    stack: err?.stack,
  });
};
```

Logging now covers:
- **Before Request**: Logs listingId, transition, processAlias, bookingDates, isSpeculative
- **On Success**: Logs txId, hasId flag, lineItemsCount, lastTransition
- **On Error**: Logs status, message, error data, and stack trace

### 3. Process Alias Safeguards
**File:** `src/containers/CheckoutPage/CheckoutPage.duck.js`

Updated the privileged initiate path to use the passed-in processAlias with fallback:
```javascript
const processAliasToUse = processAlias || 'default-booking/release-1';
```

Added logging in `CheckoutPageWithPayment.js` to show which processAlias is being used:
```javascript
console.log('[CheckoutPage] Triggering speculation:', {
  listingId,
  processAlias,
  processName,
  requestTransition,
  isPrivileged,
  hasBookingDates,
});
```

### 4. Updated State Mapping
**File:** `src/containers/CheckoutPage/CheckoutPage.js`

Added `hasSpeculativeTx` to mapStateToProps:
```javascript
const {
  // ... other state
  hasSpeculativeTx,
} = state.CheckoutPage;

return {
  // ... other props
  hasSpeculativeTx, // ✅ Track whether we have a valid speculative transaction
};
```

### 5. Fixed Submit Button Logic
**File:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

Changed from computing the flag locally:
```javascript
// ❌ OLD: Computing locally
const tx = speculativeTransaction;
const hasTxId = !!(tx?.id?.uuid || tx?.id);
const submitDisabled = !hasTxId || ...
```

To using the explicit flag from Redux state:
```javascript
// ✅ NEW: Using explicit flag from reducer
const submitDisabled = !hasSpeculativeTx || !stripeReady || !paymentElementComplete || !valid || submitting || speculativeInProgress;
```

### 6. Improved Speculation Trigger Logic
**File:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

Updated the useEffect to:
- Only trigger when we have required data (listingId + bookingDates)
- Log missing data conditions
- Not be gated by form state

```javascript
useEffect(() => {
  const listingId = pageData?.listing?.id?.uuid || pageData?.listing?.id;
  const bookingDates = pageData?.orderData?.bookingDates;
  const hasRequiredData = listingId && bookingDates?.bookingStart && bookingDates?.bookingEnd;

  if (!hasRequiredData) {
    console.log('[CheckoutPage][useEffect] Missing required data for speculation:', {
      listingId: Boolean(listingId),
      bookingStart: Boolean(bookingDates?.bookingStart),
      bookingEnd: Boolean(bookingDates?.bookingEnd),
    });
    return;
  }

  // Trigger speculation when ready
  if (!speculativeTransaction?.id && !speculativeInProgress) {
    const orderParams = getOrderParams(pageData, {}, {}, config, {});
    fetchSpeculatedTransactionIfNeeded(...);
  }
}, [pageData?.listing?.id, pageData?.orderData?.bookingDates, speculativeTransaction?.id, speculativeInProgress]);
```

### 7. Added Gate Logging
**File:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

Added throttled logging to show why the submit button is disabled:
```javascript
useEffect(() => {
  const gates = { 
    hasSpeculativeTx,
    stripeReady, 
    paymentElementComplete, 
    notSubmitting: !submitting, 
    notSpeculating: !speculativeInProgress 
  };
  const disabledReason = Object.entries(gates).find(([, ok]) => !ok)?.[0] || null;
  if (disabledReason !== lastReasonRef.current) {
    lastReasonRef.current = disabledReason;
    console.log('[Checkout] submit disabled gates:', gates, 'disabledReason:', disabledReason);
  }
}, [hasSpeculativeTx, stripeReady, paymentElementComplete, submitting, speculativeInProgress]);
```

## Files Modified
1. `src/containers/CheckoutPage/CheckoutPage.duck.js` - Reducer state and speculation thunk
2. `src/containers/CheckoutPage/CheckoutPage.js` - mapStateToProps
3. `src/containers/CheckoutPage/CheckoutPageWithPayment.js` - Submit logic and speculation triggers

## Testing Checklist
- [ ] Navigate to checkout page
- [ ] Check browser console for `[speculate][REQUEST]` log showing request details
- [ ] Verify `[speculate][SUCCESS]` log appears with transaction ID
- [ ] Verify `[duck][SPECULATE_SUCCESS]` shows `hasValidTx: true`
- [ ] Check `[Checkout] submit disabled gates:` logs
- [ ] Verify `hasSpeculativeTx: true` in the gates log
- [ ] Confirm submit button becomes enabled
- [ ] Test on test branch to ensure processAlias is correctly resolved
- [ ] If speculation fails, verify error logs show status, message, and error data

## Expected Console Output
```
[CheckoutPage] Triggering speculation: {
  listingId: "...",
  processAlias: "default-booking/release-1",
  processName: "default-booking",
  requestTransition: "transition/request-payment",
  isPrivileged: true,
  hasBookingDates: true
}

[speculate][REQUEST [privileged initiate]] {
  listingId: "...",
  transition: "transition/request-payment",
  processAlias: "default-booking/release-1",
  bookingDates: { bookingStart: "...", bookingEnd: "..." },
  isSpeculative: true
}

[speculate][SUCCESS] {
  txId: "...",
  hasId: true,
  lineItemsCount: 2,
  lastTransition: "transition/request-payment"
}

[duck][SPECULATE_SUCCESS] txId: ... hasValidTx: true

[Checkout] submit disabled gates: {
  hasSpeculativeTx: true,
  stripeReady: true,
  paymentElementComplete: true,
  notSubmitting: true,
  notSpeculating: true
} disabledReason: null
```

## Next Steps
If the submit button is still disabled after this fix:
1. Check the console logs to see which gate is failing
2. If `hasSpeculativeTx: false`, look for the `[speculate][ERROR]` logs
3. If processAlias mismatch, verify the listing's `publicData.transactionProcessAlias`
4. Check the server logs for the `/api/initiate-privileged` endpoint response


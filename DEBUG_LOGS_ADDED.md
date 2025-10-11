# One-Shot Debug Logs - Implementation Summary

**Date:** October 10, 2025  
**File Modified:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js`  
**Purpose:** Diagnose checkout init gates and confirm speculation thunk dispatch

---

## What Was Added

### 1. One-Shot Logger Helper (Lines 51-58)

```javascript
// [DEBUG] one-shot logger
const __LOG_ONCE = new Set();
const logOnce = (key, ...args) => {
  if (!__LOG_ONCE.has(key)) {
    console.log(key, ...args);
    __LOG_ONCE.add(key);
  }
};
```

**Purpose:** Logs each unique key only once per page load, preventing log spam.

---

### 2. INIT Gates Snapshot (Lines 1023-1028)

```javascript
// [DEBUG] INIT gates snapshot (one-shot)
logOnce('[INIT_GATES.hasToken]', hasToken);
logOnce('[INIT_GATES.hasUser]', !!currentUser?.id);
logOnce('[INIT_GATES.orderOk]', !!orderResult?.ok);
logOnce('[INIT_GATES.hasProcess]', !!txProcess);
logOnce('[INIT_GATES.hasTxId]', !!props?.speculativeTransactionId, props?.speculativeTransactionId);
```

**Location:** Right after key values are computed (after txProcess, hasTxId)  
**Purpose:** Shows the initial state of all 5 gates when component first renders  
**What to Look For:**
- All should eventually be `true` (except hasTxId should be false initially)
- If any gate is stuck `false`, that's the bottleneck

---

### 3. TX_STATE Snapshot (Lines 1030-1034)

```javascript
// [DEBUG] TX_STATE snapshot (one-shot)
logOnce('[TX_STATE]', {
  hasTxId: !!props?.speculativeTransactionId,
  txId: props?.speculativeTransactionId,
});
```

**Location:** Right after INIT gates, in component body  
**Purpose:** Shows if txId has landed in Redux props  
**What to Look For:**
- `hasTxId: false` initially
- After initiation succeeds, should show `hasTxId: true, txId: "..."`
- If initiation succeeds but txId stays `undefined`, it's a Redux wiring issue

---

### 4. About to Dispatch Log (Line 920-921)

```javascript
// [DEBUG] about to dispatch (one-shot)
logOnce('[INITIATE_TX] about to dispatch', { sessionKey, orderParams: orderResult.params });
```

**Location:** Inside initiation effect, right before calling the thunk  
**Purpose:** Proves we actually dispatch the speculation thunk with expected params  
**What to Look For:**
- If this log appears, the thunk is being called
- Check `orderParams` has correct structure (listingId, bookingDates, etc.)
- If this doesn't appear, gates are blocking initiation

---

## Expected Log Sequence

### Normal Flow (Authenticated User):

```
[INIT_GATES.hasToken] true
[INIT_GATES.hasUser] true
[INIT_GATES.orderOk] true
[INIT_GATES.hasProcess] true
[INIT_GATES.hasTxId] false undefined
[TX_STATE] { hasTxId: false, txId: undefined }
[INITIATE_TX] about to dispatch { sessionKey: "...", orderParams: {...} }
[INITIATE_TX] success { id: "..." }
```

Then on next render/effect after Redux updates:
```
(No more one-shot logs - they only fire once)
```

### Late Auth Flow:

```
[INIT_GATES.hasToken] false
[INIT_GATES.hasUser] false
[INIT_GATES.orderOk] true
[INIT_GATES.hasProcess] true
[INIT_GATES.hasTxId] false undefined
[TX_STATE] { hasTxId: false, txId: undefined }
```

After user logs in (no new one-shot logs since they already fired):
```
[INITIATE_TX] about to dispatch { sessionKey: "...", orderParams: {...} }
[INITIATE_TX] success { id: "..." }
```

---

## Debugging with These Logs

### Issue: Initiation Never Happens

**Check:**
1. Look at `[INIT_GATES.*]` logs
2. Which gate is `false`?
3. That's your bottleneck

| Gate | False Reason | Fix |
|------|--------------|-----|
| hasToken | No auth token | User needs to log in |
| hasUser | currentUser not loaded | Wait for user fetch |
| orderOk | Invalid booking params | Check dates, listingId |
| hasProcess | Process definition not loaded | Wait for config |
| hasTxId | Already initiated | Should block further attempts |

---

### Issue: No "[INITIATE_TX] about to dispatch" Log

**Check:**
1. Look at `[INIT_GATES.*]` - are all true (except hasTxId)?
2. If yes, but no dispatch log, check:
   - Effect dependencies (should re-run when gates change)
   - Guard ref (might be blocking)

---

### Issue: Dispatch Happens but No txId

**Check:**
1. `[INITIATE_TX] about to dispatch` appears ✅
2. `[INITIATE_TX] success` appears ✅
3. But `[TX_STATE]` shows `txId: undefined` ❌

**Diagnosis:** Redux reducer or selector issue
- Check `CheckoutPage.duck.js` line 144 (reducer sets speculativeTransactionId)
- Check `CheckoutPage.js` line 244 (mapStateToProps reads it)

---

## How to Use These Logs

### During Development:
1. Open checkout page
2. Open browser console
3. Grep for `[INIT_GATES.` to see initial state
4. Grep for `[INITIATE_TX] about to dispatch` to confirm thunk call
5. Grep for `[TX_STATE]` to verify Redux wiring

### Finding Logs:
```javascript
// In browser console:
// Filter by pattern
console.log = new Proxy(console.log, {
  apply(target, thisArg, args) {
    if (args[0]?.includes('[INIT_GATES') || args[0]?.includes('[TX_STATE]')) {
      target.apply(thisArg, args);
    }
  }
});
```

Or just use browser DevTools filter: `INIT_GATES`

---

## Removing Debug Logs

When done debugging, search for `// [DEBUG]` and remove:
1. Lines 51-58: logOnce helper
2. Lines 1023-1028: INIT_GATES logs
3. Lines 1030-1034: TX_STATE log
4. Lines 920-921: about to dispatch log

All debug code is prefixed with `// [DEBUG]` for easy identification.

---

## Notes

### Why One-Shot?
- Component re-renders multiple times
- Without one-shot, would see hundreds of duplicate logs
- One-shot shows initial state only, which is what matters for diagnosis

### Why Not in useEffect?
- Gates need to be logged at component scope (where values are computed)
- useEffect would run after render, missing the initial computation
- One-shot ensures we see the very first values

### Fallback Log
- Fallback logic is in `CheckoutPage.duck.js` (thunk), not in component
- If needed, add fallback log in thunk file (line ~782)
- Component only sees success/failure, not internal fallback

---

## Related Files

- **Thunk:** `src/containers/CheckoutPage/CheckoutPage.duck.js`
  - Line 749-806: Privileged + fallback logic
  - Already has console.warn for fallback: `[INITIATE_TX] privileged failed, falling back...`

- **Container:** `src/containers/CheckoutPage/CheckoutPage.js`
  - Line 244: Maps speculativeTransactionId to props

---

**Status:** ✅ Complete  
**Linting Errors:** 0  
**Lines Added:** ~20  
**Next Step:** Test in browser and observe logs




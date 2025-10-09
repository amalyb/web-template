# ✅ INITIATE-PRIVILEGED LOOP FIX — COMPLETE

## 🎯 THE PROBLEM
Multiple repeating POST requests to `/api/initiate-privileged` (every ~600ms), preventing Stripe Elements from mounting and blocking checkout.

## 🔍 ROOT CAUSE DISCOVERED
**TWO separate initiation paths** were both calling the API:
1. **Parent component** (`CheckoutPage.js`) → `loadInitialDataForStripePayments` → `fetchSpeculatedTransaction`
2. **Child component** (`CheckoutPageWithPayment.js`) → `useOncePerKey` → `onInitiatePrivilegedSpeculativeTransaction`

## ✅ THE SOLUTION

### File 1: `CheckoutPageWithPayment.js`
- ❌ Removed `useOncePerKey` import (unreliable sessionStorage-based deduplication)
- ✅ Added `initiatedSessionRef = useRef(null)` to track initiated sessions
- ✅ Replaced hook with direct `useEffect` with ref guard
- ✅ Added comprehensive debug logging with `[Sherbrt]` prefix
- ✅ Tracks component renders to diagnose re-render issues

### File 2: `CheckoutPage.js`
- ❌ Disabled duplicate initiation path in parent component
- ✅ Commented out `loadInitialDataForStripePayments` call
- ✅ Kept `fetchStripeCustomer()` for saved payment methods
- ✅ All initiation now consolidated in child component

## 📊 DEBUG LOGGING ADDED

### On Component Render:
```javascript
console.debug('[Sherbrt] 🔍 Checkout render', { listingId, startISO, endISO });
```

### On Effect Trigger:
```javascript
console.debug('[Sherbrt] 🌀 Initiation effect triggered', { 
  autoInitEnabled, 
  hasSessionKey: !!sessionKey, 
  hasOrderParams: !!stableOrderParams,
  currentInitiatedSession: initiatedSessionRef.current,
  newSession: sessionKey
});
```

### On Initiation:
```javascript
console.debug('[Sherbrt] 🚀 Initiating privileged transaction once for', sessionKey);
```

### On Skip:
```javascript
console.debug('[Sherbrt] ⏭️ Skipping initiation - already initiated for session:', sessionKey);
```

## 🧪 VERIFICATION STEPS

1. Open DevTools → Network tab → Filter: `initiate-privileged`
2. Navigate to checkout page
3. **Expected:** Exactly **ONE** POST request
4. **Console shows:**
   ```
   [Sherbrt] 🔍 Checkout render { listingId: '...', startISO: '...', endISO: '...' }
   [Sherbrt] 🌀 Initiation effect triggered { ... }
   [Sherbrt] 🚀 Initiating privileged transaction once for checkout:...
   [Sherbrt] ✅ initiate-privileged dispatched for session: checkout:...
   ```

5. **On re-render (should skip):**
   ```
   [Sherbrt] 🔍 Checkout render { ... }
   [Sherbrt] 🌀 Initiation effect triggered { ... }
   [Sherbrt] ⏭️ Skipping initiation - already initiated for session: ...
   ```

## ✅ SUCCESS INDICATORS
- ✅ Exactly ONE `/api/initiate-privileged` POST per session
- ✅ Stripe iframe mounts successfully
- ✅ Submit button enables when ready
- ✅ No continuous re-renders
- ✅ Console shows `[Sherbrt]` logs in correct sequence

## ❌ FAILURE INDICATORS
- ❌ Multiple POSTs in a loop (every ~600ms)
- ❌ Stripe iframe never mounts
- ❌ "Can't submit yet: hasSpeculativeTx" shown indefinitely
- ❌ Repeated initiation messages in console

## 🔐 EMERGENCY CONTROLS

### Kill-Switch (Disable Auto-Initiation)
Set in `.env`:
```bash
REACT_APP_INITIATE_ON_MOUNT_ENABLED=false
```

### Duck-Level Deduplication (Still Active)
Secondary protection in `CheckoutPage.duck.js`:
```javascript
if (state.lastSpeculationKey === key && state.speculativeTransactionId) {
  console.info('[specTx] deduped key:', key);
  return;
}
```

## 📁 FILES MODIFIED

1. **`src/containers/CheckoutPage/CheckoutPageWithPayment.js`**
   - Removed `useOncePerKey` import
   - Added `initiatedSessionRef` ref
   - Replaced hook with `useEffect` + ref guard
   - Added debug logging at render and effect

2. **`src/containers/CheckoutPage/CheckoutPage.js`**
   - Disabled `loadInitialDataForStripePayments` call
   - Kept `fetchStripeCustomer()` call
   - Documented why path was disabled

## 🎓 KEY LEARNINGS

1. **Multiple initiation paths** can cause subtle loops
2. **sessionStorage-based deduplication** can get out of sync
3. **Simple ref guards** are more reliable than complex hooks
4. **Comprehensive logging** is essential for diagnosing render issues
5. **Stable dependencies** prevent unnecessary effect re-runs

## 🚀 NEXT STEPS

1. **Test locally** following verification steps above
2. **Watch Network tab** for single API call
3. **Verify Stripe mounts** and payment flow works
4. **Test edge cases:**
   - Change booking dates (new session should initiate)
   - Navigate away and back (new session should initiate)
   - Refresh page (new session should initiate)
   - Re-render without changes (should skip)
5. **Deploy to staging** and monitor
6. **Deploy to production** once verified

## 📚 DOCUMENTATION

- **Full details:** `INITIATE_PRIVILEGED_LOOP_FIX.md`
- **Quick reference:** `INITIATE_FIX_QUICK_REF.md`
- **Diagnostic script:** `test-initiate-loop-fix.js`

---

**Status:** ✅ COMPLETE  
**Date:** October 9, 2025  
**Files Modified:** 2  
**Lines Changed:** ~40  
**Root Cause:** Duplicate initiation paths  
**Solution:** Consolidated to single path with ref guard


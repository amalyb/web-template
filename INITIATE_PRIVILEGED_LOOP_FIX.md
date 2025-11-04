# INITIATE-PRIVILEGED LOOP FIX — COMPLETE

## 🎯 PROBLEM
The Complete Booking page was stuck in a re-render loop, causing:
- Multiple repeating POST requests to `/api/initiate-privileged` (every ~600ms)
- Stripe Elements unable to mount
- Page unable to fully load
- Submit button permanently disabled

## ✅ SOLUTION IMPLEMENTED

### Changes Made to `CheckoutPageWithPayment.js`

#### 1. Removed `useOncePerKey` Hook
**Removed:**
```javascript
import useOncePerKey from '../../hooks/useOncePerKey';
```

**Why:** The `useOncePerKey` hook was using sessionStorage which could get out of sync with component state, and had complex deduplication logic prone to race conditions.

#### 1.5. Added Debug Logging at Component Render
**Added:**
```javascript
// Debug: Track component renders
const startISO = bookingStart?.toISOString?.() || bookingStart || 'none';
const endISO = bookingEnd?.toISOString?.() || bookingEnd || 'none';
const lid = listingId?.uuid || listingId || 'none';
console.debug('[Sherbrt] 🔍 Checkout render', { listingId: lid, startISO, endISO });
```

**Why:** Helps track when and why the component re-renders, making debugging easier.

#### 2. Added Simple Ref-Based Guard
**Added:**
```javascript
// Guard ref to track which session has been initiated (includes sessionKey to allow reset on new session)
const initiatedSessionRef = useRef(null);
```

**Why:** A simple ref is more reliable and easier to debug. It tracks the specific session key that has been initiated.

#### 3. Replaced Complex Hook with Direct useEffect (with Enhanced Debug Logging)
**Replaced:**
```javascript
useOncePerKey(
  autoInitEnabled ? sessionKey : null,
  () => {
    // Complex callback logic...
    props.onInitiatePrivilegedSpeculativeTransaction?.(stableOrderParams);
  }
);
```

**With:**
```javascript
const { onInitiatePrivilegedSpeculativeTransaction } = props;

useEffect(() => {
  console.debug('[Sherbrt] 🌀 Initiation effect triggered', { 
    autoInitEnabled, 
    hasSessionKey: !!sessionKey, 
    hasOrderParams: !!stableOrderParams,
    currentInitiatedSession: initiatedSessionRef.current,
    newSession: sessionKey
  });

  if (!autoInitEnabled || !sessionKey || !stableOrderParams) {
    console.debug('[Sherbrt] ⛔ Skipping - missing requirements');
    return;
  }
  
  // Check if we've already initiated this specific session
  if (initiatedSessionRef.current === sessionKey) {
    console.debug('[Sherbrt] ⏭️ Skipping initiation - already initiated for session:', sessionKey);
    return;
  }

  // Mark this session as initiated
  initiatedSessionRef.current = sessionKey;
  
  console.debug('[Sherbrt] 🚀 Initiating privileged transaction once for', sessionKey);
  console.log('[Sherbrt] orderParams:', stableOrderParams);
  
  // Call the action to initiate the privileged speculative transaction
  onInitiatePrivilegedSpeculativeTransaction?.(stableOrderParams);
  
  console.debug('[Sherbrt] ✅ initiate-privileged dispatched for session:', sessionKey);
}, [autoInitEnabled, sessionKey, stableOrderParams, onInitiatePrivilegedSpeculativeTransaction]);
```

### Changes Made to `CheckoutPage.js` (Parent Component)

#### 4. Disabled Duplicate Initiation Path
**Commented out:**
```javascript
// ⚠️ DISABLED: Moved to CheckoutPageWithPayment to prevent duplicate initiation
// The child component now handles all initiation via onInitiatePrivilegedSpeculativeTransaction
// This prevents the render loop caused by multiple initiation paths
// if (isUserAuthorized(currentUser)) {
//   if (getProcessName(data) !== INQUIRY_PROCESS_NAME) {
//     loadInitialDataForStripePayments({
//       pageData: data || {},
//       fetchSpeculatedTransaction,
//       fetchStripeCustomer,
//       config,
//     });
//   }
// }

// Still need to fetch Stripe customer for saved payment methods
if (isUserAuthorized(currentUser)) {
  fetchStripeCustomer();
}
```

**Why:** There were **TWO** separate initiation paths:
1. Parent component (`CheckoutPage.js`) calling `loadInitialDataForStripePayments` → `fetchSpeculatedTransaction`
2. Child component (`CheckoutPageWithPayment.js`) calling `onInitiatePrivilegedSpeculativeTransaction`

This duplication was causing the render loop! Now only the child component handles initiation.

### Key Improvements

1. **Single Initiation Path:** Eliminated duplicate API calls by consolidating to one initiation point in the child component.

2. **Session-Aware Deduplication:** The ref now stores the `sessionKey` itself, not just a boolean. This allows:
   - Preventing duplicates for the same session (same booking dates)
   - Allowing new initiations when session changes (new booking dates)

3. **Stable Dependencies:** Extracted `onInitiatePrivilegedSpeculativeTransaction` from props to ensure stable reference and prevent unnecessary effect re-runs.

4. **Enhanced Debug Logging:** Added comprehensive `[Sherbrt]` prefixed logs to track:
   - Component renders
   - Effect triggers
   - Initiation decisions
   - Skip reasons

## 🔍 HOW TO VERIFY THE FIX

### Step 1: Open Browser DevTools
1. Open DevTools (F12 or Cmd+Option+I)
2. Go to **Network** tab
3. Filter for: `initiate-privileged`
4. Clear the network log

### Step 2: Navigate to Checkout
1. Go to a listing page
2. Select booking dates
3. Click "Request to book" or "Book now"
4. Watch the Network tab

### Step 3: Verify Expected Behavior

#### ✅ SUCCESS Indicators:
- **Exactly ONE** POST request to `/api/initiate-privileged`
- Console shows:
  ```
  [Sherbrt] 🚀 Initiating privileged transaction once for checkout:...
  [Sherbrt] ✅ initiate-privileged dispatched for session: checkout:...
  ```
- Stripe iframe mounts successfully
- Submit button becomes enabled when form is complete
- No continuous re-renders

#### ❌ FAILURE Indicators:
- Multiple POSTs to `/api/initiate-privileged` (especially every ~600ms)
- Console shows repeated initiation messages
- Stripe iframe never mounts
- "Can't submit yet: hasSpeculativeTx" shown indefinitely
- Network tab shows requests in a loop

### Step 4: Test Session Changes
1. Change the booking dates
2. Verify a **new** initiation happens (this is expected)
3. Console should show:
   ```
   [Sherbrt] 🚀 Initiating privileged transaction once for checkout:NEW_SESSION_KEY
   ```

### Step 5: Test Re-renders
1. Without changing dates, trigger a re-render (e.g., click somewhere)
2. Verify **NO** new initiation happens
3. Console should show:
   ```
   [Sherbrt] ⏭️ Skipping initiation - already initiated for session: ...
   ```

## 🐛 TROUBLESHOOTING

### If You Still See Multiple Requests:

#### Check 1: Verify sessionKey is stable
Add temporary logging:
```javascript
console.log('[DEBUG] sessionKey:', sessionKey);
```
If it changes on every render, the `useMemo` deps might be unstable.

#### Check 2: Verify stableOrderParams is stable
Add temporary logging:
```javascript
console.log('[DEBUG] stableOrderParams changed:', stableOrderParams);
```

#### Check 3: React StrictMode (Development Only)
- React StrictMode intentionally double-mounts components in development
- This is **NORMAL** behavior
- The ref guard should still prevent duplicate API calls
- Check production build if concerned

#### Check 4: Multiple Component Instances
Search codebase for `<CheckoutPageWithPayment` and verify it's only rendered once.

#### Check 5: Parent Component Re-renders
Add logging in `CheckoutPage.js` to check if parent is constantly re-rendering and unmounting/remounting the child.

## 📋 RELATED FILES

### Modified Files:
- ✏️ `src/containers/CheckoutPage/CheckoutPageWithPayment.js` (main fix - removed useOncePerKey, added ref guard, added debug logging)
- ✏️ `src/containers/CheckoutPage/CheckoutPage.js` (disabled duplicate initiation path)

### Unchanged But Relevant:
- `src/containers/CheckoutPage/CheckoutPage.duck.js` (Redux actions, has additional deduplication)
- `src/hooks/useOncePerKey.js` (no longer used by CheckoutPageWithPayment)

## 🔐 SAFETY MECHANISMS

### Emergency Kill-Switch
If issues occur in production, set this environment variable:
```bash
REACT_APP_INITIATE_ON_MOUNT_ENABLED=false
```
This will disable auto-initiation completely.

### Duck-Level Deduplication (Still Active)
The Redux duck at `CheckoutPage.duck.js` line 663-700 has its own deduplication:
```javascript
if (state.lastSpeculationKey === key && state.speculativeTransactionId) {
  console.info('[specTx] deduped key:', key, 'tx:', state.speculativeTransactionId);
  return;
}
```
This provides a second layer of protection.

## 📊 EXPECTED CONSOLE OUTPUT

### On First Load (Success):
```
[Sherbrt] 🔍 Checkout render { listingId: 'abc123', startISO: '2025-01-15T00:00:00.000Z', endISO: '2025-01-20T00:00:00.000Z' }
[Sherbrt] 🌀 Initiation effect triggered { autoInitEnabled: true, hasSessionKey: true, hasOrderParams: true, currentInitiatedSession: null, newSession: 'checkout:...' }
[Sherbrt] 🚀 Initiating privileged transaction once for checkout:USER_ID:LISTING_ID:2025-01-15T00:00:00.000Z:2025-01-20T00:00:00.000Z
[Sherbrt] orderParams: { listingId: {...}, bookingStart: "2025-01-15T00:00:00.000Z", ... }
[Sherbrt] ✅ initiate-privileged dispatched for session: checkout:USER_ID:LISTING_ID:...
[specTx] deduped key: ... (from duck if called again - should not happen)
[Stripe] element mounted: true
[Checkout] submit disabled gates: { hasSpeculativeTx: true, stripeReady: true, ... }
```

### On Re-render (Same Session):
```
[Sherbrt] 🔍 Checkout render { listingId: 'abc123', startISO: '2025-01-15T00:00:00.000Z', endISO: '2025-01-20T00:00:00.000Z' }
[Sherbrt] 🌀 Initiation effect triggered { autoInitEnabled: true, hasSessionKey: true, hasOrderParams: true, currentInitiatedSession: 'checkout:...', newSession: 'checkout:...' }
[Sherbrt] ⏭️ Skipping initiation - already initiated for session: checkout:USER_ID:LISTING_ID:...
```

### On Session Change (New Dates):
```
[Sherbrt] 🔍 Checkout render { listingId: 'abc123', startISO: '2025-02-01T00:00:00.000Z', endISO: '2025-02-05T00:00:00.000Z' }
[Sherbrt] 🌀 Initiation effect triggered { autoInitEnabled: true, hasSessionKey: true, hasOrderParams: true, currentInitiatedSession: 'checkout:...:2025-01-15:...', newSession: 'checkout:...:2025-02-01:...' }
[Sherbrt] 🚀 Initiating privileged transaction once for checkout:USER_ID:LISTING_ID:2025-02-01T00:00:00.000Z:2025-02-05T00:00:00.000Z
[Sherbrt] ✅ initiate-privileged dispatched for session: checkout:USER_ID:LISTING_ID:...
```

## 🎉 NEXT STEPS

1. **Test in Development:**
   - Follow verification steps above
   - Confirm exactly ONE API call per session
   - Verify Stripe mounts and payment works

2. **Test Edge Cases:**
   - Change booking dates (should initiate new session)
   - Navigate away and back (should initiate new session)
   - Refresh page (should initiate new session)
   - Re-render without changes (should skip initiation)

3. **Deploy to Staging/Production:**
   - Monitor `/api/initiate-privileged` request patterns
   - Watch for any loop behavior
   - Verify Stripe payment flow works end-to-end

4. **Clean Up (Optional):**
   - Can remove `test-initiate-loop-fix.js` once verified
   - Can remove this markdown file once documented elsewhere

## 📝 TECHNICAL NOTES

### Why useRef Instead of useState?
- `useState` would trigger re-renders when updated
- `useRef` provides mutable value without re-renders
- Perfect for tracking side-effect execution

### Why Track sessionKey Instead of Boolean?
- Boolean: `true` forever, blocks new sessions
- sessionKey: Allows new initiations when session changes
- More flexible and correct behavior

### Why Extract onInitiatePrivilegedSpeculativeTransaction?
- Props object is recreated on every render
- Would cause effect to run again (though ref prevents API call)
- Extracting the specific function creates stable reference
- More efficient and cleaner

---

**Fix completed:** October 9, 2025  
**Files modified:** 2  
**Lines changed:** ~40  
**Test script:** `test-initiate-loop-fix.js`  
**Key insight:** There were TWO separate initiation paths causing the loop!


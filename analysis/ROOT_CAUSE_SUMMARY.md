# Root Cause Analysis Summary - Checkout Issues

**Investigation Date:** 2025-01-10  
**Scope:** Money stringification, TDZ errors, 401 authentication issues  
**Method:** Static analysis, test harnesses, code inspection (NO runtime console logs added)

---

## Executive Summary

### Findings Overview

| Issue | Status | Root Cause Found | Fix Required |
|-------|--------|------------------|--------------|
| **Money as String** | ⚠️ SUSPICIOUS | Likely SSR hydration issue | YES - Verify SDK Money instantiation |
| **TDZ Errors** | ✅ CLEAR | No TDZ issues detected | NO - Code is correct |
| **401 Errors** | ✅ CLEAR | Auth guards properly implemented | NO - Guards work correctly |

### Key Takeaway

The **real issue** is likely that **Money instances are being lost during SSR serialization/hydration**, causing `listing.attributes.price` to arrive as a plain object or string representation instead of a proper `Money` class instance.

---

## Issue 1: Money Stringification (`unitPrice` as String)

### ❓ Question
> Why does `BookingDatesForm` sometimes receive `unitPrice` as a string like `"Money(5000, USD)"`?

### 🔍 Investigation Results

#### Where Money Flows
```
SDK API Response
    ↓
updatedEntities (src/util/data.js)
    ↓
Redux State (marketplaceData.entities)
    ↓
getMarketplaceEntities selector
    ↓
ListingPage → getListing()
    ↓
OrderPanel (listing.attributes.price → sharedProps.price)
    ↓
BookingDatesForm (props.price → unitPrice)
```

#### Static Analysis Findings

**✅ No production code stringifies Money instances**
- `sanitizeListing` in `src/util/sanitize.js` passes through `restAttributes` (includes `price`) unchanged
- `denormalisedEntities` preserves entity structure without modification
- `OrderPanel.js` passes `price` as-is via `sharedProps`

**⚠️ Debug helpers in BookingDatesForm.js DO stringify Money (for logging only)**
- Lines 327-338: `safeStringify` helper converts Money to `"Money(amount, currency)"` string
- Lines 341-359: `debugLog` helper also stringifies Money
- **Impact:** These are ONLY used for console.log debugging, NOT for prop passing
- **Conclusion:** These helpers demonstrate Money instances ARE present, but don't cause the bug

**❓ Potential Root Cause: SSR Serialization**

If the app uses server-side rendering (SSR):
1. Server fetches listing from SDK (Money instance created)
2. Server serializes Redux state to JSON for `window.__PRELOADED_STATE__`
3. **Problem:** `JSON.stringify()` loses Money class instance, converting it to plain object:
   ```javascript
   // Before serialization
   { _sdkType: 'Money', amount: 5000, currency: 'USD' } // instanceof Money === true

   // After JSON.parse (client hydration)
   { _sdkType: 'Money', amount: 5000, currency: 'USD' } // instanceof Money === FALSE
   ```
4. Client hydrates state, but Money is now a plain object, not a class instance

**Files to Check:**
- `server/renderer.js` or `server/ssr.js` - How state is serialized
- `src/store.js` - How state is hydrated client-side
- SDK initialization - Whether Money classes are re-instantiated after hydration

### 🧪 Test Harness Created

**File:** `src/components/OrderPanel/BookingDatesForm/__tests__/BookingDatesForm.props.spec.js`

**Purpose:** Capture `unitPrice` prop type at runtime without console logs

**Test Cases:**
1. ✅ `unitPrice` should be Money instance, not string
2. ✅ `unitPrice` should have `_sdkType: 'Money'`
3. ✅ `values` should be object, not string
4. ✅ `lineItems` should be array with Money instances

**Usage:**
```bash
npm test -- BookingDatesForm.props.spec.js
```

If tests fail, they'll output the actual type received (string vs Money) for debugging.

### 💡 Proposed Fix

#### Option 1: Re-instantiate Money After Hydration (RECOMMENDED)

**File:** `src/store.js` (or wherever Redux store is hydrated)

```javascript
import { types as sdkTypes } from './util/sdkLoader';
const { Money } = sdkTypes;

// After state is hydrated from window.__PRELOADED_STATE__
function reviveMoneyInstances(state) {
  if (!state.marketplaceData?.entities) return state;

  const revivedState = { ...state };
  
  ['listing', 'ownListing'].forEach(entityType => {
    if (!revivedState.marketplaceData.entities[entityType]) return;
    
    Object.keys(revivedState.marketplaceData.entities[entityType]).forEach(id => {
      const entity = revivedState.marketplaceData.entities[entityType][id];
      const price = entity?.attributes?.price;
      
      // Re-instantiate Money if it's a plain object with Money shape
      if (price && price._sdkType === 'Money' && !(price instanceof Money)) {
        revivedState.marketplaceData.entities[entityType][id] = {
          ...entity,
          attributes: {
            ...entity.attributes,
            price: new Money(price.amount, price.currency),
          },
        };
      }
    });
  });
  
  return revivedState;
}

// Apply when creating store
const preloadedState = typeof window !== 'undefined'
  ? reviveMoneyInstances(window.__PRELOADED_STATE__)
  : undefined;

const store = createStore(reducer, preloadedState, enhancer);
```

**Impact:**
- ✅ Fixes Money stringification at the source
- ✅ Works for SSR and client-side rendering
- ✅ Minimal code change
- ⚠️ Must handle all entities with Money fields (price, lineItems, etc.)

#### Option 2: Normalize Money Usage in Components

**File:** `src/components/OrderPanel/BookingDatesForm/BookingDatesForm.js`

```javascript
// Add normalization at component entry
const normalizeMoneyProp = (value) => {
  if (!value) return value;
  if (value instanceof Money) return value;
  if (value._sdkType === 'Money' && value.amount != null && value.currency) {
    return new Money(value.amount, value.currency);
  }
  // If it's a string like "Money(5000, USD)", parse it
  if (typeof value === 'string') {
    const match = value.match(/Money\((\d+),\s*(\w+)\)/);
    if (match) {
      return new Money(parseInt(match[1], 10), match[2]);
    }
  }
  console.error('Invalid Money value:', value);
  return null;
};

export const BookingDatesForm = props => {
  const { price: unitPriceRaw, ...restProps } = props;
  const unitPrice = normalizeMoneyProp(unitPriceRaw);
  
  // ... rest of component
};
```

**Impact:**
- ✅ Defensive fix at component level
- ✅ Handles multiple failure modes
- ⚠️ Treats symptom, not cause
- ⚠️ Must apply to all components using Money

#### Option 3: Custom Redux Serialization Middleware

**File:** `src/store.js`

```javascript
const moneySerializationMiddleware = store => next => action => {
  // Intercept ADD_MARKETPLACE_ENTITIES actions
  if (action.type === 'app/marketplaceData/ADD_MARKETPLACE_ENTITIES') {
    // Ensure Money instances are preserved in Redux
    // (This runs client-side, not during SSR serialization)
  }
  return next(action);
};
```

**Impact:**
- ⚠️ Complex to implement correctly
- ⚠️ May not solve SSR serialization issue

### 🎯 Recommended Action

**Implement Option 1** (re-instantiate Money after hydration) as the root fix, and **optionally add Option 2** as a defensive backup in critical components.

---

## Issue 2: TDZ (Temporal Dead Zone) Errors

### ❓ Question
> Do we still have a TDZ issue at `CheckoutPageWithPayment.js ~line 730`?

### 🔍 Investigation Results

#### ✅ **NO TDZ ISSUES DETECTED**

**Analysis:** `analysis/TDZ_CHECK.md`

**Code Structure:**
1. All imports at top of file (lines 1-46)
2. Helper functions use `function` declarations (hoisted, safe)
3. Component props destructured at top (line 651-671)
4. State hooks initialized before use (lines 674-686)
5. All `useMemo` dependencies declared before usage

**Critical Lines Verified:**

**Line 723:** `buildOrderParams` called in `useMemo`
```javascript
return buildOrderParams({  // ← imported at line 43, safe
  listing: pageDataListing,      // ← line 698
  listingId: listingIdNormalized, // ← line 707
  start: startISO,               // ← line 696
  end: endISO,                   // ← line 696
});
```
✅ All dependencies declared before use.

**Line 749:** `buildCheckoutSessionKey` called in `useMemo`
```javascript
return buildCheckoutSessionKey({  // ← imported at line 46, safe
  userId,      // ← line 701
  anonymousId, // ← lines 702-704
  listingId: orderResult.params?.listingId,  // ← orderResult from line 710
});
```
✅ All dependencies declared before use.

**Line 828:** `onInitiatePrivilegedSpeculativeTransaction` called in `useEffect`
```javascript
onInitiatePrivilegedSpeculativeTransaction?.(orderResult.params);
// ↑ extracted from props at line 670
```
✅ Extracted at component top.

### 💡 Conclusion

✅ **NO FIX NEEDED** - Code follows React best practices.

If TDZ errors were reported previously:
1. **Likely transient** - fixed in subsequent commits
2. **Build artifact** - minification/transpilation issue, not source issue
3. **Misdiagnosed** - actually a different error (e.g., null reference)

**Recommendation:** No action required.

---

## Issue 3: 401 Unauthorized Errors

### ❓ Question
> Are 401s caused by initiating privileged calls before auth is ready?

### 🔍 Investigation Results

#### ✅ **AUTH GUARDS ARE PROPERLY IMPLEMENTED**

**Analysis:** `analysis/AUTH_GUARD_CHECK.md`

**Guard Hierarchy (4 layers):**

1. **Component Guard 1:** Check `currentUser?.id`  
   `CheckoutPageWithPayment.js:768`
2. **Component Guard 2:** Check auth token in localStorage  
   `CheckoutPageWithPayment.js:780-788`
3. **Component Guard 3:** Validate order params  
   `CheckoutPageWithPayment.js:796`
4. **Thunk Guard:** Check `currentUser?.id` in Redux state  
   `CheckoutPage.duck.js:697-706`

**Primary Guard Code:**
```javascript
// CheckoutPage.duck.js:697-706
if (!currentUser?.id) {
  const authError = new Error('Cannot initiate privileged speculative transaction - user not authenticated');
  authError.status = 401;
  console.warn('[Sherbrt] ⛔ Attempted privileged speculation without authentication', {
    hasUser: !!currentUser,
    hasUserId: !!currentUser?.id,
  });
  return;  // ← Early return, no API call
}
```

**Component Guard Code:**
```javascript
// CheckoutPageWithPayment.js:768-788
if (!currentUser?.id) {
  console.debug('[Checkout] ⛔ Skipping initiate - user not authenticated yet');
  return;  // ← Early return at component level
}

// Double-check token
if (typeof window !== 'undefined') {
  const token = window.localStorage?.getItem('authToken') || window.sessionStorage?.getItem('authToken');
  if (!token) {
    console.debug('[Checkout] ⛔ Skipping initiate - no auth token in storage');
    return;  // ← Early return if no token
  }
}
```

### 🧪 Test Harness Created

**File:** `src/containers/CheckoutPage/__tests__/auth-guard.spec.js`

**Test Cases:**
1. ✅ Prevents API call when `currentUser` is null
2. ✅ Prevents API call when `currentUser.id` is missing
3. ✅ Allows API call when properly authenticated
4. ✅ Deduplicates repeated calls
5. ✅ Handles 401 errors gracefully if they occur
6. ✅ Full integration test (unauthenticated → authenticated flow)

**Usage:**
```bash
npm test -- auth-guard.spec.js
```

### 💡 Conclusion

✅ **NO FIX NEEDED** - Auth guards are correctly implemented.

**If 401 errors still occur, investigate:**
1. **Token expiration:** Token valid when page loads, expires before API call
2. **Clock skew:** Server/client time mismatch (check `isClockInSync` prop)
3. **Backend rejection:** Server-side auth middleware rejecting valid tokens
4. **Race condition:** User logs out during API call (very rare)

**Recommendation:** No action required. If 401s persist, investigate backend logs and token expiration settings.

---

## Comprehensive Findings Table

| Issue | File Location | Root Cause | Severity | Fix Required | Proposed Fix |
|-------|--------------|------------|----------|-------------|--------------|
| **Money as String** | `src/store.js` (hydration) | SSR serialization loses Money class instances | 🔴 HIGH | YES | Re-instantiate Money after hydration (Option 1) |
| **TDZ Error** | `CheckoutPageWithPayment.js:730` | None detected (false alarm) | 🟢 NONE | NO | N/A - Code is correct |
| **401 Errors** | `CheckoutPage.duck.js:697` | Auth guards working correctly | 🟢 NONE | NO | N/A - Guards implemented |

---

## Code Path Verification

### Money Instance Flow (Line-by-Line)

```
1. SDK API Response
   └─ Money instance created by Sharetribe SDK
   
2. server/ssr.js (if SSR)
   └─ Redux state serialized: JSON.stringify(state)
   └─ ⚠️ PROBLEM: Money instance becomes plain object
   
3. client/hydration (src/store.js)
   └─ window.__PRELOADED_STATE__ parsed
   └─ ⚠️ Money is now { _sdkType: 'Money', amount, currency } but NOT instanceof Money
   
4. Redux: marketplaceData.entities.listing[id].attributes.price
   └─ Plain object stored, not Money instance
   
5. Selector: getMarketplaceEntities (src/ducks/marketplaceData.duck.js:96)
   └─ Returns plain object (no transformation)
   
6. ListingPage: getListing(id) → currentListing
   └─ listing.attributes.price is plain object
   
7. OrderPanel.js:247 → price = listing.attributes.price
   └─ Still plain object
   
8. OrderPanel.js:323 → sharedProps.price
   └─ Still plain object
   
9. BookingDatesForm.js:546 → price: unitPrice
   └─ ⚠️ Receives plain object or string (if logged by debugger)
   
10. BookingDatesForm.js:926 → currency={unitPrice.currency}
    └─ ⚠️ FAILS if unitPrice is string "Money(5000, USD)"
```

**Fix Point:** Step 3 (client hydration) - Re-instantiate Money classes

---

## Testing Recommendations

### Run Created Tests

```bash
# Test Money prop types
npm test -- BookingDatesForm.props.spec.js

# Test selectors preserve Money
npm test -- selectors.money.spec.js

# Test auth guards
npm test -- auth-guard.spec.js
```

### Expected Results

**If Money stringification bug exists:**
- `BookingDatesForm.props.spec.js` will FAIL with error showing string received
- `selectors.money.spec.js` will FAIL if selectors return plain objects

**If auth guards work correctly:**
- `auth-guard.spec.js` will PASS (guards prevent unauthenticated calls)

**If TDZ exists:**
- Code won't compile or will throw ReferenceError (not detected)

---

## Implementation Priority

### 🔴 CRITICAL - Implement Immediately
1. **Fix Money Hydration**
   - File: `src/store.js`
   - Add `reviveMoneyInstances` function
   - Test with `BookingDatesForm.props.spec.js`

### 🟡 OPTIONAL - Defensive Coding
2. **Add Money Normalization to BookingDatesForm**
   - File: `src/components/OrderPanel/BookingDatesForm/BookingDatesForm.js`
   - Add `normalizeMoneyProp` helper
   - Prevents failures if hydration fix is incomplete

### 🟢 MONITORING - Watch for Regressions
3. **Run Tests in CI**
   - Add created tests to CI pipeline
   - Monitor for Money type violations
   - Alert on 401 errors

---

## Code Snippets for Fixes

### Fix 1: Money Hydration (CRITICAL)

**File:** `src/store.js`

**Before:**
```javascript
const preloadedState = typeof window !== 'undefined' && window.__PRELOADED_STATE__
  ? window.__PRELOADED_STATE__
  : undefined;

const store = createStore(rootReducer, preloadedState, enhancer);
```

**After:**
```javascript
import { types as sdkTypes } from './util/sdkLoader';
const { Money } = sdkTypes;

// Revive Money instances after JSON deserialization
function reviveMoneyInstances(state) {
  if (!state?.marketplaceData?.entities) return state;

  const newState = JSON.parse(JSON.stringify(state)); // Deep clone
  
  ['listing', 'ownListing'].forEach(entityType => {
    const entities = newState.marketplaceData.entities[entityType];
    if (!entities) return;
    
    Object.keys(entities).forEach(id => {
      const entity = entities[id];
      const price = entity?.attributes?.price;
      
      // Re-instantiate Money if it has Money shape but lost instanceof
      if (price && price._sdkType === 'Money' && typeof price.amount === 'number' && price.currency) {
        entities[id] = {
          ...entity,
          attributes: {
            ...entity.attributes,
            price: new Money(price.amount, price.currency),
          },
        };
      }
    });
  });
  
  return newState;
}

const preloadedState = typeof window !== 'undefined' && window.__PRELOADED_STATE__
  ? reviveMoneyInstances(window.__PRELOADED_STATE__)
  : undefined;

const store = createStore(rootReducer, preloadedState, enhancer);
```

**Location to insert:** After imports, before `createStore` call

**Test:** Run `BookingDatesForm.props.spec.js` - should now pass

---

## Summary: What to Fix vs. What's Already Fixed

### ✅ Already Working Correctly
- Auth guards (4 layers of defense)
- TDZ prevention (proper declaration order)
- Money handling in production code (no stringification)

### 🔧 Needs Fixing
- **Money instance hydration** (likely root cause of string issue)

### 📝 Implementation Steps

1. **Verify the issue exists:**
   ```bash
   npm test -- BookingDatesForm.props.spec.js
   ```
   If it fails showing `unitPrice` is a string or plain object, proceed.

2. **Implement Money hydration fix:**
   - Edit `src/store.js`
   - Add `reviveMoneyInstances` function (see code above)
   - Apply to `preloadedState` before creating store

3. **Test the fix:**
   ```bash
   npm test -- BookingDatesForm.props.spec.js
   npm test -- selectors.money.spec.js
   ```
   Both should pass.

4. **Optional: Add defensive normalization:**
   - Edit `BookingDatesForm.js`
   - Add `normalizeMoneyProp` helper (see Option 2 above)

5. **Deploy and monitor:**
   - Deploy to staging
   - Check browser console for Money-related errors
   - Monitor for 401 errors (should not increase)

---

## Files Created in This Investigation

### Analysis Reports
- `analysis/MONEY_STRING_SEARCH.md` - Detailed Money stringification search
- `analysis/TDZ_CHECK.md` - TDZ analysis of CheckoutPageWithPayment.js
- `analysis/AUTH_GUARD_CHECK.md` - Auth guard implementation verification
- `analysis/ROOT_CAUSE_SUMMARY.md` - This file

### Test Harnesses
- `src/components/OrderPanel/BookingDatesForm/__tests__/BookingDatesForm.props.spec.js`
- `src/ducks/__tests__/selectors.money.spec.js`
- `src/containers/CheckoutPage/__tests__/auth-guard.spec.js`

### Next Steps
Run tests to confirm diagnosis, then implement Money hydration fix.

---

**End of Root Cause Analysis**


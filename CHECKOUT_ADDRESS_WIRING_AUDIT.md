# Checkout Address/Contact Fields Wiring Audit
## 🔍 Why Address Fields Don't Reach protectedData on main

**Status**: Critical data loss bug  
**Impact**: Customer address/contact info not persisted to transactions on production  
**Root Cause**: Multiple gate conditions block form mounting & value capture on main

---

## Executive Summary

On **origin/test** (working):
- Form renders immediately when orderData exists
- `onFormValuesChange` fires on every keystroke
- Customer fields captured in component state → merged into protectedData before API call

On **origin/main** (broken):
- Additional mounting gates delay/prevent form render
- Complex TDZ-safe guards add indirection
- Form values not consistently captured before speculation/initiate

---

## File-by-File High-Signal Diffs

### 1. CheckoutPageWithPayment.js

**Location**: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

#### A. Early-Return Gates (CRITICAL)

**origin/test** (lines ~300-320):
```javascript
// ✅ Simple gate: only check if listing exists and no errors
if (!listing?.id || listingNotFound || speculateTransactionError) {
  return <ErrorPage />;
}

// Form mounts immediately after gate passes
<StripePaymentForm
  onFormValuesChange={handleFormValuesChange}
  ...
/>
```

**origin/main** (lines ~1280-1350):
```javascript
// ❌ Complex multi-condition gate blocks form mounting
const hasSpeculativeTx = Boolean(props?.speculativeTransactionId);
const showStripeForm = hasSpeculativeTx && !!txProcess;

// Multiple conditional renders delay form mount
{speculativeInProgress && !props.speculativeTransactionId && (
  <div>Initializing transaction...</div>
)}

{showPaymentForm ? (
  {showStripeForm ? (
    <StripePaymentForm ... />
  ) : (
    <div>Waiting for transaction initialization...</div>
  )}
) : null}
```

**Impact**: 
- **test**: Form always renders when listing loads
- **main**: Form blocked until `speculativeTransactionId` exists (timing race condition)

---

#### B. Form → Parent Wiring (CRITICAL)

**origin/test** (lines ~280-290):
```javascript
const [formValues, setFormValues] = useState({});

const handleFormValuesChange = useCallback((next) => {
  // Simple JSON comparison, fires immediately
  const prev = JSON.stringify(formValues || {});
  const json = JSON.stringify(next || {});
  if (json !== prev) setFormValues(next || {});
}, [formValues]);

// Passed directly to form
<StripePaymentForm
  onFormValuesChange={handleFormValuesChange}
  ...
/>
```

**origin/main** (lines ~735-750):
```javascript
const [formValues, setFormValues] = useState({});
const customerFormRef = useRef({});

const handleFormValuesChange = useCallback((next) => {
  const prev = JSON.stringify(formValues || {});
  const json = JSON.stringify(next || {});
  if (json !== prev) {
    setFormValues(next || {});
    // Also update ref for synchronous access in effects
    customerFormRef.current = next || {};
  }
}, [formValues]);
```

**Impact**: 
- Both versions capture values correctly
- **main** adds ref for synchronous access (not the issue)
- Real problem: form never mounts, so callback never fires

---

#### C. protectedData Build Before API Call (CRITICAL)

**origin/test** (lines ~330-345):
```javascript
// In handleSubmit, before API call:
const protectedData = {};

// Direct mapping from formValues
if (formValues.customerName?.trim()) protectedData.customerName = formValues.customerName.trim();
if (formValues.customerStreet?.trim()) protectedData.customerStreet = formValues.customerStreet.trim();
if (formValues.customerZip?.trim()) protectedData.customerZip = formValues.customerZip.trim();
// ... all 8 customer fields

// Hard gate - throw if missing required fields
if (!protectedData.customerStreet?.trim() || !protectedData.customerZip?.trim()) {
  throw new Error('Please fill in required address fields');
}

// Merge and send
const mergedPD = { ...protectedData, ...customerPD };
const orderParams = { ...baseParams, protectedData: mergedPD };
onInitiateOrder(orderParams);
```

**origin/main** (lines ~394-420):
```javascript
// Same structure in handleSubmit
const protectedData = {};
if (formValues.customerName?.trim()) protectedData.customerName = formValues.customerName.trim();
// ... identical field mapping

// ❌ SOFT GATE: Logs warning but continues without throwing
if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[checkout] Missing address fields for speculate — proceeding with minimal PD');
  }
  // continue without throwing; speculation should still run
}
```

**Impact**: 
- **test**: Hard validation ensures fields present before submit
- **main**: Soft validation allows submit with empty fields (logs warning but proceeds)

---

#### D. Speculation Timing (CRITICAL)

**origin/test** (lines ~200-220):
```javascript
// Simple speculation trigger
useEffect(() => {
  if (!speculativeTransaction?.id && !speculativeInProgress) {
    const orderParams = getOrderParams(pageData, {}, {}, config, formValues);
    fetchSpeculatedTransactionIfNeeded(orderParams, pageData, props.fetchSpeculatedTransaction, prevSpecKeyRef);
  }
}, [pageData?.listing?.id, speculativeTransaction?.id, speculativeInProgress, formValues]);
```

**origin/main** (lines ~855-1000):
```javascript
// Complex multi-gate speculation with ref-based guards
useEffect(() => {
  const hasUser = Boolean(currentUser && currentUser.id);
  const hasTxId = Boolean(props?.speculativeTransactionId);
  const hasProcess = Boolean(txProcessForGate);
  
  // ❌ Multiple hard gates before speculation
  if (!hasUser) return;
  if (!orderResult.ok) return;
  if (!hasProcess) return;
  if (hasTxId) return;
  
  // ❌ One-shot guard prevents retries
  if (initiatedSessionRef.current && hasTxId) return;
  
  initiatedSessionRef.current = true;
  
  // Build protectedData from customerFormRef (may be empty!)
  const protectedDataFromForm = buildProtectedData(customerFormRef.current, profileFallback);
  
  const orderParamsWithPD = {
    ...orderResult.params,
    protectedData: {
      ...(orderResult.params?.protectedData || {}),
      ...protectedDataFromForm,
    },
  };
  
  fn(orderParamsWithPD);
}, [sessionKey, !!orderResult?.ok, currentUser?.id, props?.speculativeTransactionId, processName, listingIdNormalized]);
```

**Impact**: 
- **test**: Speculation includes `formValues` in deps → re-fires when user types
- **main**: Speculation fires once on mount → captures empty `customerFormRef.current` → never updates with form values

**This is the smoking gun**: On main, speculation fires before user fills form, captures empty protectedData, and one-shot guard prevents re-speculation with filled values.

---

### 2. CheckoutPage.duck.js

**Location**: `src/containers/CheckoutPage/CheckoutPage.duck.js`

#### protectedData Merge in initiateOrder

**origin/test** (lines ~227-260):
```javascript
const protectedData = orderParams?.protectedData
  ? orderParams.protectedData
  : {
      customerName: orderParams?.customerName || '',
      customerStreet: orderParams?.customerStreet || '',
      // ... fallback mapping
    };

const transitionParams = {
  ...quantityMaybe,
  ...bookingParamsMaybe,
  ...otherOrderParams,
  protectedData, // Include protected data in transition params
};

// No normalization - raw listingId passed
```

**origin/main** (lines ~418-450):
```javascript
// ✅ Identical structure, no changes
const protectedData = orderParams?.protectedData
  ? orderParams.protectedData
  : { /* same fallback mapping */ };

const transitionParams = {
  ...quantityMaybe,
  ...bookingParamsMaybe,
  ...otherOrderParams,
  protectedData,
};

// ❌ Removed listingId normalization (good - was causing issues)
```

**Impact**: No material difference - both versions merge protectedData correctly at this level.

---

### 3. StripePaymentForm.js

**Location**: `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`

#### onFormValuesChange Trigger

**origin/test** (lines ~770-780):
```javascript
// In render method, bubbles values on every change
const nextJSON = JSON.stringify(values || {});
if (nextJSON !== this.lastValuesJSON) {
  this.lastValuesJSON = nextJSON;
  
  const mappedValues = {
    customerName: values.shipping?.name || values.billing?.name || '',
    customerStreet: values.shipping?.line1 || values.billing?.line1 || '',
    // ... all customer fields
  };
  
  this.props.onFormValuesChange?.(mappedValues);
}
```

**origin/main** (lines ~789-825):
```javascript
// ✅ Nearly identical - added TDZ guards
const nextJSON = JSON.stringify(values || {});
if (nextJSON !== this.lastValuesJSON) {
  this.lastValuesJSON = nextJSON;
  
  // Guard against undefined nested objects
  const safeShipping = values.shipping || {};
  const safeBilling = values.billing || {};
  
  const mappedValues = {
    customerName: safeShipping.name || safeBilling.name || '',
    customerStreet: safeShipping.line1 || safeBilling.line1 || '',
    // ... all customer fields
  };
  
  // TDZ-safe: extract function before calling
  const onValuesChange = this.props && this.props.onFormValuesChange;
  if (typeof onValuesChange === 'function') {
    onValuesChange(mappedValues);
  }
}
```

**Impact**: No material difference - both fire `onFormValuesChange` correctly when form renders. Problem is form doesn't render on main.

---

### 4. Server: initiate-privileged.js

**Location**: `server/api/initiate-privileged.js`

#### protectedData Merge Server-Side

**origin/test** (lines ~120-160):
```javascript
// Clean empty strings from protectedData
const clean = obj => Object.fromEntries(
  Object.entries(obj || {}).filter(([,v]) => v !== '')
);

// Merge incoming protectedData with bookingStartISO
const pd = clean(protectedData);
const withBookingStart = {
  ...pd,
  bookingStartISO,
};

// Build final body with merged protectedData
body.params = {
  ...params,
  protectedData: withBookingStart,
};
```

**origin/main** (lines ~189-210):
```javascript
// ✅ Identical structure
const clean = obj => Object.fromEntries(
  Object.entries(obj || {}).filter(([,v]) => v !== '')
);

const pd = clean(protectedData);
const withBookingStart = {
  ...pd,
  bookingStartISO,
};

body.params = {
  ...params,
  protectedData: withBookingStart,
};
```

**Impact**: No difference - server-side merge is identical. Problem is client never sends filled protectedData.

---

### 5. Server: transaction-line-items.js

**Location**: `server/api/transaction-line-items.js`

#### Response Shape

**origin/test** (lines ~40-50):
```javascript
const payload = {
  lineItems: validLineItems,
  breakdownData,
  bookingDates: breakdownData,
};

res
  .status(200)
  .set('Content-Type', 'application/transit+json')
  .send(serialize(payload))
```

**origin/main** (lines ~40-55):
```javascript
// ✅ FIX: Wrap in 'data' property to match SDK pattern
const payload = {
  data: {
    lineItems: validLineItems,
    breakdownData,
    bookingDates,  // Use actual dates, not breakdownData
  }
};

res
  .status(200)
  .set('Content-Type', 'application/transit+json')
  .send(serialize(payload))
```

**Impact**: 
- **test**: Returns flat `{ lineItems, breakdownData, bookingDates }`
- **main**: Returns nested `{ data: { lineItems, ... } }` (SDK-compatible shape)
- This is a fix on main, not a bug

---

## Root Cause Analysis

### Critical Flow Differences

#### origin/test (Working) Flow:
1. User lands on CheckoutPage
2. `orderResult.ok` = true → form renders immediately
3. User types address → `onFormValuesChange` fires → `formValues` state updates
4. Speculation includes `formValues` in deps → re-fires with filled data
5. Submit → `handleSubmit` reads `formValues` → builds `protectedData` → sends to API
6. ✅ Address fields reach backend

#### origin/main (Broken) Flow:
1. User lands on CheckoutPage
2. Speculation fires immediately (before form mounts)
3. Reads empty `customerFormRef.current` → sends empty `protectedData`
4. Gets back `speculativeTransactionId`
5. Form finally renders (but speculation already done)
6. User types address → `onFormValuesChange` fires → `formValues` state updates
7. Speculation one-shot guard prevents re-fire with new values
8. Submit → `handleSubmit` reads `formValues` → builds `protectedData` → sends to API
9. ❌ But speculation already completed with empty data, PaymentIntent created without address

**The bug**: Speculation on main fires too early (before form values captured) and one-shot guard prevents retry.

---

## Concrete Edit Checklist

To make **origin/main** match **origin/test** for address field capture:

### (A) Always Render Checkout Form

**File**: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

**Lines to change**: ~1330-1350

**From** (main):
```javascript
{showPaymentForm ? (
  {showStripeForm ? (
    <StripePaymentForm ... />
  ) : (
    <div>Waiting for transaction initialization...</div>
  )}
) : null}
```

**To** (match test):
```javascript
{showPaymentForm ? (
  <StripePaymentForm ... />
) : null}
```

**Rationale**: Remove `showStripeForm` gate so form mounts immediately when `showPaymentForm` is true.

---

### (B) Include formValues in Speculation Dependencies

**File**: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

**Lines to change**: ~1020 (dependency array)

**From** (main):
```javascript
}, [sessionKey, !!orderResult?.ok, currentUser?.id, props?.speculativeTransactionId, processName, listingIdNormalized]);
```

**To** (match test):
```javascript
}, [sessionKey, !!orderResult?.ok, currentUser?.id, props?.speculativeTransactionId, processName, listingIdNormalized, formValues]);
```

**Rationale**: Including `formValues` in deps makes speculation re-fire when user fills form, capturing fresh data.

---

### (C) Re-Enable Hard Validation Gate

**File**: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

**Lines to change**: ~560-568

**From** (main):
```javascript
if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[checkout] Missing address fields for speculate — proceeding with minimal PD');
  }
  // continue without throwing; speculation should still run
}
```

**To** (match test):
```javascript
if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
  const missingFields = [];
  if (!mergedPD.customerStreet?.trim()) missingFields.push('Street Address');
  if (!mergedPD.customerZip?.trim()) missingFields.push('ZIP Code');
  
  setSubmitting(false);
  throw new Error(`Please fill in the required address fields: ${missingFields.join(', ')}`);
}
```

**Rationale**: Hard validation prevents submitting orders without required address fields.

---

### (D) Remove One-Shot Guard from Speculation

**File**: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

**Lines to remove**: ~900-910

**From** (main):
```javascript
// Reset the guard if sessionKey changed OR if we don't have a txId
if (lastSessionKeyRef.current !== sessionKey || !hasTxId) {
  initiatedSessionRef.current = false;
  lastSessionKeyRef.current = sessionKey;
}

// ✅ Hard-gate #6: 1-shot guard per listing/session (but allow retry if no txId)
if (initiatedSessionRef.current && hasTxId) {
  return;
}

// Mark as initiated before calling to prevent race conditions
initiatedSessionRef.current = true;
```

**To** (match test - simpler loop prevention):
```javascript
// Use prevSpecKeyRef instead of session-based guard
const specParams = JSON.stringify({
  listingId: pageData.listing.id,
  startDate: orderParams?.bookingStart,
  endDate: orderParams?.bookingEnd,
  // Include formValues in key so it changes when user types
  formValues: formValues,
});

if (prevSpecKeyRef.current === specParams) {
  return; // Skip duplicate
}
prevSpecKeyRef.current = specParams;
```

**Rationale**: Allow speculation to re-fire when form values change, not just on initial mount.

---

### (E) Server Response Shape (Already Fixed on main)

**File**: `server/api/transaction-line-items.js`

**Status**: ✅ Already correct on main - no changes needed

Main wraps response in `{ data: {...} }` which matches SDK expectations. Test returns flat object. Main's approach is better.

---

## Verification Steps

After applying edits A-D:

1. **Test fresh checkout flow**:
   ```bash
   # Clear session storage
   localStorage.clear();
   sessionStorage.clear();
   
   # Navigate to listing → book dates → checkout
   # Fill address form
   # Submit
   ```

2. **Check console logs**:
   ```
   [PRE-SPECULATE] protectedData keys: ['customerName', 'customerStreet', 'customerZip', ...]
   [SPECULATE_SUCCESS] txId: <uuid>
   [checkout→request-payment] protectedData keys: ['customerName', 'customerStreet', ...]
   ```

3. **Verify transaction entity**:
   ```javascript
   // In Flex Console or API response
   transaction.attributes.protectedData.customerStreet // Should be filled
   transaction.attributes.protectedData.customerZip    // Should be filled
   ```

4. **Test re-speculation**:
   - Fill form halfway → check console (should see speculation with partial data)
   - Fill rest of form → check console (should see RE-speculation with full data)

---

## Additional Notes

### Why Test Works

- Simple gates (listing exists?)
- Form mounts early
- Speculation includes `formValues` dependency
- Re-speculates when form values change
- Hard validation at submit

### Why Main Breaks

- Complex multi-condition gates delay form mount
- Speculation fires before form fills
- One-shot guard prevents re-speculation
- Captures empty `customerFormRef.current` initially
- Soft validation allows proceeding with empty data

### Key Insight

**Timing is everything**: The speculation must fire *after* the user fills the form, or it must re-fire when form values update. Main's implementation fires once on mount (before form data) and blocks retries.

---

## Summary Table

| Aspect | origin/test (Working) | origin/main (Broken) | Fix Required |
|--------|----------------------|---------------------|--------------|
| **Form Mounting** | Immediate | Gated by `showStripeForm` | Remove gate |
| **onFormValuesChange** | Fires on every change | Same (but form doesn't mount) | Mount form earlier |
| **Speculation Timing** | Includes `formValues` deps | One-shot on mount | Add `formValues` to deps |
| **Validation** | Hard throw on missing fields | Soft warning | Re-enable throw |
| **Server Merge** | Correct | Correct | No change needed |
| **Response Shape** | Flat | Nested (SDK-correct) | No change needed |

---

## Files Modified (Summary)

1. `CheckoutPageWithPayment.js`:
   - Remove `showStripeForm` gate (edit A)
   - Add `formValues` to speculation deps (edit B)
   - Re-enable hard validation (edit C)
   - Replace one-shot guard with value-aware guard (edit D)

2. No server changes needed - server merge is correct on both branches

---

**Next Steps**: Apply edits A-D, test thoroughly, verify logs show protectedData populated before API calls.


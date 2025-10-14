# Address Field Flow: origin/test vs origin/main

## Visual Timeline Comparison

### ✅ origin/test (Working)

```
Time →

T0: PageLoad
    ├─ orderResult.ok = true
    ├─ Form renders immediately
    └─ formValues = {}

T1: UserTypesAddress
    ├─ onFormValuesChange fires
    ├─ formValues = { customerStreet: '123 Main', customerZip: '12345', ... }
    └─ Speculation effect sees formValues in deps

T2: SpeculationTriggered (by formValues change)
    ├─ Reads formValues (filled!)
    ├─ protectedData = { customerStreet: '123 Main', customerZip: '12345', ... }
    └─ API call: /api/initiate-privileged with filled protectedData

T3: SpeculationSuccess
    ├─ speculativeTransactionId set
    ├─ PaymentIntent created WITH address fields
    └─ Form stays mounted

T4: UserSubmits
    ├─ Reads formValues (still filled)
    ├─ Validates: customerStreet ✓, customerZip ✓
    ├─ mergedPD = { customerStreet: '123 Main', ... }
    └─ API call: /api/initiate-privileged (transition) with filled protectedData

T5: Success ✅
    └─ Transaction.attributes.protectedData.customerStreet = '123 Main'
```

---

### ❌ origin/main (Broken)

```
Time →

T0: PageLoad
    ├─ orderResult.ok = true
    ├─ Speculation effect fires IMMEDIATELY
    │  ├─ customerFormRef.current = {} (empty!)
    │  ├─ protectedData = {} (empty!)
    │  └─ API call: /api/initiate-privileged with EMPTY protectedData
    ├─ initiatedSessionRef.current = true (one-shot guard activated)
    └─ Form NOT rendered yet (waiting for speculativeTransactionId)

T1: SpeculationSuccess
    ├─ speculativeTransactionId set
    ├─ PaymentIntent created WITHOUT address fields
    ├─ showStripeForm = true NOW
    └─ Form renders NOW (too late!)

T2: UserTypesAddress
    ├─ onFormValuesChange fires
    ├─ formValues = { customerStreet: '123 Main', customerZip: '12345', ... }
    ├─ customerFormRef.current = { customerStreet: '123 Main', ... }
    └─ Speculation effect sees formValues change BUT...

T3: SpeculationBlocked
    ├─ Check: initiatedSessionRef.current === true? YES
    ├─ Check: speculativeTransactionId exists? YES
    └─ Early return (one-shot guard prevents re-speculation)

T4: UserSubmits
    ├─ Reads formValues (filled now)
    ├─ Validates: customerStreet ✓, customerZip ✓ (soft warning, continues)
    ├─ mergedPD = { customerStreet: '123 Main', ... }
    └─ API call: /api/initiate-privileged (transition) with filled protectedData

T5: Partial Success ⚠️
    ├─ Transaction.attributes.protectedData.customerStreet = '123 Main' (in transition)
    └─ BUT: PaymentIntent was created at T0 without address (immutable)
```

---

## Key Differences

| Event | origin/test | origin/main | Impact |
|-------|------------|------------|--------|
| **Speculation Timing** | After form fills (T2) | Before form renders (T0) | 🔴 Critical |
| **protectedData @ Speculation** | Filled | Empty | 🔴 Critical |
| **Re-speculation** | Allowed (formValues in deps) | Blocked (one-shot guard) | 🔴 Critical |
| **Form Mount** | Immediate (T0) | Delayed until txId (T1) | 🔴 Critical |
| **Submit Validation** | Hard throw | Soft warning | 🟡 Medium |

---

## Code Paths

### origin/test Speculation Dependencies

```javascript
useEffect(() => {
  // ... speculation logic
}, [
  pageData?.listing?.id,
  speculativeTransaction?.id,
  speculativeInProgress,
  formValues  // ← 🔑 KEY: Re-fires when user types!
]);
```

When user types:
1. `formValues` changes
2. Effect re-runs
3. New speculation with filled data
4. Previous speculation ignored (new txId replaces old)

---

### origin/main Speculation Dependencies

```javascript
useEffect(() => {
  // ... speculation logic
}, [
  sessionKey,
  !!orderResult?.ok,
  currentUser?.id,
  props?.speculativeTransactionId,
  processName,
  listingIdNormalized
  // ← 🔴 MISSING: formValues!
]);
```

When user types:
1. `formValues` changes
2. Effect does NOT re-run (not in deps)
3. Old speculation data persists
4. One-shot guard prevents manual retry

---

## Gate Logic Comparison

### origin/test: Simple Gate

```javascript
// One condition: show form if listing exists and no errors
const showPaymentForm = !!(
  currentUser &&
  !listingNotFound &&
  !initiateOrderError &&
  !speculateTransactionError
);

return (
  {showPaymentForm ? (
    <StripePaymentForm
      onFormValuesChange={handleFormValuesChange}
      ...
    />
  ) : null}
);
```

Form renders: **T0** (immediately)

---

### origin/main: Complex Multi-Gate

```javascript
// Multiple conditions: require speculativeTransactionId
const showPaymentForm = !!(
  currentUser &&
  !listingNotFound &&
  !initiateOrderError &&
  !speculateTransactionError &&
  !retrievePaymentIntentError &&
  !isPaymentExpired
);

const hasSpeculativeTx = Boolean(props?.speculativeTransactionId);
const showStripeForm = hasSpeculativeTx && !!txProcess;

return (
  {showPaymentForm ? (
    <>
      {speculativeInProgress && !props.speculativeTransactionId && (
        <div>Initializing transaction...</div>
      )}
      
      {showStripeForm ? (
        <StripePaymentForm
          onFormValuesChange={handleFormValuesChange}
          ...
        />
      ) : (
        <div>Waiting for transaction initialization...</div>
      )}
    </>
  ) : null}
);
```

Form renders: **T1** (after speculation completes)

---

## One-Shot Guard Analysis

### origin/main Guard Logic

```javascript
// In speculation effect:

// Reset guard if session changed
if (lastSessionKeyRef.current !== sessionKey || !hasTxId) {
  initiatedSessionRef.current = false;
  lastSessionKeyRef.current = sessionKey;
}

// Block if already initiated AND have txId
if (initiatedSessionRef.current && hasTxId) {
  return; // ← 🔴 Prevents re-speculation with filled form data
}

// Mark as initiated
initiatedSessionRef.current = true;

// Call speculation (reads empty customerFormRef.current at T0)
fn(orderParamsWithPD);
```

**Problem**: Guard set at T0 (before form fills) → blocks retry at T2 (after form fills)

---

### origin/test Guard Logic (Simpler)

```javascript
// In speculation effect:

const specParams = JSON.stringify({
  listingId: pageData.listing.id,
  startDate: orderParams?.bookingStart,
  endDate: orderParams?.bookingEnd,
});

if (prevKeyRef.current === specParams) {
  return; // Skip duplicate
}

prevKeyRef.current = specParams;
fetchSpeculatedTransaction(orderParams, ...);
```

**Advantage**: Guard based on params (listing/dates), not timing. If formValues in deps, each form change creates new speculation.

---

## The Smoking Gun

### What Happens at T0 on main

```javascript
// Speculation effect fires immediately
const profileFallback = {
  customerPhone: currentUser?.attributes?.profile?.privateData?.phone || '',
};

// ❌ customerFormRef.current is EMPTY at T0!
const protectedDataFromForm = buildProtectedData(customerFormRef.current, profileFallback);
// → protectedDataFromForm = { customerPhone: '...' } (only phone from profile, no address)

const orderParamsWithPD = {
  ...orderResult.params,
  protectedData: {
    ...(orderResult.params?.protectedData || {}),
    ...protectedDataFromForm,  // ← EMPTY address fields!
  },
};

// Logs show:
// [PRE-SPECULATE] protectedData keys: ['customerPhone']
// [PRE-SPECULATE] protectedData: { customerPhone: '+1234567890' }

fn(orderParamsWithPD); // ← API call with NO address fields
```

---

### What Happens at T2 on test

```javascript
// Speculation effect fires AFTER user types (formValues in deps)
const protectedData = {};

// ✅ formValues is FILLED at T2!
if (formValues.customerName?.trim()) protectedData.customerName = formValues.customerName.trim();
if (formValues.customerStreet?.trim()) protectedData.customerStreet = formValues.customerStreet.trim();
if (formValues.customerZip?.trim()) protectedData.customerZip = formValues.customerZip.trim();
// ...all fields

// Logs show:
// [PRE-SPECULATE] protectedData keys: ['customerName', 'customerStreet', 'customerCity', 'customerState', 'customerZip', 'customerEmail', 'customerPhone']

const orderParams = { ...baseParams, protectedData };
fetchSpeculatedTransaction(orderParams, ...); // ← API call WITH all address fields
```

---

## Fix Strategy

### Immediate Fix (Minimal Changes)

**Option 1**: Add `formValues` to speculation deps

```diff
useEffect(() => {
  // ... speculation logic
}, [
  sessionKey,
  !!orderResult?.ok,
  currentUser?.id,
  props?.speculativeTransactionId,
  processName,
  listingIdNormalized,
+ formValues  // ← Re-fires when form fills
]);
```

**Tradeoff**: More API calls (re-speculation on every keystroke)

---

**Option 2**: Remove `showStripeForm` gate + delay speculation

```diff
- const showStripeForm = hasSpeculativeTx && !!txProcess;
+ const showStripeForm = !!txProcess; // ← Always show if process exists

{showPaymentForm ? (
-  {showStripeForm ? (
    <StripePaymentForm ... />
-  ) : (
-    <div>Waiting...</div>
-  )}
) : null}
```

AND add delay to speculation:

```diff
useEffect(() => {
+ // Wait for form to mount and user to fill
+ const hasFormData = Object.keys(customerFormRef.current).length > 0;
+ if (!hasFormData) {
+   console.debug('[Checkout] Waiting for form data before speculation');
+   return;
+ }
  
  // ... existing speculation logic
}, [
  sessionKey,
  !!orderResult?.ok,
  currentUser?.id,
  props?.speculativeTransactionId,
  processName,
  listingIdNormalized,
+ JSON.stringify(customerFormRef.current)  // ← Trigger when ref fills
]);
```

**Tradeoff**: User must fill form before Stripe Elements loads (UX delay)

---

### Recommended Fix (Balanced)

**Hybrid approach**:

1. ✅ Mount form early (remove `showStripeForm` gate)
2. ✅ Fire initial speculation for PaymentIntent setup (empty protectedData OK for PI creation)
3. ✅ Re-fire speculation when formValues fill (update PI with address)
4. ✅ Keep one-shot guard but key it to form state, not just sessionKey

```javascript
useEffect(() => {
  // Build stable key including form fill state
  const hasFormData = Object.keys(formValues).length > 3; // threshold: name, street, zip minimum
  const specKey = `${sessionKey}:${hasFormData ? 'filled' : 'empty'}`;
  
  if (lastSpecKeyRef.current === specKey) {
    return; // Skip if same state
  }
  lastSpecKeyRef.current = specKey;
  
  // ... existing speculation logic with protectedData from formValues
}, [
  sessionKey,
  !!orderResult?.ok,
  currentUser?.id,
  props?.speculativeTransactionId,
  processName,
  listingIdNormalized,
  formValues  // ← Key dependency
]);
```

**Result**:
- T0: Initial speculation (empty PD, creates PI)
- T2: Re-speculation (filled PD, updates PI metadata)
- Max 2 API calls per checkout session
- Address fields captured reliably

---

## Validation Points

After fix, verify these logs appear in sequence:

```
[INIT_GATES] hasUser:true orderOk:true hasTxId:false hasProcess:true
[Checkout] 🚀 initiating once for session:user-123_listing-456_2025-01-15_2025-01-20
[PRE-SPECULATE] protectedData keys: ['customerPhone']  ← Initial (phone from profile)
[SPECULATE_SUCCESS] txId: abc123
[Checkout] Form values changed: { customerStreet: '123 Main', customerZip: '12345' }
[Checkout] 🚀 initiating once for session:user-123_listing-456_2025-01-15_2025-01-20 (retry with form data)
[PRE-SPECULATE] protectedData keys: ['customerName','customerStreet','customerCity','customerState','customerZip','customerEmail','customerPhone']  ← Filled!
[SPECULATE_SUCCESS] txId: abc123 (updated)
```

---

## Summary

| Root Cause | test | main | Fix |
|------------|------|------|-----|
| **When speculation fires** | After form fills (T2) | Before form renders (T0) | Add formValues to deps |
| **Form mount timing** | Immediate (T0) | Delayed (T1) | Remove showStripeForm gate |
| **Re-speculation** | Allowed | Blocked | Update guard logic |
| **protectedData @ speculation** | Filled | Empty | Move speculation after form fill |

**Bottom line**: main's speculation fires too early (T0 vs T2) and blocks retries. Adding `formValues` to deps + removing mount gate fixes the timing race.


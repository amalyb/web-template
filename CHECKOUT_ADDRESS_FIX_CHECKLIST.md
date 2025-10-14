# Checkout Address Fields Fix - Action Checklist

**Goal**: Make address/contact fields reach protectedData on main (currently broken)  
**Branches**: Fix origin/main to match working behavior from origin/test  
**Root Cause**: Speculation fires before form fills + one-shot guard blocks retry

---

## Quick Reference: 4 Critical Edits

| # | File | Lines | Change | Impact |
|---|------|-------|--------|--------|
| **A** | CheckoutPageWithPayment.js | ~1350-1365 | Remove `showStripeForm` gate | Form mounts immediately |
| **B** | CheckoutPageWithPayment.js | ~1020 | Add `formValues` to deps | Re-speculates when user types |
| **C** | CheckoutPageWithPayment.js | ~560-568 | Re-enable hard validation | Blocks submit without address |
| **D** | CheckoutPageWithPayment.js | ~900-920 | Update one-shot guard | Allows retry with filled form |

**Estimated time**: 30 minutes  
**Risk**: Low (reverts to simpler test logic)  
**Testing**: 15 minutes (fill form, check logs, verify transaction)

---

## EDIT A: Remove showStripeForm Gate

**File**: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`  
**Lines**: Approximately 1350-1365  
**Goal**: Mount form immediately when `showPaymentForm` is true (don't wait for speculation)

### Current Code (main - BROKEN)

```javascript
{showPaymentForm ? (
  <>
    {speculativeInProgress && !props.speculativeTransactionId && (
      <div style={{ padding: '16px', marginBottom: '16px', backgroundColor: '#f0f4f8', borderRadius: '4px', textAlign: 'center' }}>
        <p style={{ margin: 0, color: '#4A5568' }}>
          <FormattedMessage 
            id="CheckoutPage.initializingTransaction" 
            defaultMessage="Initializing transaction..." 
          />
        </p>
      </div>
    )}

    {showPaymentForm ? (
      <>
        {(() => {
          // ... gate logic ...
        })()}
        {showStripeForm ? (
          <StripePaymentForm
            className={css.paymentForm}
            onSubmit={values => handleSubmit(values, txProcess, props, stripe, submitting, setSubmitting)}
            // ... props
          />
        ) : (
          <div style={{ fontSize: 14, opacity: 0.7, marginTop: 16, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
            Waiting for transaction initialization...
          </div>
        )}
      </>
    ) : null}
  </>
) : null}
```

### New Code (match test - WORKING)

```javascript
{showPaymentForm ? (
  <>
    {(() => {
      // Submit gates display (keep as-is)
      const hasSpeculativeTx = Boolean(props?.speculativeTransactionId);
      const canSubmit = hasSpeculativeTx && stripeReady && paymentElementComplete && formValid && !submitting;
      const disabled = !canSubmit;
      const disabledReason = !hasSpeculativeTx ? 'Waiting for transaction initialization…'
        : !stripeReady ? 'Setting up secure payment…'
        : !paymentElementComplete ? 'Enter payment details…'
        : !formValid ? 'Complete required fields…'
        : submitting ? 'Processing…'
        : null;

      return (
        <>
          {disabled && (
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8, padding: '8px 12px', backgroundColor: '#f7fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
              Can't submit yet: <code style={{ backgroundColor: '#fff', padding: '2px 6px', borderRadius: '3px', fontSize: 11 }}>{disabledReason}</code>
            </div>
          )}
        </>
      );
    })()}
    <StripePaymentForm
      className={css.paymentForm}
      onSubmit={values => handleSubmit(values, txProcess, props, stripe, submitting, setSubmitting)}
      inProgress={submitting}
      formId="CheckoutPagePaymentForm"
      authorDisplayName={listing?.author?.attributes?.profile?.displayName}
      showInitialMessageInput={showInitialMessageInput}
      initialValues={initialValuesForStripePayment}
      initiateOrderError={initiateOrderError}
      confirmPaymentError={confirmPaymentError}
      paymentIntent={paymentIntent}
      retrievePaymentIntentError={retrievePaymentIntentError}
      onStripeElementMounted={setStripeElementMounted}
      onPaymentElementComplete={setPaymentElementComplete}
      onFormValuesChange={handleFormValuesChange}
      onFormValidityChange={v => {
        console.log('[Form] parent sees valid:', v); 
        setFormValid(v); 
      }}
      requireInPaymentForm={false}
      submitInProgress={submitting}
      submitDisabled={(() => {
        const hasSpeculativeTx = Boolean(props?.speculativeTransactionId);
        const canSubmit = hasSpeculativeTx && stripeReady && paymentElementComplete && formValid && !submitting;
        return !canSubmit;
      })()}
      askShippingDetails={askShippingDetails}
      showPickUplocation={orderData?.deliveryMethod === 'pickup'}
      listingLocation={listing?.attributes?.publicData?.location}
      totalPrice={totalPrice}
      locale={config.localization.locale}
      stripePublishableKey={config.stripe.publishableKey}
      marketplaceName={config.marketplaceName}
      isBooking={isBookingProcessAlias(transactionProcessAlias)}
      isFuzzyLocation={config.maps.fuzzy.enabled}
    />
  </>
) : null}
```

**Key Changes**:
- ❌ Remove `showStripeForm` conditional wrapper
- ❌ Remove "Waiting for transaction initialization..." fallback div
- ✅ Always render `<StripePaymentForm>` when `showPaymentForm` is true
- ✅ Keep submit gate diagnostics (helpful for debugging)

**Why**: Form must mount early so `onFormValuesChange` can fire before speculation completes.

---

## EDIT B: Add formValues to Speculation Dependencies

**File**: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`  
**Lines**: Approximately 1020 (dependency array of speculation useEffect)  
**Goal**: Re-fire speculation when user fills form (capture fresh protectedData)

### Find This Line

```javascript
}, [sessionKey, !!orderResult?.ok, currentUser?.id, props?.speculativeTransactionId, processName, listingIdNormalized]);
```

### Change To

```javascript
}, [sessionKey, !!orderResult?.ok, currentUser?.id, props?.speculativeTransactionId, processName, listingIdNormalized, formValues]);
```

**Key Changes**:
- ✅ Add `formValues` at end of dependency array

**Why**: When user types address, `formValues` changes → effect re-runs → new speculation with filled protectedData.

**Note**: This will cause 2-3 speculation calls per checkout (empty → partial → filled). This is acceptable since speculation is idempotent and creates/updates the same PaymentIntent.

---

## EDIT C: Re-Enable Hard Validation

**File**: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`  
**Lines**: Approximately 560-570 (in handleSubmit function)  
**Goal**: Prevent form submission without required address fields

### Current Code (main - BROKEN)

```javascript
// Assert required fields and abort if missing
if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[checkout] Missing address fields for speculate — proceeding with minimal PD');
  }
  // continue without throwing; speculation should still run
}
```

### New Code (match test - WORKING)

```javascript
// Assert required fields and abort if missing
if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
  const missingFields = [];
  if (!mergedPD.customerStreet?.trim()) missingFields.push('Street Address');
  if (!mergedPD.customerZip?.trim()) missingFields.push('ZIP Code');
  
  setSubmitting(false);
  throw new Error(`Please fill in the required address fields: ${missingFields.join(', ')}`);
}
```

**Key Changes**:
- ❌ Remove soft warning that continues execution
- ✅ Add hard throw that stops form submission
- ✅ Reset `submitting` state before throwing

**Why**: Prevents creating transactions without required contact info.

---

## EDIT D: Update One-Shot Guard Logic

**File**: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`  
**Lines**: Approximately 900-920 (in speculation useEffect, before API call)  
**Goal**: Allow re-speculation when form data changes, not just on session change

### Current Code (main - BROKEN)

```javascript
// Reset the guard if sessionKey changed OR if we don't have a txId
// This allows retries after auth appears even if sessionKey was previously used
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

### New Code (match test pattern - WORKING)

```javascript
// Create stable key based on parameters AND form fill state
const hasFormData = formValues && Object.keys(formValues).length > 0 
  && formValues.customerStreet?.trim() 
  && formValues.customerZip?.trim();

const specParams = JSON.stringify({
  listingId: orderResult.params?.listingId,
  startDate: orderResult.params?.bookingDates?.start,
  endDate: orderResult.params?.bookingDates?.end,
  formFilled: hasFormData,  // ← Key addition: track form state
});

// Skip only if exact params match (including form state)
if (prevSpecKeyRef.current === specParams) {
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[Checkout] Skipping duplicate speculation:', specParams);
  }
  return;
}

prevSpecKeyRef.current = specParams;
```

**Key Changes**:
- ❌ Remove `initiatedSessionRef` one-shot guard
- ❌ Remove `lastSessionKeyRef` session-based guard
- ✅ Use `prevSpecKeyRef` with form state in key
- ✅ Include `formFilled` boolean in speculation key

**Why**: Allows effect to fire twice:
1. First time: `formFilled: false` → creates PaymentIntent
2. Second time: `formFilled: true` → updates with address data

**Result**: Max 2 speculation calls per checkout (empty → filled), both cached by unique keys.

---

## Verification Checklist

After applying all 4 edits, test the flow:

### ✅ Step 1: Clear Storage

```javascript
// In browser console before testing
localStorage.clear();
sessionStorage.clear();
location.reload();
```

### ✅ Step 2: Navigate to Checkout

1. Go to any listing
2. Select booking dates
3. Click "Book" or "Request to Book"
4. Should land on CheckoutPage

### ✅ Step 3: Observe Console Logs (Expected Sequence)

```
[Checkout] 🚀 initiating once for session:user-abc123_listing-xyz789_2025-01-15_2025-01-20
[PRE-SPECULATE] protectedData keys: []  ← Initial speculation (no form data yet)
[SPECULATE_SUCCESS] txId: tx_123abc

[Checkout] Form values changed: { customerStreet: '123 Main', customerZip: '12345', ... }
[Checkout] 🚀 initiating once for session:user-abc123_listing-xyz789_2025-01-15_2025-01-20
[PRE-SPECULATE] protectedData keys: ['customerName','customerStreet','customerCity','customerState','customerZip','customerEmail','customerPhone']  ← Re-speculation WITH form data
[SPECULATE_SUCCESS] txId: tx_123abc

[checkout→request-payment] protectedData keys: ['customerName','customerStreet',...]
[checkout→request-payment] customerStreet: 123 Main St
[checkout→request-payment] customerZip: 12345
```

### ✅ Step 4: Fill Form & Submit

1. Enter name, address, email, phone
2. Enter payment card details
3. Click "Confirm and Pay"
4. Should succeed (no validation errors)

### ✅ Step 5: Verify Transaction Data

**In Flex Console** (or API response):
```json
{
  "id": "tx_123abc",
  "attributes": {
    "protectedData": {
      "customerName": "John Doe",
      "customerStreet": "123 Main St",
      "customerCity": "Anytown",
      "customerState": "CA",
      "customerZip": "12345",
      "customerEmail": "john@example.com",
      "customerPhone": "+15551234567"
    }
  }
}
```

**All fields should be present and filled.**

---

## Expected Behavior Changes

### Before Fix (main - BROKEN)

```
User Flow:
1. Land on CheckoutPage
2. See "Initializing transaction..." spinner
3. Wait 1-2 seconds
4. Form appears
5. Fill address → no re-speculation
6. Submit → fields in transition but NOT in PaymentIntent
```

Console:
```
[PRE-SPECULATE] protectedData keys: ['customerPhone']  ← Only phone from profile
[SPECULATE_SUCCESS] txId: tx_123
[checkout→request-payment] protectedData keys: ['customerName','customerStreet',...]  ← Too late, PI already created
```

### After Fix (main - WORKING)

```
User Flow:
1. Land on CheckoutPage
2. Form appears IMMEDIATELY (no spinner)
3. Fill address → triggers re-speculation
4. Submit → fields in both PaymentIntent AND transaction
```

Console:
```
[PRE-SPECULATE] protectedData keys: []  ← Initial (empty)
[SPECULATE_SUCCESS] txId: tx_123
[PRE-SPECULATE] protectedData keys: ['customerName','customerStreet',...]  ← Re-speculation (filled)
[SPECULATE_SUCCESS] txId: tx_123
[checkout→request-payment] protectedData keys: ['customerName','customerStreet',...]  ← Confirmed
```

---

## Rollback Plan

If these changes cause issues, rollback is simple:

```bash
# Revert the file
git checkout origin/main -- src/containers/CheckoutPage/CheckoutPageWithPayment.js

# Or revert specific edits:
# - Re-add showStripeForm gate (undo Edit A)
# - Remove formValues from deps (undo Edit B)
# - Re-add soft validation (undo Edit C)
# - Restore initiatedSessionRef guard (undo Edit D)
```

**Rollback time**: 5 minutes  
**Risk**: Low (just reverting to known state)

---

## Additional Notes

### Why Not Just Copy test Branch?

The test branch has other experimental changes. These 4 edits are the **minimal diff** needed to fix the address field issue without pulling in unrelated changes.

### Why Multiple Speculation Calls?

Stripe PaymentIntent metadata can be updated after creation. Two calls ensure:
1. First call: Create PI quickly for Stripe Elements mount
2. Second call: Update PI with customer address after form fills

Both calls use same `sessionKey`, so Flex updates the same transaction entity (no duplicates).

### Performance Impact

- **Before**: 1 speculation call per checkout (but with empty address)
- **After**: 2 speculation calls per checkout (first empty, second filled)
- **Cost**: +1 API call (~50ms latency)
- **Benefit**: Address fields correctly captured

This is an acceptable tradeoff for data integrity.

---

## Success Criteria

✅ Form renders immediately when CheckoutPage loads  
✅ Console shows TWO speculation calls (empty → filled)  
✅ Transaction entity has all 7 customer fields populated  
✅ No validation errors on submit  
✅ PaymentIntent metadata includes customer address  

---

## Troubleshooting

### Issue: Form still doesn't render

**Check**: Did you remove the `showStripeForm` gate? (Edit A)

**Debug**:
```javascript
console.log('[Debug] showPaymentForm:', showPaymentForm);
console.log('[Debug] showStripeForm:', showStripeForm);  // Should not exist after fix
console.log('[Debug] txProcess:', txProcess);
```

---

### Issue: No re-speculation after typing

**Check**: Did you add `formValues` to deps? (Edit B)

**Debug**:
```javascript
// Add temporary log in effect
useEffect(() => {
  console.log('[Debug] Speculation effect running, formValues:', formValues);
  // ... rest of effect
}, [sessionKey, ..., formValues]);  // ← Verify formValues is here
```

---

### Issue: Can submit without address

**Check**: Did you re-enable hard throw? (Edit C)

**Debug**:
```javascript
// In handleSubmit, before throw
console.log('[Debug] mergedPD.customerStreet:', mergedPD.customerStreet);
console.log('[Debug] mergedPD.customerZip:', mergedPD.customerZip);
```

---

### Issue: Only one speculation call

**Check**: Did you update one-shot guard? (Edit D)

**Debug**:
```javascript
// In speculation effect, before guard check
console.log('[Debug] prevSpecKeyRef.current:', prevSpecKeyRef.current);
console.log('[Debug] specParams:', specParams);
console.log('[Debug] Match:', prevSpecKeyRef.current === specParams);
```

---

## Summary

| Edit | Goal | Lines Changed | Risk | Priority |
|------|------|---------------|------|----------|
| **A** | Mount form early | ~15 | Low | 🔴 Critical |
| **B** | Re-fire on form fill | 1 | Low | 🔴 Critical |
| **C** | Block submit without address | ~8 | Low | 🟡 High |
| **D** | Allow retry with filled form | ~10 | Medium | 🔴 Critical |

**Total**: ~34 lines changed in 1 file  
**Time**: 30 minutes implementation + 15 minutes testing = **45 minutes total**

---

**Questions?** Compare the working flow in `origin/test` against these changes to verify they match the intended behavior.


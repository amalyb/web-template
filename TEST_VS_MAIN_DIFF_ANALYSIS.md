# Test vs Main Branch - Critical Differences Analysis

This document identifies key differences between the `test` and `main` branches that may affect the booking page loading issue.

---

## 🔴 CRITICAL FINDING: Speculation Flow Differences

### CheckoutPageWithPayment.js

#### **Test Branch (Simpler, Works)**
- ✅ Uses `fetchSpeculatedTransaction` prop directly
- ✅ Single speculation effect triggered by `listingId` change
- ✅ Uses standard prop name: `speculatedTransaction`
- ✅ No complex module-level caching
- ✅ No auth token/user gates blocking speculation

#### **Main Branch (Complex, Broken)**
- ❌ Uses custom `onInitiatePrivilegedSpeculativeTransaction` action
- ❌ Multiple complex effects with session key management
- ❌ Renamed prop: `speculativeTransaction` 
- ❌ Module-level cache: `MODULE_SPEC_CACHE`
- ❌ Multiple auth gates that can block rendering:
  ```js
  const allGatesPassed = hasUser && orderResult?.ok && !hasTxId && hasProcess;
  ```
- ❌ Returns early preventing page render if `!orderResult.ok`:
  ```js
  if (!orderResult.ok) {
    return (
      <Page title={title} scrollingDisabled={scrollingDisabled}>
        <div>Cannot render - invalid orderParams</div>
      </Page>
    );
  }
  ```

---

## 🔑 Parent ↔ Child Wiring

### StripePaymentForm.js

#### **Test Branch**
```js
const mappedValues = {
  customerName: values.shipping?.name || values.billing?.name || '',
  customerStreet: values.shipping?.line1 || values.billing?.line1 || '',
  customerStreet2: values.shipping?.line2 || values.billing?.line2 || '',
  customerCity: values.shipping?.city || values.billing?.city || '',
  customerState: values.shipping?.state || values.billing?.state || '',
  customerZip: values.shipping?.postalCode || values.billing?.postalCode || '',
  customerEmail: values.shipping?.email || values.billing?.email || '',
  customerPhone: values.shipping?.phone || values.billing?.phone || '',
  // ... rest
};
this.props.onFormValuesChange?.(mappedValues);
```

✅ **Key: `customerStreet` and `customerZip` are correctly mapped from form fields**
✅ **Bubbles up via `onFormValuesChange`**

#### **Main Branch**
```js
// SAME mapping logic BUT:
const safeValues = {
  ...v,
  shipping: v.shipping || {},
  billing: v.billing || {},
};
const customerStreet = pickFromShippingOrBilling(safeValues, 'line1');
const customerZip = pickFromShippingOrBilling(safeValues, 'postalCode');
```

⚠️ **Same key names but has defensive "safe" object wrapping that might affect undefined handling**

---

## 🔧 CheckoutPage.duck.js - State Management

### **Test Branch (Clean)**
```js
case SPECULATE_TRANSACTION_SUCCESS: {
  const tx = payload.transaction;
  console.log('[duck] privileged speculative success:', tx?.id);
  return {
    ...state,
    speculateTransactionInProgress: false,
    speculatedTransaction: payload.transaction,
    isClockInSync: Math.abs(lastTransitionedAt?.getTime() - localTime.getTime()) < minute,
  };
}
```

✅ **Simple state update**
✅ **No complex client secret extraction**
✅ **No extra action types**

### **Main Branch (Complex)**
```js
case SPECULATE_TRANSACTION_SUCCESS: {
  // 🔐 PROD HOTFIX: Robustly extract Stripe client secret from all possible paths
  const pd = tx?.attributes?.protectedData || {};
  const md = tx?.attributes?.metadata || {};
  const nested = pd?.stripePaymentIntents?.default || {};

  const maybeSecret =
    pd?.stripePaymentIntentClientSecret ||
    md?.stripePaymentIntentClientSecret ||
    nested?.stripePaymentIntentClientSecret;

  const validatedSecret = looksStripey ? maybeSecret : null;
  
  return {
    ...state,
    speculateTransactionInProgress: false,
    speculatedTransaction: tx,
    stripeClientSecret: validatedSecret,
    speculativeTransactionId: tx?.id?.uuid || tx?.id || null,
    clientSecretHotfix: secretLooksValid ? clientSecret : null,
    speculateStatus: 'succeeded',
  };
}
```

❌ **Additional action types:**
- `INITIATE_PRIV_SPECULATIVE_TRANSACTION_REQUEST`
- `INITIATE_PRIV_SPECULATIVE_TRANSACTION_SUCCESS`
- `INITIATE_PRIV_SPECULATIVE_TRANSACTION_ERROR`
- `HOTFIX_SET_CLIENT_SECRET`

❌ **Extra state fields:**
- `lastSpeculationKey`
- `speculativeTransactionId`
- `speculateStatus`
- `stripeClientSecret`
- `lastSpeculateError`
- `clientSecretHotfix`

❌ **Custom action: `initiatePrivilegedSpeculativeTransactionIfNeeded`** (100+ lines)

---

## 📦 OrderParams Building

### CheckoutPageWithPayment.js

#### **Test Branch**
```js
const orderParams = getOrderParams(pageData, shippingDetails, optionalPaymentParams, config, formValues);

// Simple helper:
const getOrderParams = (pageData, shippingDetails, optionalPaymentParams, config, formValues = {}) => {
  const quantity = pageData.orderData?.quantity;
  const quantityMaybe = quantity ? { quantity } : {};
  // ... build orderParams
  return orderParams;
};
```

✅ **No complex validation that blocks rendering**
✅ **Returns orderParams directly**

#### **Main Branch**
```js
const orderResult = useMemo(() => {
  if (!startISO || !endISO) {
    console.debug('[Checkout] Missing booking dates in orderParams');
    return { ok: false, reason: 'missing-bookingDates', params: null };
  }
  
  return buildOrderParams({
    listing: pageDataListing,
    listingId: listingIdNormalized,
    start: startISO,
    end: endISO,
    protectedData: {},
  });
}, [pageDataListing, listingIdNormalized, startISO, endISO, pageData]);
```

❌ **Returns `{ ok: false }` if booking dates missing**
❌ **Blocks page render with early return if `!orderResult.ok`**

---

## 🔄 Dispatch Path Differences

### **Test Branch (Direct)**
```js
useEffect(() => {
  const listingId = pageData?.listing?.id?.uuid || pageData?.listing?.id;
  if (!listingId) return;

  if (!speculativeTransaction?.id && !speculativeInProgress) {
    const orderParams = getOrderParams(pageData, {}, {}, config, formValues);
    fetchSpeculatedTransactionIfNeeded(
      orderParams,
      pageData,
      props.fetchSpeculatedTransaction,
      prevSpecKeyRef
    );
  }
}, [pageData?.listing?.id, speculativeTransaction?.id, speculativeInProgress, formValues]);
```

✅ **Single effect**
✅ **Minimal gates**
✅ **Uses standard `fetchSpeculatedTransaction`**

### **Main Branch (Multi-Stage with Guards)**
```js
useEffect(() => {
  const hasUser = Boolean(currentUser && currentUser.id);
  const hasTxId = Boolean(props?.speculativeTransactionId);
  const hasProcess = Boolean(txProcessForGate);
  
  const allGatesPassed = hasUser && orderResult?.ok && !hasTxId && hasProcess;
  
  if (!hasUser) return;
  if (!orderResult.ok) return;
  if (!hasProcess) return;
  if (hasTxId) return;
  if (initiatedSessionRef.current && hasTxId) return;
  
  initiatedSessionRef.current = true;
  
  const fn = initiateRef.current;
  if (typeof fn === 'function') {
    fn(orderParamsWithPD)
      .then(res => { /* ... */ })
      .catch(err => { /* ... */ });
  }
}, [sessionKey, !!orderResult?.ok, currentUser?.id, props?.speculativeTransactionId, processName, listingIdNormalized]);
```

❌ **Multiple blocking gates**
❌ **Complex session key tracking**
❌ **Custom action via ref**

---

## 📋 Line Items & Transaction Utils

### transaction-line-items.js (Server)

#### **Test Branch**
```js
const payload = {
  lineItems: validLineItems,
  breakdownData,          // { startDate, endDate }
  bookingDates: breakdownData,
};

res.status(200)
  .set('Content-Type', 'application/transit+json')
  .send(serialize(payload))
  .end();
```

✅ **Returns structured payload with `breakdownData` and `bookingDates`**

#### **Main Branch**
```js
res.status(200)
  .set('Content-Type', 'application/transit+json')
  .send(serialize({ data: validLineItems }))
  .end();
```

❌ **Only returns `{ data: lineItems }` - missing breakdown/booking dates**

### ListingPage.duck.js

#### **Test Branch**
```js
case FETCH_LINE_ITEMS_SUCCESS:
  return { 
    ...state, 
    fetchLineItemsInProgress: false, 
    lineItems: payload.lineItems,
    breakdownData: payload.breakdownData,
    bookingDates: payload.bookingDates,
  };
```

✅ **Stores `breakdownData` and `bookingDates` in state**

#### **Main Branch**
```js
case FETCH_LINE_ITEMS_SUCCESS:
  return { ...state, fetchLineItemsInProgress: false, lineItems: payload };
```

❌ **Only stores `lineItems`, discards breakdown/dates**

---

## 🛠️ Validation Schema

### **Both branches use same keys**
Both branches map to `customerStreet` and `customerZip` correctly.

The issue is NOT key names but rather:
1. Whether the form data reaches the speculation call
2. Whether orderParams blocks rendering before form appears

---

## 🎯 ROOT CAUSE ANALYSIS

### Why Main Branch Fails to Load Booking Page

1. **Early Return on Missing Booking Dates**
   ```js
   if (!orderResult.ok) {
     return <Page><div>Cannot render</div></Page>; // 💥 Blocks UI
   }
   ```
   If `bookingDates` aren't present when the component first renders, main returns early and never shows the form.

2. **Complex OrderParams Validation**
   Main uses `buildOrderParams` with strict validation that returns `{ ok: false }` if dates are missing, while test uses simpler `getOrderParams` that always returns params.

3. **Multiple Auth/State Gates**
   Main has many more conditions that can prevent speculation from running:
   ```js
   if (!hasUser) return;
   if (!orderResult.ok) return;
   if (!hasProcess) return;
   ```
   Test has minimal gates and focuses on `listingId` presence only.

4. **Missing Booking Dates in Line Items Response**
   Main's server only returns `{ data: lineItems }`, while test returns full payload with `breakdownData` and `bookingDates`. This means the UI may not have the dates it needs to populate orderData.

5. **State Shape Differences**
   - Test: `speculatedTransaction`, `breakdownData`, `bookingDates`
   - Main: `speculativeTransaction`, `speculativeTransactionId`, `stripeClientSecret`, etc.
   
   Selectors may be looking for the wrong field names.

---

## 🔥 IMMEDIATE FIX RECOMMENDATIONS

### Option A: Backport Test's Simpler Approach to Main
1. Remove early return for `!orderResult.ok`
2. Simplify speculation effect to single useEffect with minimal gates
3. Remove module-level caching and session key complexity
4. Use standard `fetchSpeculatedTransaction` instead of custom action
5. Ensure server returns full payload with booking dates

### Option B: Fix Main's Validation Logic
1. Allow page to render even if `orderResult.ok === false`
2. Show form so user can select dates
3. Only block submission (not rendering) on missing dates
4. Ensure `bookingDates` are captured from form and stored in redux state
5. Update line items API to return dates in response

### Option C: Merge Test into Main
If test branch is stable and working, consider it the source of truth and merge it into main, carefully reviewing any intentional improvements in main that should be preserved.

---

## 📝 SPECIFIC MISSING DATA FLOW IN MAIN

```
User selects dates in BookingDatesForm
  ↓
  ? (Missing: How do dates get into pageData/orderData?)
  ↓
CheckoutPageWithPayment renders
  ↓
buildOrderParams() called
  ↓
if (!startISO || !endISO) → { ok: false } 💥
  ↓
if (!orderResult.ok) → return early 💥
  ↓
Page never renders form
```

**Test's flow:**
```
User selects dates in BookingDatesForm
  ↓
Dates stored in redux state (breakdownData/bookingDates)
  ↓
CheckoutPageWithPayment renders (no early return)
  ↓
getOrderParams() builds params (returns even if dates missing)
  ↓
Page renders form
  ↓
Form shows dates from state
  ↓
Speculation runs with dates
```

---

## 🧪 TESTING CHECKLIST

To verify the fix:
- [ ] Navigate to listing page
- [ ] Select booking dates
- [ ] Click "Request to book"
- [ ] **Checkpoint:** Checkout page loads (form visible)
- [ ] **Checkpoint:** OrderBreakdown shows correct dates
- [ ] Fill in address fields
- [ ] **Checkpoint:** Console logs show `customerStreet` and `customerZip` in speculation call
- [ ] Submit booking
- [ ] **Checkpoint:** Transaction created successfully

---

## 📚 FILES TO REVIEW

1. **How dates flow from ListingPage to CheckoutPage**
   - Check `src/containers/ListingPage/BookingDatesForm.js` (no diff - same in both)
   - Check how `onSubmit` in BookingDatesForm dispatches to redux
   - Verify `pageData.orderData.bookingDates` is populated

2. **CheckoutPage Container**
   - `src/containers/CheckoutPage/CheckoutPage.js` - the parent container
   - Verify `mapStateToProps` pulls `orderData` from redux correctly
   - Check if `pageData` selector differs between branches

3. **Redux Selectors**
   - Check if selectors expect different state shapes (speculatedTransaction vs speculativeTransaction)

---

## 🎯 MOST LIKELY FIX

Remove these lines from main's `CheckoutPageWithPayment.js`:

```js
// ❌ DELETE THIS BLOCK
if (!orderResult.ok) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[Checkout] Cannot render - invalid orderParams:', orderResult.reason);
  }
  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <CustomTopbar intl={intl} linkToExternalSite={config?.topbar?.logoLink} />
      <div className={css.contentContainer}>
        <section className={css.incompatibleCurrency}>
          <H4 as="h1" className={css.heading}>
            <FormattedMessage id="CheckoutPage.incompleteBookingData" />
          </H4>
        </section>
      </div>
    </Page>
  );
}
```

This will allow the page to render and the form to appear, matching test branch behavior.


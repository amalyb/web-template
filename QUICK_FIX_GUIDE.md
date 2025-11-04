# Quick Fix Guide - Booking Page Not Loading

## 🔴 ROOT CAUSE

Main branch has an **early return** that blocks the checkout page from rendering if booking dates are missing:

```js
// main branch - CheckoutPageWithPayment.js around line 1308
if (!orderResult.ok) {
  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <div>Cannot render - invalid orderParams</div>
    </Page>
  );
}
```

Test branch **DOES NOT** have this block, so the form always renders.

---

## ✅ IMMEDIATE FIX

### Step 1: Remove Early Return

In `src/containers/CheckoutPage/CheckoutPageWithPayment.js`, delete lines ~1308-1327:

```diff
- // Don't render if orderParams are invalid (prevents Stripe mounting with bad data)
- if (!orderResult.ok) {
-   if (process.env.NODE_ENV !== 'production') {
-     console.warn('[Checkout] Cannot render - invalid orderParams:', orderResult.reason);
-   }
-   return (
-     <Page title={title} scrollingDisabled={scrollingDisabled}>
-       <CustomTopbar intl={intl} linkToExternalSite={config?.topbar?.logoLink} />
-       <div className={css.contentContainer}>
-         <section className={css.incompatibleCurrency}>
-           <H4 as="h1" className={css.heading}>
-             <FormattedMessage id="CheckoutPage.incompleteBookingData" />
-           </H4>
-         </section>
-       </div>
-     </Page>
-   );
- }
```

### Step 2: Simplify OrderParams Logic

Replace the complex `buildOrderParams` with test's simpler `getOrderParams`:

```diff
- const orderResult = useMemo(() => {
-   if (!startISO || !endISO) {
-     return { ok: false, reason: 'missing-bookingDates', params: null };
-   }
-   return buildOrderParams({ ... });
- }, [...]);
+ const orderParams = getOrderParams(pageData, {}, {}, config, formValues);
```

Then update all references from `orderResult.params` to `orderParams` and remove `orderResult.ok` checks.

### Step 3: Simplify Speculation Effect

Replace the complex multi-gate effect with test's simple version:

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

Remove all the auth gates and session key tracking.

---

## 🔧 SECONDARY FIXES

### Fix Line Items API Response

In `server/api/transaction-line-items.js`, update the response to include booking dates:

```diff
  const validLineItems = constructValidLineItems(lineItems);

+ const raw = orderData || {};
+ const breakdownData = raw.bookingDates || {
+   startDate: raw.bookingStart,
+   endDate: raw.bookingEnd,
+ };
+
+ const payload = {
+   lineItems: validLineItems,
+   breakdownData,
+   bookingDates: breakdownData,
+ };

  res.status(200)
    .set('Content-Type', 'application/transit+json')
-   .send(serialize({ data: validLineItems }))
+   .send(serialize(payload))
    .end();
```

### Fix Duck Reducer

In `src/containers/ListingPage/ListingPage.duck.js`, store the full payload:

```diff
  case FETCH_LINE_ITEMS_SUCCESS:
-   return { ...state, fetchLineItemsInProgress: false, lineItems: payload };
+   return { 
+     ...state, 
+     fetchLineItemsInProgress: false, 
+     lineItems: payload.lineItems,
+     breakdownData: payload.breakdownData,
+     bookingDates: payload.bookingDates,
+   };
```

---

## 🎯 MINIMAL FIX (5 Minutes)

If you just want to get it working quickly, only do **Step 1** above:

1. Open `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
2. Find the block starting with `if (!orderResult.ok) {` around line 1308
3. Delete the entire if block (lines 1308-1327)
4. Save and test

This will unblock the page from rendering. The form will appear and users can proceed with booking.

---

## 📊 COMPARISON TABLE

| Aspect | Test (Works) | Main (Broken) |
|--------|--------------|---------------|
| Early return on bad orderParams | ❌ No | ✅ Yes - BLOCKS PAGE |
| OrderParams validation | Simple `getOrderParams()` | Complex `buildOrderParams()` with `ok` flag |
| Speculation effect | Single effect, minimal gates | Multiple effects, auth gates, session tracking |
| Line items response | Full payload with dates | Only `{ data: lineItems }` |
| State shape | `speculatedTransaction` | `speculativeTransaction` (renamed) |
| Module-level cache | ❌ No | ✅ Yes - `MODULE_SPEC_CACHE` |
| Custom actions | Standard `fetchSpeculatedTransaction` | Custom `initiatePrivilegedSpeculativeTransactionIfNeeded` |

---

## 🧪 TEST AFTER FIX

1. Go to any listing
2. Select dates in calendar
3. Click "Request to book"
4. **VERIFY:** Checkout page loads with form visible
5. **VERIFY:** Date range shows in OrderBreakdown sidebar
6. Fill in address fields
7. **VERIFY:** Console shows `customerStreet` and `customerZip` in logs
8. Submit booking
9. **VERIFY:** Transaction creates successfully

---

## 🔗 RELATED FILES

- Full analysis: `TEST_VS_MAIN_DIFF_ANALYSIS.md`
- CheckoutPageWithPayment: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
- Duck reducer: `src/containers/CheckoutPage/CheckoutPage.duck.js`
- Line items API: `server/api/transaction-line-items.js`
- ListingPage duck: `src/containers/ListingPage/ListingPage.duck.js`

---

## 💡 WHY THIS HAPPENED

The main branch added "defensive" validation that checks if `orderResult.ok === false` and returns early to "prevent Stripe mounting with bad data."

However, this validation is **too strict** and blocks the page from rendering when booking dates aren't immediately available in props, which prevents the form from ever appearing.

Test branch doesn't have this validation, so the page renders normally and the form collects the necessary data.

**Solution:** Remove the early return and let the form render. Only block **submission** (not rendering) on invalid data.


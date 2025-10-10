# Money String Stringification Search Report

## Search Patterns Used
- `JSON.stringify(`
- `String(...price`
- `` `${unitPrice}` ``
- `.toString(`
- `formatMoney(`
- `console.log("Money("`

## Findings

### 1. BookingDatesForm.js - **CONFIRMED DEBUG LOGS PRESENT**
**File:** `src/components/OrderPanel/BookingDatesForm/BookingDatesForm.js`

**Lines 562-565:** Console logging Money instance
```javascript
console.log('🔍 Debugging BookingDatesForm unitPrice prop:');
console.log('Is Money instance:', unitPrice instanceof Money);
console.log('Object details:', unitPrice);
console.log('Money constructor:', Money);
```

**Lines 723-726:** More debug logging before passing to EstimatedCustomerBreakdownMaybe
```javascript
console.log('🔍 Debugging before EstimatedCustomerBreakdownMaybe:');
console.log('Unit price:', unitPrice);
console.log('Is Money instance:', unitPrice instanceof Money);
console.log('Line items:', lineItems);
console.log('Currency:', unitPrice?.currency);
```

**Lines 327-338:** `safeStringify` helper that **EXPLICITLY CONVERTS Money to string**
```javascript
const safeStringify = (obj) => {
  try {
    return JSON.stringify(obj, (key, value) => {
      if (value instanceof Money) {
        return `Money(${value.amount}, ${value.currency})`; // ⚠️ CONVERTS TO STRING!
      }
      return value;
    }, 2);
  } catch (e) {
    return 'Error stringifying object';
  }
};
```

**Lines 572, 692-695, 729:** Using `safeStringify` on props for logging
```javascript
console.log('BookingDatesForm props:', {
  unitPrice: safeStringify(unitPrice), // ⚠️ STRINGIFIES unitPrice!
  listingId,
  ...
});

console.log('BookingDatesForm render props:', {
  lineItems: safeStringify(lineItems),
  values: safeStringify(values),
  ...
});

console.log('Passing to EstimatedCustomerBreakdownMaybe:', {
  breakdownData: safeStringify(breakdownData),
  lineItems: safeStringify(lineItems),
  ...
});
```

**Lines 341-359:** `debugLog` helper that also stringifies Money
```javascript
const debugLog = (label, data) => {
  try {
    window._debug = window._debug || [];
    const logEntry = {
      timestamp: new Date().toISOString(),
      label,
      data: JSON.stringify(data, (key, value) => {
        if (value instanceof Money) {
          return `Money(${value.amount}, ${value.currency})`; // ⚠️ CONVERTS TO STRING!
        }
        return value;
      }, 2)
    };
    window._debug.push(logEntry);
    window.console.log(`[DEBUG] ${label}:`, data);
  } catch (e) {
    window.console.error('Debug logging failed:', e);
  }
};
```

**⚠️ CRITICAL FINDING:** While the `safeStringify` and `debugLog` helpers are only used for *logging*, they demonstrate that:
1. Money instances ARE present in the codebase
2. The helpers explicitly detect and convert them to string representation
3. These are only for debugging/logging - they don't affect runtime props

### 2. formatMoney Usage - **SAFE (Display Only)**
Found in 29 files, all using `formatMoney()` from `src/util/currency.js` for **display purposes only**. This is correct usage - it converts Money to formatted string for UI display, but doesn't affect prop passing.

Files include:
- `src/components/OrderPanel/EstimatedCustomerBreakdownMaybe.js`
- `src/components/OrderBreakdown/*.js` (multiple breakdown components)
- `src/containers/ListingPage/ListingPage.shared.js`
- `src/containers/CheckoutPage/CheckoutPageTransactionHelpers.js`

### 3. OrderPanel.js - **PRICE PASSED CORRECTLY**
**File:** `src/components/OrderPanel/OrderPanel.js`

**Line 247:** Price extracted from listing
```javascript
const price = listing?.attributes?.price;
```

**Line 323:** Price added to sharedProps (as-is, not stringified)
```javascript
const sharedProps = {
  lineItemUnitType,
  onSubmit,
  price, // ← Passed as-is (should be Money instance)
  marketplaceCurrency,
  listingId: listing.id,
  ...
};
```

**Line 428:** BookingDatesForm receives sharedProps
```javascript
<BookingDatesForm
  seatsEnabled={seatsEnabled}
  className={css.bookingForm}
  formId="OrderPanelBookingDatesForm"
  dayCountAvailableForBooking={dayCountAvailableForBooking}
  monthlyTimeSlots={monthlyTimeSlots}
  onFetchTimeSlots={onFetchTimeSlots}
  timeZone={timeZone}
  {...sharedProps} // ← price prop comes from here
/>
```

### 4. Sanitize.js - **DOES NOT TOUCH PRICE**
**File:** `src/util/sanitize.js`

The `sanitizeListing` function (lines 218-249) sanitizes `title`, `description`, and `publicData`, but **passes through all `restAttributes`** which includes `price`:

```javascript
const attributesMaybe = attributes
  ? {
      attributes: {
        title: sanitizeText(title),
        description: sanitizeText(description),
        ...sanitizePublicData(publicData),
        ...restAttributes, // ← price is in here, untouched
      },
    }
  : {};
```

### 5. Data Normalization Flow - **PRESERVES MONEY INSTANCES**
**File:** `src/util/data.js`

- `updatedEntities` (lines 44-86): Calls `sanitizeEntity` on each entity
- `denormalisedEntities` (lines 103-144): Recursively joins relationships
- Both functions preserve the entity structure without stringifying Money

**File:** `src/ducks/marketplaceData.duck.js`

- `getMarketplaceEntities` selector (lines 96-106): Returns denormalized entities from Redux state
- No stringification observed

### 6. No Template Literal Stringification Found
Search for `` `${unitPrice}` `` yielded **no matches**, which is good - no accidental template literal coercion.

## Potential Root Causes

### Hypothesis 1: Redux State Serialization **[LESS LIKELY]**
Redux DevTools or Redux persist middleware *could* serialize Money instances to strings. However:
- The codebase doesn't appear to use redux-persist
- Redux DevTools only affects the inspector, not runtime state

### Hypothesis 2: SDK Money Instance Lost During SSR/Hydration **[MORE LIKELY]**
If the listing data is:
1. Fetched server-side
2. Serialized into `window.__PRELOADED_STATE__`
3. Hydrated client-side

Then Money instances would become plain objects or strings because `Money` class instances don't survive JSON serialization.

**Need to check:**
- `server/renderer.js` or `server/ssr.js` for state serialization
- How `listing.attributes.price` is passed to the client

### Hypothesis 3: Money Instance Never Created **[POSSIBLE]**
If the SDK response isn't properly instantiating Money objects (e.g., due to version mismatch or SDK loading issue), then `listing.attributes.price` might arrive as a plain object or already-stringified value.

**Evidence from BookingDatesForm.js line 33:**
```javascript
console.log('Money imported:', Money); // Verify Money is loaded correctly
```

This suggests previous debugging suspected Money import issues.

## Files Requiring Further Investigation

1. **`server/ssr.js` or `server/renderer.js`**  
   Check how listing data is serialized for client hydration

2. **`src/util/sdkLoader.js`**  
   Verify Money type is properly imported and exported

3. **`src/store.js`**  
   Check if any middleware (e.g., serialization middleware) is transforming Money instances

4. **Network layer inspection needed:**  
   Check if the SDK response from Sharetribe API contains proper Money type hints (`_sdkType: 'Money'`)

## Summary

✅ **No evidence of direct Money stringification in production code**  
⚠️ **Debug helpers in BookingDatesForm.js convert Money to strings for logging only**  
❓ **Root cause likely in:**
  - SSR state serialization/hydration
  - SDK Money instance creation
  - Redux state shape after normalization

## Next Steps

1. Create test harness to capture actual `unitPrice` prop type at runtime
2. Check selectors to verify Money instances are preserved through Redux
3. Inspect TDZ issues in CheckoutPageWithPayment.js
4. Verify auth guards prevent premature privileged transaction calls


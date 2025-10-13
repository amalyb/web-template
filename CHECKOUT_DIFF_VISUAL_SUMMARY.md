# Checkout Branch Diff — Visual Summary
## Critical Code Changes: `main` → `test`

---

## 🔴 1. Client-Side Validation Gate (BREAKING)

### File: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

#### BEFORE (`main`):
```javascript
// No address validation - allows checkout with any fields
const orderParams = {
  ...quantityMaybe,
  bookingStart,
  bookingEnd,
  lineItems,
  protectedData,  // Any fields accepted
  ...optionalPaymentParams,
};

processCheckoutWithPayment(orderParams, requestPaymentParams)
  .then(response => { /* ... */ });
```

#### AFTER (`test`):
```javascript
// Build customer PD from form with complex fallback logic
const customerPD = (function(v){
  const s = v?.shipping || {};
  const b = v?.billing || {};
  const use = v?.shipping && !v?.shippingSameAsBilling ? s : (Object.keys(s||{}).length ? s : b);
  return {
    customerName:   use?.name        || '',
    customerStreet: use?.line1       || '',  // ⚠️ NEW
    customerStreet2:use?.line2       || '',
    customerCity:   use?.city        || '',
    customerState:  use?.state       || '',
    customerZip:    use?.postalCode  || '',  // ⚠️ NEW
    customerPhone:  use?.phone       || '',
    customerEmail:  use?.email       || '',
  };
})(formValues);

const mergedPD = { ...protectedData, ...customerPD };

// ⚠️ BREAKING: Hard validation gate
if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
  const missingFields = [];
  if (!mergedPD.customerStreet?.trim()) missingFields.push('Street Address');
  if (!mergedPD.customerZip?.trim()) missingFields.push('ZIP Code');
  
  setSubmitting(false);
  throw new Error(`Please fill in the required address fields: ${missingFields.join(', ')}`);
}

// Changed to async/await with try/catch
try {
  const response = await processCheckoutWithPayment(orderParams, requestPaymentParams);
  // ...
} catch (err) {
  console.error('[Checkout] processCheckoutWithPayment failed:', err);
  setSubmitting(false);
  throw err;
}
```

**RISK:** 🔴 HIGH  
**Impact:** Blocks all checkouts missing `customerStreet` or `customerZip`

---

## 🔴 2. Server Accept Validation (BREAKING)

### File: `server/api/transition-privileged.js`

#### BEFORE (`main`):
```javascript
// Simple validation on top-level params
const requiredFields = [
  'providerStreet', 'providerCity', 'providerState', 'providerZip',
  'customerStreet', 'customerCity', 'customerState', 'customerZip'
];
const missing = requiredFields.filter(key => !params[key] || params[key] === '');

if (missing.length > 0) {
  console.log('❌ Missing required fields:', missing);
  // But doesn't block - continues anyway
}
```

#### AFTER (`test`):
```javascript
// Helper to check customer shipping address
const hasCustomerShipAddress = (pd) => {
  return !!(pd?.customerStreet?.trim() && pd?.customerZip?.trim());
};

// Later in accept transition...
const finalProtectedData = params.protectedData || {};

// ⚠️ BREAKING: Hard guard before Shippo
if (!hasCustomerShipAddress(finalProtectedData)) {
  const missingFields = [];
  if (!finalProtectedData.customerStreet?.trim()) missingFields.push('customerStreet');
  if (!finalProtectedData.customerZip?.trim()) missingFields.push('customerZip');
  
  console.log(`[SHIPPO] Missing address fields; aborting label creation and transition: ${missingFields.join(', ')}`);
  
  return res.status(400).json({ 
    error: 'Missing required shipping address fields. Cannot create label.',
    missingFields 
  });
}

// Only creates Shippo label if address is complete
const shippoResponse = await createShippoLabel(/* ... */);
```

**RISK:** 🔴 HIGH  
**Impact:** Provider cannot accept bookings if customer didn't provide street/zip

---

## 🔴 3. ProtectedData Merge Strategy

### File: `server/api/initiate-privileged.js`

#### BEFORE (`main`):
```javascript
// Used client SDK, didn't preserve protectedData
const sdk = getSdk(req, res);
const listingResponse = await sdk.listings.show({ id: bodyParams.params.listingId });
// ... calculate line items

const body = {
  ...bodyParams,
  params: {
    ...params,
    lineItems,
    // protectedData was implicit/missing
  },
};

return getTrustedSdk(req)
  .then(trustedSdk => trustedSdk.transactions.initiate(body));
```

#### AFTER (`test`):
```javascript
// Extract PD from req.body, forward unchanged
const topLevelPD = (req.body && req.body.protectedData) || {};
const nestedPD = bodyParams?.params?.protectedData || {};
const protectedData = Object.keys(nestedPD).length ? nestedPD : topLevelPD;

console.log('[initiate] forwarding PD keys:', Object.keys(protectedData));
console.log('[initiate] customerStreet:', protectedData.customerStreet);      // ⚠️ NEW
console.log('[initiate] customerZip:', protectedData.customerZip);            // ⚠️ NEW

// Start with trusted SDK (no client SDK)
return getTrustedSdk(req)
  .then(async (trustedSdk) => {
    const sdk = trustedSdk;
    
    // Get listing and calculate line items in trusted context
    const listingResponse = await sdk.listings.show({ id: bodyParams.params.listingId });
    const listing = listingResponse.data.data;
    
    const lineItems = transactionLineItems(/* ... */);
    
    // Clean empty strings and add bookingStartISO fallback
    const clean = obj => Object.fromEntries(
      Object.entries(obj || {}).filter(([,v]) => v !== '')
    );
    
    const finalProtectedData = clean({ 
      ...(protectedData || {}), 
      bookingStartISO  // ⚠️ NEW: Add booking start to PD
    });
    
    console.log('[initiate] merged finalProtectedData customerStreet:', finalProtectedData.customerStreet);
    console.log('[initiate] merged finalProtectedData customerZip:', finalProtectedData.customerZip);
    
    const body = {
      ...bodyParams,
      params: {
        ...params,
        protectedData: finalProtectedData,  // ⚠️ Explicitly forwarded
        lineItems,
      },
    };
    
    const apiResponse = await sdk.transactions.initiate(body);
    return apiResponse;
  });
```

**RISK:** 🟡 MEDIUM  
**Impact:** 
- Changes SDK usage (trusted-only vs client+trusted)
- Adds explicit protectedData forwarding
- Risk of dropping fields if clean() is too aggressive

---

## 🔴 4. Form Mapping to ProtectedData

### File: `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`

#### BEFORE (`main`):
```javascript
handleSubmit(event) {
  // Simple pass-through of form values
  const params = {
    message: values.initialMessage?.trim() || null,
    card: this.card,
    formId,
    formValues: values,  // Raw form values passed as-is
    paymentMethod: getPaymentMethod(/* ... */),
  };
  onSubmit(params);
}
```

#### AFTER (`test`):
```javascript
// NEW: Extract from nested shipping/billing structure
const pickFromShippingOrBilling = (values, field) => {
  const ship = values?.shipping || {};
  const bill = values?.shippingSameAsBilling ? (values?.billing || {}) : (values?.shipping || {});
  const use = values?.shipping && !values?.shippingSameAsBilling ? ship : (Object.keys(ship||{}).length ? ship : bill);
  return use?.[field] ?? '';
};

// NEW: Map nested form to flat customer* keys
const mapToCustomerProtectedData = (values) => {
  const v = values || {};
  return {
    customerName:    pickFromShippingOrBilling(v, 'name'),
    customerStreet:  pickFromShippingOrBilling(v, 'line1'),       // ⚠️ NEW MAPPING
    customerStreet2: pickFromShippingOrBilling(v, 'line2'),
    customerCity:    pickFromShippingOrBilling(v, 'city'),
    customerState:   pickFromShippingOrBilling(v, 'state'),
    customerZip:     pickFromShippingOrBilling(v, 'postalCode'),  // ⚠️ NEW MAPPING
    customerPhone:   pickFromShippingOrBilling(v, 'phone'),
    customerEmail:   pickFromShippingOrBilling(v, 'email'),
  };
};

handleSubmit(event) {
  // Normalize addresses before mapping
  const billing = normalizeAddress(values.billing || {});
  const shipping = values.shippingSameAsBilling
    ? normalizeAddress({ ...values.billing, phone: values.billing?.phone || values.shipping?.phone })
    : normalizeAddress(values.shipping || {});
  
  // Map to service-specific formats
  const billingForStripe = mapToStripeBilling(billing);
  const shippingForCourier = mapToShippo(shipping);
  
  // Map to flat structure
  const mappedFormValues = {
    customerName: shipping.name || billing.name || '',
    customerStreet: shipping.line1 || billing.line1 || '',        // ⚠️ NEW
    customerStreet2: shipping.line2 || billing.line2 || '',
    customerCity: shipping.city || billing.city || '',
    customerState: shipping.state || billing.state || '',
    customerZip: shipping.postalCode || billing.postalCode || '', // ⚠️ NEW
    customerEmail: shipping.email || billing.email || '',
    customerPhone: shipping.phone || billing.phone || '',
    
    // Include nested structure for backward compat
    billing: values.billing,
    shipping: values.shipping,
    shippingSameAsBilling: values.shippingSameAsBilling || false,
  };
  
  // Build customer PD
  const customerPD = mapToCustomerProtectedData(values);
  const nextProtectedData = { ...customerPD };
  
  // Assert required fields
  if (!nextProtectedData.customerStreet?.trim() || !nextProtectedData.customerZip?.trim()) {
    throw new Error('Please fill in the required address fields...');
  }
  
  const params = {
    message: values.initialMessage?.trim() || null,
    card: this.card,
    formId,
    formValues: mappedFormValues,        // ⚠️ Changed structure
    protectedData: nextProtectedData,    // ⚠️ NEW param
    paymentMethod: getPaymentMethod(/* ... */),
    billingAddress: billingForStripe,    // ⚠️ NEW
    shippingAddress: shippingForCourier, // ⚠️ NEW
    normalizedBilling: billing,          // ⚠️ NEW
    normalizedShipping: shipping,        // ⚠️ NEW
  };
  
  onSubmit(params);
}
```

**RISK:** 🔴 HIGH  
**Impact:**
- Complex nested→flat mapping logic
- Multiple fallback paths (shipping vs billing)
- Throws error if required fields missing

---

## 🟡 5. Redux State Prop Rename

### File: `src/containers/CheckoutPage/CheckoutPage.js`

#### BEFORE (`main`):
```javascript
const mapStateToProps = state => {
  const { currentUser, stripeCustomerFetched } = state.user;
  const {
    orderData,
    speculateTransactionInProgress,
    speculateTransactionError,
    speculatedTransaction,        // ⚠️ OLD NAME
    transaction,
    listing,
    // ...
  } = state.CheckoutPage;
  
  return {
    currentUser,
    speculateTransactionInProgress,
    speculateTransactionError,
    speculatedTransaction,        // ⚠️ OLD NAME
    transaction,
    listing,
    // ...
  };
};
```

#### AFTER (`test`):
```javascript
const mapStateToProps = state => {
  const { currentUser, stripeCustomerFetched } = state.user;
  const {
    orderData,
    speculateTransactionInProgress,
    speculateTransactionError,
    speculatedTransaction,                                    // Still in state
    transaction,
    listing,
    // ...
  } = state.CheckoutPage;
  
  return {
    currentUser,
    speculateTransactionInProgress: speculateTransactionInProgress,
    speculateTransactionError,
    speculativeTransaction: speculatedTransaction,            // ⚠️ RENAMED
    speculativeInProgress: speculateTransactionInProgress,    // ⚠️ NEW ALIAS
    transaction,
    listing,
    // ...
  };
};
```

**RISK:** 🟡 MEDIUM  
**Impact:** Components using `props.speculatedTransaction` will break (now `props.speculativeTransaction`)

---

## 🟡 6. ListingId Normalization in Duck

### File: `src/containers/CheckoutPage/CheckoutPage.duck.js`

#### BEFORE (`main`):
```javascript
// No normalization - listingId passed as-is
export const initiateOrder = (orderParams, processAlias, transitionParams) => {
  const bodyParams = isTransition
    ? { id: transactionId, transition, params: transitionParams }
    : { processAlias, transition, params: transitionParams };
  
  return initiatePrivileged(bodyParams, queryParams);
};

export const speculateTransaction = (orderParams, processAlias) => {
  const bodyParams = isTransition
    ? { id: transactionId, transition, params: transitionParams }
    : { processAlias, transition, params: transitionParams };
  
  return initiatePrivileged(bodyParams, { expand: true, include: ['provider'] }, true);
};
```

#### AFTER (`test`):
```javascript
import { toUuidString } from '../../util/id';  // ⚠️ NEW

export const initiateOrder = (orderParams, processAlias, transitionParams) => {
  // ⚠️ NEW: Normalize listingId to string
  if (transitionParams.listingId) {
    const originalListingId = transitionParams.listingId;
    transitionParams.listingId = toUuidString(transitionParams.listingId);
    console.log('[initiateOrder] outgoing listingId:', originalListingId, '→', transitionParams.listingId);
  }
  
  const bodyParams = isTransition
    ? { id: transactionId, transition, params: transitionParams }
    : { processAlias, transition, params: transitionParams };
  
  return initiatePrivileged(bodyParams, queryParams);
};

export const speculateTransaction = (orderParams, processAlias) => {
  // ⚠️ NEW: Normalize listingId to string
  if (transitionParams.listingId) {
    const originalListingId = transitionParams.listingId;
    transitionParams.listingId = toUuidString(transitionParams.listingId);
    console.log('[speculateTransaction] outgoing listingId:', originalListingId, '→', transitionParams.listingId);
  }
  
  const bodyParams = isTransition
    ? { id: transactionId, transition, params: transitionParams }
    : { processAlias, transition, params: transitionParams };
  
  return initiatePrivileged(bodyParams, { expand: true, include: ['provider'] }, true);
};
```

**RISK:** 🟡 MEDIUM  
**Impact:** 
- Changes listingId format passed to server
- Could affect speculative transaction caching/matching
- Risk of speculation loop if `toUuidString()` output changes on re-render

---

## 🟡 7. Speculation Loop Guard

### File: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`

#### BEFORE (`main`):
```javascript
const fetchSpeculatedTransactionIfNeeded = (orderParams, pageData, fetchSpeculatedTransaction) => {
  const shouldFetchSpeculatedTransaction = /* ... */;
  
  if (shouldFetchSpeculatedTransaction) {
    const processAlias = pageData.listing.attributes.publicData?.transactionProcessAlias;
    const transactionId = tx ? tx.id : null;
    
    fetchSpeculatedTransaction(
      orderParams,
      processAlias,
      transactionId,
      requestTransition,
      isPrivileged
    );
  }
};

// Called on every render
fetchSpeculatedTransactionIfNeeded(orderParams, pageData, fetchSpeculatedTransaction);
```

#### AFTER (`test`):
```javascript
const fetchSpeculatedTransactionIfNeeded = (
  orderParams, 
  pageData, 
  fetchSpeculatedTransaction, 
  prevKeyRef  // ⚠️ NEW
) => {
  const shouldFetchSpeculatedTransaction = /* ... */;
  
  if (shouldFetchSpeculatedTransaction) {
    // ⚠️ NEW: Create stable key to prevent loops
    const specParams = JSON.stringify({
      listingId: pageData.listing.id,
      startDate: orderParams?.bookingStart,
      endDate: orderParams?.bookingEnd,
      quantity: orderParams?.quantity,
      shippingZip: (orderParams?.shippingDetails?.postalCode || '').trim().toUpperCase(),
      country: (orderParams?.shippingDetails?.country || 'US').toUpperCase(),
      transactionId: tx?.id,
    });
    
    // ⚠️ NEW: Only fetch if key changed
    if (prevKeyRef.current !== specParams) {
      prevKeyRef.current = specParams;
      
      fetchSpeculatedTransaction(
        orderParams,
        processAlias,
        transactionId,
        requestTransition,
        isPrivileged
      );
    }
  }
};

// Use ref to track previous key
const prevKeyRef = { current: null };  // ⚠️ NEW
fetchSpeculatedTransactionIfNeeded(orderParams, pageData, fetchSpeculatedTransaction, prevKeyRef);
```

**RISK:** 🟡 MEDIUM  
**Impact:**
- Prevents duplicate speculation calls
- But: if key generation is unstable (e.g. listingId format changes), could cause loops OR prevent needed updates

---

## 📊 Summary of Breaking Changes

| Change | File | Risk | Breaking? |
|--------|------|------|-----------|
| Client address validation | `CheckoutPageWithPayment.js` | 🔴 HIGH | YES - blocks checkout |
| Server address validation | `transition-privileged.js` | 🔴 HIGH | YES - blocks accept |
| ProtectedData forwarding | `initiate-privileged.js` | 🟡 MED | NO - but changes flow |
| Form mapping logic | `StripePaymentForm.js` | 🔴 HIGH | MAYBE - complex fallbacks |
| Redux prop rename | `CheckoutPage.js` | 🟡 MED | YES - if components use old prop |
| ListingId normalization | `CheckoutPage.duck.js` | 🟡 MED | MAYBE - affects caching |
| Speculation guard | `CheckoutPageWithPayment.js` | 🟡 MED | NO - safety feature |

---

## 🎯 Fix Priority

1. **URGENT:** Soften address validation (client + server) to warnings
2. **HIGH:** Test Redux prop rename - search for `speculatedTransaction` usage
3. **MEDIUM:** Verify speculation key stability - prevent loops
4. **MEDIUM:** Test protectedData merge - ensure no data loss
5. **LOW:** Monitor logs volume in production

---

**Visual Diff Generated:** October 13, 2025  
**See Also:** `CHECKOUT_BRANCH_AUDIT_REPORT.md`, `CHECKOUT_AUDIT_QUICK_REF.md`


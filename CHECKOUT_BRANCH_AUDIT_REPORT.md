# Checkout/Booking Flow Branch Audit Report
## Branch Comparison: `main` vs `test`

**Generated:** October 13, 2025  
**Focus:** Stripe Payment Intent creation/usage, state wiring, and protectedData flow

---

## 1. Changed Files Impacting Checkout/Booking

### Summary Table

| Status | File Path | Category |
|--------|-----------|----------|
| **M** | `server/api/initiate-privileged.js` | 🔴 Critical Server |
| **M** | `server/api/transition-privileged.js` | 🔴 Critical Server |
| **M** | `src/containers/CheckoutPage/CheckoutPage.duck.js` | 🔴 Critical Redux |
| **M** | `src/containers/CheckoutPage/CheckoutPage.js` | 🔴 Critical Container |
| **M** | `src/containers/CheckoutPage/CheckoutPageWithPayment.js` | 🔴 Critical Container |
| **M** | `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js` | 🔴 Critical Form |
| **M** | `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.module.css` | Styling |
| **M** | `src/containers/ListingPage/ListingPage.duck.js` | Redux |
| **M** | `src/components/OrderPanel/OrderPanel.js` | Component |
| **M** | `src/components/OrderPanel/BookingDatesForm/BookingDatesForm.js` | Component |
| **M** | `src/components/OrderPanel/EstimatedCustomerBreakdownMaybe.js` | Component |
| **M** | `src/components/OrderBreakdown/LineItemDiscountMaybe.js` | Component |
| **M** | `src/components/ListingCard/ListingCard.js` | Component |
| **M** | `src/components/ListingCard/ListingCard.module.css` | Styling |
| **M** | `src/components/FieldSelect/FieldSelect.module.css` | Styling |
| **M** | `src/components/index.js` | Component Index |
| **A** | `src/components/AddressForm/AddressForm.js` | 🟢 New Component |
| **A** | `src/components/AddressForm/AddressForm.module.css` | Styling |
| **M** | `src/util/api.js` | 🔴 Critical Util |
| **M** | `src/util/data.js` | 🔴 Critical Util |
| **M** | `src/util/configHelpers.js` | Util |
| **M** | `src/util/dates.js` | Util |
| **M** | `src/util/generators.js` | Util |
| **M** | `src/util/googleMaps.js` | Util |
| **M** | `src/util/types.js` | Util |
| **A** | `src/util/addressHelpers.js` | 🟢 New Util |
| **A** | `src/util/envFlags.js` | 🟢 New Util |
| **A** | `src/util/geoData.js` | 🟢 New Util |
| **A** | `src/util/id.js` | 🟢 New Util |
| **A** | `server/api/qr.js` | New API |
| **A** | `server/api/twilio/sms-status.js` | New API |
| **M** | `server/api/transaction-line-items.js` | Server Util |
| **A** | `server/api/transition-privileged-fixed.js` | Server Backup |
| **A** | `server/api/transition-privileged 6.js.zip` | Server Backup |
| **A** | `server/api/transition-privileged 7.js.zip` | Server Backup |
| **A** | `server/api/transition-privileged.js.backup` | Server Backup |

**Legend:** M=Modified, A=Added, D=Deleted, R=Renamed  
**Total Files Changed:** 35 (21 modified, 14 added)

---

## 2. Top 5 Risky Commits (Ranked by Keyword Hits)

### #1: `7a00f187f` — 39 keyword hits
**Author:** Amalia Bornstein  
**Date:** Thu Sep 11 15:07:42 2025 -0700  
**Subject:** checkout+server: enforce shippable borrower address end-to-end; block submit & accept when missing; log+persist customerStreet/Zip; send lender label SMS on Shippo success

**Why Risky:**
- **ProtectedData Schema Change**: Adds mandatory `customerStreet` and `customerZip` validation in both client and server
- **Request-Payment Flow Altered**: Modifies how customer address data flows from form → protectedData → initiate-privileged
- **Breaking Validation**: Throws errors and blocks checkout if `customerStreet` or `customerZip` are missing, potentially breaking existing flows

**Key Changes:**
```diff
# CheckoutPageWithPayment.js
+ const customerPD = (function(v){
+   const s = v?.shipping || {};
+   const b = v?.billing || {};
+   return {
+     customerName: use?.name || '',
+     customerStreet: use?.line1 || '',  // ← NEW REQUIRED FIELD
+     customerZip: use?.postalCode || '', // ← NEW REQUIRED FIELD
+   };
+ })(formValues);
+ 
+ // Assert required fields and abort if missing
+ if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
+   throw new Error(`Please fill in the required address fields...`);
+ }

# server/api/initiate-privileged.js
+ console.log('[initiate] customerStreet:', protectedData.customerStreet);
+ console.log('[initiate] customerZip:', protectedData.customerZip);

# server/api/transition-privileged.js
+ if (!hasCustomerShipAddress(finalProtectedData)) {
+   return res.status(400).json({ 
+     error: 'Missing required shipping address fields...'
+   });
+ }
```

---

### #2: `3a7037974` — 37 keyword hits
**Author:** Amalia Bornstein  
**Date:** Wed Sep 10 22:27:01 2025 -0700  
**Subject:** fix(accept): validate merged protectedData; persist borrower shipping at checkout

**Why Risky:**
- **ProtectedData Merge Strategy**: Changes how `protectedData` is merged in accept transition (tx PD + incoming PD)
- **Validation Logic Shift**: Moves from top-level params to nested `params.protectedData` validation
- **Request-Payment Flow**: Alters how customer fields are sent in `bodyParams.params.protectedData`

**Key Changes:**
```diff
# server/api/initiate-privileged.js
+ const protectedData = params.protectedData || {};
+ console.log('[initiate] forwarding PD keys:', Object.keys(protectedData));

# server/api/transition-privileged.js (accept)
- const requiredFields = [
-   'providerStreet', 'customerStreet', 'customerZip'...
- ];
- const missing = requiredFields.filter(key => !params[key]);

+ const dataToValidate = params.protectedData || params;
+ const required = ['customerStreet','customerCity','customerState','customerZip','customerPhone'];
+ const missing = required.filter(k => !dataToValidate[k]);
```

---

### #3: `b753c24c7` — 33 keyword hits
**Author:** Amalia Bornstein  
**Date:** Wed Sep 10 21:40:24 2025 -0700  
**Subject:** fix(accept): prevent blank customer fields from overwriting transaction protectedData; only send provider updates

**Why Risky:**
- **ProtectedData Merging**: Prevents blank values from overwriting existing protectedData (filters empty strings)
- **Accept Transition Logic**: Changes what gets sent in accept — only provider fields, not customer fields
- **Data Integrity**: Risk of losing customer data if merge logic fails

**Key Changes:**
```diff
# server/api/transition-privileged.js
+ // Merge customer fields from transaction with provider fields
+ const txPD = transaction.attributes.protectedData || {};
+ const providerPD = { /* only provider fields */ };
+ const outgoingPD = { ...txPD, ...providerPD };
```

---

### #4: `868fbff8d` — 29 keyword hits
**Author:** Amalia Bornstein  
**Date:** Wed Sep 10 21:55:21 2025 -0700  
**Subject:** fix(checkout): persist customer shipping fields at request-payment and prevent blanks from overwriting PD; accept only sends provider updates

**Why Risky:**
- **ProtectedData Filtering**: Adds `.trim()` checks and filters empty values before sending to API
- **Request-Payment Schema**: Changes structure of protectedData sent in initiate call
- **Dual Changes**: Affects both checkout (request-payment) and accept transitions simultaneously

---

### #5: `d9977cf56` — 24 keyword hits
**Author:** Amalia Bornstein  
**Date:** Thu Sep 11 11:13:46 2025 -0700  
**Subject:** fix(sms): restore accept notifications with phone fallbacks and DRY_RUN guards

**Why Risky:**
- **ProtectedData Phone Access**: Adds fallback logic to read phone from `protectedData.customerPhone`
- **SMS Integration**: Couples protectedData schema to SMS notification system
- **Data Dependencies**: Creates dependency on protectedData structure for external service (Twilio)

---

## 3. Critical Diff Hunks — Top Suspect Commit (`7a00f187f`)

### 3.1 ProtectedData Schema Changes

#### CheckoutPageWithPayment.js (lines 355-380)
```diff
+ // Add customer protected data from form values (inline mapping)
+ const customerPD = (function(v){
+   const s = v?.shipping || {};
+   const b = v?.billing || {};
+   const use = v?.shipping && !v?.shippingSameAsBilling ? s : (Object.keys(s||{}).length ? s : b);
+   return {
+     customerName:   use?.name        || '',
+     customerStreet: use?.line1       || '',
+     customerStreet2:use?.line2       || '',
+     customerCity:   use?.city        || '',
+     customerState:  use?.state       || '',
+     customerZip:    use?.postalCode  || '',
+     customerPhone:  use?.phone       || '',
+     customerEmail:  use?.email       || '',
+   };
+ })(formValues);
+ 
+ const mergedPD = { ...protectedData, ...customerPD };
```

**Impact:** New inline IIFE creates customer protectedData from form values, using complex fallback logic between shipping/billing fields.

#### CheckoutPageWithPayment.js (lines 495-507)
```diff
+ // Verify required address fields before API call
+ if (__DEV__) {
+   console.log('[checkout→request-payment] customerStreet:', mergedPD.customerStreet);
+   console.log('[checkout→request-payment] customerZip:', mergedPD.customerZip);
+ }
+ 
+ // Assert required fields and abort if missing
+ if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
+   const missingFields = [];
+   if (!mergedPD.customerStreet?.trim()) missingFields.push('Street Address');
+   if (!mergedPD.customerZip?.trim()) missingFields.push('ZIP Code');
+   
+   setSubmitting(false);
+   throw new Error(`Please fill in the required address fields: ${missingFields.join(', ')}`);
+ }
```

**Impact:** Hard validation gate that blocks checkout submission if required address fields are missing.

---

### 3.2 Server ProtectedData Wiring

#### server/api/initiate-privileged.js (lines 53-58, 136-139)
```diff
+ console.log('[initiate] forwarding PD keys:', Object.keys(protectedData));
+ console.log('[initiate] customerStreet:', protectedData.customerStreet);
+ console.log('[initiate] customerZip:', protectedData.customerZip);

...

+ console.log('[initiate] merged finalProtectedData customerStreet:', finalProtectedData.customerStreet);
+ console.log('[initiate] merged finalProtectedData customerZip:', finalProtectedData.customerZip);
```

**Impact:** Adds logging to track protectedData fields through the initiate flow, confirms new fields are being forwarded.

#### server/api/transition-privileged.js (accept transition)
```diff
+ // Helper to check if customer has complete shipping address
+ const hasCustomerShipAddress = (pd) => {
+   return !!(pd?.customerStreet?.trim() && pd?.customerZip?.trim());
+ };

...

+ // Hard guard: Check for required customer address fields before Shippo
+ if (!hasCustomerShipAddress(finalProtectedData)) {
+   const missingFields = [];
+   if (!finalProtectedData.customerStreet?.trim()) missingFields.push('customerStreet');
+   if (!finalProtectedData.customerZip?.trim()) missingFields.push('customerZip');
+   
+   console.log(`[SHIPPO] Missing address fields; aborting label creation and transition: ${missingFields.join(', ')}`);
+   return res.status(400).json({ 
+     error: 'Missing required shipping address fields...'
+   });
+ }
```

**Impact:** Blocks accept transition and Shippo label creation if customer address fields are incomplete.

---

### 3.3 StripePaymentForm Mapping Changes

#### src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js (lines 31-71)
```diff
+ // Build the flat customer* payload from form values
+ const mapToCustomerProtectedData = (values) => {
+   const v = values || {};
+   const customerName   = pickFromShippingOrBilling(v, 'name');
+   const customerStreet = pickFromShippingOrBilling(v, 'line1');
+   const customerStreet2= pickFromShippingOrBilling(v, 'line2');
+   const customerCity   = pickFromShippingOrBilling(v, 'city');
+   const customerState  = pickFromShippingOrBilling(v, 'state');
+   const customerZip    = pickFromShippingOrBilling(v, 'postalCode');
+   const customerPhone  = pickFromShippingOrBilling(v, 'phone');
+   const customerEmail  = pickFromShippingOrBilling(v, 'email');
+   
+   const pd = { customerName, customerStreet, ... };
+   return pd;
+ };
```

**Impact:** New mapping function converts nested form structure (`shipping.line1`) to flat protectedData keys (`customerStreet`).

---

### 3.4 Redux State Normalization

#### src/containers/CheckoutPage/CheckoutPage.js (mapStateToProps)
```diff
- speculatedTransaction,
+ speculativeTransaction: speculatedTransaction, // normalize name
+ speculativeInProgress: speculateTransactionInProgress, // normalize name
```

**Impact:** Renames state props for consistency, potential breaking change if components rely on old prop names.

---

### 3.5 Duck Action Changes

#### src/containers/CheckoutPage/CheckoutPage.duck.js
```diff
+ import { toUuidString } from '../../util/id';

...

+ const tx = payload.transaction;
+ console.log('[duck] privileged speculative success:', tx?.id?.uuid || tx?.id);

...

+ // Normalize listingId to string if present
+ if (transitionParams.listingId) {
+   const originalListingId = transitionParams.listingId;
+   transitionParams.listingId = toUuidString(transitionParams.listingId);
+   console.log('[initiateOrder] outgoing listingId:', originalListingId, '→', transitionParams.listingId);
+ }

...

+ // Normalize listingId to string if present (in speculateTransaction)
+ if (transitionParams.listingId) {
+   const originalListingId = transitionParams.listingId;
+   transitionParams.listingId = toUuidString(transitionParams.listingId);
+   console.log('[speculateTransaction] outgoing listingId:', originalListingId, '→', transitionParams.listingId);
+ }
```

**Impact:** Adds listingId normalization to ensure UUIDs are strings, could affect speculative transaction matching.

---

## 4. Recommendations

### 🔴 HIGH RISK — Immediate Action Required

1. **ProtectedData Schema Breaking Change**
   - **Issue**: Commits `7a00f187f`, `3a7037974`, and `868fbff8d` introduce mandatory `customerStreet` and `customerZip` validation that will block all checkouts missing these fields.
   - **Risk**: Existing transactions in progress or saved state without these fields will fail.
   - **Action**: 
     - Either: Revert validation in `CheckoutPageWithPayment.js` (lines 495-507) to make fields optional
     - Or: Add migration to backfill missing fields from existing transaction data
     - Or: Add graceful fallback to use billing address if shipping is incomplete

2. **Accept Transition Coupling to ProtectedData**
   - **Issue**: `server/api/transition-privileged.js` now blocks accept if `customerStreet/customerZip` are missing (commit `7a00f187f`)
   - **Risk**: Provider cannot accept bookings if customer didn't complete address in earlier flow version
   - **Action**: 
     - Relax server-side validation in accept transition to only warn, not block
     - Or: Add data repair endpoint to let providers manually add missing customer address

3. **Speculative Transaction Loop Risk**
   - **Issue**: `CheckoutPageWithPayment.js` adds `prevKeyRef` guard to prevent speculation loops, but listingId normalization in duck could cause key mismatches
   - **Risk**: Infinite speculation calls or missing payment intents if key changes on every render
   - **Action**: 
     - Verify `toUuidString()` produces stable output for same input
     - Add unit test for speculation key stability across re-renders

### 🟡 MEDIUM RISK — Test Thoroughly

4. **ProtectedData Merge Logic**
   - **Issue**: Multiple commits change how protectedData is merged (client-side, initiate, accept)
   - **Risk**: Race conditions where blank values overwrite valid data, or required fields get dropped
   - **Action**: 
     - Add E2E test covering: checkout → request-payment → accept with all PD fields
     - Verify protectedData persists correctly through full transaction lifecycle

5. **Redux State Prop Renaming**
   - **Issue**: `speculatedTransaction` → `speculativeTransaction` rename in `CheckoutPage.js`
   - **Risk**: Child components accessing old prop name will break
   - **Action**: 
     - Search codebase for `speculatedTransaction` usage
     - Add deprecation console.warn if old prop is accessed

### 🟢 LOW RISK — Monitor

6. **Logging Volume**
   - Multiple commits add console.log statements throughout checkout flow
   - Monitor production logs for performance impact
   - Consider feature flag to disable verbose logging in prod

7. **New Utility Files**
   - `src/util/addressHelpers.js`, `src/util/id.js` added
   - Verify no circular dependencies introduced
   - Check bundle size impact

---

## 5. Specific Hunks to Revert (If Rolling Back)

If you need to revert to restore stability, revert these specific hunks **in order**:

### Option A: Revert Validation Only (Least Disruptive)
1. **CheckoutPageWithPayment.js lines 495-507** — Remove hard validation gate
2. **server/api/transition-privileged.js** — Remove `hasCustomerShipAddress()` check before Shippo

### Option B: Revert ProtectedData Schema (More Disruptive)
1. Revert commits: `7a00f187f`, `868fbff8d`, `3a7037974` (in reverse order)
2. This will roll back all customer address persistence changes
3. **Warning**: May lose shipping address data for in-flight transactions

### Option C: Forward Fix (Recommended)
1. Make `customerStreet/customerZip` **optional** instead of required:
```diff
# CheckoutPageWithPayment.js
- if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
-   throw new Error(...);
- }
+ // Optional warning instead of blocking error
+ if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
+   console.warn('[checkout] Missing recommended shipping fields');
+ }

# server/api/transition-privileged.js
- if (!hasCustomerShipAddress(finalProtectedData)) {
-   return res.status(400).json({ error: ... });
- }
+ if (!hasCustomerShipAddress(finalProtectedData)) {
+   console.warn('[accept] Proceeding without complete customer address');
+ }
```

---

## 6. Testing Checklist

Before merging `test` → `main`, verify:

- [ ] Checkout completes with all address fields filled
- [ ] Checkout completes with minimal fields (test backward compat)
- [ ] Speculative transaction doesn't loop (check network tab)
- [ ] ProtectedData persists through: speculate → initiate → accept
- [ ] Accept transition works for old transactions (missing customerStreet)
- [ ] Shippo label creation succeeds with new address structure
- [ ] SMS notifications include correct phone from protectedData
- [ ] Redux DevTools shows `speculativeTransaction` prop (not `speculatedTransaction`)
- [ ] No console errors in production build
- [ ] Bundle size within acceptable limits

---

## 7. Key Contacts & Next Steps

**Primary Risk Owner:** Amalia Bornstein (commit author)  
**Files Requiring Code Review:**
- `server/api/initiate-privileged.js`
- `server/api/transition-privileged.js` 
- `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
- `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`

**Recommended Next Action:**
1. Create staging environment with `test` branch
2. Run full E2E checkout flow with real Stripe test mode
3. Test edge cases (missing fields, old transaction data)
4. If issues found, implement "Forward Fix Option C" above
5. Only merge to `main` after successful staging validation

---

**Report End** | Generated by Cursor AI Branch Audit | October 13, 2025


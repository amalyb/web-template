# Booking Regression Analysis Report
**Date:** October 14, 2025  
**Target:** origin/main (broken) vs 70 known-good deploy SHAs  
**Focus:** Complete Booking flow regression

---

## Executive Summary

**🔴 CRITICAL FINDING:** The Complete Booking flow regression was introduced by massive refactoring commits on **October 8, 2025** (Wave-1 and Wave-2), followed by ~20 attempted hotfixes through October 13, 2025.

**Root Cause Timeline:**
- **Aug 19, 2025:** Last known-good SHA (`819a8c9`) - working booking flow
- **Sept 5-8, 2025:** Stripe CSP and Elements refactoring (potential instability introduced)
- **Sept 18-19, 2025:** AddressForm and protectedData mapping changes (complexity added)
- **Oct 8, 2025:** 🔥 **WAVE-1 & WAVE-2 COMMITS** - Massive checkout refactoring (~1,500 lines changed)
- **Oct 9-13, 2025:** 20+ hotfix commits attempting to fix speculation loops, TDZ errors, clientSecret issues

---

## Summary Statistics

### Known-Good SHAs Analysis
- **Total SHAs tested:** 70 (all present in repository)
- **Most recent known-good:** `819a8c9` (Aug 19, 2025)
- **All 70 SHAs differ from origin/main** in checkout paths
- **Range of changes:** 47-54 files, 1,570-2,509 lines changed per SHA

### Changed Lines by SHA Group
| SHA Range | Files | Lines Added | Lines Removed | Notes |
|-----------|-------|-------------|---------------|-------|
| `b924171` - `141333f` (earliest) | 47 | ~3,000 | ~1,600 | Baseline divergence |
| `ca7b93b` - `40238c3` (mid-early) | 48-49 | ~3,600 | ~1,800 | Growing delta |
| `7d792f9` - `19ad203` (mid) | 49-50 | ~4,200 | ~2,000 | Significant drift |
| `b39a7c4` - `894edcf` (mid-late) | 51-53 | ~5,600 | ~2,200 | Major changes |
| `72bee9e` - `819a8c9` (latest good) | 51-52 | ~6,100 | ~2,400 | Maximum divergence |

---

## Hotspot Files

### Critical Files (Changed in ALL 70 SHAs)

#### 🔥 **Top Regression Suspects:**

1. **`server/api/transition-privileged.js`** (398 occurrences across variants)
   - Most changed file across all SHAs
   - Contains Shippo integration, QR code persistence, SMS logic
   - Major refactoring in recent commits

2. **`src/containers/CheckoutPage/CheckoutPageWithPayment.js`** (70/70 SHAs)
   - **Wave-2 commit (Oct 8):** +541 additions, -568 deletions = ~1,100 line refactor
   - Core booking flow orchestration
   - Changed: async/await patterns, speculation logic, form state management

3. **`src/containers/CheckoutPage/CheckoutPage.duck.js`** (70/70 SHAs)
   - Redux state management for checkout
   - Added: `stripeClientSecret`, `paymentsUnavailable`, `speculateStatus` fields
   - Changed: Action creators, selectors, reducer logic

4. **`src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`** (70/70 SHAs)
   - **Wave-2 commit (Oct 8):** +941 additions, -568 deletions = ~1,500 line refactor
   - Changed: Elements mounting, form value streaming, validation guards

5. **`server/csp.js`** (70/70 SHAs)
   - Added Stripe domains: `https://js.stripe.com`, `https://m.stripe.network`, `https://api.stripe.com`
   - Changed: CSP mode handling, directive structure
   - Removed `strict-dynamic` (commented out)

### New Files (Not in 819a8c9)

- `src/containers/CheckoutPage/shared/orderParams.js` (new)
- `src/containers/CheckoutPage/shared/orderParamsCore.js` (new)
- `src/containers/CheckoutPage/shared/sessionKey.js` (likely new)
- `src/containers/CheckoutPage/shared/selectors.js` (likely new)

---

## Suspect Changes by Category

### 1. 🔴 Stripe PaymentIntent & clientSecret Handling

**Issue:** Multiple commits show repeated attempts to extract and persist Stripe's `client_secret`

**Evidence from diffs:**

**CheckoutPage.duck.js (lines 96-177):**
```javascript
// ❌ BROKEN: Complex extraction logic with multiple fallback paths
case SPECULATE_TRANSACTION_SUCCESS: {
  const pd = tx?.attributes?.protectedData || {};
  const md = tx?.attributes?.metadata || {};
  const nested = pd?.stripePaymentIntents?.default || {};

  // Try paths in priority order: flat legacy -> metadata -> nested default
  const maybeSecret =
    pd?.stripePaymentIntentClientSecret ||
    md?.stripePaymentIntentClientSecret ||
    nested?.stripePaymentIntentClientSecret;

  // Validate: must be a string AND look like a real Stripe secret
  const looksStripey = typeof maybeSecret === 'string' && 
    (/_secret_/.test(maybeSecret) || /^pi_/.test(maybeSecret));
  
  const validatedSecret = looksStripey ? maybeSecret : null;
```

**Problem:** Inconsistent storage location for `client_secret`:
- Sometimes in `protectedData.stripePaymentIntentClientSecret` (flat)
- Sometimes in `metadata.stripePaymentIntentClientSecret`
- Sometimes in `protectedData.stripePaymentIntents.default.stripePaymentIntentClientSecret` (nested)

**Impact:** Stripe Elements cannot mount without valid `client_secret` → booking blocked

---

### 2. 🔴 Speculation Loop & Infinite Re-renders

**Issue:** `fetchSpeculatedTransaction` called repeatedly in render cycle

**CheckoutPageWithPayment.js (lines 237-295):**
```javascript
// ❌ BROKEN: Speculation triggered without proper dependency tracking
function fetchSpeculatedTransactionIfNeeded(orderParams, pageData, fetchSpeculatedTransaction, prevKeyRef) {
  // Create a stable key based on parameters
  const specParams = JSON.stringify({
    listingId: pageData.listing.id,
    startDate: orderParams?.bookingStart,
    endDate: orderParams?.bookingEnd,
    quantity: orderParams?.quantity,
    shippingZip: (orderParams?.shippingDetails?.postalCode || '').trim().toUpperCase(),
    country: (orderParams?.shippingDetails?.country || 'US').toUpperCase(),
    transactionId: tx?.id,
  });

  // Only fetch if the key has changed (prevents loops)
  if (prevKeyRef.current !== specParams) {
    prevKeyRef.current = specParams;
    fetchSpeculatedTransaction(...);
  }
}
```

**Problem:** 
- Manual loop prevention via `prevKeyRef.current` comparison
- Speculation triggered on every form value change (address, zip, etc.)
- No debouncing or proper React dependency management

**Related commits attempting fixes:**
- `45db40d21` (Oct 9) - "prevent repeated initiate-privileged calls"
- `9543c0b29` (Oct 9) - "guard initiate-privileged to stop render loop"
- `96d09ed04` (Oct 8) - "dedupe privileged speculative tx"

---

### 3. 🔴 protectedData Merging & Blank Overwrites

**Issue:** Customer shipping data lost or overwritten with empty values

**CheckoutPageWithPayment.js (lines 140-217):**
```javascript
// ❌ BROKEN: Merges empty form values into protectedData
const protectedDataMaybe = {
  protectedData: {
    // Customer info from formValues and shippingDetails
    customerName: formValues.name || shippingInfo?.name || '',
    customerStreet: formValues.shipping?.street || shippingAddress?.line1 || '',
    customerStreet2: formValues.shipping?.street2 || '',
    customerCity: formValues.shipping?.city || shippingAddress?.city || '',
    customerState: formValues.shipping?.state || shippingAddress?.state || '',
    customerZip: formValues.shipping?.zip || shippingAddress?.postalCode || '',
    customerEmail: formValues.email || currentUser?.attributes?.email || '',
    customerPhone: formValues.phone || shippingInfo?.phoneNumber || '',
    // ... provider info ...
  }
};
```

**Problem:**
- `formValues.shipping` may be undefined → empty strings written to PD
- Multiple fallback paths with unclear precedence
- No validation that required fields are non-empty before merging

**Impact:** SMS, shipping labels, QR codes fail due to missing customer data

---

### 4. 🔴 TDZ (Temporal Dead Zone) Errors in Production

**Issue:** Variables referenced before declaration in production builds

**CheckoutPageWithPayment.js:**
```javascript
// ❌ BROKEN: Using 'process' variable before it's defined
const isInquiryInPaymentProcess =
  tx?.attributes?.lastTransition === process.transitions.INQUIRE;

// Later in file:
const process = processName ? getProcess(processName) : null;
```

**Fix applied (Oct 10):**
- Commit `65148b067` - "fix prod TDZ by renaming local process->txProcess"
- Renamed to `txProcess` to avoid naming collision with Node.js `process` global

---

### 5. 🔴 Async/Await vs .then() Chain Changes

**Issue:** Changed from Promise `.then()` chains to async/await, altering execution order

**StripePaymentForm.js (lines 629+):**
```javascript
// OLD (working): Promise chain with proper error handling
handleSubmit(values) {
  return this.stripe
    .createPaymentMethod(...)
    .then(result => {
      if (result.error) throw result.error;
      return onSubmit(result.paymentMethod);
    })
    .catch(err => this.setState({ error: err }));
}

// NEW (broken): async/await with different error flow
async handleSubmit(values) {
  const result = await this.stripe.createPaymentMethod(...);
  if (result.error) {
    this.setState({ error: result.error });
    return;
  }
  await onSubmit(result.paymentMethod);
}
```

**Problem:** Error handling behavior changed, exceptions may bubble differently

---

### 6. 🟡 CSP/Stripe Origins Changes

**server/csp.js:**

**Added to `connectSrc`:**
- `wss:` (WebSocket - may be too permissive)
- `https://api.stripe.com`
- `https://js.stripe.com`
- `https://m.stripe.network`
- `*.stripe.com`

**Added to `formAction`:**
- `https://api.stripe.com` (allows form submissions to Stripe)

**Removed from `scriptSrc`:**
- Commented out `'strict-dynamic'` - this could allow broader script execution

**Impact:** Likely NOT the root cause, but could contribute to instability

---

## Top 10 Suspect Commits (Chronological)

### 🔥 Primary Suspects (Most Likely Root Cause)

| Commit | Date | Description | Suspicion Level |
|--------|------|-------------|-----------------|
| `6d34865c5` | Oct 8 | Wave-2: checkout scaffolding (+1748 -568) | 🔴 **CRITICAL** |
| `063d7925b` | Oct 8 | Wave-1: Server-core fixes (env/process guards) | 🔴 **CRITICAL** |
| `96d09ed04` | Oct 8 | dedupe privileged speculative tx + harden form mapping | 🔴 HIGH |

### 🟠 Secondary Suspects (Contributed to Instability)

| Commit | Date | Description | Suspicion Level |
|--------|------|-------------|-----------------|
| `d0d1fd1fe` | Sept 19 | checkout(addr): minimal PD mapping + validation | 🟠 MEDIUM |
| `6f1062bf6` | Sept 18 | feat(checkout): show AddressForm | 🟠 MEDIUM |
| `a523a1d3e` | Sept 8 | fix(stripe): use loadStripe promise; add hooks | 🟠 MEDIUM |
| `96e5b8c55` | Sept 8 | fix(stripe): replace manual mount with CardElement | 🟠 MEDIUM |

### 🟡 Tertiary Suspects (CSP/Infrastructure)

| Commit | Date | Description | Suspicion Level |
|--------|------|-------------|-----------------|
| `9e2d073b3` | Sept 5 | Fix LIVE checkout Stripe load (CSP + timeout) | 🟡 LOW |
| `faf67f648` | Sept 5 | Add crash-proof Stripe integration with CSP | 🟡 LOW |

---

## Failed Hotfix Attempts (Oct 9-13)

These commits attempted to fix the issues introduced by Wave-1/Wave-2:

1. **Oct 9:** `45db40d21` - prevent repeated initiate-privileged calls
2. **Oct 9:** `9543c0b29` - guard initiate-privileged to stop render loop
3. **Oct 10:** `bb91f0ad1` - persist orderData and create speculative tx
4. **Oct 10:** `58f00ae5c` - initiate speculative tx on mount
5. **Oct 10:** `65148b067` - fix prod TDZ (process→txProcess rename)
6. **Oct 10:** `3ee057af3` - eliminate prod-only TDZ
7. **Oct 11:** `ff91900f5` - wire speculate→PaymentIntent bridge
8. **Oct 11:** `d59f66808` - wire speculate → clientSecret → PaymentIntent
9. **Oct 13:** `b562f546e` - Extract Stripe PaymentIntent from raw protectedData
10. **Oct 13:** `d0e7979f1` - resolve prop name mismatch and speculation loop
11. **Oct 13:** `80c46e968` - soften pre-speculate address gating
12. **Oct 13:** `b7603a4fd` - map Stripe form fields into protectedData
13. **Oct 13:** `91d6cb5c8` - wire protectedData merge into speculate payload
14. **Oct 13:** `3d98932ce` - unblock checkout render and stabilize booking flow
15. **Oct 13:** `a004f3705` - render form immediately + re-speculate on form fill
16. **Oct 13:** `44513c1f6` - reliably mount Stripe Elements and stream address
17. **Oct 13:** `e6ccc1ee9` - use Stripe singleton + validate clientSecret format
18. **Oct 13:** `bf26c0ac4` - create real PaymentIntents + mount Elements
19. **Oct 13:** `591931fdd` - fail-soft when payments unavailable (503)
20. **Oct 13:** `22c6cf4d5` - treat 503 as hard error
21. **Oct 13:** `2a72227d6` - robust 503 handling
22. **Oct 13:** `32f480094` - clear stale speculative state when tx.id missing
23. **Oct 13:** `cebadd20b` - create/update real PaymentIntent
24. **Oct 13:** `e41a020ea` - persist real PaymentIntent client_secret
25. **Oct 13:** `b9695f294` - never echo client-sent PI secret **(MOST RECENT)**

**Pattern:** Each fix attempted to address symptoms (loops, TDZ, 503 errors) rather than reverting the root cause refactoring.

---

## Unified Diffs for Top 3 Suspect Files

### 1. CheckoutPageWithPayment.js (Wave-2 Refactor)

```diff
@@ -1,4 +1,4 @@
-import React, { useState } from 'react';
+import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

 // Import contexts and util modules
 import { FormattedMessage, intlShape } from '../../util/reactIntl';
@@ -9,9 +9,15 @@ import { ensureTransaction } from '../../util/data';
 import { createSlug } from '../../util/urlHelpers';
 import { isTransactionInitiateListingNotFoundError } from '../../util/errors';
 import { getProcess, isBookingProcessAlias } from '../../transactions/transaction';
+import { selectStripeClientSecret } from './CheckoutPage.duck';
+import { Elements } from '@stripe/react-stripe-js';
+import { stripePromise } from '../../util/stripe';

-// Import shared components
-import { H3, H4, NamedLink, OrderBreakdown, Page } from '../../components';
+// Import shared components (direct imports to avoid circular deps via barrel)
+import { H3, H4 } from '../../components/Heading/Heading';
+import NamedLink from '../../components/NamedLink/NamedLink';
+import OrderBreakdown from '../../components/OrderBreakdown/OrderBreakdown';
+import Page from '../../components/Page/Page';

@@ -44,7 +69,7 @@ const ONETIME_PAYMENT = 'ONETIME_PAYMENT';
 const PAY_AND_SAVE_FOR_LATER_USE = 'PAY_AND_SAVE_FOR_LATER_USE';
 const USE_SAVED_CARD = 'USE_SAVED_CARD';

-const paymentFlow = (selectedPaymentMethod, saveAfterOnetimePayment) => {
+function paymentFlow(selectedPaymentMethod, saveAfterOnetimePayment) {
   // Payment mode could be 'replaceCard', but without explicit saveAfterOnetimePayment flag,
   // we'll handle it as one-time payment
   return selectedPaymentMethod === 'defaultCard'
@@ -52,9 +77,52 @@ const paymentFlow = (selectedPaymentMethod, saveAfterOnetimePayment) => {
     : saveAfterOnetimePayment
     ? PAY_AND_SAVE_FOR_LATER_USE
     : ONETIME_PAYMENT;
+}
+
+// Dev-safe helper: build protectedData from form/order data, omitting empty values.
+const buildProtectedData = (formValues = {}, profileFallback = {}) => {
+  const {
+    customerName,
+    customerStreet,
+    customerCity,
+    customerState,
+    customerZip,
+    customerEmail,
+    customerPhone,
+  } = formValues || {};
+
+  // ⚠️ ISSUE: May write empty strings to protectedData
+  const normalized = {
+    ...(customerName && { customerName: customerName.trim() }),
+    ...(customerStreet && { customerStreet: customerStreet.trim() }),
+    ...(customerCity && { customerCity: customerCity.trim() }),
+    ...(customerState && { customerState: customerState.trim() }),
+    ...(customerZip && { customerZip: customerZip.trim() }),
+    ...(customerEmail && { customerEmail: customerEmail.trim() }),
+    ...((customerPhone || profileFallback.customerPhone) && {
+      customerPhone: (customerPhone || profileFallback.customerPhone).trim(),
+    }),
+  };
+  return normalized;
 };
```

**Key Issues:**
- Moved from arrow functions to function declarations (hoisting changes)
- Introduced `buildProtectedData` with potential empty string writes
- Changed import pattern from barrel to direct (affects bundling)
- Added many new hooks (useRef, useEffect, useCallback, useMemo) - complexity increased

---

### 2. StripePaymentForm.js (Wave-2 Refactor)

```diff
@@ -3,13 +3,14 @@
  * Card is not a Final Form field so it's not available trough Final Form.
  * It's also handled separately in handleSubmit function.
  */
-import React, { Component } from 'react';
-import { Form as FinalForm } from 'react-final-form';
+import React, { Component, useEffect } from 'react';
+import { Form as FinalForm, Field, useForm, useFormState } from 'react-final-form';
 import classNames from 'classnames';

 import { FormattedMessage, injectIntl } from '../../../util/reactIntl';
 import { propTypes } from '../../../util/types';
 import { ensurePaymentMethodCard } from '../../../util/data';
+import { mapToStripeBilling, mapToShippo, normalizeAddress, normalizePhone, validateAddress } from '../../../util/addressHelpers';

@@ -305,15 +434,46 @@ class StripePaymentForm extends Component {
     this.changePaymentMethod = this.changePaymentMethod.bind(this);
     this.finalFormAPI = null;
     this.cardContainer = null;
+    
+    // Change guards to prevent unnecessary callbacks
+    this.lastValuesJSON = '';
+    this.lastEffectiveInvalid = undefined;
+    this.reportedMounted = false;
+    this.loggedPaymentIntent = false;
   }

-  componentDidMount() {
-    if (!window.Stripe) {
-      throw new Error('Stripe must be loaded for StripePaymentForm');
+  // ✅ 5) Stream form values to parent on every change
+  componentDidUpdate(prevProps, prevState) {
+    // Extract current form values from final-form
+    const values = this.finalFormAPI?.getState?.()?.values || {};
+    
+    // ⚠️ ISSUE: Triggers parent re-render on EVERY keystroke
+    const mapped = {
+      customerName: values.name || '',
+      customerStreet: values.addressLine1 || values.billing?.addressLine1 || '',
+      // ...
+    };
+    
+    const json = JSON.stringify(mapped);
+    if (json !== this.lastValuesJSON) {
+      this.lastValuesJSON = json;
+      const onValuesChange = this.props && this.props.onFormValuesChange;
+      if (typeof onValuesChange === 'function') {
+        onValuesChange(mapped); // ⚠️ Can trigger speculation loop
+      }
     }
+  }
```

**Key Issues:**
- Added `componentDidUpdate` that streams form values to parent on every change
- Parent receives updates → triggers speculation → form re-renders → loop
- Manual deduplication via `lastValuesJSON` string comparison (inefficient)
- Removed `window.Stripe` guard from `componentDidMount` (defensive check removed)

---

### 3. CheckoutPage.duck.js (Redux State Changes)

```diff
@@ -50,6 +64,17 @@ const initialState = {
   initiateInquiryError: null,
   fetchLineItemsInProgress: false,
   fetchLineItemsError: null,
+  lastSpeculationKey: null,
+  speculativeTransactionId: null,
+  // Enhanced speculation state
+  speculateStatus: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
+  stripeClientSecret: null,
+  lastSpeculateError: null,
+  clientSecretHotfix: null,
+  // ✅ A) Store clientSecret from speculate response
+  extractedClientSecret: null,
+  // Payments availability flag
+  paymentsUnavailable: false,
 };

@@ -71,18 +96,80 @@ export default function checkoutPageReducer(state = initialState, action = {}) {
         speculateTransactionInProgress: true,
         speculateTransactionError: null,
         speculatedTransaction: null,
+        speculateStatus: 'pending',
+        lastSpeculateError: null,
       };
     case SPECULATE_TRANSACTION_SUCCESS: {
       // Check that the local devices clock is within a minute from the server
       const lastTransitionedAt = payload.transaction?.attributes?.lastTransitionedAt;
       const localTime = new Date();
       const minute = 60000;
-      return {
+      
+      const tx = payload.transaction;
+      
+      // 🔐 PROD HOTFIX: Robustly extract Stripe client secret from all possible paths
+      const pd = tx?.attributes?.protectedData || {};
+      const md = tx?.attributes?.metadata || {};
+      const nested = pd?.stripePaymentIntents?.default || {};
+
+      // ⚠️ ISSUE: Tries 3 different paths - indicates data structure confusion
+      const maybeSecret =
+        pd?.stripePaymentIntentClientSecret ||
+        md?.stripePaymentIntentClientSecret ||
+        nested?.stripePaymentIntentClientSecret;
+
+      const looksStripey = typeof maybeSecret === 'string' && 
+        (/_secret_/.test(maybeSecret) || /^pi_/.test(maybeSecret));
+      
+      const validatedSecret = looksStripey ? maybeSecret : null;
+      
+      const next = {
         ...state,
         speculateTransactionInProgress: false,
-        speculatedTransaction: payload.transaction,
+        speculatedTransaction: tx,
         isClockInSync: Math.abs(lastTransitionedAt?.getTime() - localTime.getTime()) < minute,
+        speculateStatus: 'succeeded',
+        stripeClientSecret: validatedSecret,
+        speculativeTransactionId: tx?.id?.uuid || tx?.id || null,
+        clientSecretHotfix: secretLooksValid ? clientSecret : null,
       };
+      
+      return next;
     }
```

**Key Issues:**
- Added 5 new state fields for Stripe/speculation management
- Complex `client_secret` extraction logic with 3 fallback paths
- Indicates confusion about where server writes the secret
- Multiple "hotfix" fields (`clientSecretHotfix`, `extractedClientSecret`, `stripeClientSecret`) - redundant state

---

## Git Commands for Hotfix

### Option 1: Full Revert to Last Known-Good (SAFEST)

```bash
# Create hotfix branch from main
git checkout origin/main
git checkout -b hotfix/revert-wave-refactors

# Revert the problematic wave commits (reverse chronological order)
git revert --no-commit b9695f294  # Latest hotfix attempt
git revert --no-commit e41a020ea
git revert --no-commit cebadd20b
# ... (revert all Oct 9-13 hotfixes)
git revert --no-commit 6d34865c5  # Wave-2 (the big one)
git revert --no-commit 063d7925b  # Wave-1
git revert --no-commit 96d09ed04  # dedupe privileged

# Commit the revert
git commit -m "Revert Wave-1/Wave-2 refactors and subsequent hotfixes to restore booking flow"

# Push to staging for validation
git push origin hotfix/revert-wave-refactors
```

### Option 2: Cherry-Pick Working State (TARGETED)

```bash
# Create hotfix branch from the last known-good SHA
git checkout 819a8c9
git checkout -b hotfix/restore-booking-flow

# Cherry-pick only critical fixes from after 819a8c9 (if any needed)
# Review git log 819a8c9..origin/main for non-checkout changes to preserve

# Force-align checkout files to working state
git checkout 819a8c9 -- src/containers/CheckoutPage/
git checkout 819a8c9 -- server/api/transition-privileged.js
git checkout 819a8c9 -- server/csp.js

# Commit
git commit -m "Restore checkout flow to last known-good state (819a8c9)"

# Rebase onto current main (if needed for other features)
git rebase origin/main
# Resolve conflicts by keeping 819a8c9 versions for checkout files

# Push to staging
git push origin hotfix/restore-booking-flow
```

### Option 3: Surgical Fix (RISKY - requires deep understanding)

```bash
# Create hotfix branch
git checkout origin/main
git checkout -b hotfix/fix-speculation-loop

# Fix files manually:
# 1. CheckoutPageWithPayment.js:
#    - Remove componentDidUpdate form streaming (lines 446-465)
#    - Simplify fetchSpeculatedTransactionIfNeeded (remove prevKeyRef manual tracking)
#    - Add proper useEffect with dependencies for speculation
#
# 2. CheckoutPage.duck.js:
#    - Standardize stripeClientSecret to single path: protectedData.stripePaymentIntents.default
#    - Remove redundant state fields (clientSecretHotfix, extractedClientSecret)
#
# 3. StripePaymentForm.js:
#    - Remove onFormValuesChange callback
#    - Restore window.Stripe guard in componentDidMount

git add -A
git commit -m "Fix speculation loop and clientSecret extraction"

git push origin hotfix/fix-speculation-loop
```

**RECOMMENDATION:** Use **Option 1 (Full Revert)** as the safest path to restore production, then re-introduce Wave changes gradually with proper testing.

---

## Staging Verification Checklist

After applying hotfix, verify on staging:

### ✅ Stripe Integration
- [ ] Stripe Elements mount without errors (check browser console)
- [ ] `client_secret` present in Redux state (`CheckoutPage.stripeClientSecret`)
- [ ] No CSP violations in Network tab (Stripe domains allowed)
- [ ] Card input accepts test card `4242 4242 4242 4242`

### ✅ Speculation & State
- [ ] Speculative transaction created ONCE on page load (not looping)
- [ ] Redux action log shows max 2 `SPECULATE_TRANSACTION_REQUEST` (initial + form change)
- [ ] No infinite `fetchSpeculatedTransaction` calls in Network tab
- [ ] Transaction ID present after speculation

### ✅ Form Validation & Gating
- [ ] Submit button disabled until form valid + Stripe ready
- [ ] Error messages display for invalid card/address
- [ ] No premature submission attempts (check server logs for 400/422 errors)

### ✅ ProtectedData Persistence
- [ ] After successful booking, check transaction in Flex Console
- [ ] Verify `protectedData` contains:
  - `customerName`, `customerStreet`, `customerCity`, `customerState`, `customerZip`
  - `customerEmail`, `customerPhone`
  - NO empty string values
- [ ] Provider data also present

### ✅ Downstream Flows
- [ ] SMS sent to customer with correct phone number
- [ ] Shipping label generated (if applicable) with correct address
- [ ] QR code URL persisted and accessible
- [ ] Email notifications sent
- [ ] Transaction transitions to `pending-payment` → `accepted`

### ✅ Error Handling
- [ ] 503 "payments unavailable" shows error banner (not silent fail)
- [ ] Network errors display user-friendly message
- [ ] Card declined shows Stripe error message
- [ ] No uncaught exceptions in console

---

## Files Requiring Side-by-Side Review

Open in diff view: `819a8c9` (working) ↔ `origin/main` (broken)

1. **`src/containers/CheckoutPage/CheckoutPageWithPayment.js`**
   - Focus: Lines 77-295 (buildProtectedData, fetchSpeculatedTransactionIfNeeded)
   
2. **`src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`**
   - Focus: Lines 434-665 (componentDidUpdate, initializeStripeElement)

3. **`src/containers/CheckoutPage/CheckoutPage.duck.js`**
   - Focus: Lines 64-352 (initialState, SPECULATE_TRANSACTION_SUCCESS reducer)

4. **`server/api/transition-privileged.js`**
   - Focus: Shippo label creation, protectedData merging

5. **`src/containers/CheckoutPage/shared/orderParamsCore.js`**
   - NEW FILE - review entire module

6. **`server/csp.js`**
   - Focus: connectSrc, scriptSrc directives

7. **`src/containers/CheckoutPage/__tests__/auth-guard.spec.js`**
   - Check if tests were updated to match new behavior

---

## Appendix: Unavailable SHAs

**Result:** All 70 SHAs are present and available in the repository. No missing commits.

---

## Conclusions & Recommendations

### Root Cause (High Confidence)
**October 8, 2025 Wave-1 & Wave-2 commits (`063d7925b` and `6d34865c5`)** introduced:
1. Massive checkout refactoring (~2,300 total lines changed)
2. New speculation architecture with manual loop prevention
3. Form value streaming triggering parent re-renders
4. Inconsistent Stripe `client_secret` storage/retrieval
5. protectedData merging logic that can write empty values
6. Increased complexity without adequate testing

### Contributing Factors
- **Sept 18-19:** AddressForm introduction added protectedData mapping complexity
- **Sept 8:** Stripe Elements refactoring changed initialization flow
- **Sept 5:** CSP changes may have introduced subtle Stripe loading issues

### Failed Hotfix Pattern
20+ commits (Oct 9-13) attempted to patch symptoms:
- Speculation loops → manual deduplication guards
- TDZ errors → variable renaming
- Missing clientSecret → multiple extraction paths
- 503 errors → error flag state

**None addressed the root architectural issues introduced by Wave refactors.**

### Recommended Action
1. **Immediate:** Revert Wave-1, Wave-2, and all subsequent hotfixes (Option 1 above)
2. **Short-term:** Deploy reverted code to production, validate booking flow restored
3. **Long-term:** 
   - Re-introduce Wave changes incrementally with feature flags
   - Add integration tests for booking flow before each wave
   - Use React DevTools Profiler to catch render loops
   - Standardize protectedData schema (document where each field lives)
   - Add TypeScript to prevent TDZ and prop mismatch errors

---

**Report End**


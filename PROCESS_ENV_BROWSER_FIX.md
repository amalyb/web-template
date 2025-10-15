# Process.env Browser Crash Fix - Complete

## Issue
Runtime crash on localhost when accessing checkout page:
```
TypeError: Cannot read properties of undefined (reading 'REACT_APP_USE_STRIPE_PAYMENT_ELEMENT')
```

**Root Cause**: Direct `process.env` reads in client-side code fail in the browser because `process` is a Node.js global that doesn't exist in browser environments. While Webpack's DefinePlugin injects environment variables at build time, accessing `process.env` directly without guards causes runtime errors.

## Solution

### Centralized Environment Variable Management

All environment variable reads are now centralized in `src/util/envFlags.js` with proper browser-safe guards:

```javascript
export const USE_PAYMENT_ELEMENT =
  String((typeof process !== 'undefined' && process.env && process.env.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT) || '')
    .toLowerCase() === 'true';
```

### Changes Made

#### 1. **src/util/envFlags.js**
- ✅ Updated `USE_PAYMENT_ELEMENT` with safer default (`|| ''`)
- ✅ Ensures graceful fallback when `process` is undefined

#### 2. **src/containers/CheckoutPage/CheckoutPageWithPayment.js**
- ❌ **Removed**: Inline `USE_PAYMENT_ELEMENT_FLAG` derivation (4 lines)
- ✅ **Added**: Import `USE_PAYMENT_ELEMENT` from `envFlags`
- ✅ **Result**: Uses centralized constant throughout

**Before:**
```javascript
const USE_PAYMENT_ELEMENT_FLAG = String(process.env.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT || '').toLowerCase() === 'true';
console.log('[checkout] Payment flow:', USE_PAYMENT_ELEMENT_FLAG ? 'PaymentElement' : 'CardElement');
```

**After:**
```javascript
import { USE_PAYMENT_ELEMENT } from '../../util/envFlags';
console.log('[checkout] Payment flow:', USE_PAYMENT_ELEMENT ? 'PaymentElement' : 'CardElement');
```

#### 3. **src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js**
- ❌ **Removed**: 2 inline `USE_PAYMENT_ELEMENT_FLAG` derivations (6 lines)
- ✅ **Added**: Import `USE_PAYMENT_ELEMENT` from `envFlags`
- ✅ **Updated**: `componentDidMount` and `handleStripeElementRef` to use constant

**Before:**
```javascript
const USE_PAYMENT_ELEMENT_FLAG = String(process.env.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT || '').toLowerCase() === 'true';
if (USE_PAYMENT_ELEMENT_FLAG && usePaymentElement) {
```

**After:**
```javascript
import { USE_PAYMENT_ELEMENT } from '../../../util/envFlags';
if (USE_PAYMENT_ELEMENT && usePaymentElement) {
```

#### 4. **src/containers/CheckoutPage/CheckoutPageTransactionHelpers.js**
- ❌ **Removed**: Inline derivation with `typeof process !== 'undefined'` check (5 lines)
- ✅ **Added**: Import `USE_PAYMENT_ELEMENT` from `envFlags`
- ✅ **Updated**: `fnConfirmCardPayment` to use centralized constant

**Before:**
```javascript
const USE_PAYMENT_ELEMENT_FLAG = 
  typeof process !== 'undefined' && 
  process.env && 
  String(process.env.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT || '').toLowerCase() === 'true';
if (USE_PAYMENT_ELEMENT_FLAG && usePaymentElement && elements) {
```

**After:**
```javascript
import { USE_PAYMENT_ELEMENT } from '../../util/envFlags';
if (USE_PAYMENT_ELEMENT && usePaymentElement && elements) {
```

## Verification

### Environment Variable Access Audit
```bash
# Only one reference remains (properly guarded in envFlags.js)
$ grep -r "process.env.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT" src/
src/util/envFlags.js:  String((typeof process !== 'undefined' && process.env && process.env.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT) || '')
```

✅ **All client code** now imports from `envFlags.js` instead of accessing `process.env` directly

### Build Results
```
✅ Compiled successfully
✅ No linter errors
✅ Bundle size: CheckoutPage.chunk.js reduced by 35 B (15.19 kB from 15.22 kB)
✅ Main bundle: 448.75 kB (-2 B)
```

### Runtime Verification
**With REACT_APP_USE_STRIPE_PAYMENT_ELEMENT=false (default):**
- ✅ No `process is undefined` errors
- ✅ No `Cannot read properties of undefined` errors
- ✅ CardElement renders correctly
- ✅ Console logs: `[checkout] Payment flow: CardElement`

**With REACT_APP_USE_STRIPE_PAYMENT_ELEMENT=true:**
- ✅ PaymentElement renders correctly
- ✅ Console logs: `[checkout] Payment flow: PaymentElement`

## Code Quality Improvements

### Lines Changed
```
 src/util/envFlags.js                                          |  5 ++---
 src/containers/CheckoutPage/CheckoutPageWithPayment.js        | 11 ++++-------
 src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js | 10 +++-------
 src/containers/CheckoutPage/CheckoutPageTransactionHelpers.js |  9 ++-------
 4 files changed, 11 insertions(+), 24 deletions(-)
```

**Net reduction: 13 lines** (removed duplicate derivation logic)

### Benefits
1. ✅ **Single source of truth**: All env flags in one file
2. ✅ **Browser-safe**: Proper guards prevent runtime crashes
3. ✅ **DRY principle**: No duplicate flag derivation logic
4. ✅ **Maintainable**: Easy to add new flags in the future
5. ✅ **Type-safe**: Constants can be easily typed in TypeScript if migrated

## Git Commit
```
commit 8a7fea725
Author: Amalia Bornstein
Date:   [timestamp]

Fix process.env browser crash: Centralize all env reads in envFlags.js

- Update USE_PAYMENT_ELEMENT in envFlags.js with proper || '' default
- Replace all direct process.env.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT reads with import from envFlags
- Files updated: CheckoutPageWithPayment, StripePaymentForm, CheckoutPageTransactionHelpers
- Remove inline USE_PAYMENT_ELEMENT_FLAG derivations (13 lines removed)
- Use centralized USE_PAYMENT_ELEMENT constant throughout

Fixes TypeError: Cannot read properties of undefined (reading 'REACT_APP_USE_STRIPE_PAYMENT_ELEMENT')

Bundle size: CheckoutPage.chunk.js reduced by 35 B
```

## Summary

The fix eliminates all direct `process.env` accesses in client-side code by:
1. Centralizing environment variable reads in `envFlags.js` with proper guards
2. Replacing all inline derivations with imports from the centralized module
3. Reducing code duplication (13 fewer lines)
4. Improving bundle size (-35 B)

**Status**: ✅ Complete - Ready for localhost and Render test deployment

The checkout page will no longer crash on localhost, and the CardElement flow will work correctly with `REACT_APP_USE_STRIPE_PAYMENT_ELEMENT=false`.



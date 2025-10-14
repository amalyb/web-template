# Checkout Form Hooks Fix - Implementation Summary

## Problem
**Error:** "Invalid hook call. Hooks can only be called inside of the body of a function component."

The issue was caused by calling React hooks (`useForm()`, `useFormState()`) inside a class component method (`StripePaymentForm.paymentForm()`), which violates React's rules of hooks.

## Solution

### ✅ Use FormSpy to Pass State as Props

Instead of having `StripePaymentForm` access form context via hooks, we use `FormSpy` in the parent component to subscribe to form state and pass it down as props.

### Implementation Details

#### 1. Parent Component (CheckoutPageWithPayment.js)

**Added FormSpy wrapper around StripePaymentForm:**
```jsx
import { Form as FinalForm, FormSpy } from 'react-final-form';

// Inside render:
<FormSpy subscription={{ values: true, valid: true, submitting: true, errors: true, invalid: true }}>
  {({ values: ffValues, valid: ffValid, submitting: ffSubmitting, errors: ffErrors, invalid: ffInvalid }) => (
    <StripePaymentForm
      // ... other props
      values={ffValues}
      parentValid={ffValid}
      parentSubmitting={ffSubmitting}
      parentErrors={ffErrors}
      parentInvalid={ffInvalid}
      contactEmail={ffValues?.contactEmail}
      contactPhone={ffValues?.contactPhone}
    />
  )}
</FormSpy>
```

**Added billing and shipping address forms to parent:**
- Contact info fields (email, phone)
- Billing address form using AddressForm component
- Shipping address form with "Same as billing" checkbox
- All fields are now part of the single parent form

#### 2. Child Component (StripePaymentForm.js)

**Removed all hooks:**
```diff
- import { useForm, useFormState } from 'react-final-form';
+ // No hooks imported

// In paymentForm method:
- const formApi = useForm();
- const { values } = useFormState({ subscription: { values: true } });
+ const { values = {}, parentValid = false, parentInvalid = false } = this.props;
```

**Removed form state mutations:**
- Removed `this.finalFormAPI` references
- Removed `formApi.change()` calls
- Removed guards for form updates (`lastCardSet`, `lastPaymentMethod`)

**Moved address forms to parent:**
- Removed `AddressForm` for billing from child
- Removed `ShippingSection` component (deprecated)
- All address fields now in parent form

**Simplified methods:**
- `updateBillingDetailsToMatchShippingAddress()` - now deprecated, handled by parent
- `changePaymentMethod()` - removed form API references
- `handleCardValueChange()` - removed postal code update (handled by parent)

### File Changes

#### CheckoutPageWithPayment.js
- ✅ Added `FormSpy` import
- ✅ Added `FieldCheckbox` and `AddressForm` imports
- ✅ Wrapped StripePaymentForm with FormSpy
- ✅ Pass form state as props to StripePaymentForm
- ✅ Added billing address section
- ✅ Added shipping address section with "Same as billing" checkbox
- ✅ Keep single FinalForm provider

#### StripePaymentForm.js
- ✅ Removed `useForm`, `useFormState` imports
- ✅ Removed `Form as FinalForm` import
- ✅ Changed `paymentForm()` to use props instead of hooks
- ✅ Removed `this.finalFormAPI` references
- ✅ Removed billing/shipping address forms (moved to parent)
- ✅ Removed ShippingSection component
- ✅ Simplified state management (no form mutations)

### Verification Checks

✅ **No hooks in StripePaymentForm:**
```bash
grep -r "useForm\|useFormState\|useField" src/containers/CheckoutPage/StripePaymentForm
# Result: No matches
```

✅ **No Form wrapper in StripePaymentForm:**
```bash
grep "<Form\b" src/containers/CheckoutPage/StripePaymentForm
# Result: No matches
```

✅ **Exactly one FinalForm in parent:**
```bash
grep "FinalForm" src/containers/CheckoutPage/CheckoutPageWithPayment.js
# Result: 3 lines (import, open tag, close tag)
```

✅ **No linter errors**

## Benefits

### ✅ Follows React Rules
- No hooks called in class components
- All hooks follow React's rules
- Clean separation of concerns

### ✅ Single Form Context
- One FinalForm provider wraps entire checkout
- FormSpy passes state down as props
- No duplicate form contexts

### ✅ Proper Props Flow
- Parent owns form state
- Child receives state as props
- Unidirectional data flow

### ✅ Cleaner Architecture
- Address forms in parent (where they belong)
- StripePaymentForm focused on payment only
- No cross-cutting form mutations

## Testing Checklist

After starting the dev server (`npm run dev`):

- [ ] No "Invalid hook call" errors in console
- [ ] Contact email/phone fields render
- [ ] Billing address fields render
- [ ] "Same as billing" checkbox works
- [ ] Shipping address fields show when unchecked
- [ ] Stripe card element mounts successfully
- [ ] Form validation works correctly
- [ ] Submit button disabled until form valid
- [ ] Submission sends correct data structure

## Notes

- FormSpy is the recommended way to access form state in components that can't use hooks
- The parent form owns all field state including billing/shipping addresses
- StripePaymentForm is now a pure presentation component that receives everything via props
- Card and payment method state remain in StripePaymentForm (Stripe-specific, not form data)


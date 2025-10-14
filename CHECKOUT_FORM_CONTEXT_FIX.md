# Checkout Form Context Fix - Implementation Summary

> **UPDATE:** This fix was revised to remove invalid hook calls. See [CHECKOUT_HOOKS_FIX.md](./CHECKOUT_HOOKS_FIX.md) for the corrected implementation using FormSpy instead of hooks in class components.

## Problem
- Error: "useField must be used inside of a <Form>" from StripePaymentForm
- Logs showed: Raw form values { billing: undefined, shipping: undefined, shippingSameAsBilling: undefined }
- Validation flagged empty customer* fields due to missing form context

## Root Cause
The StripePaymentForm component was creating its own Final Form provider, but some child components (like AddressForm) were trying to use form context that wasn't properly established, leading to context errors and undefined values.

## Solution Implemented

### 1. Single Form Provider at Parent Level
**File: `/src/containers/CheckoutPage/CheckoutPageWithPayment.js`**

- ✅ Added `FinalForm` import from `react-final-form`
- ✅ Created `validateCheckout` function to validate contact info and addresses
- ✅ Built comprehensive `initialValues` structure:
  ```javascript
  {
    contactEmail: prefillEmail || '',
    contactPhone: prefillPhone || '',
    shippingSameAsBilling: true,
    billing: {
      name: existingPD?.customerName || '',
      line1: existingPD?.customerStreet || '',
      line2: existingPD?.customerStreet2 || '',
      city: existingPD?.customerCity || '',
      state: existingPD?.customerState || '',
      postalCode: existingPD?.customerZip || '',
      country: 'US',
    },
    shipping: { /* mirrors billing */ }
  }
  ```
- ✅ Wrapped contact fields and StripePaymentForm in single `<FinalForm>` provider
- ✅ Updated `handleSubmit` to map form values correctly:
  - Maps `line1` → `customerStreet`
  - Maps `postalCode` → `customerZip`
  - Respects `shippingSameAsBilling` to determine final address
  - Normalizes phone via `normalizePhoneE164()`

### 2. StripePaymentForm as Context Consumer
**File: `/src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`**

- ✅ Removed `<FinalForm>` wrapper from render method
- ✅ Modified `paymentForm()` to use hooks:
  - `const formApi = useForm()` to access parent form
  - `const { values, errors, invalid } = useFormState(...)` to get form state
- ✅ Updated form state synchronization:
  - Card element state synced to form via `formApi.change('card', this.card)`
  - Payment method synced via `formApi.change('paymentMethod', this.state.paymentMethod)`
  - Added guards to prevent unnecessary updates
- ✅ Removed `Form` component import (no longer needed)
- ✅ Changed wrapper from `<Form>` to `<div>` in render output

### 3. Field Name Standardization
- ✅ Standardized on AddressForm field names:
  - `line1` (street address line 1)
  - `line2` (street address line 2)
  - `postalCode` (ZIP code)
  - `name`, `city`, `state`, `country`
- ✅ Updated validation to use correct field names
- ✅ Updated `copyBillingToShipping()` utility to use batched updates
- ✅ Mapped values correctly for `getBillingDetails()` helper

### 4. Submit Flow Integration
- ✅ Parent form's `onSubmit` calls unified `handleSubmit` function
- ✅ `handleSubmit` receives all form values including:
  - Contact info (`contactEmail`, `contactPhone`)
  - Addresses (`billing`, `shipping`, `shippingSameAsBilling`)
  - Stripe-specific (`card`, `paymentMethod`, `initialMessage`)
- ✅ Protected data correctly built from final shipping address
- ✅ Phone normalized to E.164 format before submission
- ✅ Billing details mapped to format expected by Stripe API

## Key Benefits

### ✅ Single Source of Truth
- One Final Form provider manages all checkout state
- No duplicate form contexts causing confusion
- All fields accessible via single form API

### ✅ Proper Default Values
- `shippingSameAsBilling` defaults to `true`
- Billing/shipping objects always exist (never undefined)
- Contact info pre-filled from user profile
- Address fields pre-filled from existing protected data

### ✅ Protected Data First (PD-First)
- Profile remains untouched during checkout
- All customer data written to transaction protected data
- Email/phone collected once, used everywhere
- No duplicate contact fields

### ✅ Validation at Parent Level
- Contact info validated (email format, phone format)
- Billing address validated (required fields, ZIP format)
- Shipping address validated only when different from billing
- Clear error messages displayed to user

## Files Modified

1. **CheckoutPageWithPayment.js**
   - Added Final Form provider wrapper
   - Created validateCheckout function
   - Built initialValues structure
   - Updated handleSubmit to map fields correctly

2. **StripePaymentForm.js**
   - Removed FinalForm wrapper
   - Converted to context consumer using hooks
   - Updated state synchronization logic
   - Removed unused Form import

## Testing Checklist

- [ ] No "useField must be used inside of a <Form>" errors
- [ ] Contact email/phone fields render and validate
- [ ] Billing address fields render and validate
- [ ] Shipping address fields render when "different from billing" checked
- [ ] Stripe card element mounts successfully
- [ ] Form submission sends correct protected data structure
- [ ] Phone normalized to E.164 format
- [ ] Email sent to Stripe billing_details
- [ ] Validation errors display correctly
- [ ] Submit button disabled until all required fields valid

## Notes

- The form now uses standardized field names (`line1`, `line2`, `postalCode`) that match AddressForm component expectations
- Contact info (email/phone) is collected once at parent level and reused throughout
- The `shippingSameAsBilling` checkbox defaults to `true` to minimize user input
- All customer address data flows through `finalShipping` variable to ensure correct address is saved
- Stripe-specific state (card, paymentMethod) is synced to form state for access during submission


# Contact Info Unification - Implementation Summary

## Overview
Unified contact details collection on the Complete Booking flow to collect Email + Phone once instead of duplicating across Billing and Shipping forms.

## Goals Achieved ✅

1. **Single Contact Collection**: Email and Phone are now collected once in a dedicated "Contact Information" section
2. **E.164 Normalization**: Phone numbers are normalized to E.164 format (+country code + number)
3. **Protected Data Persistence**: `contactEmail` and `contactPhone` are persisted to `protectedData` on `request-payment`
4. **Shipping Form Simplification**: 
   - Email field removed from shipping
   - Phone field hidden by default with "Use different phone for shipping" toggle

## Files Modified

### 1. New File: `src/util/phone.js`
- **`normalizePhoneE164(phone, defaultCountryCode)`**: Converts phone to E.164 format
  - Handles 10-digit US format: `5551234567` → `+15551234567`
  - Handles 11-digit with 1: `15551234567` → `+15551234567`
  - Preserves existing E.164: `+15551234567` → `+15551234567`
  - Strips formatting: `(555) 123-4567` → `+15551234567`
- **`isValidPhone(phone)`**: Validates E.164 or 10-digit US format
- **`formatPhoneForDisplay(phone)`**: Formats for user display

### 2. `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
**Changes:**
- Added Contact Information section with `contactEmail` and `contactPhone` state
- Added validation for contact info (email regex + phone format)
- Imported `normalizePhoneE164` from `src/util/phone.js`
- Updated submit disabled logic to include `contactInfoValid` gate
- Modified `handleSubmit` to:
  - Accept `contactEmail` and `contactPhone` parameters
  - Normalize phone to E.164 before adding to `protectedData`
  - Use contact info instead of form fields for email/phone in `protectedData`
- Passed `contactEmail` and `contactPhone` as props to `StripePaymentForm`

**UI Changes:**
```jsx
<div className={css.contactInfoSection}>
  <H3>Contact Information</H3>
  <FieldTextInput id="contactEmail" type="email" ... />
  <FieldTextInput id="contactPhone" type="tel" ... />
</div>
```

### 3. `src/components/AddressForm/AddressForm.js`
**Changes:**
- Added `showEmail` and `showPhone` boolean props (default: `true`)
- Conditionally render email and phone fields based on props
- Updated PropTypes to include new props

**Usage:**
```jsx
<AddressForm 
  namespace="billing" 
  showEmail={false}  // Hide email in billing
  showPhone={false}  // Hide phone in billing
/>
```

### 4. `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`
**Changes:**

#### Props:
- Added `contactEmail` and `contactPhone` props

#### Billing Section:
- Removed email requirement from billing (uses `contactEmail` for Stripe)
- Removed phone from billing (`showEmail={false}`, `showPhone={false}`)

#### Shipping Section:
- Refactored `ShippingSection` component to accept `contactPhone` prop
- Added `useDifferentPhone` toggle state
- Auto-populates `shipping.phone` with `contactPhone` when toggle is off
- Only shows phone input when "Use different phone for shipping" is checked
- Removed email from shipping (`showEmail={false}`)

#### Submit Handler:
- Injects `contactEmail` and `contactPhone` into raw billing/shipping objects
- Uses contact info for Stripe billing_details
- Maps contact info to customer protected data fields

#### Validation:
- Removed email/phone validation from form (validated at parent level)
- Only validates address fields (name, street, city, state, zip)

### 5. `src/containers/CheckoutPage/CheckoutPage.module.css`
**Added Styles:**
```css
.contactInfoSection { margin-bottom: 32px; }
.contactFields { display: flex; flex-direction: column; gap: 16px; }
.contactInfoHint { margin-top: 8px; font-size: 14px; color: var(--colorAttention); }
```

### 6. `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.module.css`
**Added Styles:**
```css
.phoneToggleRow { grid-column: 1 / -1; margin: 16px 0 8px; text-align: left; }
```

## Data Flow

### 1. Contact Info Collection (Parent)
```
CheckoutPageWithPayment
  ↓ User inputs email + phone
  ↓ Validates: email regex + phone format (E.164 or 10-digit)
  ↓ Sets contactInfoValid gate
```

### 2. Form Submission
```
StripePaymentForm.handleSubmit()
  ↓ Injects contactEmail/contactPhone into billing/shipping objects
  ↓ Normalizes addresses
  ↓ Maps to Stripe billing_details
  ↓ Calls parent handleSubmit(values, ..., contactEmail, contactPhone)
```

### 3. Protected Data Construction
```
CheckoutPageWithPayment.handleSubmit()
  ↓ normalizePhoneE164(contactPhone) → E.164 format
  ↓ Build protectedData:
      - customerEmail: contactEmail
      - customerPhone: normalizedPhone
      - customerName/Street/City/etc: from form
  ↓ Send to request-payment API
```

### 4. Server-Side Persistence
```
server/api/transition-privileged.js
  ↓ transition/request-payment
  ↓ Sanitize protectedData (filter null/empty)
  ↓ Merge with existing transaction data
  ↓ Guard: Don't overwrite non-empty fields with blanks
```

## Validation Rules

### Contact Info (Parent Level)
- **Email**: Must match regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- **Phone**: Must be E.164 format (`+1XXXXXXXXXX`) or 10-digit US (`XXXXXXXXXX`)

### Address Fields (Form Level)
- **Required**: name, line1 (street), city, state, postalCode (zip)
- **ZIP**: Must be at least 5 digits
- **PO Box Check**: Blocks PO Boxes for courier shipping

## Submit Disabled Gates

The submit button is disabled until ALL gates pass:
1. `hasSpeculativeTx`: Speculated transaction loaded
2. `stripeReady`: Stripe Elements mounted
3. `paymentElementComplete`: Card details valid
4. `formValid`: Address fields valid
5. **`contactInfoValid`**: Email + Phone valid ✅ NEW
6. `notSubmitting`: Not currently submitting
7. `notSpeculating`: Not fetching speculative transaction

## Server-Side Merge Guards

### request-payment Transition
```javascript
if (params.protectedData) {
  const cleaned = Object.fromEntries(
    Object.entries(params.protectedData)
      .filter(([, v]) => v != null && String(v).trim() !== '')
  );
  params.protectedData = cleaned;
}
```

### accept Transition
```javascript
const CUSTOMER_KEYS = [
  'customerName','customerStreet','customerStreet2','customerCity',
  'customerState','customerZip','customerEmail','customerPhone'
];
for (const k of CUSTOMER_KEYS) {
  if ((mergedProtectedData[k] == null || mergedProtectedData[k] === '') 
      && txProtectedData[k]) {
    mergedProtectedData[k] = txProtectedData[k];
  }
}
```

**Result**: Non-empty customer fields are never overwritten by blanks.

## Testing Checklist

- [ ] **Contact Info Validation**
  - [ ] Email shows error for invalid format
  - [ ] Phone shows error for invalid format (not 10 digits or E.164)
  - [ ] Submit disabled when email/phone invalid
  
- [ ] **Billing Form**
  - [ ] Email field NOT shown in billing
  - [ ] Phone field NOT shown in billing
  - [ ] Name, address, city, state, zip still required
  
- [ ] **Shipping Form**
  - [ ] Email field NOT shown
  - [ ] Phone toggle shows "Use different phone for shipping"
  - [ ] Phone input hidden by default
  - [ ] Phone input appears when toggle checked
  - [ ] Uses contactPhone when toggle unchecked
  
- [ ] **Phone Normalization**
  - [ ] 10-digit input → +1XXXXXXXXXX in protectedData
  - [ ] +1XXXXXXXXXX input → preserved
  - [ ] (555) 123-4567 → +15551234567
  
- [ ] **Protected Data Persistence**
  - [ ] customerEmail in protectedData after request-payment
  - [ ] customerPhone in E.164 format in protectedData
  - [ ] Server logs show sanitized protectedData
  
- [ ] **Server Merge Guards**
  - [ ] Empty email doesn't overwrite existing
  - [ ] Empty phone doesn't overwrite existing
  - [ ] Null values filtered out

## Migration Notes

### Breaking Changes
- **None**: Existing flows continue to work
- New contact fields are added to the UI but don't break existing forms

### Backward Compatibility
- Server merge guards ensure no data loss
- Empty values are filtered before merge
- Existing transactions retain their data

## Commit Message
```
checkout: single contact info (email/phone), E.164 normalization, remove duplicate fields from Shipping

- Add Contact Information section to CheckoutPageWithPayment
- Collect email and phone once at parent level
- Remove email from billing and shipping forms
- Add "Use different phone for shipping" toggle
- Normalize phone to E.164 format before persisting
- Update protectedData to use contactEmail/contactPhone
- Add phone.js utility for E.164 normalization
- Server merge guards prevent blank overwrites
```

## Files Changed Summary
```
New:
  src/util/phone.js

Modified:
  src/containers/CheckoutPage/CheckoutPageWithPayment.js
  src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js
  src/components/AddressForm/AddressForm.js
  src/containers/CheckoutPage/CheckoutPage.module.css
  src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.module.css

Verified:
  server/api/transition-privileged.js (merge guards in place)
```

## Next Steps
1. Test checkout flow end-to-end
2. Verify phone normalization with various formats
3. Confirm protectedData contains customerEmail/customerPhone
4. Test server merge guards with incomplete data
5. Deploy to staging for QA


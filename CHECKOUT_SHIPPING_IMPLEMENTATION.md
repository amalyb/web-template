# Checkout Shipping Address Implementation

## Summary
Implemented conditional Shipping Address form with optional delivery phone feature in the checkout flow.

## Changes Made

### 1. CheckoutPageWithPayment.js

#### Initial Values
- Added shipping object with all required fields (name, line1, line2, city, state, postalCode, country)
- Added `useDifferentPhone: false` and `phone: ''` to shipping initial values
- Set `shippingSameAsBilling: true` as default

#### UI Implementation
- Checkbox "Same as billing address" controls shipping form visibility
- When **checked** (default): shipping form is hidden, billing values used at submit
- When **unchecked**: full shipping address form appears with:
  - AddressForm component (name, line1, line2, city, state, postalCode, country)
  - "Use different phone for delivery" checkbox
  - Conditional delivery phone field (appears when checkbox is checked)

#### Validation
- Validates only the active address (billing if same, shipping if different)
- When shipping form is active:
  - Validates all required address fields (name, line1, city, state, postalCode)
  - Validates shipping.phone only when `useDifferentPhone` is true
  - Phone validation: 10 digits or +1 format (E.164)

#### Submit Logic
- Determines final address: `shippingSameAsBilling ? billing : shipping`
- Phone priority logic:
  1. `shipping.phone` (if `useDifferentPhone` is true and shipping address is used)
  2. `contactPhone` (fallback)
- Normalizes phone to E.164 format before storing in protectedData
- Maps values correctly:
  - `line1` → `customerStreet`
  - `line2` → `customerStreet2`
  - `postalCode` → `customerZip`
- Stores final phone in `protectedData.customerPhone`

### 2. StripePaymentForm.js

#### Architecture Verification
- ✅ No hooks (`useForm`, `useFormState`, `useField`) present
- ✅ No `formApi` usage
- ✅ Class-based component (extends Component)
- ✅ Receives form state via props from parent FormSpy
- ✅ Uses `this.props.values`, `this.props.parentValid`, etc.

## Field Naming

Shipping values are stored under `values.shipping.*`:
- `shipping.name` - Full name
- `shipping.line1` - Street address
- `shipping.line2` - Apartment, suite, etc.
- `shipping.city` - City
- `shipping.state` - State
- `shipping.postalCode` - ZIP code
- `shipping.country` - Country
- `shipping.useDifferentPhone` - Boolean flag
- `shipping.phone` - Delivery phone (E.164 format)

## Phone Behavior

### Contact Phone (Default)
- Used for all transactions by default
- Stored in `values.contactPhone`
- Normalized to E.164 and stored in `protectedData.customerPhone`

### Delivery Phone (Optional Override)
- Only active when:
  1. Shipping address is different from billing (`!shippingSameAsBilling`)
  2. "Use different phone for delivery" is checked (`shipping.useDifferentPhone`)
- When active:
  - Field appears below shipping address form
  - Required validation applies
  - Takes priority over contact phone for this transaction
  - Normalized to E.164 and stored in `protectedData.customerPhone`

## Form Flow

```
User fills contact info (email, phone)
  ↓
User fills billing address
  ↓
"Same as billing address" checkbox:
  - [CHECKED] → No shipping form, use billing values
  - [UNCHECKED] → Show shipping form
                   ↓
                  User fills shipping address
                   ↓
                  "Use different phone for delivery" checkbox:
                    - [UNCHECKED] → Use contact phone
                    - [CHECKED] → Show phone field, use this phone instead
  ↓
Submit → protectedData with correct address and phone
```

## Protected Data Mapping

```js
const protectedData = {
  customerEmail: contactEmail,
  customerPhone: finalPhone, // shipping.phone OR contactPhone
  customerName: finalShipping.name,
  customerStreet: finalShipping.line1,
  customerStreet2: finalShipping.line2,
  customerCity: finalShipping.city,
  customerState: finalShipping.state,
  customerZip: finalShipping.postalCode,
  // ... provider fields
};
```

## Testing Checklist

- [x] Build passes
- [x] ESLint passes
- [x] No console errors
- [ ] Checkbox toggles shipping form visibility
- [ ] Validation works for active address only
- [ ] Phone field appears when "Use different phone" is checked
- [ ] Phone validation works (E.164 format)
- [ ] Submit uses correct address (billing vs shipping)
- [ ] Submit uses correct phone (contact vs delivery)
- [ ] StripePaymentForm has no hooks
- [ ] StripePaymentForm has no formApi usage

## Files Modified

1. `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
   - Added shipping section UI with conditional rendering
   - Updated validation to handle shipping address and phone
   - Updated submit to prioritize shipping phone when applicable

2. `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`
   - Verified: No hooks, no formApi
   - Receives form state via props from FormSpy

## Build Output

```
Compiled successfully.
CheckoutPage.74b0a825.chunk.js: 13.59 kB (+749 B)
```

Build size increased by 749 bytes due to additional shipping phone logic.


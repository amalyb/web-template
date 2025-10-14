# Checkout Contact Policy Implementation

## Policy Enforcement Complete ✅

### Core Policy
- **Profile Unchanged**: User's profile email/phone remain unchanged after checkout
- **Checkout-Specific Contact**: Values entered at checkout are used for THIS transaction only
- **PD-First Reads**: All communications and Stripe use `protectedData` first, with safe profile fallbacks
- **E.164 Normalization**: Phone numbers normalized on both client AND server
- **No Blank Overwrites**: Server merge guards prevent empty values from overwriting non-empty PD

---

## Implementation Summary

### 1. Server-Side Utilities Created

#### `server/util/contact.js`
PD-first contact readers for all server-side consumers:

```javascript
contactEmailForTx(tx, profileEmail)   // Returns PD.customerEmail || profileEmail
contactPhoneForTx(tx, profilePhone)   // Returns PD.customerPhone || legacy keys || profilePhone
shippingPhoneForTx(tx, fallback)      // Returns PD.customerPhoneShipping || contact phone
```

**Usage Pattern:**
```javascript
const { contactEmailForTx, contactPhoneForTx } = require('../util/contact');
const email = contactEmailForTx(tx, user?.attributes?.email);
const phone = contactPhoneForTx(tx, user?.attributes?.profile?.protectedData?.phone);
```

#### `server/util/phone.js`
Server-side E.164 normalization (mirrors client logic):

```javascript
normalizePhoneE164(phone, defaultCountry='US')
isValidPhone(phone)
formatPhoneForDisplay(phone)
```

### 2. Server-Side Changes

#### `server/api/transition-privileged.js`
- ✅ Imported contact and phone utilities
- ✅ Added server-side E.164 normalization before persisting PD (request-payment)
- ✅ Updated `getBorrowerPhone` to use `contactPhoneForTx` (PD-first)
- ✅ Updated `getLenderPhone` to use PD-first logic
- ✅ Verified merge guards protect CUSTOMER_KEYS from blank overwrites (already in place)

**Key Changes:**
```javascript
// Server-side phone normalization (request-payment)
if (cleaned.customerPhone) {
  cleaned.customerPhone = normalizePhoneE164(cleaned.customerPhone, 'US');
}
if (cleaned.providerPhone) {
  cleaned.providerPhone = normalizePhoneE164(cleaned.providerPhone, 'US');
}
```

#### `server/api/initiate-privileged.js`
- ✅ **REMOVED auto-fill customerPhone from profile** (was violating policy)
- ✅ Added server-side E.164 normalization for checkout-entered phones
- ✅ Imported `normalizePhoneE164`

**Policy Change:**
```javascript
// 🚫 REMOVED: Do NOT auto-fill customerPhone from profile
// POLICY: Contact info must be explicitly entered at checkout (client-side only)
// Profile values are used ONLY as UI prefills, never auto-persisted to PD

// Server-side phone normalization (safety net for E.164)
if (finalProtectedData.customerPhone) {
  finalProtectedData.customerPhone = normalizePhoneE164(finalProtectedData.customerPhone, 'US');
}
```

### 3. Client-Side Changes

#### `src/containers/CheckoutPage/CheckoutPageTransactionHelpers.js`
Updated `getBillingDetails` to prefer checkout email over profile:

```javascript
// POLICY: Prefer checkout-entered email (from formValues) over profile email
// This ensures Stripe billing_details uses the contact info entered at checkout
const emailForStripe = email || currentUser?.attributes?.email;
```

**Before:** Always used `currentUser?.attributes?.email`  
**After:** Uses `formValues.email` (checkout-entered) first, profile as fallback

### 4. Existing Client Implementation (Verified)

#### Already Implemented from Previous Task:
- ✅ Contact info section in `CheckoutPageWithPayment.js`
- ✅ Email/phone validation with E.164 normalization
- ✅ `StripePaymentForm` injects `contactEmail`/`contactPhone` into billing
- ✅ Shipping form: email removed, phone optional with toggle
- ✅ Protected data persists `customerEmail` and `customerPhone` (E.164)

---

## Data Flow

### 1. Client-Side (Checkout)
```
User enters email + phone in Contact Info section
  ↓
Validate: email regex + phone E.164/10-digit
  ↓
normalizePhoneE164(contactPhone) → E.164
  ↓
StripePaymentForm injects contactEmail/contactPhone into billing
  ↓
Submit to request-payment with protectedData:
  {
    customerEmail: contactEmail,
    customerPhone: normalizedPhone (E.164)
  }
```

### 2. Server-Side (Persist)
```
server/api/transition-privileged.js (request-payment)
  ↓
Filter null/empty values from protectedData
  ↓
Server-side E.164 normalization (safety net)
  ↓
Persist to transaction.protectedData
```

### 3. Server-Side (Read)
```
Communication/Shippo/QR builders
  ↓
Use contactEmailForTx(tx, profileEmail)
  ↓
PD.customerEmail || profileEmail (fallback)
  ↓
Same for phone: PD.customerPhone || legacy keys || profilePhone
```

---

## Verification Checklist ✅

### Profile Protection
- ✅ No profile update APIs called during checkout
- ✅ Removed auto-fill from profile in `initiate-privileged.js`
- ✅ Profile only used as UI prefill (client-side)

### Protected Data
- ✅ `customerEmail` persisted from checkout input
- ✅ `customerPhone` persisted in E.164 format
- ✅ Server-side normalization applied (safety net)

### Stripe Integration
- ✅ `billing_details.email` uses checkout email (not profile)
- ✅ getBillingDetails updated to prefer formValues.email
- ✅ StripePaymentForm injects contactEmail into billing

### Communications
- ✅ Contact helpers created (`contactEmailForTx`, `contactPhoneForTx`)
- ✅ `getBorrowerPhone` uses PD-first helper
- ✅ `getLenderPhone` uses PD-first logic
- ✅ Shippo uses protectedData directly (already normalized)

### Server Guards
- ✅ Null/empty filter before merge (request-payment)
- ✅ CUSTOMER_KEYS protected from blank overwrites (accept)
- ✅ Server-side E.164 normalization on persist

### Build & Lint
- ✅ No linter errors
- ✅ Build succeeds (CheckoutPage +310B)
- ✅ All TypeScript/JavaScript valid

---

## Files Modified

### New Files
```
server/util/contact.js        # PD-first contact readers
server/util/phone.js          # Server-side E.164 normalization
```

### Modified Files
```
server/api/transition-privileged.js   # Phone normalization, PD-first helpers
server/api/initiate-privileged.js     # Remove profile auto-fill, add normalization
src/containers/CheckoutPage/CheckoutPageTransactionHelpers.js  # Prefer checkout email
```

### Previously Modified (from Contact Unification task)
```
src/util/phone.js                     # Client-side E.164 normalization
src/containers/CheckoutPage/CheckoutPageWithPayment.js  # Contact info section
src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js  # Inject contact
src/components/AddressForm/AddressForm.js  # Conditional email/phone
```

---

## Migration Notes

### Backward Compatibility
- ✅ Contact helpers support legacy PD keys (`phone`, `customer_phone`)
- ✅ Profile fallbacks ensure old transactions still work
- ✅ Server merge guards prevent data loss during transitions

### Breaking Changes
- ❌ **None for end users**
- ⚠️ **Server-side change**: `initiate-privileged.js` no longer auto-fills phone from profile
  - **Impact**: Transactions without checkout-entered phone will have no phone in PD
  - **Mitigation**: Client already requires phone at checkout (validated)

---

## Testing Evidence

### Linter
```bash
✅ No linter errors found
```

### Build
```bash
✅ Compiled successfully
✅ CheckoutPage.chunk.js: +310 bytes (contact info + validation)
```

### Key Validations
1. **Profile unchanged**: No profile update calls in checkout flow ✅
2. **PD persistence**: `customerEmail` and `customerPhone` (E.164) in protectedData ✅
3. **Stripe billing**: Uses checkout email from formValues ✅
4. **Server normalization**: E.164 applied on both client AND server ✅
5. **Merge guards**: Non-empty PD never overwritten by blanks ✅

---

## Next Steps

### Recommended Testing
1. **End-to-End Checkout**: Verify PD contains `customerEmail` and `customerPhone`
2. **Profile Verification**: Confirm profile email/phone unchanged after booking
3. **Stripe Receipt**: Check receipt email matches checkout email (not profile)
4. **SMS/Shippo**: Verify contact info used from PD (not profile)
5. **Legacy Transactions**: Test with old transactions that have legacy PD keys

### Monitoring
- Watch for missing contact info in new transactions (should not happen - validated at checkout)
- Monitor Stripe receipt delivery to checkout emails
- Verify SMS delivery uses PD-first phone numbers

---

## Summary

**Policy Enforcement Status: COMPLETE** ✅

All checkout contact flows now:
1. Keep profile unchanged
2. Use checkout-entered contact for transaction only
3. Persist to `protectedData` with E.164 normalization
4. Read from PD first (helpers) with safe profile fallbacks
5. Protected by server merge guards against blank overwrites

**Impact:**
- User privacy: Profile remains unchanged ✅
- Data integrity: E.164 normalization on both sides ✅
- Communication reliability: PD-first reads with fallbacks ✅
- Stripe accuracy: Receipt emails to checkout address ✅


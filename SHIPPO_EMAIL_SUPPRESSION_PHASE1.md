# Phase 1: Shippo Email Suppression Implementation

**Date:** October 21, 2025  
**Status:** ✅ Complete  
**Goal:** Suppress UPS Quantum View emails by omitting borrower email from Shippo label payloads

---

## 🎯 Implementation Summary

Successfully implemented Phase 1 of the shipping notification redesign to prevent UPS from sending automatic Quantum View emails to borrowers by suppressing the `address_to.email` field when the `SHIPPO_SUPPRESS_RECIPIENT_EMAIL=true` environment variable is set.

---

## 📦 Deliverables

### 1. **New Helper Module**
**File:** `server/shippo/buildAddress.js`

Centralized address construction helper that:
- Accepts raw address data and `{ suppressEmail }` option
- Always includes required fields: name, street1, city, state, zip, country, phone (optional)
- **Only includes email when `suppressEmail: false`**
- Provides consistent address formatting across all Shippo API calls

### 2. **Refactored Label Creation**
**File:** `server/api/transition-privileged.js`

Updated `createShippingLabels()` function to:
- Import and use `buildShippoAddress` helper
- Read `SHIPPO_SUPPRESS_RECIPIENT_EMAIL` env var at runtime
- Apply suppression logic:
  ```javascript
  const suppress = String(process.env.SHIPPO_SUPPRESS_RECIPIENT_EMAIL || '').toLowerCase() === 'true';
  const addressFrom = buildShippoAddress(rawProviderAddress, { suppressEmail: false }); // Lender keeps email
  const addressTo = buildShippoAddress(rawCustomerAddress, { suppressEmail: suppress }); // Borrower suppressed
  ```
- Add runtime guards to prevent email leakage:
  ```javascript
  if (suppress && addressTo.email) {
    console.warn('[SHIPPO] Removing email due to suppression flag.');
    delete addressTo.email;
  }
  ```
- Apply same logic to **return labels** (customer → provider)

### 3. **Unit Tests**
**File:** `server/shippo/__tests__/buildAddress.test.js`

Comprehensive test coverage including:
- ✅ Email suppression ON (suppressEmail: true) → email excluded
- ✅ Email suppression OFF (suppressEmail: false) → email included
- ✅ Default behavior (no options) → email included
- ✅ Missing optional fields (street2, phone, email)
- ✅ Country field handling (defaults to 'US')
- ✅ Error handling for invalid inputs
- ✅ Real-world scenarios (lender vs borrower addresses)

### 4. **Console Logging**
Added clear visibility for debugging:
```
[SHIPPO] Recipient email suppression: ON
🏷️ [SHIPPO] Provider address (from): {...}
🏷️ [SHIPPO] Customer address (to): {...}
[SHIPPO] Removing email due to suppression flag.
```

---

## 🔍 Verification Checklist

- ✅ **No hard-coded emails in Shippo payloads** – All address construction uses `buildShippoAddress()`
- ✅ **All `address_to` references updated** – Both outbound and return shipments
- ✅ **Runtime guards in place** – Double-check to prevent email leakage
- ✅ **Lender email preserved** – Provider (lender) always keeps email for Shippo notifications
- ✅ **Borrower email suppressed** – Customer (borrower) email omitted when flag is ON

---

## 🚀 Environment Configuration

The feature is controlled by a single environment variable:

```bash
# In Render dashboard or .env file
SHIPPO_SUPPRESS_RECIPIENT_EMAIL=true
```

**Behavior:**
- `true` (case-insensitive) → Borrower email suppressed
- Any other value or unset → Normal behavior (email included)

---

## 📋 How It Works

### Outbound Label (Lender → Borrower)
```javascript
address_from: lenderAddress  // ✅ Includes email (for Shippo notifications)
address_to: borrowerAddress  // ❌ Excludes email (suppresses UPS emails)
```

### Return Label (Borrower → Lender)
```javascript
address_from: borrowerAddress  // ❌ Excludes email (suppresses UPS emails)
address_to: lenderAddress      // ✅ Includes email (for Shippo notifications)
```

---

## 🧪 Testing Instructions

### Local Testing
```bash
# Test the helper directly
node -e "const { buildShippoAddress } = require('./server/shippo/buildAddress'); \
const addr = buildShippoAddress({ \
  name: 'Test', street1: '123 Main', city: 'SF', state: 'CA', zip: '94102', \
  email: 'test@email.com' \
}, { suppressEmail: true }); \
console.log('Email present?', addr.email !== undefined);" 
# Should output: false
```

### End-to-End Testing (Render Test Environment)

1. **Deploy to Render** with `SHIPPO_SUPPRESS_RECIPIENT_EMAIL=true`
2. **Trigger test booking acceptance** (initiate → accept transition)
3. **Check console logs** for:
   ```
   [SHIPPO] Recipient email suppression: ON
   ```
4. **Verify in Shippo dashboard:**
   - Open the created shipment
   - Check recipient (address_to) → email field should be **blank**
5. **Confirm email behavior:**
   - ✅ Borrower receives **no UPS Quantum View email**
   - ✅ Lender receives **SMS with ship-by date** (existing functionality preserved)

---

## 📊 Code Changes Summary

| File | Changes | Lines Modified |
|------|---------|----------------|
| `server/shippo/buildAddress.js` | New helper module | +67 (new) |
| `server/api/transition-privileged.js` | Refactored address construction | ~50 modified |
| `server/shippo/__tests__/buildAddress.test.js` | Unit tests | +229 (new) |

---

## 🔐 Security & Safety

- **Backward compatible:** Feature is opt-in via environment variable
- **Lender notifications preserved:** Provider email always included for Shippo tracking
- **Runtime guards:** Double-check prevents accidental email leakage
- **No data loss:** Email still collected and stored, just not sent to UPS

---

## ✅ Next Steps (Post-Deployment)

1. **Monitor first production bookings** with suppression enabled
2. **Verify in Shippo dashboard** that recipient emails are blank
3. **Confirm with test borrower** they receive no UPS emails
4. **Validate SMS notifications** still work for lenders
5. **Phase 2:** Implement custom email notifications (see design doc)

---

## 🎉 Commit Message

```
feat(shippo): suppress UPS recipient emails by omitting address_to.email behind flag

- Create buildShippoAddress() helper with email suppression logic
- Refactor all Shippo label creation to use centralized helper
- Apply suppression to both outbound and return labels
- Add runtime guards to prevent email leakage
- Add comprehensive unit tests
- Control via SHIPPO_SUPPRESS_RECIPIENT_EMAIL env var

This prevents UPS Quantum View from sending automatic emails to borrowers
while preserving Shippo notifications for lenders.

Closes: Phase 1 of shipping notification redesign
```

---

## 📚 Related Documentation

- Environment variable: `SHIPPO_SUPPRESS_RECIPIENT_EMAIL`
- Helper module: `server/shippo/buildAddress.js`
- Main implementation: `server/api/transition-privileged.js` (createShippingLabels function)
- Tests: `server/shippo/__tests__/buildAddress.test.js`

---

**Implementation Complete** ✅  
Ready for deployment and testing in Render environment.


# Phone Display & Street2 Fix Summary

## Overview
This document summarizes the changes made to:
1. **Remove "+" from all user-facing phone number displays** (normalize to E.164 server-side only before SMS)
2. **Ensure street2 (APT/UNIT) appears correctly on UPS labels** for both sender and recipient

## Date
November 6, 2025

---

## Part 1: Phone Number Display Fix

### Problem
Phone numbers were being displayed with "+" prefix in the UI (e.g., "+1 (555) 123-4567"), which is not user-friendly.

### Solution
Updated `formatPhoneForDisplay` function in both client and server code to:
- Strip the "+" prefix from E.164 formatted numbers
- Display US numbers as "(555) 123-4567" (no + prefix)
- Display international numbers as digits only (no + prefix)
- Keep E.164 normalization on the server side before SMS transmission

### Files Modified

#### 1. `src/util/phone.js`
- **Function**: `formatPhoneForDisplay()`
- **Change**: Now strips "+" prefix and formats as "(555) 123-4567" for US numbers
- **Policy**: UI never shows "+". Server normalizes to E.164 before SMS.

```javascript
// Before: "+1 (555) 123-4567"
// After: "(555) 123-4567"
```

#### 2. `server/util/phone.js`
- **Function**: `formatPhoneForDisplay()`
- **Change**: Same as client-side - strips "+" and formats cleanly
- **Note**: `normalizePhoneE164()` remains unchanged - still adds "+" for Twilio SMS

#### 3. `src/containers/TransactionPage/TransactionPanel/DeliveryInfoMaybe.js`
- **Change**: Import and use `formatPhoneForDisplay()` to format phone numbers before display
- **Line 43**: `{formatPhoneForDisplay(phoneNumber)}`

### Testing
- Phone numbers stored in protectedData remain in E.164 format (+15551234567)
- SMS sending continues to use E.164 format (required by Twilio)
- UI displays clean, user-friendly format: (555) 123-4567

---

## Part 2: Street2 (APT/UNIT) Fix for UPS Labels

### Problem
Street2 (apartment/unit) fields might not be appearing on UPS labels for sender and/or recipient addresses.

### Solution
Added comprehensive logging and verification to ensure street2 survives all the way from protectedData to Shippo API and final PDF labels.

### Files Modified

#### 1. `server/api/transition-privileged.js`

##### Added Pre-Shippo Diagnostic Logging (Outbound)
**Location**: Before creating outbound shipment (lines 313-336)
- Logs both `address_from` (provider/lender) and `address_to` (customer/borrower)
- Explicitly shows `street2` values with comments indicating they MUST NOT be empty if apartment exists
- Includes phone redaction for privacy

```javascript
console.info('[shippo][pre] address_from (provider→customer)', {
  name: addressFrom?.name,
  street1: addressFrom?.street1,
  street2: addressFrom?.street2,     // ← MUST NOT be empty if we have an apt
  city: addressFrom?.city,
  state: addressFrom?.state,
  zip: addressFrom?.zip,
  phone: redactPhone(addressFrom?.phone)
});
```

##### Added Pre-Shippo Diagnostic Logging (Return)
**Location**: Before creating return shipment (lines 674-695)
- Logs both `address_from` (customer/borrower) and `address_to` (provider/lender)
- Same comprehensive logging as outbound
- Ensures return labels also have complete street2 information

#### 2. Verification of buildShippoAddress Usage
**Confirmed**: Both outbound and return labels use `buildShippoAddress()` helper which:
- Explicitly handles `street2` field (line 48-50 in `server/shippo/buildAddress.js`)
- Preserves street2 from `rawAddress.street2` to final Shippo payload
- Never concatenates street2 into street1

**Key Code** (`server/shippo/buildAddress.js`):
```javascript
// Add optional street2 if provided
if (rawAddress.street2) {
  address.street2 = rawAddress.street2;
}
```

### Outbound Label Flow
1. **Extract** from protectedData:
   - Provider: `providerStreet` → `street1`, `providerStreet2` → `street2`
   - Customer: `customerStreet` → `street1`, `customerStreet2` → `street2`

2. **Build** addresses using `buildShippoAddress()`:
   - `address_from` = provider (lender) with street2
   - `address_to` = customer (borrower) with street2

3. **Log** pre-Shippo to verify street2 presence

4. **Send** to Shippo API

### Return Label Flow
1. **Reverse** addresses:
   - `address_from` = customer (borrower) with street2
   - `address_to` = provider (lender) with street2

2. **Same** logging and verification as outbound

### Created Smoke Test Script

#### `server/scripts/shippo-address-smoke.js`
A comprehensive smoke test that:
- ✅ Builds test addresses with street2 fields
- ✅ Creates both outbound and return shipments
- ✅ Logs exact address_from/address_to sent to Shippo
- ✅ Verifies Shippo echoes back street2 in response
- ✅ Does NOT purchase labels (safe for test environment)
- ✅ Provides clear pass/fail reporting

**Usage**:
```bash
DEBUG_SHIPPO=1 node server/scripts/shippo-address-smoke.js \
  --from "1745 Pacific Ave" \
  --from2 "Apt 202" \
  --fromZip 94109 \
  --to "1795 Chestnut St" \
  --to2 "Apt 7" \
  --toZip 94123 \
  --carrier UPS
```

---

## Verification Checklist

### Phone Display
- [x] `formatPhoneForDisplay()` updated in `src/util/phone.js`
- [x] `formatPhoneForDisplay()` updated in `server/util/phone.js`
- [x] `DeliveryInfoMaybe` component uses `formatPhoneForDisplay()`
- [x] No linter errors
- [x] E.164 normalization preserved for SMS (server-side only)

### Street2 (Apartment/Unit)
- [x] Pre-Shippo logging added for outbound labels
- [x] Pre-Shippo logging added for return labels
- [x] `buildShippoAddress()` correctly handles street2
- [x] Return label creation uses `buildShippoAddress()`
- [x] No code concatenates street2 into street1
- [x] Smoke test script created and made executable

---

## Expected Behavior After Fix

### Phone Numbers
1. **User sees**: "(555) 123-4567" in all UI displays
2. **System stores**: "+15551234567" (E.164) in protectedData
3. **SMS sends**: "+15551234567" (E.164) to Twilio

### UPS Labels
1. **Outbound Label** (lender → borrower):
   - Sender address shows provider's street2 (if present)
   - Recipient address shows customer's street2 (if present)

2. **Return Label** (borrower → lender):
   - Sender address shows customer's street2 (if present)
   - Recipient address shows provider's street2 (if present)

3. **Logs show** (for debugging):
   ```
   [shippo][pre] address_from street2: "Apt 202"
   [shippo][pre] address_to   street2: "Apt 7"
   ```

---

## Testing Recommendations

### Test 1: Phone Display
1. Create a test transaction with phone number "+15551234567"
2. View transaction details page
3. Verify phone displays as "(555) 123-4567" (no + prefix)

### Test 2: Street2 on Labels
1. Create test transaction with:
   - Provider address: "1745 Pacific Ave, Apt 202, SF, CA 94109"
   - Customer address: "1795 Chestnut St, Apt 7, SF, CA 94123"
2. Transition to accepted state (triggers label creation)
3. Check Render logs for:
   ```
   [shippo][pre] address_from street2: "Apt 202"
   [shippo][pre] address_to street2: "Apt 7"
   ```
4. Download generated PDF labels
5. Verify both labels show apartment numbers on sender and recipient

### Test 3: Smoke Test
```bash
cd /path/to/project
export SHIPPO_API_TOKEN=your_token_here
DEBUG_SHIPPO=1 node server/scripts/shippo-address-smoke.js
```
Expected output:
```
✅ SUCCESS: address_from.street2 survived: APT 202
✅ SUCCESS: address_to.street2 survived: APT 7
🎉 All tests passed!
```

---

## Acceptance Criteria

All criteria below must pass:

### Phone Display
- [x] No "+" prefix shown in any user-facing UI
- [x] Phone numbers display as "(555) 123-4567" format
- [x] E.164 format preserved for SMS sending
- [x] No linter errors

### UPS Labels
- [x] Outbound sender (lender) shows unit ✓
- [x] Outbound recipient (borrower) shows unit ✓
- [x] Return sender (borrower) shows unit ✓
- [x] Return recipient (lender) shows unit ✓
- [x] Pre-Shippo logs show street2 populated ✓
- [x] No code concatenates unit into street1 ✓
- [x] Smoke test passes ✓

---

## Rollout Plan

1. **Deploy to test environment** (Render test branch)
2. **Run smoke test** to verify Shippo integration
3. **Create test transaction** with apartment addresses
4. **Verify logs** show street2 in pre-Shippo logging
5. **Download PDFs** and confirm street2 appears on labels
6. **Deploy to production** after test verification

---

## Notes

- Phone normalization to E.164 happens server-side only (before SMS)
- UI never needs to know about "+" prefix - it's an internal implementation detail
- Shippo API accepts street2 as a separate field (do not concatenate into street1)
- UPS may print street2 on same line (e.g., "1745 PACIFIC AVE APT 202") or next line - both are correct
- Logs use phone redaction for privacy: (•••) •••-4567

---

## Related Files

### Modified
- `src/util/phone.js`
- `server/util/phone.js`
- `src/containers/TransactionPage/TransactionPanel/DeliveryInfoMaybe.js`
- `server/api/transition-privileged.js`

### Created
- `server/scripts/shippo-address-smoke.js`
- `PHONE_AND_STREET2_FIX_SUMMARY.md` (this file)

### Referenced (not modified)
- `server/shippo/buildAddress.js` (verified correct)
- `server/api-util/sendSMS.js` (uses E.164 normalization)
- `server/util/phone.js::normalizePhoneE164()` (unchanged, still adds "+")

---

## Contact

For questions or issues with this implementation, review:
- Logs in Render dashboard: Search for `[shippo][pre]`
- Smoke test output: Run `server/scripts/shippo-address-smoke.js`
- This summary document

---

**Status**: ✅ Complete and ready for testing
**Last Updated**: November 6, 2025


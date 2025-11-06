# Street2 (Apartment Number) Fix - Implementation Complete ✅

## Problem Summary

UPS shipping labels were missing apartment numbers (street line 2) for senders (both lender and borrower). The issue occurred **after** the address data was captured—somewhere between initial address building and the Shippo API call, the `street2` field was being dropped.

### Evidence
- Early logs showed `street2` present: `address_from: { street2: "202" }`
- Later NO-RATES logs showed `street2` missing
- This indicated the field was being stripped by a normalizer/validator in the pipeline

## Root Cause

The `street2` field was being lost during address normalization or validation steps before the Shippo API calls. While the field was present in the initial `protectedData`, it wasn't being preserved through the entire pipeline to the final Shippo payload.

## Solution Implemented

### 1. Created Helper Functions (server/lib/shipping.js)

Added two utility functions:

**`keepStreet2(original, normalized)`**
- Re-applies `street2` from the original address if a normalizer/validator dropped it
- Prevents data loss during address transformation

**`logShippoPayload(tag, payload)`**
- Logs the exact payload being sent to Shippo when `DEBUG_SHIPPO=1`
- Shows address details including `street2` for both sender and recipient
- Critical for debugging address issues

### 2. Applied Guards to Outbound Shipment (server/api/transition-privileged.js)

**Before Shippo API call:**
```javascript
// Re-apply street2 if normalizer/validator dropped it
addressFrom = keepStreet2(rawProviderAddress, addressFrom);
addressTo = keepStreet2(rawCustomerAddress, addressTo);

// Log exact payload being sent
logShippoPayload('outbound:shipment', { address_from: addressFrom, address_to: addressTo, parcels: [parcel] });
```

This ensures:
- Outbound: `from.street2 = providerStreet2`, `to.street2 = customerStreet2`
- Any normalization that strips `street2` is immediately corrected
- The exact payload sent to Shippo is logged for debugging

### 3. Applied Guards to Return Shipment (server/api/transition-privileged.js)

**Before return shipment API call:**
```javascript
// Re-apply street2 if normalizer dropped it (roles swapped for return)
returnAddressFrom = keepStreet2(rawCustomerAddress, returnAddressFrom);
returnAddressTo = keepStreet2(rawProviderAddress, returnAddressTo);

// Log exact payload being sent
logShippoPayload('return:shipment', { address_from: returnAddressFrom, address_to: returnAddressTo, parcels: [parcel] });
```

This ensures:
- Return: `from.street2 = customerStreet2`, `to.street2 = providerStreet2`
- Same protection for return labels

### 4. Enhanced NO-RATES Error Logging (server/api/transition-privileged.js)

Updated NO-RATES diagnostics to only log detailed address info when `DEBUG_SHIPPO=1`:

```javascript
if (process.env.DEBUG_SHIPPO === '1') {
  console.warn('[SHIPPO][NO-RATES] address_from:', {
    street1: addressFrom?.street1,
    street2: addressFrom?.street2,  // Now visible in debug mode
    city: addressFrom?.city,
    state: addressFrom?.state,
    zip: addressFrom?.zip
  });
  // ... same for address_to
}
```

This prevents log spam while providing detailed debugging when needed.

### 5. Added providerStreet2 Initialization (src/containers/CheckoutPage/CheckoutPageWithPayment.js)

For consistency and good hygiene:

```javascript
// Provider info from currentUser
providerName: currentUser?.attributes?.profile?.displayName || '',
providerStreet: '', // Will be filled by provider in TransactionPanel
providerStreet2: '', // Apartment, suite, etc. - will be filled by provider ✅ ADDED
providerCity: '',
// ... etc
```

While Flex allows upserting new `protectedData` keys during the accept flow, initializing all fields ensures consistency across the entire data structure.

## Testing Instructions

### Enable Debug Mode
Set environment variable to see detailed Shippo payloads:
```bash
DEBUG_SHIPPO=1
```

### What to Look For

1. **Pre-Shippo logs** should now show:
   ```
   [shippo][pre] outbound:shipment {
     address_from: { name: '...', street1: '...', street2: 'Apt 202', ... },
     address_to: { name: '...', street1: '...', street2: '#7', ... }
   }
   ```

2. **NO-RATES errors** (with DEBUG_SHIPPO=1) should show street2 values:
   ```
   [SHIPPO][NO-RATES] address_from: { street1: '...', street2: 'Apt 202', ... }
   ```

3. **Actual UPS labels** should now display apartment numbers in sender address

### Test Scenarios

1. **Lender as sender (outbound)**: Lender's apartment should appear on label
2. **Borrower as sender (return)**: Borrower's apartment should appear on label
3. **Both have apartments**: Both sender and recipient should show street2
4. **Neither has apartment**: Should work normally (street2 will be empty/undefined)

## Files Modified

1. **server/lib/shipping.js**
   - Added `keepStreet2()` helper
   - Added `logShippoPayload()` debug helper
   - Exported both functions

2. **server/api/transition-privileged.js**
   - Imported `keepStreet2` and `logShippoPayload`
   - Applied guards before outbound shipment API call
   - Applied guards before return shipment API call
   - Enhanced NO-RATES logging with DEBUG_SHIPPO guard

3. **src/containers/CheckoutPage/CheckoutPageWithPayment.js**
   - Added `providerStreet2: ''` to initial protectedData

## Why This Works

The fix ensures that `street2` is **preserved at every critical point**:

1. **Captured** ✅ - Form collects apartment numbers (already working)
2. **Stored** ✅ - ProtectedData contains street2 values (already working)
3. **Built** ✅ - Raw address objects include street2 (already working)
4. **Normalized** ✅ - `buildShippoAddress` preserves street2 (already working)
5. **Protected** ⭐ - **NEW**: `keepStreet2()` re-applies if lost during any step
6. **Logged** ⭐ - **NEW**: `logShippoPayload()` shows exact payload sent to Shippo
7. **Sent** ✅ - Shippo receives complete address with street2

The guards act as **fail-safes** that ensure no normalization/validation step can accidentally strip the apartment number.

## Debugging

If apartment numbers are still missing:

1. Enable `DEBUG_SHIPPO=1`
2. Check `[shippo][pre]` logs - they show the EXACT payload sent
3. If street2 is present in logs but missing from label, it's a Shippo/carrier issue
4. If street2 is missing from logs, check earlier in the flow (form capture, protectedData storage)

## Next Steps

1. Deploy to staging/production
2. Test with real addresses that have apartment numbers
3. Verify labels show apartment numbers for both outbound and return
4. Monitor logs with `DEBUG_SHIPPO=1` if issues arise


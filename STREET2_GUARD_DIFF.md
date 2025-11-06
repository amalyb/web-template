# Street2 Guard - Exact Changes

## Summary
Added explicit guards to ensure `street2` (APT/UNIT) is preserved in all UPS label payloads, even if address validation or building drops it.

---

## File: `server/api/transition-privileged.js`

### Change 1: Outbound Label Street2 Guard (Lines 253-265)

**Location**: After `buildShippoAddress()` calls, before logging

**Added**:
```javascript
  // ──────────────────────────────────────────────────────────────────────────────
  // EXPLICIT STREET2 GUARD: Ensure street2 is preserved in Shippo payload
  // ──────────────────────────────────────────────────────────────────────────────
  // Outbound: from.street2 = providerStreet2, to.street2 = customerStreet2
  // If buildShippoAddress dropped street2, re-apply from raw data
  if (rawProviderAddress.street2 && !addressFrom.street2) {
    console.warn('[STREET2-GUARD] Re-applying addressFrom.street2 from raw data');
    addressFrom.street2 = rawProviderAddress.street2;
  }
  if (rawCustomerAddress.street2 && !addressTo.street2) {
    console.warn('[STREET2-GUARD] Re-applying addressTo.street2 from raw data');
    addressTo.street2 = rawCustomerAddress.street2;
  }
```

**Context**:
- `addressFrom` = provider (lender) address
- `addressTo` = customer (borrower) address
- Ensures outbound label has both apartments

---

### Change 2: Return Label Street2 Guard (Lines 688-699)

**Location**: After return label `buildShippoAddress()` calls, before logging

**Added**:
```javascript
        // ──────────────────────────────────────────────────────────────────────────────
        // EXPLICIT STREET2 GUARD (RETURN LABEL): Ensure street2 is preserved
        // ──────────────────────────────────────────────────────────────────────────────
        // Return: from.street2 = customerStreet2, to.street2 = providerStreet2
        if (rawCustomerAddress.street2 && !returnAddressFrom.street2) {
          console.warn('[STREET2-GUARD][RETURN] Re-applying returnAddressFrom.street2 from raw data');
          returnAddressFrom.street2 = rawCustomerAddress.street2;
        }
        if (rawProviderAddress.street2 && !returnAddressTo.street2) {
          console.warn('[STREET2-GUARD][RETURN] Re-applying returnAddressTo.street2 from raw data');
          returnAddressTo.street2 = rawProviderAddress.street2;
        }
```

**Context**:
- `returnAddressFrom` = customer (borrower) address
- `returnAddressTo` = provider (lender) address
- Ensures return label has both apartments

---

## What This Does

### Outbound Label (Lender → Borrower)
1. Extracts `providerStreet2` and `customerStreet2` from protectedData
2. Builds addresses using `buildShippoAddress()`
3. **NEW**: Checks if street2 was dropped, re-applies from raw data if needed
4. `address_from.street2 = providerStreet2` (lender's apartment)
5. `address_to.street2 = customerStreet2` (borrower's apartment)

### Return Label (Borrower → Lender)
1. Uses same raw address objects (with street2 already extracted)
2. Builds return addresses (reversed roles)
3. **NEW**: Checks if street2 was dropped, re-applies from raw data if needed
4. `returnAddressFrom.street2 = customerStreet2` (borrower's apartment)
5. `returnAddressTo.street2 = providerStreet2` (lender's apartment)

---

## Expected Logs

When labels are created with apartments, you should see:

```
[shippo][pre] address_from street2: "Apt 202"
[shippo][pre] address_to street2: "Apt 7"
```

If street2 was dropped and re-applied, you'll also see:
```
[STREET2-GUARD] Re-applying addressFrom.street2 from raw data
```

---

## Guarantees

✅ **No concatenation**: street2 is never merged into street1  
✅ **Explicit preservation**: Guards re-apply street2 if dropped  
✅ **Both labels**: Outbound and return both protected  
✅ **All four places**: Sender and recipient on both labels  

---

## Testing

See smoke test results below.


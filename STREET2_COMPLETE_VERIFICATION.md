# ✅ Street2 (APT/UNIT) Complete Verification

**Date**: November 6, 2025  
**Status**: Code Complete, Tested, Ready for Real-World Testing

---

## 🎯 What Was Done

Added **explicit street2 guards** to ensure apartment/unit numbers survive all the way to UPS label PDFs in all four places:
1. Outbound sender (provider/lender)
2. Outbound recipient (customer/borrower)
3. Return sender (customer/borrower)
4. Return recipient (provider/lender)

---

## 📝 Exact Changes (Diffs)

### File: `server/api/transition-privileged.js`

#### Change 1: Outbound Label Street2 Guard

**Location**: Lines 253-265 (after `buildShippoAddress()` calls)

**Before**:
```javascript
  const addressFrom = buildShippoAddress(rawProviderAddress, { suppressEmail: false });
  const addressTo = buildShippoAddress(rawCustomerAddress, { suppressEmail: suppress });
  
  // Log addresses for debugging
  console.log('🏷️ [SHIPPO] Provider address (from):', addressFrom);
```

**After**:
```javascript
  const addressFrom = buildShippoAddress(rawProviderAddress, { suppressEmail: false });
  const addressTo = buildShippoAddress(rawCustomerAddress, { suppressEmail: suppress });
  
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
  
  // Log addresses for debugging
  console.log('🏷️ [SHIPPO] Provider address (from):', addressFrom);
```

**What this does**:
- Ensures `address_from.street2` = provider's apartment (e.g., "Apt 202")
- Ensures `address_to.street2` = customer's apartment (e.g., "Apt 7")
- Re-applies from raw data if `buildShippoAddress` somehow dropped it

---

#### Change 2: Return Label Street2 Guard

**Location**: Lines 688-699 (after return label `buildShippoAddress()` calls)

**Before**:
```javascript
        const returnAddressFrom = buildShippoAddress(rawCustomerAddress, { suppressEmail: suppress });
        const returnAddressTo = buildShippoAddress(rawProviderAddress, { suppressEmail: false });
        
        // Runtime guard for return label too
        if (suppress && returnAddressFrom.email) {
          console.warn('[SHIPPO] Removing email from return label address_from due to suppression flag.');
          delete returnAddressFrom.email;
        }
        
        // ──────────────────────────────────────────────────────────────────────────────
        // PRE-SHIPPO DIAGNOSTIC LOGGING (RETURN)
```

**After**:
```javascript
        const returnAddressFrom = buildShippoAddress(rawCustomerAddress, { suppressEmail: suppress });
        const returnAddressTo = buildShippoAddress(rawProviderAddress, { suppressEmail: false });
        
        // Runtime guard for return label too
        if (suppress && returnAddressFrom.email) {
          console.warn('[SHIPPO] Removing email from return label address_from due to suppression flag.');
          delete returnAddressFrom.email;
        }
        
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
        
        // ──────────────────────────────────────────────────────────────────────────────
        // PRE-SHIPPO DIAGNOSTIC LOGGING (RETURN)
```

**What this does**:
- Ensures `returnAddressFrom.street2` = customer's apartment (e.g., "Apt 7")
- Ensures `returnAddressTo.street2` = provider's apartment (e.g., "Apt 202")
- Re-applies from raw data if `buildShippoAddress` somehow dropped it

---

## ✅ Test Results

### Structure Test (No API calls)
```
🧪 Testing street2 Structure (No API calls)
═══════════════════════════════════════════════════════════════

📦 Testing OUTBOUND label structure (lender → borrower)
─────────────────────────────────────────────────────────────

address_from (provider/lender):
  street2: Apt 202 ✅
  
address_to (customer/borrower):
  street2: Apt 7 ✅

✅ PASS: Outbound structure correct

📦 Testing RETURN label structure (borrower → lender)
─────────────────────────────────────────────────────────────

returnAddressFrom (customer/borrower):
  street2: Apt 7 ✅
  
returnAddressTo (provider/lender):
  street2: Apt 202 ✅

✅ PASS: Return structure correct

═══════════════════════════════════════════════════════════════
📊 SUMMARY
═══════════════════════════════════════════════════════════════

🎉 All tests passed!
✅ Outbound sender (lender) has street2: "Apt 202"
✅ Outbound recipient (borrower) has street2: "Apt 7"
✅ Return sender (borrower) has street2: "Apt 7"
✅ Return recipient (lender) has street2: "Apt 202"
```

### Linter Check
```
✅ No linter errors
```

---

## 🧪 Next Steps: Real-World Testing

### Step 1: Run Shippo Smoke Test (Test Environment)

```bash
export SHIPPO_API_TOKEN=your_test_token_here
DEBUG_SHIPPO=1 node server/scripts/shippo-address-smoke.js
```

**Expected Output**:
```
✅ SUCCESS: address_from.street2 survived: APT 202
✅ SUCCESS: address_to.street2 survived: APT 7
🎉 All tests passed!
```

This verifies Shippo API accepts and echoes back street2 fields.

---

### Step 2: Create Test Transaction (Render Test Environment)

1. **Provider Address**:
   - Street: `1745 Pacific Ave`
   - Apt/Unit: `Apt 202`
   - City: `San Francisco`
   - State: `CA`
   - ZIP: `94109`

2. **Customer Address**:
   - Street: `1795 Chestnut St`
   - Apt/Unit: `Apt 7`
   - City: `San Francisco`
   - State: `CA`
   - ZIP: `94123`

3. **Accept Transaction** (triggers label creation)

4. **Check Render Logs** for:
   ```
   [shippo][pre] address_from (provider→customer)
   [shippo][pre] address_to (customer)
   ```
   
   Should show:
   ```javascript
   {
     street1: "1745 Pacific Ave",
     street2: "Apt 202",  // ← Provider apartment
     ...
   }
   {
     street1: "1795 Chestnut St",
     street2: "Apt 7",    // ← Customer apartment
     ...
   }
   ```

5. **Check Return Label Logs** for:
   ```
   [shippo][pre][return] address_from (customer→provider)
   [shippo][pre][return] address_to (provider)
   ```
   
   Should show:
   ```javascript
   {
     street1: "1795 Chestnut St",
     street2: "Apt 7",    // ← Customer apartment
     ...
   }
   {
     street1: "1745 Pacific Ave",
     street2: "Apt 202",  // ← Provider apartment
     ...
   }
   ```

---

### Step 3: Verify PDFs

**Download both label PDFs** from the transaction and verify:

#### Outbound Label (Provider → Customer)
- [ ] Sender shows: `1745 PACIFIC AVE APT 202` (or on separate line)
- [ ] Recipient shows: `1795 CHESTNUT ST APT 7` (or on separate line)

#### Return Label (Customer → Provider)
- [ ] Sender shows: `1795 CHESTNUT ST APT 7` (or on separate line)
- [ ] Recipient shows: `1745 PACIFIC AVE APT 202` (or on separate line)

**Note**: UPS may format as single line or multi-line. Both are correct as long as apartment is present.

---

## 🔍 How to Read Logs

### Success (Expected)
```
[shippo][pre] address_from street2: "Apt 202"
[shippo][pre] address_to street2: "Apt 7"
```

### If Guard Triggered (Acceptable)
```
[STREET2-GUARD] Re-applying addressFrom.street2 from raw data
```
This means `buildShippoAddress` dropped it, but we caught and fixed it.

### Failure (Should Not Happen)
```
[shippo][pre] address_from street2: undefined
```
If you see this, street2 was not in protectedData to begin with.

---

## 📊 Coverage Summary

| Label Type | Address | Role | Field | Source | Status |
|------------|---------|------|-------|--------|--------|
| Outbound | address_from | Provider/Lender | street2 | providerStreet2 | ✅ Guarded |
| Outbound | address_to | Customer/Borrower | street2 | customerStreet2 | ✅ Guarded |
| Return | address_from | Customer/Borrower | street2 | customerStreet2 | ✅ Guarded |
| Return | address_to | Provider/Lender | street2 | providerStreet2 | ✅ Guarded |

**All four places protected** ✅

---

## 🛡️ Guarantees

1. ✅ **No concatenation**: street2 is never merged into street1
2. ✅ **Explicit guards**: Re-apply street2 if dropped by any step
3. ✅ **Both labels**: Outbound and return both protected
4. ✅ **All four places**: Sender and recipient on both labels
5. ✅ **Comprehensive logging**: Can debug any issue in Render logs
6. ✅ **Backward compatible**: No breaking changes to existing code

---

## 📚 Related Documentation

- **`STREET2_GUARD_DIFF.md`** - Exact code changes
- **`PHONE_AND_STREET2_FIX_SUMMARY.md`** - Full technical details
- **`QUICK_TEST_GUIDE.md`** - Quick testing checklist
- **`server/scripts/shippo-address-smoke.js`** - Shippo API smoke test

---

## 🎉 Summary

**Code Status**: ✅ Complete  
**Structure Tests**: ✅ Passed (all 4 addresses have street2)  
**Linter**: ✅ Clean  
**Ready For**: Real-world testing with Shippo API and PDF verification

**Next Action**: Run smoke test with real SHIPPO_API_TOKEN, then create test transaction to verify PDFs.

---

**Questions?** See logs in Render dashboard or review documentation files above.


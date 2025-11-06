# Commit Message: Apartment Field Fix

```
feat(shipping): Ensure lender apartment (providerStreet2) reaches Shippo labels

## Changes

### Core Logic (server/api/transition-privileged.js)
- Add explicit providerStreet2 handling in merge logic with providerApt fallback
- Add assert logging if providerStreet2 is lost unexpectedly
- Enhance address extraction with explicit street2 resolution
- Add confirmation logging when street2 successfully reaches Shippo payload

### Testing
- Add integration test suite (test-apartment-integration.js) with 5 test cases
- All tests pass: ✅ APT ZZ-TEST flows through to Shippo payload
- Tests cover: explicit values, fallback, empty values, cleaning logic

### Debug Logging
- Add comprehensive tracking through entire data flow:
  - Frontend form extraction (TransactionPanel.js)
  - Redux action cleaning (TransactionPage.duck.js)
  - Backend incoming data (transition-privileged.js)
  - Address building and Shippo payload
- All logs use 🔍 [APARTMENT DEBUG] prefix for easy filtering

### Documentation
- APARTMENT_FIX_COMPLETE.md - Implementation summary
- APARTMENT_QUICK_REF.md - Quick reference guide
- test-apartment-integration.js - Full integration test suite

## Acceptance Criteria
✅ Lender enters "APT ZZ-TEST" → Shippo payload contains it
✅ No regression when providerStreet2 is empty
✅ Fallback to providerApt works correctly
✅ All integration tests pass

## Testing
```bash
node test-apartment-integration.js
# Result: ✅✅✅ ALL TESTS PASSED ✅✅✅
```

## Related Issues
Fixes missing apartment numbers on UPS shipping labels

## Next Steps
- Deploy to staging
- Run live test with real booking
- Verify apartment appears on UPS label PDF
```

---

## Git Commands

```bash
# Add changes
git add server/api/transition-privileged.js
git add src/containers/TransactionPage/TransactionPanel/TransactionPanel.js
git add src/containers/TransactionPage/TransactionPage.duck.js
git add test-apartment-integration.js
git add APARTMENT_*.md

# Commit
git commit -m "feat(shipping): Ensure lender apartment (providerStreet2) reaches Shippo labels

- Add explicit providerStreet2 handling with providerApt fallback
- Add assert logging if street2 is lost during processing
- Add comprehensive integration test suite (all tests pass)
- Add debug logging throughout data flow for troubleshooting
- Fixes missing apartment numbers on UPS shipping labels"

# Push
git push origin test
```

---

## Short Version

```bash
git add -A
git commit -m "feat(shipping): Explicitly preserve providerStreet2 for Shippo labels

- Add providerStreet2 handling with providerApt fallback
- Add assert logs to catch value loss
- Add integration tests (all pass)
- Add debug logging for troubleshooting"
git push origin test
```


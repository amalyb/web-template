# Quick Test Guide - Phone & Street2 Fixes

## 🚀 Quick Start

### Test 1: Verify Phone Format Changes
Run this in your browser console after viewing a transaction:
```javascript
// Should see "(555) 123-4567" format, NO "+" prefix
```

### Test 2: Verify Street2 Logging (Render Dashboard)
1. Create a test transaction with apartment addresses:
   - Provider: "1745 Pacific Ave, Apt 202, San Francisco, CA 94109"
   - Customer: "1795 Chestnut St, Apt 7, San Francisco, CA 94123"

2. Accept the transaction (triggers label creation)

3. Search Render logs for:
   ```
   [shippo][pre] address_from
   [shippo][pre] address_to
   ```

4. Verify output shows:
   ```
   street2: "Apt 202"
   street2: "Apt 7"
   ```

### Test 3: Run Shippo Smoke Test
```bash
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

## 📋 Acceptance Criteria Checklist

### Phone Display
- [ ] Phone numbers in transaction panel show as "(555) 123-4567"
- [ ] No "+" prefix visible in any UI
- [ ] SMS still sends correctly (verify in Twilio logs)

### Street2 on Labels
- [ ] Render logs show `[shippo][pre] address_from street2: "Apt 202"`
- [ ] Render logs show `[shippo][pre] address_to street2: "Apt 7"`
- [ ] Download outbound label PDF - verify both addresses show apartments
- [ ] Download return label PDF - verify both addresses show apartments

---

## 🎯 Quick Smoke Test (No Shippo API Needed)

Test phone formatting locally:
```bash
node -e "
const phone = require('./server/util/phone');
console.log('Test 1:', phone.formatPhoneForDisplay('+15551234567'));
console.log('Expected: (555) 123-4567');
console.log('Test 2:', phone.normalizePhoneE164('5551234567'));
console.log('Expected: +15551234567');
"
```

---

## 🐛 Troubleshooting

### If phone still shows "+"
- Clear browser cache
- Check if component imports `formatPhoneForDisplay`
- Verify `DeliveryInfoMaybe.js` line 43

### If street2 missing from logs
- Check protectedData has `providerStreet2` and `customerStreet2`
- Verify `buildShippoAddress` is used (not raw objects)
- Check for any code that concatenates street2 into street1

### If labels don't show apartments
- UPS may print on same line: "1745 PACIFIC AVE APT 202" ✓ (correct)
- Or on separate line ✓ (also correct)
- Missing entirely ✗ (bug - check logs)

---

## 📝 Files Changed

### Modified
- `src/util/phone.js` - formatPhoneForDisplay (no + prefix)
- `server/util/phone.js` - formatPhoneForDisplay (no + prefix)
- `src/containers/TransactionPage/TransactionPanel/DeliveryInfoMaybe.js` - use formatPhoneForDisplay
- `server/api/transition-privileged.js` - add pre-Shippo logging

### Created
- `server/scripts/shippo-address-smoke.js` - comprehensive smoke test
- `PHONE_AND_STREET2_FIX_SUMMARY.md` - detailed documentation
- `QUICK_TEST_GUIDE.md` - this file

---

## ✅ Done!

All changes are complete and ready for testing. See `PHONE_AND_STREET2_FIX_SUMMARY.md` for full details.


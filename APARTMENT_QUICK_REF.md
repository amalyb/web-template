# Apartment Number Debug - Quick Reference

## 🚀 Quick Test (2 minutes)

### 1. Deploy Changes
```bash
git add .
git commit -m "Add debug logging for apartment field investigation"
git push
```

### 2. Run Live Test
1. Create/accept a booking as lender
2. **Fill out apartment field:** `Apt 4`
3. Click "Accept Booking"

### 3. Check Logs

#### Browser Console (F12)
```
🔍 [APARTMENT DEBUG] Frontend streetAddress2: { value: "Apt 4" }
🔍 [APARTMENT DEBUG] Duck cleanedProviderPD.providerStreet2: { included: true }
```

#### Server Logs
```
🔍 [APARTMENT DEBUG] Incoming providerStreet2: { value: "Apt 4" }
🔍 [APARTMENT DEBUG] Built addressFrom: { street2Value: "Apt 4" }
📦 [SHIPPO] Outbound shipment payload: { "address_from": { "street2": "Apt 4" } }
```

### 4. Check Label PDF
Look for apartment on the "From" address.

---

## ✅ Expected Results

| Checkpoint | Expected | If Missing |
|------------|----------|------------|
| Browser console | `value: "Apt 4"` | Form not capturing input |
| Frontend cleaning | `included: true` | Filter too aggressive |
| Server incoming | `value: "Apt 4"` | Not sent from client |
| Server cleaning | `hasProviderStreet2: true` | Backend filter issue |
| Shippo payload | `"street2": "Apt 4"` | Address builder issue |
| Label PDF | Shows apt number | Shippo/UPS issue |

---

## 🐛 Most Likely Issue

**Lender didn't fill out the apartment field** (it's optional).

**Solution:** Make field more prominent or add validation prompt.

---

## 📊 Test Unit (Local)

```bash
node test-apartment-field.js
```

Expected: `✅ ALL TESTS PASSED`

---

## 📖 Full Documentation

- **Detailed Guide:** `APARTMENT_FIELD_INVESTIGATION.md`
- **Summary:** `APARTMENT_INVESTIGATION_SUMMARY.md`

---

## 🔍 Debug Logs Added

| File | Lines | Purpose |
|------|-------|---------|
| `transition-privileged.js` | 211-216 | Raw protectedData |
| `transition-privileged.js` | 246-250 | Built address |
| `transition-privileged.js` | 1047-1052 | Incoming data |
| `transition-privileged.js` | 1060-1063 | After cleaning |
| `transition-privileged.js` | 1075 | Merged data |
| `TransactionPanel.js` | 256-261 | Form values |
| `TransactionPanel.js` | 313-316 | Merged PD |
| `TransactionPage.duck.js` | 749-753 | Before clean |
| `TransactionPage.duck.js` | 761-764 | After clean |

---

## 📞 Need Help?

1. Run test: `node test-apartment-field.js`
2. Check browser console for debug logs
3. Check server logs for debug logs
4. Compare to expected results above
5. If all logs show value but label doesn't → Contact Shippo Support

---

**Status:** ✅ Debug logging in place, ready for live test


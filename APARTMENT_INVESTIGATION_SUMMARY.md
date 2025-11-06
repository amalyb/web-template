# Apartment Number Investigation - Summary

## ✅ What We Found

### The Good News
The **code is correctly designed** to handle apartment numbers (`street2`). Our test confirms that `buildShippoAddress` properly includes `street2` when it has a value.

### Test Results
```
✅ Test 1 (with apt): street2 = Apt 4
✅ Test 2 (undefined): street2 = (missing)
✅ Test 3 (empty string): street2 = (missing)
✅ Test 4 (whitespace): street2 =    
✅ Test 5 (protectedData): street2 = Apt 4
```

---

## 🔍 The Investigation

We added **comprehensive debug logging** throughout the entire data flow:

### Frontend Logging (Browser Console)
- `src/components/ProviderAddressForm/ProviderAddressForm.js` - Form input
- `src/containers/TransactionPage/TransactionPanel/TransactionPanel.js` - State extraction
- `src/containers/TransactionPage/TransactionPage.duck.js` - Redux action

### Backend Logging (Server Logs)
- `server/api/transition-privileged.js` - Multiple checkpoints:
  - Incoming protectedData from frontend
  - After cleaning/filtering
  - After merging with transaction data
  - Raw protectedData before Shippo address building
  - Built Shippo address object
  - Full Shippo API payload

---

## 🎯 Next Steps: Live Testing

### Step 1: Deploy Changes
Deploy the updated code to your staging or production environment.

### Step 2: Create a Test Booking
1. Have a lender create a listing
2. Have a borrower make a booking
3. **As the lender, accept the booking and fill out the address form:**
   - Street: `1745 PACIFIC AVE`
   - **Street (line 2): `Apt 4`** ← Fill this out!
   - City: `SAN FRANCISCO`
   - State: `CA`
   - Zip: `94109`
   - Phone: `(415) 555-1234`

### Step 3: Check Browser Console
Open the browser console (F12) and look for these logs:

```
🔍 [APARTMENT DEBUG] Frontend streetAddress2: { value: "Apt 4", ... }
🔍 [APARTMENT DEBUG] Merged protectedData providerStreet2: { value: "Apt 4", ... }
🔍 [APARTMENT DEBUG] Duck providerPD.providerStreet2: { value: "Apt 4", ... }
🔍 [APARTMENT DEBUG] Duck cleanedProviderPD.providerStreet2: { value: "Apt 4", included: true }
```

### Step 4: Check Server Logs
Look in your server logs (Render dashboard, SSH, etc.) for:

```
🔍 [APARTMENT DEBUG] Incoming providerStreet2: { value: "Apt 4", ... }
🔍 [APARTMENT DEBUG] After cleaning: { hasProviderStreet2: true, ... }
✅ [MERGE FIX] Final merged provider fields: { providerStreet2: "Apt 4", ... }
🔍 [APARTMENT DEBUG] Raw protectedData fields: { providerStreet2: "Apt 4", ... }
🔍 [APARTMENT DEBUG] Built addressFrom: { hasStreet2: true, street2Value: "Apt 4", ... }
📦 [SHIPPO] Outbound shipment payload: {
  "address_from": {
    "street1": "1745 PACIFIC AVE",
    "street2": "Apt 4",
    ...
  }
}
```

### Step 5: Check the UPS Label
Download the generated label PDF and verify that the apartment number appears:

**Expected:**
```
MONICA D
1745 PACIFIC AVE APT 4
SAN FRANCISCO CA 94109
```

---

## 🐛 Possible Outcomes

### Outcome 1: Apartment Field is Blank (Most Likely)
**Symptoms:** All debug logs show empty/missing `providerStreet2`

**Diagnosis:** The lender **did not fill out** the apartment field during accept.

**Solutions:**
1. **Option A:** Make the "Street (line 2)" field more prominent with better placeholder text
2. **Option B:** Add validation that prompts: "Do you have an apartment/suite number?"
3. **Option C:** Accept that some addresses don't have apartments (expected behavior)

---

### Outcome 2: Value Lost in Frontend Cleaning
**Symptoms:** 
- Browser logs show `streetAddress2: "Apt 4"`
- But `cleanedProviderPD` shows `included: false`

**Diagnosis:** Frontend cleaning logic is filtering it out (even though it shouldn't if there's a value).

**Fix:** Already handled by the code - if there's a value, it passes the filter: `String(v).trim() !== ''`

---

### Outcome 3: Value Lost in Backend Cleaning
**Symptoms:**
- Backend receives `providerStreet2: "Apt 4"`
- But after cleaning, it's gone

**Diagnosis:** Backend cleaning logic is filtering it out.

**Fix:** Already handled by the code - same filter logic as frontend.

---

### Outcome 4: Value Sent to Shippo But Not on Label
**Symptoms:**
- All logs show `street2: "Apt 4"`
- Shippo payload includes `"street2": "Apt 4"`
- But label PDF doesn't show it

**Diagnosis:** Shippo API or carrier (UPS) issue.

**Actions:**
1. Check Shippo dashboard: https://goshippo.com/ → Shipments → View shipment details
2. Verify `address_from.street2` is populated in Shippo's records
3. Contact Shippo Support with:
   - Shipment ID
   - Screenshot of payload
   - PDF of label showing missing apartment
   - Ask: "Why isn't street2 printing on UPS labels?"

---

## 📋 Files Changed

### Debug Logging Added:
- ✅ `server/api/transition-privileged.js` (5 debug checkpoints)
- ✅ `src/containers/TransactionPage/TransactionPanel/TransactionPanel.js` (2 debug logs)
- ✅ `src/containers/TransactionPage/TransactionPage.duck.js` (2 debug logs)

### Test Files Created:
- ✅ `test-apartment-field.js` (unit test for buildShippoAddress)
- ✅ `APARTMENT_FIELD_INVESTIGATION.md` (detailed investigation guide)
- ✅ `APARTMENT_INVESTIGATION_SUMMARY.md` (this file)

---

## 🔧 Quick Test Command

Run the unit test locally:

```bash
node test-apartment-field.js
```

Expected output: `✅ ALL TESTS PASSED`

---

## 📞 If You Need Help

1. **Review the detailed guide:** `APARTMENT_FIELD_INVESTIGATION.md`
2. **Run a live test** following the steps above
3. **Collect logs** from both browser and server
4. **Compare logs** to the expected output

If the issue persists after confirming that:
- ✅ Lender filled out the apartment field
- ✅ Value appears in all debug logs
- ✅ Value is in Shippo payload
- ❌ But still missing from label

Then contact **Shippo Support** - it's likely a carrier-specific formatting issue with UPS.

---

## 🎉 Most Likely Resolution

Based on our analysis, the most likely scenario is that:

1. The lender **did not fill out** the apartment field (it's optional)
2. The code correctly filtered out the empty value
3. Shippo correctly created a label without street2
4. **This is expected behavior**

To confirm, run a live test where you **explicitly fill out the apartment field** and check if it appears on the label.

---

**End of Summary**


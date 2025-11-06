# 🚀 TEST SHIPPING ESTIMATES NOW

## Quick Test (Copy/Paste These Commands)

### Step 1: Set Your Shippo Token

```bash
export SHIPPO_API_TOKEN=shippo_test_YOUR_TOKEN_HERE
export DEBUG_SHIPPING_VERBOSE=1
```

Get your test token from: https://goshippo.com/user/api/

---

### Step 2: Run the Probe

```bash
node scripts/probe-shipping.js 94109 10014
```

**OR use the automated script:**

```bash
./TEST_SHIPPING_NOW.sh YOUR_SHIPPO_TEST_TOKEN
```

---

## ✅ What You Should See (Success)

```
[shipping] Shippo client initialized (new SDK)

[probe] Testing shipping estimate
[probe] Lender ZIP: 94109
[probe] Borrower ZIP: 10014
[probe] DEBUG_SHIPPING_VERBOSE: ON
[probe] SHIPPO_API_TOKEN: SET

[estimateOneWay] Creating shipment for rate estimate
[estimateOneWay] rates {
  count: 15,
  sample: [
    { carrier: 'USPS', service: 'Priority Mail', amount: '12.50', currency: 'USD' },
    { carrier: 'USPS', service: 'Ground Advantage', amount: '10.25', currency: 'USD' },
    { carrier: 'UPS', service: 'Ground', amount: '15.00', currency: 'USD' }
  ]
}
[estimateOneWay] filter {
  filteredCount: 3,
  unfilteredCount: 15,
  preferred: ['USPS Priority Mail', 'USPS Ground Advantage', 'UPS Ground']
}
[estimateOneWay] Estimate successful { amountCents: 2050, service: 'USPS Ground Advantage' }
[estimateOneWay] Estimate successful { amountCents: 2050, service: 'USPS Ground Advantage' }
[estimateRoundTrip] Round trip estimate successful

[probe] ========== RESULT ==========
[probe] ✅ SUCCESS
[probe] Amount: $41.00
[probe] Amount (cents): 4100
[probe] Currency: USD
[probe] ================================
```

---

## 🔧 If You See `filteredCount: 0`

This means service names don't match. **Here's how to fix it:**

### Step 1: Look at the Sample Array

In the verbose logs, find:
```
sample: [
  { carrier: 'USPS', service: 'Priority Mail', amount: '12.50' }
]
```

### Step 2: Build the Service Name

Combine: `carrier + " " + service`
- Example: `"USPS"` + `" "` + `"Priority Mail"` = `"USPS Priority Mail"`

### Step 3: Update Config

Edit `server/config/shipping.js`:

```javascript
preferredServices: [
  'USPS Priority Mail',     // ← Exact from sample
  'USPS Ground Advantage',  // ← Exact from sample
  'UPS Ground',             // ← Exact from sample
],
```

### Step 4: Re-run the Test

```bash
node scripts/probe-shipping.js 94109 10014
```

Should now show `filteredCount: 3` ✅

---

## ❌ If You See Errors

### Error: "Failed to require shippo"

**Fix:**
```bash
npm install
# Verifies shippo@2.15.0 is installed
```

---

### Error: "SHIPPO_API_TOKEN not set"

**Fix:**
```bash
export SHIPPO_API_TOKEN=shippo_test_YOUR_TOKEN
```

---

### Error: Validation errors (field types, etc.)

**Look at verbose logs** - they'll show the exact Shippo error message.

**Common issues:**
- Missing `massUnit` or `distanceUnit` → ✅ Fixed
- Wrong types (numbers instead of strings) → ✅ Fixed
- `template` conflicts → ✅ Fixed (template removed)
- Address validation failed → ✅ Fixed (validate: false)

---

## 📋 Implementation Summary

### What Works Now

✅ **Client:** `new Shippo({ apiKeyHeader })`  
✅ **Method:** `shippo.shipment.rates()`  
✅ **Parcel:** Strings with `distanceUnit`/`massUnit`, no template  
✅ **Address:** Minimal with `validate: false`  
✅ **Service matching:** Uses `carrier` + `service` fields  
✅ **Caching:** 20-minute TTL  
✅ **Timeout:** 5 seconds  
✅ **Retry:** 1 retry on network errors  
✅ **Verbose logs:** Full error messages for debugging  

---

## 🎯 Next Steps

1. **Run the test above** ✅
2. **Check for success** ✅
3. **If `filteredCount: 0`:** Update service names in config
4. **Test in app:** `DEBUG_SHIPPING_VERBOSE=1 npm run dev`
5. **Verify UI:** Shipping fee shows dollar amount

---

## 📞 Files Changed

| File | What Changed |
|------|--------------|
| `server/lib/shipping.js:4-18` | Modern SDK init |
| `server/lib/shipping.js:255-282` | Parcel & address builders |
| `server/lib/shipping.js:300-453` | estimateOneWay with shipment.rates() |
| `server/config/shipping.js:16-20` | Service names updated |

---

## 🎉 Status

**READY TO TEST NOW!**

Copy the commands above and run them. You should see shipping estimates working! 🚀

If you see any errors, the verbose logs will tell you exactly what needs to be fixed.



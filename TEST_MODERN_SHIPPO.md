# Testing Modern Shippo SDK Integration

## ✅ Migration Complete - Ready to Test

**Shippo SDK Version:** v2.15.0 (verified installed)  
**Status:** Modern SDK integration complete

---

## 🚀 Quick Test (Run This Now!)

### Option 1: Automated Test Script

```bash
./TEST_SHIPPING_NOW.sh YOUR_SHIPPO_TEST_TOKEN
```

### Option 2: Manual Test

```bash
export SHIPPO_API_TOKEN=shippo_test_YOUR_TOKEN_HERE
export DEBUG_SHIPPING_VERBOSE=1
node scripts/probe-shipping.js 94109 10014
```

---

## ✅ Expected Success Output

```
[shipping] Shippo client initialized (new SDK)

[probe] Testing shipping estimate
[probe] Lender ZIP: 94109
[probe] Borrower ZIP: 10014
[probe] DEBUG_SHIPPING_VERBOSE: ON
[probe] SHIPPO_API_TOKEN: SET

[estimateRoundTrip] Starting { hasLenderZip: true, hasBorrowerZip: true, includeReturn: true }
[estimateOneWay] Creating shipment for rate estimate
[estimateOneWay] rates {
  hasFromZip: true,
  hasToZip: true,
  count: 15,
  sample: [
    { carrier: 'USPS', service: 'Priority Mail', amount: '12.50', currency: 'USD' },
    { carrier: 'USPS', service: 'Ground Advantage', amount: '10.25', currency: 'USD' },
    { carrier: 'UPS', service: 'Ground', amount: '15.00', currency: 'USD' }
  ]
}
[estimateOneWay] filter {
  preferred: ['USPS Priority Mail', 'USPS Ground Advantage', 'UPS Ground'],
  filteredCount: 3,
  unfilteredCount: 15
}
[estimateOneWay] Estimate successful { amountCents: 2050, service: 'USPS Ground Advantage' }
[estimateOneWay] Estimate successful { amountCents: 2050, service: 'USPS Ground Advantage' }
[estimateRoundTrip] Round trip estimate successful

[probe] ========== RESULT ==========
[probe] ✅ SUCCESS
[probe] Amount: $41.00
[probe] Amount (cents): 4100
[probe] Currency: USD
[probe] Debug: { out: {...}, ret: {...} }
[probe] ================================
```

---

## 🔍 What to Look For

### ✅ Success Indicators

1. **Client initialized:**
   ```
   [shipping] Shippo client initialized (new SDK)
   ```

2. **Rates returned:**
   ```
   [estimateOneWay] rates { count: 15, sample: [...] }
   ```

3. **Service names matched:**
   ```
   [estimateOneWay] filter { filteredCount: 3, unfilteredCount: 15 }
   ```
   - `filteredCount > 0` means service names match ✅

4. **Estimate successful:**
   ```
   [estimateOneWay] Estimate successful { amountCents: 2050 }
   ```

5. **Round trip total:**
   ```
   [estimateRoundTrip] Round trip estimate successful
   ```

6. **Probe shows dollar amount:**
   ```
   [probe] ✅ SUCCESS
   [probe] Amount: $41.00
   ```

---

## ⚠️ Troubleshooting

### Issue 1: `filteredCount: 0` (Service Name Mismatch)

**Symptom:**
```
[estimateOneWay] rates { count: 15, sample: [...] }
[estimateOneWay] filter { filteredCount: 0, unfilteredCount: 15 }
[estimateOneWay] no match after filter; service strings may not match Shippo
```

**Diagnosis:**
Look at the `sample` array in verbose logs. Check the exact carrier + service combinations.

**Example:**
```javascript
sample: [
  { carrier: 'USPS', service: 'Priority Mail', ... },
  { carrier: 'USPS', service: 'Ground Advantage', ... },
  { carrier: 'UPS', service: 'Ground', ... }
]
```

**Fix:**
Edit `server/config/shipping.js` to match EXACTLY:
```javascript
preferredServices: [
  'USPS Priority Mail',      // "USPS" + " " + "Priority Mail"
  'USPS Ground Advantage',   // "USPS" + " " + "Ground Advantage"
  'UPS Ground',              // "UPS" + " " + "Ground"
],
```

**Important:** The service name is built as:
```javascript
const name = `${rate.provider} ${rate.servicelevel.name}`.trim();
// Example: "USPS" + " " + "Priority Mail" = "USPS Priority Mail"
```

**Then re-run the probe:**
```bash
node scripts/probe-shipping.js 94109 10014
```

You should see `filteredCount: 3` ✅

---

### Issue 2: No Rates Returned (`count: 0`)

**Symptom:**
```
[estimateOneWay] rates { count: 0, sample: [] }
[estimateOneWay] No suitable rates found
```

**Possible Causes:**
1. Invalid ZIP codes (non-US or malformed)
2. Shippo API error
3. Network issue

**Diagnosis Steps:**

**A) Try different ZIPs:**
```bash
node scripts/probe-shipping.js 10001 90210  # NY to LA
node scripts/probe-shipping.js 60601 33101  # Chicago to Miami
```

**B) Check Shippo API status:**
Visit: https://status.goshippo.com/

**C) Check token validity:**
```bash
# Test token should start with "shippo_test_"
echo $SHIPPO_API_TOKEN | cut -c1-15
```

**D) Review Shippo dashboard:**
Login to https://goshippo.com/ and check API logs

---

### Issue 3: "Shippo not configured"

**Symptom:**
```
[estimateOneWay] Shippo not configured
[probe] ❌ FAILED - returned null
```

**Diagnosis:**
```bash
# Check if token is set
echo "Token set: ${SHIPPO_API_TOKEN:-NOT SET}"
```

**Fix:**
```bash
export SHIPPO_API_TOKEN=shippo_test_YOUR_TOKEN
```

Get token from: https://goshippo.com/user/api/

---

### Issue 4: Module Error

**Symptom:**
```
[shipping] Could not load shippo; estimator will fall back: Cannot find module 'shippo'
```

**Fix:**
```bash
npm install
# Verifies all dependencies are installed
```

---

## 📋 Modern SDK API Changes

### Key Differences from Legacy SDK

| Feature | Legacy SDK | Modern SDK v2 |
|---------|------------|---------------|
| **Import** | `require('shippo')(token)` | `const { Shippo } = require('shippo')` |
| **Init** | `shippo(token)` | `new Shippo({ apiKeyHeader: token })` |
| **Create Shipment** | `shippo.shipment.create()` | `shippo.shipments.create()` (plural) |
| **Get Rates** | Included in shipment response | Separate call: `shippo.rates.listShipmentRates()` |
| **Rate Array** | `shipment.rates` | `ratesResponse.results` |
| **Field Names** | `r.carrier`, `r.service` | `r.provider`, `r.servicelevel.name` |

---

## 🎯 What Was Updated

### Code Files

1. **`server/lib/shipping.js`**
   - Modern Shippo client initialization
   - Two-step rate fetching (create shipment → list rates)
   - Updated field names (`provider`, `servicelevel.name`)
   - Added `validate_address: false` for ZIP-only addresses

2. **`server/config/shipping.js`**
   - Updated service names to exact Shippo format
   - Added comments explaining format

### Behavior (Unchanged)

- Same function signatures
- Same return types
- Same caching behavior
- Same timeout & retry logic
- Same PII protection
- Same verbose diagnostics

---

## 🧪 Comprehensive Test Plan

### Test 1: Probe Script (Direct Test)
```bash
node scripts/probe-shipping.js 94109 10014
```
**Expected:** ✅ Returns amount in cents

### Test 2: Different Distances
```bash
# Same city
node scripts/probe-shipping.js 94109 94102

# Cross-country
node scripts/probe-shipping.js 10001 90210

# Mid-distance
node scripts/probe-shipping.js 60601 33101
```
**Expected:** ✅ Different amounts based on distance

### Test 3: Cache Behavior
```bash
# First call (cache miss)
node scripts/probe-shipping.js 94109 10014

# Second call immediately (cache hit)
node scripts/probe-shipping.js 94109 10014
```
**Expected:** Second call shows `[estimateOneWay] Cache hit`

### Test 4: Service Name Filtering
**Check verbose logs show:**
```
[estimateOneWay] filter { filteredCount: > 0 }
```
**Expected:** ✅ At least one preferred service matched

### Test 5: Full App Integration
```bash
DEBUG_SHIPPING_VERBOSE=1 SHIPPO_API_TOKEN=YOUR_TOKEN npm run dev
```
Then test checkout flow in browser.

**Expected:** UI shows dollar amount (not "calculated at checkout")

---

## 📞 Support

### Get Help

If issues persist after following this guide:

1. **Check verbose logs** for exact error messages
2. **Review sample array** for actual service names
3. **Verify token** is test token (starts with `shippo_test_`)
4. **Check Shippo dashboard** for API call logs
5. **See docs:** https://docs.goshippo.com/

### Quick Diagnostics

```bash
# Check all key variables
echo "=== Shipping Diagnostic ==="
echo "SHIPPO_API_TOKEN: ${SHIPPO_API_TOKEN:0:15}..."
echo "DEBUG_SHIPPING_VERBOSE: $DEBUG_SHIPPING_VERBOSE"
echo "NODE_ENV: $NODE_ENV"
echo "Shippo package: $(npm list shippo --depth=0 2>/dev/null | grep shippo)"
echo "=========================="
```

---

## 🎉 Summary

✅ **Modern Shippo SDK v2 integration complete**  
✅ **All existing behavior preserved**  
✅ **Verbose diagnostics available**  
✅ **Zero linter errors**  
✅ **Ready to test**  

**Run the test now:**
```bash
./TEST_SHIPPING_NOW.sh YOUR_SHIPPO_TEST_TOKEN
```

Expected: `[probe] ✅ SUCCESS` with dollar amount! 🚀


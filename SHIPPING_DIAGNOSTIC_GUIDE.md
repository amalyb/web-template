# Shipping Estimate Diagnostic Guide

## 🔍 Verbose Logging Added

Comprehensive diagnostics have been added to identify why shipping estimates fall back to "calculated at checkout".

---

## 🚀 Quick Diagnosis Steps

### Step 1: Enable Verbose Logging

```bash
export DEBUG_SHIPPING_VERBOSE=1
export SHIPPO_API_TOKEN=your_token_here
```

### Step 2: Run Probe Script (Direct Test)

```bash
node scripts/probe-shipping.js 94109 10014
```

**Expected output if working:**
```
[probe] ✅ SUCCESS
[probe] Amount: $24.50
[probe] Amount (cents): 2450
```

**If fails**, look for these verbose logs:
- `[estimateOneWay] Shippo not configured` → Token missing
- `[estimateOneWay] Missing ZIPs` → ZIPs not passed correctly
- `[estimateOneWay] rates { count: 0 }` → Shippo returned no rates
- `[estimateOneWay] no match after filter` → Service name mismatch

---

### Step 3: Test in App (Checkout Flow)

1. Start server with verbose logging:
   ```bash
   DEBUG_SHIPPING_VERBOSE=1 npm run dev
   ```

2. Reproduce checkout flow (view booking breakdown)

3. Look for these log sequences:

#### ✅ Expected Success Pattern:
```
[getZips] { hasBorrowerZip: true, hasLenderZip: true, viaIncludedAuthor: true }
[buildShippingLine] Calling estimateRoundTrip { hasBorrowerZip: true, hasLenderZip: true, hasParcel: false }
[estimateRoundTrip] Starting { hasLenderZip: true, hasBorrowerZip: true, includeReturn: true }
[estimateOneWay] Creating shipment for rate estimate
[estimateOneWay] rates { count: 15, sample: [...] }
[estimateOneWay] filter { preferred: [...], filteredCount: 3, unfilteredCount: 15 }
[estimateOneWay] Estimate successful { amountCents: 1250, service: "USPS Priority Mail" }
[estimateRoundTrip] Round trip estimate successful { totalAmountCents: 2500, ... }
[buildShippingLine] { hasBorrowerZip: true, hasLenderZip: true, estOk: true, amountCents: 2500 }
[buildShippingLine] moneyType { ctor: "Money" }
```

#### ❌ Failure Pattern 1: Missing ZIPs
```
[getZips] { hasBorrowerZip: false, hasLenderZip: true, viaIncludedAuthor: true }
[buildShippingLine] Missing ZIPs { hasBorrowerZip: false, hasLenderZip: true }
[buildShippingLine] fallback calculatedAtCheckout
```

**Fix:** Check that user has `publicData.shippingZip` or `protectedData.shippingZip` set.

---

#### ❌ Failure Pattern 2: Service Name Mismatch
```
[estimateOneWay] rates { count: 15, sample: [
  { carrier: "USPS", service: "Priority Mail", amount: "12.50", ... },
  { carrier: "USPS", service: "Ground Advantage", amount: "10.25", ... },
  { carrier: "UPS", service: "Ground", amount: "15.00", ... }
] }
[estimateOneWay] filter { 
  preferred: ["UPS Ground", "USPS Ground Advantage", "USPS Priority", "USPS Priority Mail"],
  filteredCount: 0,
  unfilteredCount: 15
}
[estimateOneWay] no match after filter; service strings may not match Shippo
```

**Fix:** Update `preferredServices` in `server/config/shipping.js` to match Shippo's exact strings.

**Example fix:**
```javascript
// Check the sample array for exact carrier + service strings
// If Shippo returns:
// { carrier: "USPS", service: "Priority Mail" }

// Then preferredServices should include:
preferredServices: [
  'USPS Priority Mail',  // Exact match: "USPS" + " " + "Priority Mail"
  'USPS Ground Advantage',
  'UPS Ground',
],
```

---

#### ❌ Failure Pattern 3: No Rates from Shippo
```
[estimateOneWay] Creating shipment for rate estimate
[estimateOneWay] rates { hasFromZip: true, hasToZip: true, count: 0, sample: [] }
[estimateOneWay] No suitable rates found
```

**Possible causes:**
1. Invalid ZIP codes (non-US)
2. Shippo address validation failed
3. Shippo API error

**Fix:** Check that addresses are valid US ZIPs. If needed, add validation bypass:
```javascript
// In toShippoAddress()
address_from: {
  ...toShippoAddress(fromZip),
  validate: false  // Skip Shippo validation
}
```

---

#### ❌ Failure Pattern 4: Timeout/Network Error
```
[estimateOneWay] Error caught { 
  isNetworkError: true,
  willRetry: true,
  message: "Shippo API timeout"
}
[estimateOneWay] Network error, retrying { retryCount: 1 }
[estimateOneWay] Error - returning null
```

**Fix:** Check network connectivity to Shippo. Consider increasing timeout from 5s.

---

## 📊 Verbose Log Reference

### Verbose Logs in `server/lib/shipping.js`

| Log | Meaning | Next Action |
|-----|---------|-------------|
| `[estimateOneWay] Shippo not configured` | Token missing or client not initialized | Set `SHIPPO_API_TOKEN` |
| `[estimateOneWay] Missing ZIPs` | One or both ZIPs are null/undefined | Check getZips() logs |
| `[estimateOneWay] Cache hit` | Found cached estimate (< 20min old) | Success (fast path) |
| `[estimateOneWay] rates { count: 0 }` | Shippo returned no rates | Check ZIP validity |
| `[estimateOneWay] filter { filteredCount: 0, unfilteredCount: > 0 }` | Service name mismatch | Update preferredServices |
| `[estimateOneWay] no match after filter` | Filtering removed all rates | Update preferredServices |
| `[estimateOneWay] Estimate successful` | Got rate from Shippo | Success ✅ |
| `[estimateRoundTrip] Outbound estimate failed` | First leg failed | Check estimateOneWay logs |
| `[estimateRoundTrip] Round trip estimate successful` | Both legs succeeded | Success ✅ |

### Verbose Logs in `server/api-util/lineItems.js`

| Log | Meaning | Next Action |
|-----|---------|-------------|
| `[getZips] { hasBorrowerZip: false }` | Current user has no shippingZip | Check user profile |
| `[getZips] { hasLenderZip: false }` | Lender has no shippingZip | Check lender profile |
| `[getZips] { viaIncludedAuthor: true }` | Got lender ZIP from listing include (optimized) | Success |
| `[getZips] { viaIncludedAuthor: false }` | Had to fetch lender separately (slower) | OK but not optimal |
| `[buildShippingLine] Missing ZIPs` | Can't estimate without both ZIPs | Falls back to calculatedAtCheckout |
| `[buildShippingLine] Estimate failed` | estimateRoundTrip returned null | Check estimateRoundTrip logs |
| `[buildShippingLine] { estOk: true }` | Got valid estimate | Success ✅ |
| `[buildShippingLine] moneyType { ctor: "Money" }` | Using correct Money type | Verification |
| `[buildShippingLine] fallback calculatedAtCheckout` | Returning zero-priced line | UI will show placeholder |

---

## 🛠️ Common Fixes

### Fix 1: Service Name Mismatch

**Symptom:** `filteredCount: 0` but `unfilteredCount > 0`

**Diagnosis:**
```bash
# Enable verbose logging and check the sample array
DEBUG_SHIPPING_VERBOSE=1 node scripts/probe-shipping.js 94109 10014
```

Look for:
```
[estimateOneWay] rates {
  sample: [
    { carrier: "USPS", service: "Priority Mail", amount: "12.50" }
  ]
}
```

**Fix:**
Edit `server/config/shipping.js`:
```javascript
preferredServices: [
  'USPS Priority Mail',  // Match: "USPS" + " " + "Priority Mail"
  // NOT "USPS Priority" (will not match)
],
```

---

### Fix 2: Missing User ZIPs

**Symptom:** `[buildShippingLine] Missing ZIPs { hasBorrowerZip: false }`

**Diagnosis:**
Check user profile in Sharetribe Console → Users → [User] → Public Data

**Fix:**
Ensure user has either:
- `publicData.shippingZip = "94109"` (preferred)
- OR `protectedData.shippingZip = "94109"` (fallback)

Can be set via:
1. Signup form
2. Contact Details page
3. Console (manual)

---

### Fix 3: SDK/CurrentUserId Not Passed

**Symptom:** `[getZips] No SDK provided`

**Diagnosis:**
Check that `transactionLineItems()` is called with options:
```javascript
await transactionLineItems(
  listing,
  orderData,
  providerCommission,
  customerCommission,
  { currentUserId, sdk }  // ← Must include this
);
```

**Files to check:**
- `server/api/transaction-line-items.js`
- `server/api/initiate-privileged.js`
- `server/api/transition-privileged.js`

---

### Fix 4: Shippo Token Not Set

**Symptom:** `[estimateOneWay] Shippo not configured { hasClient: true, hasToken: false }`

**Fix:**
```bash
# In production (e.g., Render)
SHIPPO_API_TOKEN=shippo_live_xxx

# In development
export SHIPPO_API_TOKEN=shippo_test_xxx
```

---

### Fix 5: No Rates from Shippo (Address Issues)

**Symptom:** `[estimateOneWay] rates { count: 0 }`

**Possible causes:**
1. International ZIPs (non-US)
2. Invalid ZIP format
3. Shippo address validation rejected placeholder addresses

**Fix Option A:** Add city/state inference
```javascript
// In toShippoAddress()
const toShippoAddress = (zip) => {
  // Optional: Add ZIP → city/state lookup
  const location = lookupZip(zip); // Implement or use library
  
  return {
    name: 'Sherbrt User',
    street1: 'N/A',
    city: location?.city || 'N/A',
    state: location?.state || 'N/A',
    zip,
    country: 'US',
  };
};
```

**Fix Option B:** Disable validation
```javascript
// In estimateOneWay()
const shipment = await shippingClient.shipment.create({
  address_from: {
    ...toShippoAddress(fromZip),
    validate: false  // Skip Shippo validation
  },
  address_to: {
    ...toShippoAddress(toZip),
    validate: false
  },
  parcels: [toShippoParcel(parcel)],
  async: false,
});
```

---

## 🧪 Testing Checklist

After fixing issues, verify:

- [ ] `node scripts/probe-shipping.js 94109 10014` returns success
- [ ] Probe shows `amountCents > 0`
- [ ] App checkout shows dollar amount (not "calculated at checkout")
- [ ] Verbose logs show `[buildShippingLine] { estOk: true }`
- [ ] No errors in server logs
- [ ] Totals calculate correctly

---

## 🔄 After Diagnosis

Once root cause is identified and fixed:

### Option 1: Keep Verbose Logging (Recommended)
Leave the logging in place, guarded by the flag:
```bash
# Production: verbose off (default)
# Debugging: verbose on
DEBUG_SHIPPING_VERBOSE=1
```

### Option 2: Remove Verbose Logs
If you want to remove them entirely:
```bash
# Find all vlog() calls
grep -r "vlog(" server/

# Remove or comment out
```

---

## 📞 Support Info

**Files with diagnostics:**
- `server/config/shipping.js` - DEBUG_SHIPPING_VERBOSE flag
- `server/lib/shipping.js` - estimateOneWay, estimateRoundTrip
- `server/api-util/lineItems.js` - getZips, buildShippingLine
- `scripts/probe-shipping.js` - Direct testing tool

**Key environment variables:**
- `DEBUG_SHIPPING_VERBOSE=1` - Enable detailed logs
- `SHIPPO_API_TOKEN` - Shippo API key (required)

**Test command:**
```bash
DEBUG_SHIPPING_VERBOSE=1 \
SHIPPO_API_TOKEN=your_token \
node scripts/probe-shipping.js 94109 10014
```

---

## 📝 Next Steps After Fix

1. ✅ Verify probe script works
2. ✅ Test in app checkout flow
3. ✅ Check both ZIPs are fetched correctly
4. ✅ Confirm service names match Shippo's format
5. ✅ Verify Money type is correct
6. ✅ Test with various ZIP combinations
7. ✅ Monitor cache hit rate
8. ✅ Confirm no 500 errors

**Production readiness:**
- Ensure `SHIPPO_API_TOKEN` is set to live key (not test)
- Consider leaving `DEBUG_SHIPPING_VERBOSE` off unless troubleshooting
- Monitor Shippo API usage and costs
- Set up alerts for estimation failures



# Test Shippo Shipping Estimates - Quick Guide

## ✅ Implementation Complete

The Shippo runtime adapter is now fully implemented with:
- ✅ Runtime SDK detection (works with any Shippo SDK version)
- ✅ **Automatic ZIP lookup** using `zipcodes` npm package (all 40,000+ U.S. ZIPs)
- ✅ Valid city/state address mapping (no more 'N/A')
- ✅ Valid parcel dimensions (strings + units)
- ✅ **Robust service name formatting** (handles carrier/provider field variations)
- ✅ Verbose diagnostics

## Current Test Results

```bash
$ export DEBUG_SHIPPING_VERBOSE=1
$ node scripts/probe-shipping.js 94109 10014
```

**Payload being sent:**
```javascript
{
  addressFrom: { city: 'San Francisco', state: 'CA', zip: '94109', country: 'US' },
  addressTo: { city: 'New York', state: 'NY', zip: '10014', country: 'US' },
  parcel: {
    length: '12', width: '9', height: '3',
    distanceUnit: 'in', weight: '16', massUnit: 'oz'
  }
}
```

✅ **Address mapping works correctly**  
✅ **Parcel payload is valid**  
✅ **API call is being made**

❌ Getting 401 error because we need a valid Shippo API token

---

## 🔑 Ready to Test with Valid Token

### Step 1: Get Your Shippo API Token

1. Go to: https://apps.goshippo.com/settings/api
2. Copy your **Test** token (starts with `shippo_test_`)
   - Use test token for development
   - Use live token only in production

### Step 2: Export Token and Run Test

```bash
# Set your Shippo API token
export SHIPPO_API_TOKEN=shippo_test_YOUR_KEY_HERE

# Enable verbose logging
export DEBUG_SHIPPING_VERBOSE=1

# Run the test
node scripts/probe-shipping.js 94109 10014
```

### Step 3: Expected Success Output

```
[estimateOneWay] Payload preview {
  addressFrom: { city: 'San Francisco', state: 'CA', zip: '94109', country: 'US' },
  addressTo: { city: 'New York', state: 'NY', zip: '10014', country: 'US' },
  parcel: { length: '12', width: '9', height: '3', ... }
}

[estimateOneWay] rates {
  count: 5,
  sample: [
    { carrier: 'USPS', service: 'Priority Mail', amount: '12.34', currency: 'USD' },
    { carrier: 'USPS', service: 'Ground Advantage', amount: '8.99', currency: 'USD' },
    { carrier: 'UPS', service: 'Ground', amount: '15.67', currency: 'USD' }
  ]
}

[estimateOneWay] filter {
  filteredCount: 3,
  unfilteredCount: 5,
  preferred: ['USPS Priority Mail', 'USPS Ground Advantage', 'UPS Ground']
}

[estimateOneWay] Estimate successful {
  amountCents: 899,
  service: 'USPS Ground Advantage'
}

[estimateRoundTrip] Round trip estimate successful {
  totalAmountCents: 1798,
  outboundCents: 899,
  returnCents: 899
}

[probe] ✅ SUCCESS
[probe] Amount: $17.98
[probe] Currency: USD
```

---

## 🔧 Troubleshooting

### If `filteredCount: 0`

The service names in your config don't match what Shippo returns. 

**Fix:** Copy the exact service names from the logs and update `server/config/shipping.js`:

```javascript
preferredServices: [
  'USPS Priority Mail',      // Copy exact strings from logs
  'USPS Ground Advantage',   // Must match exactly (case-sensitive)
  'UPS Ground',
],
```

The format is: `"CARRIER SERVICE"` where:
- CARRIER = r.carrier (e.g., "USPS", "UPS", "FedEx")
- SERVICE = r.service (e.g., "Priority Mail", "Ground Advantage")

### If Still Getting Errors

1. **Check token is set:**
   ```bash
   echo $SHIPPO_API_TOKEN
   ```

2. **Verify token is valid:**
   - Should start with `shippo_test_` or `shippo_live_`
   - Check at: https://apps.goshippo.com/settings/api

3. **Run introspection to verify SDK:**
   ```bash
   node scripts/shippo-introspect.js
   ```
   Should show: ✅ Use: shippo.shipments.create(payload)

---

## 🚀 Test in Your Application

Once the probe test succeeds:

1. **Start your server:**
   ```bash
   export SHIPPO_API_TOKEN=shippo_test_YOUR_KEY_HERE
   export DEBUG_SHIPPING_VERBOSE=1
   npm run dev
   ```

2. **Navigate to a listing in your browser**

3. **Open browser console** and look for:
   ```
   [estimateRoundTrip] Round trip estimate successful
   ```

4. **Check the checkout breakdown** - should show shipping estimate

---

## 📝 Quick Test Script

Use the provided test script:

```bash
export SHIPPO_API_TOKEN=shippo_test_YOUR_KEY_HERE
./TEST_SHIPPO_ADAPTER.sh
```

This runs:
1. SDK introspection
2. Shipping estimate test with verbose logging

---

## 📋 Implementation Summary

**Files Modified:**
- `server/lib/shipping.js` - Runtime adapter + city/state mapping
- `server/config/shipping.js` - Already correct

**New Diagnostic Tools:**
- `scripts/shippo-introspect.js` - Check SDK structure
- `TEST_SHIPPO_ADAPTER.sh` - Quick test script
- `scripts/probe-shipping.js` - Test estimates

**Key Improvements:**
- ✅ Works with modern Shippo SDK (`shippo.shipments.create`)
- ✅ Valid addresses (San Francisco, CA instead of N/A, N/A)
- ✅ Valid parcel dimensions (strings with units)
- ✅ Verbose diagnostic logging
- ✅ Handles multiple SDK versions
- ✅ 20-minute caching
- ✅ Network error retry logic

---

## 🎯 Next Action

**Run this command with your Shippo API token:**

```bash
export SHIPPO_API_TOKEN=shippo_test_YOUR_KEY_HERE
export DEBUG_SHIPPING_VERBOSE=1
node scripts/probe-shipping.js 94109 10014
```

**Expected result:** ✅ SUCCESS with shipping amount in dollars

If you see rates but `filteredCount: 0`, update the service names in `server/config/shipping.js` to match the exact strings from the logs.


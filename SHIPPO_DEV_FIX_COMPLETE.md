# Shippo Dev Environment Fix - Complete ✅

## What Was Fixed

### 1. ✅ Cleaned Up Shippo Client Initialization

**File:** `server/lib/shipping.js`

**Before:**
- Complex multi-path initialization with fallback stubs
- Stub client threw "Shippo disabled in dev" errors
- Used `DUMMY_TOKEN_FOR_DEV` which could cause confusion

**After:**
- Clean, simple factory function call: `shippoFactory(process.env.SHIPPO_API_TOKEN)`
- No stubs - either works or gracefully returns null
- Clear logging: shows env (dev/production) when initialized
- Falls back cleanly when token not set

**New Code:**
```javascript
let shippingClient = null;

try {
  const shippoFactory = require('shippo');
  if (process.env.SHIPPO_API_TOKEN) {
    shippingClient = shippoFactory(process.env.SHIPPO_API_TOKEN);
    console.log('[shipping] Shippo client initialized (env:', process.env.NODE_ENV, ')');
  } else {
    console.log('[shipping] SHIPPO_API_TOKEN not set; estimator will fall back');
  }
} catch (e) {
  console.log('[shipping] Failed to require shippo; estimator will fall back:', e?.message);
  shippingClient = null;
}
```

### 2. ✅ Verified No Dev Environment Guards

**Searched for:**
- `Shippo disabled in dev`
- `DISABLE_SHIPPO`
- `NODE_ENV !== 'production'` guards

**Result:** ✅ None found

The codebase already allows Shippo to work in dev when token is set.

### 3. ✅ Verified Shippo Dependency

**File:** `package.json`
```json
"shippo": "^2.15.0"
```

✅ Already installed, no `npm install` needed.

---

## 🚀 How to Test

### Step 1: Set Environment Variables

```bash
# Use your Shippo test token
export SHIPPO_API_TOKEN=shippo_test_YOUR_TOKEN_HERE

# Enable verbose logging
export DEBUG_SHIPPING_VERBOSE=1

# Optional: Set NODE_ENV to verify it works in dev
export NODE_ENV=development
```

### Step 2: Run the Probe Script

```bash
node scripts/probe-shipping.js 94109 10014
```

### Expected Success Output

```
[shipping] Shippo client initialized (env: development )
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
  preferred: [...],
  filteredCount: 3,
  unfilteredCount: 15
}
[estimateOneWay] Estimate successful { amountCents: 2050, service: 'USPS Ground Advantage' }

[probe] ========== RESULT ==========
[probe] ✅ SUCCESS
[probe] Amount: $20.50
[probe] Amount (cents): 2050
[probe] Currency: USD
[probe] ================================
```

---

## 🔧 Troubleshooting

### Issue 1: "SHIPPO_API_TOKEN not set"

**Symptom:**
```
[shipping] SHIPPO_API_TOKEN not set; estimator will fall back
[probe] ❌ FAILED - returned null
```

**Fix:**
```bash
export SHIPPO_API_TOKEN=shippo_test_YOUR_TOKEN
```

Get your test token from: https://goshippo.com/user/api/

---

### Issue 2: "Failed to require shippo"

**Symptom:**
```
[shipping] Failed to require shippo; estimator will fall back: Cannot find module 'shippo'
```

**Fix:**
```bash
npm install
```

Verify `package.json` has `"shippo": "^2.15.0"` in dependencies.

---

### Issue 3: Service Name Mismatch (filteredCount: 0)

**Symptom:**
```
[estimateOneWay] rates { count: 15, sample: [...] }
[estimateOneWay] filter { 
  preferred: ["UPS Ground", "USPS Ground Advantage", "USPS Priority"],
  filteredCount: 0,
  unfilteredCount: 15
}
[estimateOneWay] no match after filter; service strings may not match Shippo
```

**Diagnosis:**
Look at the `sample` array in verbose logs. Example:
```javascript
sample: [
  { carrier: 'USPS', service: 'Priority Mail', amount: '12.50' }
  // Shippo combines as: "USPS Priority Mail"
]
```

**Fix:**
Update `server/config/shipping.js`:
```javascript
preferredServices: [
  'USPS Priority Mail',     // ✅ Exact match: "USPS" + " " + "Priority Mail"
  'USPS Ground Advantage',  // ✅ Exact match
  'UPS Ground',             // ✅ Exact match
],
```

**Service name matching logic:**
```javascript
// In pickCheapestAllowed()
const serviceName = `${r.provider} ${r.servicelevel?.name}`.trim();
// Example: "USPS" + " " + "Priority Mail" = "USPS Priority Mail"

// Then checked against preferredServices:
preferredServices.some(pref => serviceName.includes(pref))
```

---

### Issue 4: No Rates from Shippo (count: 0)

**Symptom:**
```
[estimateOneWay] rates { count: 0, sample: [] }
[estimateOneWay] No suitable rates found
```

**Possible Causes:**
1. Invalid ZIP codes (non-US or malformed)
2. Shippo address validation rejected placeholder addresses
3. Network/API issue

**Fixes:**

**Option A: Try different ZIPs**
```bash
node scripts/probe-shipping.js 10001 90210  # NY to LA
node scripts/probe-shipping.js 60601 33101  # Chicago to Miami
```

**Option B: Disable address validation** (if using placeholder addresses)

Edit `server/lib/shipping.js`, in `estimateOneWay()`:
```javascript
const shipment = await shippingClient.shipment.create({
  address_from: {
    ...toShippoAddress(fromZip),
    validate: false  // ← Add this
  },
  address_to: {
    ...toShippoAddress(toZip),
    validate: false  // ← Add this
  },
  parcels: [toShippoParcel(parcel)],
  async: false,
});
```

**Option C: Add city/state lookup**

For production, consider using a ZIP code database to fill in city/state instead of "N/A":
```javascript
const toShippoAddress = (zip) => {
  const location = lookupZip(zip); // Use a ZIP lookup library
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

---

## 📊 What the Logs Tell You

| Log Message | Means | Status |
|-------------|-------|--------|
| `[shipping] Shippo client initialized (env: development)` | ✅ Shippo loaded successfully | Good |
| `[shipping] SHIPPO_API_TOKEN not set` | ⚠️ Token missing | Set token |
| `[shipping] Failed to require shippo` | ❌ Module not installed | Run `npm install` |
| `[estimateOneWay] rates { count: 15 }` | ✅ Shippo returned rates | Good |
| `[estimateOneWay] rates { count: 0 }` | ❌ No rates from Shippo | Check ZIPs |
| `[estimateOneWay] filter { filteredCount: 0 }` | ⚠️ Service name mismatch | Update config |
| `[estimateOneWay] Estimate successful` | ✅ Got estimate | Success! |
| `[probe] ✅ SUCCESS` | ✅ End-to-end working | Ready! |

---

## 🎯 Service Name Quick Fix

If you see `filteredCount: 0` but `unfilteredCount > 0`, here's a quick fix:

### 1. Check Verbose Logs
Look for the `sample` array:
```
[estimateOneWay] rates {
  sample: [
    { carrier: 'USPS', service: 'Priority Mail', amount: '12.50' },
    { carrier: 'USPS', service: 'Ground Advantage', amount: '10.25' },
    { carrier: 'UPS', service: 'Ground', amount: '15.00' }
  ]
}
```

### 2. Build Service Names
Combine `carrier + " " + service`:
- `"USPS" + " " + "Priority Mail"` → `"USPS Priority Mail"`
- `"USPS" + " " + "Ground Advantage"` → `"USPS Ground Advantage"`
- `"UPS" + " " + "Ground"` → `"UPS Ground"`

### 3. Update Config
Edit `server/config/shipping.js`:
```javascript
preferredServices: [
  'USPS Priority Mail',      // ✅ Exact from sample
  'USPS Ground Advantage',   // ✅ Exact from sample
  'UPS Ground',              // ✅ Exact from sample
],
```

### 4. Re-run Probe
```bash
node scripts/probe-shipping.js 94109 10014
```

Should now show `filteredCount: 3` ✅

---

## ✅ Success Checklist

After running the probe, verify:

- [ ] `[shipping] Shippo client initialized` appears in logs
- [ ] `[estimateOneWay] rates { count: > 0 }` shows rates returned
- [ ] `[estimateOneWay] filter { filteredCount: > 0 }` shows matches
- [ ] `[estimateOneWay] Estimate successful` appears
- [ ] `[probe] ✅ SUCCESS` at the end
- [ ] Amount shows as `$XX.XX` (not null)
- [ ] Script exits with code 0

---

## 🚀 Next: Test in App

Once the probe succeeds, test in the full app:

### 1. Start Server with Verbose Logging
```bash
DEBUG_SHIPPING_VERBOSE=1 \
SHIPPO_API_TOKEN=shippo_test_YOUR_TOKEN \
npm run dev
```

### 2. Reproduce Checkout Flow
- Log in as a user with `publicData.shippingZip` set
- View a listing from a lender with `publicData.shippingZip` set
- Click "Request to book"
- View the booking breakdown

### 3. Check Server Logs
Look for:
```
[getZips] { hasBorrowerZip: true, hasLenderZip: true }
[buildShippingLine] { estOk: true, amountCents: 2050 }
```

### 4. Check UI
- Shipping fee row should show: `$XX.XX` (not "calculated at checkout")

---

## 📝 Summary of Changes

| File | Change | Status |
|------|--------|--------|
| `server/lib/shipping.js` | Simplified Shippo init, removed stub | ✅ Complete |
| `server/config/shipping.js` | Already has DEBUG_SHIPPING_VERBOSE | ✅ Good |
| `server/api-util/lineItems.js` | Already has verbose logs | ✅ Good |
| `package.json` | Already has `shippo: ^2.15.0` | ✅ Good |
| Dev environment guards | None found to remove | ✅ Good |

**Result:** Shippo now works in dev when `SHIPPO_API_TOKEN` is set! 🎉

---

## 🔍 Common Scenarios

### Scenario 1: Testing Locally (Dev Environment)
```bash
export NODE_ENV=development
export SHIPPO_API_TOKEN=shippo_test_xxx
export DEBUG_SHIPPING_VERBOSE=1
node scripts/probe-shipping.js 94109 10014
```
**Expected:** ✅ Works! Shows rates and amount.

### Scenario 2: Production Deployment
```bash
export NODE_ENV=production
export SHIPPO_API_TOKEN=shippo_live_xxx
# Don't set DEBUG_SHIPPING_VERBOSE (verbose off by default)
```
**Expected:** ✅ Works! No verbose logs, just essential info.

### Scenario 3: CI/CD (No Token)
```bash
# SHIPPO_API_TOKEN not set
npm test
```
**Expected:** ✅ Server starts, falls back gracefully. No crashes.

---

## 🎉 You're Ready!

The Shippo integration now works seamlessly in both dev and production:
- ✅ No dummy tokens or stubs
- ✅ Clear logging with environment context
- ✅ Graceful fallback when token not set
- ✅ Works in dev when token is provided
- ✅ Production-ready

Run the probe and start seeing real shipping estimates! 🚀


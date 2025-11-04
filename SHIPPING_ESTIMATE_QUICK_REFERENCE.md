# Shipping Estimate - Quick Reference

## 🚀 Quick Start

### Run Tests
```bash
node test-shipping-estimate-integration.js
```
All 22 tests should pass ✅

### Check Implementation
```bash
# Verify no linter errors
npm run lint server/lib/shipping.js
npm run lint server/api-util/lineItems.js
```

---

## 📍 Field Paths (Confirmed)

### User ZIP Code Location
```javascript
// Primary location (where we store it)
user.attributes.profile.publicData.shippingZip

// Fallback (legacy compatibility)
user.attributes.profile.protectedData.shippingZip
```

**Type:** `string`  
**Validation:** 3-10 characters  
**Example:** `"94109"`

### Access Pattern (Server)
```javascript
const zip = user?.attributes?.profile?.publicData?.shippingZip ||
            user?.attributes?.profile?.protectedData?.shippingZip ||
            null;
```

---

## 🔧 Key Functions

### `getZips({ listingId, currentUserId, sdk })`
**Location:** `server/api-util/lineItems.js:20-115`  
**Purpose:** Fetch borrower & lender ZIP codes  
**Strategy:**
1. Fetch listing with `include: ['author', 'author.profile']`
2. Try to get lender ZIP from included data
3. If not in included, fetch lender separately
4. Fetch borrower ZIP from currentUserId

**Returns:** `{ borrowerZip: string|null, lenderZip: string|null }`

---

### `estimateOneWay({ fromZip, toZip, parcel }, retryCount)`
**Location:** `server/lib/shipping.js:350-441`  
**Purpose:** Get one-way shipping rate with timeout & retry  
**Features:**
- ✅ 5-second timeout
- ✅ 1 automatic retry on network errors
- ✅ In-memory caching (20min TTL)
- ✅ PII-safe logging

**Returns:** `{ amountCents, currency, debug } | null`

---

### `estimateRoundTrip({ lenderZip, borrowerZip, parcel })`
**Location:** `server/lib/shipping.js:443-475`  
**Purpose:** Get total cost (outbound + return)  
**Logic:**
- Calls `estimateOneWay` twice
- Sums both amounts if `includeReturn === true`
- Best-effort: returns outbound only if return fails

**Returns:** `{ amountCents, currency, debug } | null`

---

### `buildShippingLine({ listing, currentUserId, sdk })`
**Location:** `server/api-util/lineItems.js:117-180`  
**Purpose:** Build shipping line item for pricing  
**Outcomes:**
- ✅ Success: `Money(amountCents)`, `calculatedAtCheckout: false`
- ❌ Failure: `Money(0)`, `calculatedAtCheckout: true`

**Returns:** Line item object

---

## 📊 Line Item Structures

### Success (Estimate Available)
```javascript
{
  code: 'line-item/estimated-shipping',
  unitPrice: new Money(2450, 'USD'),  // $24.50
  quantity: 1,
  includeFor: ['customer'],
  calculatedAtCheckout: false
}
```

### Fallback (No Estimate)
```javascript
{
  code: 'line-item/estimated-shipping',
  unitPrice: new Money(0, 'USD'),
  quantity: 1,
  includeFor: ['customer'],
  calculatedAtCheckout: true
}
```

---

## 🎯 Cache Behavior

### Cache Key Format
```
fromZip:toZip:parcelSig:servicesSig:includeReturn
```

**Example:**
```
94109:10014:default:UPS Ground,USPS Ground Advantage:true
```

### Cache Properties
- **TTL:** 20 minutes
- **Max entries:** 1,000
- **Storage:** In-memory Map
- **Eviction:** FIFO when limit reached

### Cache Hit Flow
```javascript
1. Generate cache key
2. Check cache
3. If found && not expired → return cached value
4. Else → call Shippo API → cache result
```

---

## 🔒 PII Protection Rules

### ✅ DO:
```javascript
// Log booleans only
console.log('[getZips] Result', { 
  hasBorrowerZip: !!borrowerZip,
  hasLenderZip: !!lenderZip 
});
```

### ❌ DON'T:
```javascript
// Never log actual ZIPs
console.log('[getZips] Result', { borrowerZip, lenderZip });
```

### Error Redaction
```javascript
// Automatically redact ZIPs in error messages
err.message.replace(/\b\d{5}(-\d{4})?\b/g, '[ZIP]')
```

---

## ⏱️ Timeout & Retry

### Timeout
```javascript
const TIMEOUT_MS = 5000;  // 5 seconds

const shipment = await withTimeout(
  shippingClient.shipment.create({ ... }),
  TIMEOUT_MS
);
```

### Retry Logic
```javascript
// Retry once on network errors
if (isNetworkError && retryCount < 1) {
  await sleep(500);  // 500ms backoff
  return estimateOneWay({ ... }, retryCount + 1);
}
```

### Network Error Detection
```javascript
const isNetworkError = 
  err.message?.includes('timeout') || 
  err.message?.includes('ECONNREFUSED') ||
  err.message?.includes('ETIMEDOUT') ||
  err.code === 'ENOTFOUND';
```

---

## 🎨 UI Display Logic

**Component:** `src/components/OrderBreakdown/LineItemEstimatedShippingMaybe.js`

```javascript
// ALWAYS respect the calculatedAtCheckout flag
const valueText = shippingItem.calculatedAtCheckout === true
  ? 'calculated at checkout'
  : formatMoney(intl, shippingItem.lineTotal);
```

**Outcomes:**
- `calculatedAtCheckout: true` → "calculated at checkout"
- `calculatedAtCheckout: false` → "$24.50"

---

## 🧪 Testing Commands

### Run Integration Tests
```bash
node test-shipping-estimate-integration.js
```

### Run Unit Tests (Jest)
```bash
npm test server/__tests__/shipping-estimates.test.js
```

### Manual Testing

#### Test 1: Happy Path (Both ZIPs Present)
1. Set `SHIPPO_API_TOKEN` in environment
2. Ensure borrower has `publicData.shippingZip`
3. Ensure lender has `publicData.shippingZip`
4. View checkout page
5. **Expected:** Shipping line shows dollar amount

#### Test 2: Missing Borrower ZIP
1. Remove `shippingZip` from borrower profile
2. View checkout page
3. **Expected:** "calculated at checkout", no errors

#### Test 3: Shippo Disabled
1. Unset `SHIPPO_API_TOKEN`
2. View checkout page
3. **Expected:** "calculated at checkout", no errors

---

## 📈 Monitoring

### Success Indicators
```bash
# Look for these in logs
[estimateOneWay] Estimate successful
[estimateOneWay] Cache hit
```

### Failure Indicators
```bash
# These are OK (graceful fallback)
[estimateOneWay] Shippo not configured
[estimateOneWay] Missing ZIPs
[buildShippingLine] Missing ZIPs, using calculatedAtCheckout
[buildShippingLine] Estimate failed, using calculatedAtCheckout
```

### Error Indicators
```bash
# These need attention
[estimateOneWay] Network error, retrying
[estimateOneWay] Error: [message]
```

---

## ⚙️ Configuration

### Environment Variables
```bash
SHIPPO_API_TOKEN=shippo_live_xxx  # Required for estimates
```

### Config File
**Location:** `server/config/shipping.js`

```javascript
module.exports = {
  defaultParcel: {
    length: 12,      // inches
    width: 9,
    height: 3,
    weightOz: 16,    // 1 lb
  },
  
  preferredServices: [
    'UPS Ground',
    'USPS Ground Advantage',
    'USPS Priority',
  ],
  
  includeReturn: true,
};
```

### Per-Listing Parcel Override
Add to `listing.publicData`:
```javascript
{
  parcel: {
    length: 24,
    width: 18,
    height: 6,
    weightOz: 32
  }
}
```

---

## 🚨 Troubleshooting

### Issue: Always shows "calculated at checkout"

**Possible causes:**
1. `SHIPPO_API_TOKEN` not set
2. Users missing `shippingZip` in profile
3. Shippo API errors

**Debug:**
```bash
# Check logs for:
[estimateOneWay] Shippo not configured
[getZips] Result { hasBorrowerZip: false, hasLenderZip: false }
[estimateOneWay] Error: [message]
```

---

### Issue: Estimates seem wrong

**Check:**
1. Default parcel dimensions in config
2. Preferred services list
3. `includeReturn` flag (should be `true`)

**Verify:**
```bash
# Look for debug info in logs
[estimateOneWay] Estimate successful {
  amountCents: 2450,
  service: "USPS Ground Advantage"
}
```

---

### Issue: Performance slow

**Check:**
1. Cache hit rate (should be > 40%)
2. Timeout frequency (should be < 1%)
3. API call count

**Optimize:**
```bash
# Monitor cache effectiveness
[estimateOneWay] Cache hit  # Good!
[estimateOneWay] Creating shipment...  # Cache miss
```

---

## 📚 Related Documentation

- **Full Implementation:** `SHIPPING_ESTIMATE_IMPLEMENTATION.md`
- **Verification Report:** `SHIPPING_ESTIMATE_VERIFICATION.md`
- **Tests:** `test-shipping-estimate-integration.js`
- **Unit Tests:** `server/__tests__/shipping-estimates.test.js`

---

## 🎯 Key Takeaways

1. ✅ ZIPs stored in `publicData.shippingZip`
2. ✅ Zero-priced fallback keeps totals math working
3. ✅ 5s timeout + 1 retry prevents hanging
4. ✅ 20min cache reduces API calls
5. ✅ Boolean-only logging protects PII
6. ✅ UI always respects `calculatedAtCheckout` flag
7. ✅ No 500 errors - graceful degradation everywhere

---

**Status:** ✅ Production Ready  
**Last Updated:** November 4, 2025


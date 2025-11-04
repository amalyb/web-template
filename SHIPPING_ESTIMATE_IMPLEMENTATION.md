# Shipping Estimate Implementation - Complete

## Overview

This implementation adds **pre-checkout shipping cost estimation** to your marketplace. When users view the booking breakdown during the checkout flow, the system now:

1. Fetches the **borrower's shipping ZIP** (from their profile)
2. Fetches the **lender's shipping ZIP** (from the listing author's profile)
3. Calls **Shippo API** to get real shipping rates
4. Displays the **estimated total shipping cost** (outbound + return) in the order breakdown

If ZIP codes are missing or Shippo API fails, the UI gracefully falls back to showing "calculated at checkout" instead of a dollar amount.

---

## What Was Changed

### 1. Server Configuration

**File: `server/config/shipping.js`** *(NEW)*

- Defines default parcel dimensions (12" × 9" × 3", 16 oz)
- Lists preferred shipping services (UPS Ground, USPS Ground Advantage, USPS Priority)
- Configures whether to include return shipping in estimates (`includeReturn: true`)

### 2. Server Shipping Library

**File: `server/lib/shipping.js`** *(ENHANCED)*

Added three new functions:

- **`estimateOneWay({ fromZip, toZip, parcel })`**
  - Creates a Shippo shipment with the provided ZIPs and parcel details
  - Picks the cheapest rate from allowed services
  - Returns `{ amountCents, currency, debug }` or `null` on failure

- **`estimateRoundTrip({ lenderZip, borrowerZip, parcel })`**
  - Calls `estimateOneWay` twice (outbound + return)
  - Sums the costs if both succeed
  - Falls back to outbound-only on errors (best-effort)

- **Helper functions**: `toShippoAddress`, `toShippoParcel` (null-safe with optional chaining), `pickCheapestAllowed`

### 3. Line Items Logic

**File: `server/api-util/lineItems.js`** *(MADE ASYNC + ADDED FUNCTIONS)*

- **`getZips({ listingId, currentUserId, sdk })`** *(NEW)*
  - Fetches the listing to get the lender's user ID
  - Fetches both borrower and lender user profiles
  - Extracts `shippingZip` from `protectedData` (fallback to `publicData`)
  - Returns `{ borrowerZip, lenderZip }`

- **`buildShippingLine({ listing, currentUserId, sdk })`** *(NEW)*
  - Calls `getZips` to get both ZIP codes
  - If ZIPs available: calls `estimateRoundTrip` and returns line item with `unitPrice` + `calculatedAtCheckout: false`
  - If ZIPs missing or estimate fails: returns zero-priced line item (`Money(0, 'USD')`) with `calculatedAtCheckout: true` (keeps totals math happy)

- **`transactionLineItems(..., options = {})`** *(MADE ASYNC)*
  - Now accepts optional `{ currentUserId, sdk }` parameter
  - Calls `buildShippingLine` if user context available
  - Adds shipping line to final `lineItems` array
  - **Privacy**: ZIPs are never sent to the client, only the Money amount is returned

### 4. API Endpoints Updated

**Files Modified:**
- `server/api/transaction-line-items.js`
- `server/api/initiate-privileged.js`
- `server/api/transition-privileged.js`

**Changes:**
- Made endpoint handlers `async`
- Fetch `currentUserId` from `sdk.currentUser.show()`
- Pass `{ currentUserId, sdk }` to `transactionLineItems()`
- Properly `await` the async `transactionLineItems()` call

---

## How It Works

### Flow Diagram

```
1. User views checkout page
   ↓
2. Client calls /api/transaction-line-items (speculation)
   ↓
3. Server fetches:
   - Listing data
   - Current user ID (borrower)
   - Lender user ID (from listing author)
   - Borrower ZIP (from user.profile.protectedData.shippingZip)
   - Lender ZIP (from lender.profile.protectedData.shippingZip)
   ↓
4. If both ZIPs exist:
   - Call Shippo API for outbound rate (lender → borrower)
   - Call Shippo API for return rate (borrower → lender)
   - Sum the costs
   - Return LINE_ITEM_ESTIMATED_SHIPPING with unitPrice
   ↓
5. If ZIPs missing or API fails:
   - Return LINE_ITEM_ESTIMATED_SHIPPING with calculatedAtCheckout: true
   ↓
6. Client renders:
   - If calculatedAtCheckout: false → Show "$XX.XX"
   - If calculatedAtCheckout: true → Show "calculated at checkout"
```

### Example Line Item

**When estimate succeeds:**
```javascript
{
  code: 'line-item/estimated-shipping',
  unitPrice: Money(2450, 'USD'), // $24.50
  quantity: 1,
  includeFor: ['customer'],
  calculatedAtCheckout: false
}
```

**When estimate fails or ZIPs missing:**
```javascript
{
  code: 'line-item/estimated-shipping',
  unitPrice: Money(0, 'USD'),  // zero-priced placeholder keeps totals math happy
  quantity: 1,
  includeFor: ['customer'],
  calculatedAtCheckout: true
}
```

---

## Client-Side (Already Implemented)

**No changes needed!** The UI already handles this:

### Component: `LineItemEstimatedShippingMaybe.js`

```javascript
const valueText = shippingItem.calculatedAtCheckout
  ? 'calculated at checkout'
  : formatMoney(intl, shippingItem.lineTotal);
```

### Translation: `en.json`

```json
"OrderBreakdown.estimatedShipping": "Shipping fee"
```

### Type Definition: `util/types.js`

```javascript
export const LINE_ITEM_ESTIMATED_SHIPPING = 'line-item/estimated-shipping';
```

---

## Configuration Options

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `SHIPPO_API_TOKEN` | Shippo API key (required) | `shippo_test_xxx` or `shippo_live_xxx` |
| `SHIP_LEAD_MODE` | Lead time mode (for ship-by dates) | `static` or `distance` |
| `SHIP_LEAD_DAYS` | Default lead days | `2` |

### Parcel Configuration

Edit `server/config/shipping.js` to change defaults:

```javascript
defaultParcel: {
  length: 12,    // inches
  width: 9,      // inches
  height: 3,     // inches
  weightOz: 16,  // 1 lb
}
```

### Per-Listing Parcels

To specify custom dimensions for a listing, add to `listing.publicData`:

```javascript
parcel: {
  length: 24,
  width: 18,
  height: 6,
  weightOz: 32  // 2 lbs
}
```

The system will use this instead of the default parcel for that listing.

### Service Selection

Edit `server/config/shipping.js` to change which carriers/services to consider:

```javascript
preferredServices: [
  'UPS Ground',
  'USPS Ground Advantage',
  'USPS Priority',
]
```

The system picks the **cheapest** rate from these services.

---

## Privacy & Security

✅ **ZIP codes are NEVER sent to the client**
- Only the final Money amount is returned in the line item
- ZIPs are fetched server-side from `protectedData`
- Shippo API calls happen entirely server-side

✅ **Graceful fallback**
- Missing ZIPs → zero-priced line item with `calculatedAtCheckout: true`
- Shippo API errors → zero-priced line item with `calculatedAtCheckout: true`
- No interruption to checkout flow (totals still calculate correctly)

---

## Testing Checklist

### 1. Test with Valid ZIPs

**Setup:**
- Borrower has `shippingZip` in profile (`protectedData` or `publicData`)
- Lender has `shippingZip` in profile
- `SHIPPO_API_TOKEN` is set

**Expected:**
- Shipping line shows dollar amount (e.g., "$24.50")
- Server logs show: `[estimateRoundTrip] Round trip estimate successful`

### 2. Test with Missing ZIPs

**Setup:**
- Remove `shippingZip` from borrower or lender profile

**Expected:**
- Shipping line shows "calculated at checkout"
- Server logs show: `[buildShippingLine] Missing ZIPs, using calculatedAtCheckout`

### 3. Test with Invalid SHIPPO_API_TOKEN

**Setup:**
- Set `SHIPPO_API_TOKEN` to invalid value or remove it

**Expected:**
- Shipping line shows "calculated at checkout"
- Server logs show: `[estimateOneWay] Error:`

### 4. Test Different Distances

**Setup:**
- Try ZIPs that are close (same state)
- Try ZIPs that are far (coast to coast)

**Expected:**
- Close ZIPs → lower cost (e.g., $10-15)
- Far ZIPs → higher cost (e.g., $30-50)

---

## Troubleshooting

### Issue: Always shows "calculated at checkout"

**Possible causes:**
1. `SHIPPO_API_TOKEN` not set or invalid
   - Check: `console.log('[shipping] Shippo client initialized')`
2. Users don't have `shippingZip` in their profiles
   - Check: Server logs for `[getZips] Result { borrowerZip: null, lenderZip: null }`
3. Shippo API rate fetch failed
   - Check: Server logs for `[estimateOneWay] Error:`

**Solutions:**
- Verify env var is set: `echo $SHIPPO_API_TOKEN`
- Check user profiles have `protectedData.shippingZip`
- Review Shippo API logs in their dashboard

### Issue: "Cannot read property 'show' of undefined"

**Cause:** SDK not passed to `transactionLineItems()`

**Solution:** Ensure all callers pass `{ currentUserId, sdk }` as 5th parameter

### Issue: Wrong shipping cost

**Possible causes:**
1. Wrong parcel dimensions
   - Check: `server/config/shipping.js` defaultParcel
2. Wrong service selection
   - Check: `preferredServices` array in config

**Solutions:**
- Add per-listing parcel data to `listing.publicData.parcel`
- Adjust `preferredServices` or `defaultParcel` in config

---

## Future Enhancements

### Option 1: Per-Listing Service Selection

Add to listing creation form:
```javascript
shippingPreference: 'cheapest' | 'fastest' | 'ground-only'
```

Use this in `pickCheapestAllowed()` to filter rates.

### Option 2: Real-Time Delivery Estimates

Return `deliveryDays` from Shippo and show:
```
Shipping: $24.50 (arrives in 3-5 days)
```

### Option 3: Carrier-Specific Rates

Let lenders choose their preferred carrier:
```javascript
preferredCarrier: 'UPS' | 'USPS' | 'FedEx'
```

### Option 4: Insurance Add-On

For high-value items:
```javascript
includeInsurance: true,
insuranceValue: 500 // $500 coverage
```

---

## Key Implementation Details

### Why Zero-Priced Line Items on Failure?

When shipping estimation fails (missing ZIPs, Shippo API error, etc.), we return a **zero-priced line item** instead of omitting the line item or returning it without a price. This approach:

1. **Keeps totals math consistent**: All line items have a `unitPrice` and `quantity`, so `calculateTotalFromLineItems()` works correctly
2. **Prevents UI errors**: Components that expect `lineTotal` won't encounter `undefined`
3. **Shows the placeholder text**: The UI still displays "calculated at checkout" via the `calculatedAtCheckout: true` flag

### Null-Safe Parcel Handling

The `toShippoParcel()` function uses optional chaining (`parcel?.length`) to safely handle:
- `null` parcel values
- `undefined` parcel values
- Missing parcel properties

This prevents crashes when listings don't have custom parcel data or when `null` is explicitly passed.

### Shippo API Guard

The `estimateOneWay()` function checks **both** conditions:
1. `shippingClient` is initialized
2. `SHIPPO_API_TOKEN` environment variable is set

This ensures the function fails gracefully in development environments where Shippo might not be configured.

---

## Code Files Changed

| File | Type | Changes |
|------|------|---------|
| `server/config/shipping.js` | NEW | Default config for parcels & services |
| `server/lib/shipping.js` | ENHANCED | Added `estimateOneWay`, `estimateRoundTrip` |
| `server/api-util/lineItems.js` | ENHANCED | Added `getZips`, `buildShippingLine`; made async |
| `server/api/transaction-line-items.js` | MODIFIED | Made async, pass SDK & userId |
| `server/api/initiate-privileged.js` | MODIFIED | Made async call, pass SDK & userId |
| `server/api/transition-privileged.js` | MODIFIED | Made async call, pass SDK & userId |

**Client files:** No changes needed (already implemented)

---

## Summary

✅ **Server-side estimation** using Shippo API  
✅ **Round-trip pricing** (outbound + return)  
✅ **Privacy-safe** (ZIPs never exposed to client)  
✅ **Graceful fallback** for missing data  
✅ **Per-listing parcel support**  
✅ **Configurable service selection**  
✅ **Already integrated in UI**  

The shipping estimate now appears automatically during checkout speculation, giving users accurate pricing before they commit to booking.

---

## Questions or Issues?

- Check server logs for `[estimateOneWay]`, `[getZips]`, `[buildShippingLine]` messages
- Verify `SHIPPO_API_TOKEN` is set correctly
- Ensure users have `shippingZip` in their profile `protectedData`
- Review Shippo dashboard for API call logs


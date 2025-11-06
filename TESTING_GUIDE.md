# Testing Guide - Ship-by Zip & Street2 Fixes

## Quick Start

### 1. Test Locally with Smoke Script

**Prerequisites:**
- Shippo API token (test or sandbox)

**Basic test (with API):**
```bash
cd /Users/amaliabornstein/shop-on-sherbet-cursor

SHIPPO_API_TOKEN=your_token_here \
DEBUG_SHIPPO=1 \
node server/scripts/shippo-address-smoke.js \
  --from "1745 Pacific Ave" \
  --from2 "Apt 202" \
  --fromZip 94109 \
  --to "1795 Chestnut St" \
  --to2 "Apt 7" \
  --toZip 94123
```

**Expected output:**
```
✅ address_from.street2 present: Apt 202
✅ address_to.street2 present: Apt 7
✅ SUCCESS: address_from.street2 survived: Apt 202
✅ SUCCESS: address_to.street2 survived: Apt 7
🎉 All tests passed! street2 fields survived through Shippo API.
```

### 2. Test in Render (Test Environment)

**Set environment variables:**
```
DEBUG_SHIPPO=1
SHIPPO_MODE=sandbox
SHIPPO_API_TOKEN=your_test_token
SHIP_LEAD_MODE=distance   # Optional: test distance-based ship-by
```

**Create test booking:**
1. List an item
2. Book with these test addresses:
   - **Lender:** 1745 Pacific Ave, Apt 202, San Francisco, CA 94109
   - **Borrower:** 1795 Chestnut Street, Apt 7, San Francisco, CA 94123
3. Accept the booking (generates outbound label)
4. Request return label

**Check Render logs for:**

#### ✅ Outbound Label Creation
```
[shippo][pre] address_from (provider→customer) {
  name: "Provider Name",
  street1: "1745 Pacific Ave",
  street2: "Apt 202",          ← MUST BE PRESENT
  city: "San Francisco",
  state: "CA",
  zip: "94109"
}

[shippo][pre] address_to (customer) {
  name: "Borrower Name",
  street1: "1795 Chestnut Street",
  street2: "Apt 7",            ← MUST BE PRESENT
  city: "San Francisco",
  state: "CA",
  zip: "94123"
}
```

#### ✅ Return Label Creation
```
[shippo][pre][return] address_from (customer→provider) {
  street2: "Apt 7",            ← MUST BE PRESENT
  ...
}

[shippo][pre][return] address_to (provider) {
  street2: "Apt 202",          ← MUST BE PRESENT
  ...
}
```

#### ✅ Ship-by Calculation
```
[ship-by] PD zips {
  providerZip: "94109",        ← MUST BE PRESENT
  customerZip: "94123",        ← MUST BE PRESENT
  usedFrom: "94109",
  usedTo: "94123"
}

[ship-by:distance] {
  fromZip: "94109",
  toZip: "94123",
  miles: 2,                    ← Distance calculated successfully
  chosenLeadDays: 2,
  floor: 2,
  max: 5
}
```

#### ✅ Sandbox Carrier Filtering
```
📊 [SHIPPO] Available rates (before filtering): 12
[shippo][sandbox] Filtered carriers to UPS/USPS only {
  mode: "sandbox",
  originalCount: 12,
  filteredCount: 6,           ← Only UPS/USPS kept
  allowedCarriers: ["UPS", "USPS"]
}
📊 [SHIPPO] Available rates (after filtering): 6
```

#### ✅ Retry Logic (if rate limited)
```
⚠️  [shippo][retry] UPS 10429 or rate limit detected, backing off {
  retriesLeft: 2,
  waitMs: 600,
  code: "10429"
}
⚠️  [shippo][retry] UPS 10429 or rate limit detected, backing off {
  retriesLeft: 1,
  waitMs: 1200,
  code: "10429"
}
✅ Shipment created successfully
```

### 3. Verify PDFs

**Download both labels and check:**
1. **Outbound label:**
   - Sender address includes "Apt 202"
   - Recipient address includes "Apt 7"

2. **Return label:**
   - Sender address includes "Apt 7"
   - Recipient address includes "Apt 202"

## Troubleshooting

### Issue: providerZip shows as undefined

**Check:**
1. Frontend is sending `providerZip` in accept transition
2. Look for this log:
   ```
   🔐 [ACCEPT] providerZip: undefined
   ```
3. Check earlier in logs:
   ```
   🔍 [DEBUG] Incoming protectedData: { ... }
   ```
   - Does it contain `providerZip`?

**Fix:**
- If missing from incoming data → frontend issue
- If present but lost → check merge logic

### Issue: street2 is missing from labels

**Check these logs:**
1. Pre-call logging:
   ```
   [shippo][pre] address_from {
     street2: "Apt 202"   ← Should be here
   }
   ```

2. Street2 guard warnings:
   ```
   [STREET2-GUARD] Re-applying addressFrom.street2 from raw data
   ```

3. Apartment debug logs:
   ```
   ✅ [APARTMENT CONFIRMED] street2 successfully made it to addressFrom: Apt 202
   ```

**If street2 is missing:**
- Check `providerStreet2` in protectedData
- Check for cleaning that removes it
- Verify `buildShippoAddress()` received it

### Issue: No rates returned

**Check NO-RATES logs:**
```
❌ [SHIPPO][NO-RATES] No shipping rates available
[SHIPPO][NO-RATES] messages: [...]     ← Shippo error messages
[SHIPPO][NO-RATES] address_from: {
  street1: "...",
  street2: "...",                       ← Verify addresses are valid
  ...
}
```

**Common causes:**
1. Invalid address (check Shippo messages)
2. All rates filtered out by carrier filter
3. API rate limit (should retry automatically)
4. Invalid parcel dimensions

### Issue: UPS 10429 errors persist

**If retries fail after 3 attempts:**
1. Check rate limit quota in Shippo dashboard
2. Consider increasing `baseMs` in `withBackoff` calls
3. Add more retries: `{ retries: 3, baseMs: 1000 }`
4. Contact Shippo support about rate limits

## Performance Testing

### Test Rate Limiting Behavior

**Simulate rapid requests:**
1. Create multiple bookings quickly
2. Accept them in sequence
3. Monitor logs for retry behavior

**Expected:**
- First few succeed immediately
- Later ones may hit rate limit
- Automatic retry with backoff
- All eventually succeed (or fail gracefully)

### Test Carrier Filtering

**Verify sandbox filtering:**
1. Check rate counts before/after filtering
2. Ensure only UPS/USPS rates remain
3. Verify production mode disables filtering

```bash
# Sandbox mode (filters carriers)
SHIPPO_MODE=sandbox

# Production mode (no filtering)
SHIPPO_MODE=production
```

## Success Criteria

### ✅ All Tests Pass If:

1. **Street2 preservation:**
   - Outbound from.street2: ✓
   - Outbound to.street2: ✓
   - Return from.street2: ✓
   - Return to.street2: ✓

2. **Ship-by calculation:**
   - providerZip present: ✓
   - customerZip present: ✓
   - Distance calculated: ✓
   - Lead days computed: ✓

3. **Rate selection:**
   - Rates returned: ✓
   - Sandbox filtering applied: ✓
   - Rate selected successfully: ✓

4. **Retry logic:**
   - UPS 10429 triggers retry: ✓
   - Backoff timing correct: ✓
   - Eventually succeeds: ✓

5. **PDF verification:**
   - All 4 apartment fields visible: ✓
   - No formatting issues: ✓

## Rollback

If any issues occur:

```bash
# Disable carrier filtering (show all carriers)
SHIPPO_MODE=production

# Disable debug logging (reduce noise)
unset DEBUG_SHIPPO

# Emergency: Disable retries (modify code)
# Change: { retries: 2, baseMs: 600 }
# To:     { retries: 0, baseMs: 600 }
```

## Additional Resources

- **Implementation Summary:** See `IMPLEMENTATION_SUMMARY.md`
- **Smoke Test Script:** `server/scripts/shippo-address-smoke.js`
- **Ship-by Logic:** `server/lib/shipping.js`
- **Address Builder:** `server/shippo/buildAddress.js`
- **Label Creation:** `server/api/transition-privileged.js` (createLabel function)


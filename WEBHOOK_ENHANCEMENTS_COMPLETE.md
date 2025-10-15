# Shippo Webhook Enhancements Complete ✅

## Summary

Enhanced Shippo webhook handling with better logging, idempotency, flexible signature verification, and dev-only test routes for Step-4 (first-scan) borrower notifications.

## Changes Implemented

### 1. Enhanced Logging

**Entry Logging**:
```javascript
console.log(`🚀 Shippo webhook received! event=${eventType}`);
```

**Step-4 Specific Logging**:
```javascript
console.log(`[STEP-4] Sending borrower SMS for tracking ${trackingNumber}, txId=${transaction.id}`);
console.log(`[STEP-4] Message length: ${message.length} chars, shortLink: ${shortTrackingUrl}`);
console.log(`✅ [STEP-4] Borrower SMS sent for tracking ${trackingNumber}, txId=${transaction.id}`);
```

### 2. Conditional Signature Verification

**Before**:
- Required `SHIPPO_WEBHOOK_SECRET` always
- Failed if not set

**After**:
- Verifies signature if `SHIPPO_WEBHOOK_SECRET` is set
- Skips verification if not set (test environments)
- Logs the mode clearly

```javascript
if (webhookSecret) {
  if (!verifyShippoSignature(req, webhookSecret)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }
  console.log('✅ Shippo signature verified');
} else {
  console.log('⚠️ SHIPPO_WEBHOOK_SECRET not set - skipping signature verification (test mode)');
}
```

### 3. Expanded First-Scan Statuses

**Before**: Only `TRANSIT`

**After**: All common first-scan statuses
- `TRANSIT`
- `IN_TRANSIT`
- `ACCEPTED`
- `ACCEPTANCE`

```javascript
const firstScanStatuses = ['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE'];
const isFirstScan = firstScanStatuses.includes(upperStatus);
```

### 4. Robust Idempotency for First-Scan

**Dual-Layer Idempotency**:

1. **Primary**: Check `protectedData.shippingNotification.firstScan.sent`
2. **Fallback**: In-memory LRU cache with 24h TTL

**Why Both?**:
- ProtectedData may fail due to 409 conflicts
- Cache prevents duplicate SMS even if PD update fails
- Cache survives for 24 hours (covers retry windows)

```javascript
// In-memory LRU cache
const firstScanCache = new Map();
const FIRST_SCAN_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Check both sources
const pdFirstScanSent = protectedData.shippingNotification?.firstScan?.sent === true;
const cacheKey = `firstscan:${trackingNumber}`;
const cachedTimestamp = firstScanCache.get(cacheKey);
const cacheValid = cachedTimestamp && (Date.now() - cachedTimestamp < FIRST_SCAN_TTL);

if (pdFirstScanSent || cacheValid) {
  console.log(`ℹ️ [STEP-4] First scan SMS already sent - skipping (idempotent via ${pdFirstScanSent ? 'protectedData' : 'cache'})`);
  return res.status(200).json({ message: 'First scan SMS already sent - idempotent' });
}

// Mark in cache immediately to prevent race conditions
firstScanCache.set(cacheKey, Date.now());
```

**Cache Cleanup**:
```javascript
// Auto-cleanup every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of firstScanCache.entries()) {
    if (now - timestamp > FIRST_SCAN_TTL) {
      firstScanCache.delete(key);
    }
  }
}, 60 * 60 * 1000);
```

### 5. Enhanced Step-4 SMS Message

**Updated Message Format**:
```
Sherbrt 🍧: 🚚 "Vintage Designer Handbag" is on its way! Track: https://sherbrt.com/r/abc123
```

**Features**:
- Includes listing title (truncated to 40 chars if needed)
- Uses short link for tracking URL
- Personalized and concise
- ~80-120 chars total

**Code**:
```javascript
// Get listing title
const listing = transaction.attributes?.listing || transaction.relationships?.listing?.data;
const rawTitle = listing?.title || listing?.attributes?.title || 'your item';
const listingTitle = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;

// Use short link
const shortTrackingUrl = await shortLink(trackingUrl);
message = `Sherbrt 🍧: 🚚 "${listingTitle}" is on its way! Track: ${shortTrackingUrl}`;
```

### 6. Dev-Only Test Route

**Route**: `POST /api/webhooks/__test/shippo/track`

**Purpose**: Simulate Shippo tracking webhooks without actual Shippo events

**Security**: Only available when:
- `NODE_ENV !== 'production'`, OR
- `ENABLE_TEST_WEBHOOKS=1` explicitly set

**Request Body**:
```json
{
  "tracking_number": "1Z123TEST456",
  "carrier": "ups",
  "status": "TRANSIT",
  "txId": "optional-transaction-id"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Test webhook injected",
  "payload": { ... },
  "note": "Check server logs for processing details"
}
```

**Usage**:
```bash
# Using curl
curl -X POST http://localhost:3500/api/webhooks/__test/shippo/track \
  -H 'Content-Type: application/json' \
  -d '{
    "tracking_number": "1Z123TEST456",
    "carrier": "ups",
    "status": "TRANSIT"
  }'

# Using npm script
npm run webhook:test:track
```

### 7. npm Test Script

**Added to package.json**:
```json
{
  "scripts": {
    "webhook:test:track": "curl -s -X POST ${APP_HOST:-http://localhost:3500}/api/webhooks/__test/shippo/track -H 'Content-Type: application/json' -d '{\"tracking_number\":\"1Z123TEST456\",\"carrier\":\"ups\",\"status\":\"TRANSIT\"}' && echo"
  }
}
```

**Usage**:
```bash
# Default (localhost:3500)
npm run webhook:test:track

# Custom host
APP_HOST=https://your-host.com npm run webhook:test:track
```

## Testing

### Local Testing

1. **Start server**:
   ```bash
   npm run dev-server
   ```

2. **Trigger test webhook**:
   ```bash
   npm run webhook:test:track
   ```

3. **Check logs** for:
   ```
   [TEST] Injected track_updated webhook
   🚀 Shippo webhook received! event=track_updated [TEST MODE]
   [STEP-4] Sending borrower SMS for tracking 1Z123TEST456
   [STEP-4] Message length: 95 chars, shortLink: https://...
   ✅ [STEP-4] Borrower SMS sent for tracking 1Z123TEST456
   ```

### Production Testing

Use actual Shippo webhooks - signature verification will be enforced if `SHIPPO_WEBHOOK_SECRET` is set.

## Files Modified

| File | Lines Changed | Changes |
|------|--------------|---------|
| `server/webhooks/shippoTracking.js` | ~100 | Enhanced logging, idempotency, test route |
| `package.json` | 1 | Added webhook test script |

## Environment Variables

### Optional (New)

```bash
# Enable test webhook route in production (not recommended)
ENABLE_TEST_WEBHOOKS=1
```

### Existing (No Changes Required)

```bash
# Optional: Set to verify signatures (recommended for production)
SHIPPO_WEBHOOK_SECRET=<webhook-secret>

# Optional: Filter by Shippo mode
SHIPPO_MODE=test  # or 'live'
```

## Expected Behavior

### Scenario 1: First Scan (Happy Path)

1. **Webhook arrives**: `status=TRANSIT`
2. **Lookup transaction**: By metadata or tracking number
3. **Check idempotency**: Not sent before
4. **Mark in cache**: Prevent duplicates
5. **Send SMS**: To borrower with listing title and short tracking link
6. **Update protectedData**: Mark as sent
7. **Log**: `[STEP-4] Borrower SMS sent`

### Scenario 2: Duplicate First Scan

1. **Webhook arrives**: `status=TRANSIT` (duplicate)
2. **Check idempotency**: Found in cache
3. **Skip SMS**: Log `already sent - skipping (idempotent via cache)`
4. **Return 200**: No error

### Scenario 3: First Scan After PD Update Failure

1. **First attempt**: SMS sent, PD update fails (409)
2. **Cache marked**: Duplicate prevention active
3. **Second attempt**: Webhook arrives again
4. **Check cache**: Found (even though PD not updated)
5. **Skip SMS**: Idempotency via cache
6. **No duplicate SMS**: ✅

### Scenario 4: Test Webhook

1. **POST** to `/__test/shippo/track`
2. **Construct payload**: Mock Shippo format
3. **Skip signature**: Test mode
4. **Process normally**: Same logic as real webhook
5. **Log**: `[TEST] Injected track_updated`

## Monitoring

### Key Log Patterns

**Success**:
```
🚀 Shippo webhook received! event=track_updated
✅ Status is TRANSIT - processing first scan webhook
✅ Transaction found via metadata.transactionId: tx-123
[STEP-4] Sending borrower SMS for tracking 1Z...
[STEP-4] Message length: 95 chars, shortLink: https://sherbrt.com/r/abc123
✅ [STEP-4] Borrower SMS sent for tracking 1Z...
```

**Idempotency**:
```
ℹ️ [STEP-4] First scan SMS already sent - skipping (idempotent via cache)
```

**Test Mode**:
```
[TEST] Injected track_updated webhook
⚠️ Test mode - skipping signature verification
```

### Metrics to Track

- **First-scan SMS sent**: Count of `[STEP-4] Borrower SMS sent`
- **Idempotency hits**: Count of `already sent - skipping`
- **Cache size**: `firstScanCache.size`
- **SMS length**: Average message length

## Troubleshooting

### Issue: SMS not sending

**Check**:
1. Webhook received? Look for `🚀 Shippo webhook received!`
2. Transaction found? Look for `✅ Transaction found`
3. Status correct? Should be one of: TRANSIT, IN_TRANSIT, ACCEPTED, ACCEPTANCE
4. Already sent? Check for `already sent - skipping`
5. Phone number? Look for `No borrower phone number found`

### Issue: Duplicate SMS

**Check**:
1. Cache working? Look for cache log messages
2. ProtectedData updated? Check `firstScan.sent` in transaction
3. Multiple webhooks? Shippo may retry failed webhooks

### Issue: Test route not working

**Check**:
1. Environment: Must be non-production OR `ENABLE_TEST_WEBHOOKS=1`
2. URL: Should be `/api/webhooks/__test/shippo/track`
3. Method: Must be POST
4. Body: Must include `tracking_number`

## Security

### Signature Verification

- **Production**: Set `SHIPPO_WEBHOOK_SECRET` to verify all webhooks
- **Test/Dev**: Leave unset to skip verification
- **Logging**: Always logs whether verification was performed

### Test Route

- **Disabled by default** in production
- **Requires explicit flag** to enable in production
- **Returns 404** if not available
- **No authentication** (assumes trusted network/firewall)

## Benefits

1. **Better debugging**: Enhanced logging shows full webhook flow
2. **Prevents duplicates**: Dual-layer idempotency (PD + cache)
3. **Flexible testing**: Dev route works without Shippo
4. **Shorter SMS**: Uses short links (80-120 chars vs 600+)
5. **Personalized**: Includes listing title in message
6. **Robust**: Works even if PD updates fail (409)

## Rollback Plan

If issues occur:

1. **Disable test route**: Remove or set `NODE_ENV=production`
2. **Revert webhook changes**: Git revert to previous version
3. **Fall back to PD only**: Comment out cache logic

## Next Steps

1. Deploy to test environment
2. Set `SHIPPO_WEBHOOK_SECRET` if available
3. Test with `npm run webhook:test:track`
4. Accept a booking and wait for real first-scan
5. Verify borrower receives SMS
6. Check logs for expected patterns
7. Monitor for 24 hours
8. Deploy to production

## Success Criteria

- [x] Enhanced logging at webhook entry
- [x] Conditional signature verification
- [x] Multiple first-scan statuses supported
- [x] Dual-layer idempotency (PD + cache)
- [x] Listing title in Step-4 SMS
- [x] Short links used for tracking URLs
- [x] Dev-only test route added
- [x] npm test script added
- [x] No linter errors
- [x] Graceful fallbacks

---

**Implementation Date**: October 15, 2025  
**Status**: ✅ Complete - Ready for Testing  
**Breaking Changes**: None  
**Risk Level**: Low (all changes backward compatible)


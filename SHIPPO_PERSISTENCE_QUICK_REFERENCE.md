# Shippo Persistence - Quick Reference

## What Changed?

✅ **Robust Persistence** - Retries on 409 conflicts, deep merges data  
✅ **Privileged SDK** - No `req.cookies` needed, works everywhere  
✅ **Complete Field Tracking** - All label data saved to protectedData  
✅ **Fast Webhook Lookup** - Uses `metadata.txId` for direct ID lookup  

---

## Using txUpdateProtectedData()

### Basic Usage

```javascript
const { txUpdateProtectedData } = require('./api-util/integrationSdk');

// Simple update
const result = await txUpdateProtectedData(txId, {
  outboundTrackingNumber: '1Z999AA10123456784',
  outboundCarrier: 'UPS'
});

if (result.success) {
  console.log('✅ Saved!');
} else {
  console.log('❌ Failed:', result.error);
}
```

### With Nested Objects (Deep Merge)

```javascript
// This merges into existing shippingNotification, doesn't clobber it
await txUpdateProtectedData(txId, {
  shippingNotification: {
    firstScan: { sent: true, sentAt: new Date().toISOString() }
  }
});
```

### With Retry Options

```javascript
await txUpdateProtectedData(txId, patch, {
  maxRetries: 5,      // Default: 3
  backoffMs: 200      // Default: 100
});
```

---

## Fields Persisted

### Outbound Label
```javascript
{
  outboundTrackingNumber: '1Z999AA10123456784',
  outboundTrackingUrl: 'https://ups.com/track/...',
  outboundLabelUrl: 'https://shippo.com/label/...',
  outboundQrUrl: 'https://shippo.com/qr/...',
  outboundCarrier: 'UPS',
  outboundService: 'Ground',
  outboundQrExpiry: '2025-01-20T00:00:00Z',
  outboundPurchasedAt: '2025-01-15T12:00:00Z',
  outbound: {
    shipByDate: '2025-01-17T00:00:00Z'
  }
}
```

### Return Label
```javascript
{
  returnTrackingNumber: '...',
  returnTrackingUrl: '...',
  returnLabelUrl: '...',
  returnQrUrl: '...',
  returnCarrier: 'USPS',
  returnService: 'Priority',
  returnQrExpiry: '...',
  returnPurchasedAt: '...'
}
```

### Notification State
```javascript
{
  shippingNotification: {
    labelCreated: { sent: true, sentAt: '...' },
    firstScan: { sent: true, sentAt: '...' },
    delivered: { sent: true, sentAt: '...' }
  }
}
```

---

## Webhook Lookup Order

### 1. Preferred: metadata.txId
```javascript
// Webhook payload from Shippo
{
  event: 'track_updated',
  data: {
    tracking_number: '1Z999AA10123456784',
    metadata: { transactionId: 'abc-123-def' } // ← Direct lookup!
  }
}
```
✅ **Fast** - Single API call  
✅ **Reliable** - Always finds correct transaction  

### 2. Fallback: Tracking Number Search
```javascript
// If metadata missing, searches last 100 transactions
for (const tx of last100Transactions) {
  if (tx.protectedData.outboundTrackingNumber === trackingNumber) {
    return tx; // Found!
  }
}
```
⚠️ **Slower** - Searches 100 transactions  
⚠️ **Limited** - Only checks last 100  

---

## Test Endpoint

### Setup
```bash
# Add to .env
TEST_ENDPOINTS=1
```

### Usage
```bash
# Test first-scan SMS
curl -X POST http://localhost:3000/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{"txId":"your-transaction-id", "status":"TRANSIT"}'

# Test delivery SMS
curl -X POST http://localhost:3000/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{"txId":"your-transaction-id", "status":"DELIVERED"}'
```

### What It Does
1. Fetches transaction by ID
2. Extracts `outboundTrackingNumber`
3. Constructs Shippo webhook payload
4. Calls real handler (no signature check)
5. Triggers Step-4 SMS flow

---

## Logs to Watch

### Persistence Success
```
[PERSIST] Updating protectedData for tx=abc123, keys=outboundTrackingNumber,outboundCarrier
[PERSIST] Attempt 1/3: Merging keys into protectedData
✅ [PERSIST] Successfully updated protectedData for tx=abc123
✅ [PERSIST] Stored outbound label fields: outboundTrackingNumber, outboundCarrier, ...
```

### 409 Retry
```
⚠️ [PERSIST] 409 Conflict on attempt 1/3, retrying in 100ms
[PERSIST] Attempt 2/3: Merging keys into protectedData
✅ [PERSIST] Successfully updated protectedData for tx=abc123
```

### Failure
```
❌ [PERSIST] Failed to update protectedData for tx=abc123: {status: 500, error: "..."}
⚠️ [PERSIST] Failed to save outbound label (SMS already sent): Internal error
```

### Webhook Lookup
```
🔍 Looking up transaction by metadata.transactionId: abc123
✅ Found transaction by metadata.transactionId: abc123
✅ Transaction found via metadata.transactionId: abc123
```

---

## Common Issues

### Issue: "Transaction not found" in webhook
**Cause:** metadata.txId missing or incorrect  
**Fix:** Verify Shippo label purchase includes `metadata: JSON.stringify({ txId })`

### Issue: 409 conflicts on every attempt
**Cause:** High concurrency or rapid updates  
**Fix:** Check for multiple workers/processes updating same transaction

### Issue: protectedData fields missing
**Cause:** Persistence failed silently  
**Fix:** Check logs for `[PERSIST]` errors, verify Integration SDK credentials

### Issue: Old data clobbered
**Cause:** Bug in deepMerge or direct assignment  
**Fix:** Always use `txUpdateProtectedData()`, never direct `sdk.transactions.update()`

---

## Environment Variables Required

```bash
# Integration SDK credentials (required)
INTEGRATION_CLIENT_ID=your-client-id
INTEGRATION_CLIENT_SECRET=your-client-secret

# Shippo API (required)
SHIPPO_API_TOKEN=shippo_live_...

# Optional
TEST_ENDPOINTS=1          # Enable test webhook endpoint
SHIPPO_MODE=live          # 'test' or 'live'
SHIPPO_DEBUG=true         # Verbose Shippo logs
```

---

## FAQs

### Q: Can I use this in a cron job?
✅ **Yes!** `getTrustedSdk()` doesn't need `req.cookies`

### Q: What if I need to update multiple transactions?
✅ **Use Promise.all()** for parallel updates:
```javascript
await Promise.all(
  txIds.map(id => txUpdateProtectedData(id, patch))
);
```

### Q: How do I clear a field?
```javascript
await txUpdateProtectedData(txId, {
  outboundQrUrl: null  // Sets to null
});
```

### Q: Can I use this for other data besides labels?
✅ **Yes!** Works for any protectedData updates

### Q: What happens if Integration SDK fails?
The function returns `{ success: false, error: '...' }`. Your code should handle this gracefully (SMS will still work, data just won't persist).

---

## Migration from Old Code

### Before
```javascript
// Old approach - used transitions
const sdk = getIntegrationSdk();
await sdk.transactions.transition({
  id: txId,
  transition: 'transition/store-shipping-urls',
  params: { protectedData: { ...allData } }
});
```

### After
```javascript
// New approach - uses privileged SDK with retries
await txUpdateProtectedData(txId, {
  outboundTrackingNumber: '...'
  // Only include fields you want to update
});
```

**Benefits:**
- ✅ Retries on 409
- ✅ Merges instead of clobbering
- ✅ No transition dependency
- ✅ Works in any state

---

## Ready to Use! 🚀

The new persistence system is:
- ✅ Deployed and working
- ✅ Backward compatible
- ✅ No breaking changes
- ✅ Ready for production

Just use `txUpdateProtectedData(txId, patch)` wherever you need to update protectedData!


# Shippo Test Endpoint Implementation ✅

## Summary

Added a dev-only test endpoint for Shippo tracking webhooks that bypasses signature verification and exercises the real Step-4 SMS handler path.

## Changes Made

### 1. `server/webhooks/shippoTracking.js`

#### Extracted Handler Function
Refactored the main webhook handler into a reusable function:

```javascript
async function handleTrackingWebhook(req, res, opts = {}) {
  const { skipSignature = false, isTest = false } = opts;
  // ... full handler logic with conditional signature verification
}
```

This function:
- Accepts `skipSignature` flag to bypass signature verification
- Accepts `isTest` flag to add `[TEST]` prefix to logs
- Contains all the original webhook processing logic

#### Updated Main Route
```javascript
router.post('/shippo', async (req, res) => {
  await handleTrackingWebhook(req, res, { skipSignature: false, isTest: false });
});
```

#### Added Test Route
```javascript
if (process.env.TEST_ENDPOINTS) {
  router.post('/__test/shippo/track', express.json(), async (req, res) => {
    try {
      console.log('[WEBHOOK:TEST] path=/api/webhooks/__test/shippo/track body=', req.body);
      
      const { txId, status = 'TRANSIT', carrier = 'ups' } = req.body;
      
      if (!txId) {
        return res.status(400).json({ error: 'txId required' });
      }
      
      // Fetch the transaction to get its tracking number
      console.log('[WEBHOOK:TEST] Fetching transaction:', txId);
      const sdk = await getTrustedSdk();
      const response = await sdk.transactions.show({ 
        id: txId,
        include: ['customer', 'provider', 'listing']
      });
      const transaction = response.data.data;
      
      // Extract tracking number from transaction (or use fallback)
      const protectedData = transaction.attributes.protectedData || {};
      const tracking_number = protectedData.outboundTrackingNumber || '1ZXXXXXXXXXXXXXXXX';
      
      console.log('[WEBHOOK:TEST] Using tracking_number:', tracking_number);
      
      // Build payload matching Shippo's track_updated format
      const testPayload = {
        event: 'track_updated',
        test: true,
        mode: process.env.SHIPPO_MODE || 'test',
        data: {
          tracking_number,
          carrier: carrier.toLowerCase(),
          tracking_status: {
            status: status.toUpperCase(),
            status_details: 'Test Event',
            status_date: new Date().toISOString()
          },
          metadata: { transactionId: txId }
        }
      };
      
      // Create request object with test payload
      const testReq = {
        body: testPayload,
        headers: req.headers,
        rawBody: JSON.stringify(testPayload)
      };
      
      // Reuse the real handler; skip signature in test
      await handleTrackingWebhook(testReq, res, { skipSignature: true, isTest: true });
      
    } catch (err) {
      console.error('[WEBHOOK:TEST] error', err);
      res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
  });
}
```

## Key Features

### 1. **Environment Gating**
- Only enabled when `TEST_ENDPOINTS=1` is set
- Safe for production (won't expose test endpoint without explicit opt-in)

### 2. **JSON Parsing**
- Uses `express.json()` middleware on the test route
- Separate from the `express.raw()` used for signature verification on the main route
- Allows easy testing with JSON payloads

### 3. **Signature Bypass**
- Passes `skipSignature: true` to handler
- No need to generate valid HMAC signatures for testing

### 4. **Clear Logging**
- Entry log: `[WEBHOOK:TEST] path=/api/webhooks/__test/shippo/track body=...`
- All handler logs prefixed with `[TEST]`
- Easy to identify test requests in logs

### 5. **Real Handler Reuse**
- Constructs a Shippo-formatted payload from simple test input
- Calls the same `handleTrackingWebhook()` function as production
- Exercises the full Step-4 SMS path (first-scan borrower notifications)

## API Endpoint

### URL
```
POST /api/webhooks/__test/shippo/track
```

### Request Body
```json
{
  "txId": "8e123456-7890-1234-5678-901234567890",
  "status": "TRANSIT"
}
```

### Parameters
- `txId` (required): Transaction ID - endpoint will fetch the transaction and use its tracking number
- `status` (optional): Tracking status (default: "TRANSIT")
  - Use "TRANSIT", "IN_TRANSIT", "ACCEPTED", or "ACCEPTANCE" for first-scan (Step-4) SMS
  - Use "DELIVERED" for delivery SMS
- `carrier` (optional): Carrier name (default: "ups")

### How It Works
1. Fetches the transaction by ID using `sdk.transactions.show()`
2. Extracts tracking number from `tx.attributes.protectedData.outboundTrackingNumber`
3. Falls back to `"1ZXXXXXXXXXXXXXXXX"` if no tracking number is found
4. Constructs a Shippo-formatted webhook payload
5. Calls the real handler with signature verification bypassed
6. Works even with Shippo test tracking numbers!

### Example Using curl
```bash
# Local testing
curl -X POST http://localhost:3000/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{"txId":"your-transaction-id", "status":"TRANSIT"}'

# Test on Render (uses the transaction's saved tracking number)
curl -X POST https://web-template-1.onrender.com/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{"txId":"<YOUR_TX_ID>", "status":"TRANSIT"}'
```

## Environment Setup

### Development/Test Server
Add to `.env` or Render environment variables:
```bash
TEST_ENDPOINTS=1
SHIPPO_MODE=test
```

### Production Server
- **DO NOT** set `TEST_ENDPOINTS=1` in production
- The test endpoint will return 404 if accessed without this flag

## Routing Structure

The endpoint is accessible because:
1. `server/index.js` mounts apiRouter at `/api`
2. `server/apiRouter.js` mounts shippoWebhook at `/webhooks`
3. Result: Full path is `/api/webhooks/__test/shippo/track`

## Testing Flow

1. **First Scan SMS (Step-4)**
   ```bash
   POST /api/webhooks/__test/shippo/track
   {
     "txId": "your-transaction-id",
     "status": "TRANSIT"
   }
   ```
   - Fetches transaction and uses its `outboundTrackingNumber`
   - Triggers borrower SMS with tracking link
   - Message format: `Sherbrt 🍧: 🚚 "Item Title" is on its way! Track: [short-link]`

2. **Delivery SMS**
   ```bash
   POST /api/webhooks/__test/shippo/track
   {
     "txId": "your-transaction-id",
     "status": "DELIVERED"
   }
   ```
   - Uses the transaction's saved tracking number
   - Triggers borrower delivery notification
   - Message format: `Your Sherbrt borrow was delivered! Don't forget to take pics...`

3. **Return First Scan**
   - The endpoint will detect if the tracking number matches `returnTrackingNumber`
   - Automatically sends SMS to lender (not borrower)
   - Works the same way - just provide the txId

## Logs to Watch

When the test endpoint is hit:
```
[WEBHOOK:TEST] path=/api/webhooks/__test/shippo/track body= { txId: '...', status: 'TRANSIT' }
[WEBHOOK:TEST] Fetching transaction: ...
[WEBHOOK:TEST] Using tracking_number: 1Z999AA10123456784
[TEST] 🚀 Shippo webhook received! event=track_updated
[TEST] 📋 Request body: { ... }
[TEST] ⚠️ Signature verification skipped (test mode)
✅ Status is TRANSIT - processing first scan webhook
🔍 Looking up transaction by metadata.transactionId: ...
✅ Transaction found via metadata.transactionId: ...
[STEP-4] Sending borrower SMS for tracking ..., txId=...
✅ [STEP-4] Borrower SMS sent for tracking ..., txId=...
```

## Commit Message

```
feat(webhooks): add dev-only Shippo test route and ensure JSON parsing; bypass signature in test
```

## Next Steps

1. **Deploy to Test Environment**
   - Add `TEST_ENDPOINTS=1` to Render environment variables
   - Redeploy the test service

2. **Test the Endpoint**
   - Use curl or Postman to hit the test endpoint
   - Verify SMS messages are sent
   - Check logs for `[WEBHOOK:TEST]` and `[TEST]` prefixes

3. **Production Safety**
   - Ensure `TEST_ENDPOINTS` is NOT set in production
   - The test endpoint will be completely disabled without this env var


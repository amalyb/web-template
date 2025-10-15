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
      
      // Construct a Shippo-formatted payload from test input
      const { tracking_number, carrier = 'ups', status = 'TRANSIT', txId } = req.body;
      
      if (!tracking_number) {
        return res.status(400).json({ error: 'tracking_number required' });
      }
      
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
          metadata: txId ? { transactionId: txId } : {}
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
  "tracking_number": "1Z999AA10123456784",
  "carrier": "ups",
  "status": "TRANSIT",
  "txId": "8e123456-7890-1234-5678-901234567890"
}
```

### Parameters
- `tracking_number` (required): The tracking number to simulate
- `carrier` (optional): Carrier name (default: "ups")
- `status` (optional): Tracking status (default: "TRANSIT")
  - Use "TRANSIT", "IN_TRANSIT", "ACCEPTED", or "ACCEPTANCE" for first-scan (Step-4) SMS
  - Use "DELIVERED" for delivery SMS
- `txId` (optional): Transaction ID for direct lookup (added to payload metadata)

### Example Using curl
```bash
curl -X POST http://localhost:3000/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{
    "tracking_number": "1Z999AA10123456784",
    "carrier": "ups",
    "status": "TRANSIT",
    "txId": "8e123456-7890-1234-5678-901234567890"
  }'
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
     "tracking_number": "1Z999AA10123456784",
     "status": "TRANSIT",
     "txId": "your-transaction-id"
   }
   ```
   - Triggers borrower SMS with tracking link
   - Message format: `Sherbrt 🍧: 🚚 "Item Title" is on its way! Track: [short-link]`

2. **Delivery SMS**
   ```bash
   POST /api/webhooks/__test/shippo/track
   {
     "tracking_number": "1Z999AA10123456784",
     "status": "DELIVERED",
     "txId": "your-transaction-id"
   }
   ```
   - Triggers borrower delivery notification
   - Message format: `Your Sherbrt borrow was delivered! Don't forget to take pics...`

3. **Return First Scan**
   - Use a tracking number that matches `returnTrackingNumber` in transaction protectedData
   - Sends SMS to lender (not borrower)

## Logs to Watch

When the test endpoint is hit:
```
[WEBHOOK:TEST] path=/api/webhooks/__test/shippo/track body= { tracking_number: '...', ... }
[TEST] 🚀 Shippo webhook received! event=track_updated
[TEST] 📋 Request body: { ... }
[TEST] ⚠️ Signature verification skipped (test mode)
✅ Status is TRANSIT - processing first scan webhook
🔍 Looking up transaction by metadata.transactionId: ...
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


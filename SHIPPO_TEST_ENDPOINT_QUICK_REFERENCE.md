# Shippo Test Endpoint - Quick Reference

## What Was Implemented

✅ Dev-only test endpoint for Shippo tracking webhooks  
✅ Bypasses signature verification  
✅ Uses JSON parsing (not raw body)  
✅ Reuses real handler to exercise Step-4 SMS path  
✅ Clear logging with `[WEBHOOK:TEST]` breadcrumbs  
✅ Only enabled when `TEST_ENDPOINTS=1`

## Endpoint

```
POST /api/webhooks/__test/shippo/track
Content-Type: application/json
```

## Request Body

```json
{
  "txId": "8e123456-7890-1234-5678-901234567890",
  "status": "TRANSIT"
}
```

- `txId` (required): Transaction ID - will fetch and use its tracking number
- `status` (optional): Default "TRANSIT"
  - First-scan: "TRANSIT", "IN_TRANSIT", "ACCEPTED", "ACCEPTANCE"
  - Delivery: "DELIVERED"
- `carrier` (optional): Default "ups"

**How it works:**
- Fetches the transaction by ID
- Uses `tx.attributes.protectedData.outboundTrackingNumber`
- Falls back to `"1ZXXXXXXXXXXXXXXXX"` if not found
- Works even with Shippo test tracking numbers

## Environment Setup

### Test/Dev Server
```bash
TEST_ENDPOINTS=1
SHIPPO_MODE=test
```

### Production
- DO NOT set `TEST_ENDPOINTS=1`
- Endpoint will be disabled without this flag

## Quick Test

```bash
# Test first-scan SMS (uses the transaction's saved tracking number)
curl -X POST http://localhost:3000/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{"txId":"your-transaction-id-here", "status":"TRANSIT"}'

# Test delivery SMS
curl -X POST http://localhost:3000/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{"txId":"your-transaction-id-here", "status":"DELIVERED"}'

# Test on Render
curl -X POST https://web-template-1.onrender.com/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{"txId":"<YOUR_TX_ID>", "status":"TRANSIT"}'
```

## Files Changed

- `server/webhooks/shippoTracking.js` - Added test route and extracted handler

## What Logs to Watch

```
[WEBHOOK:TEST] path=/api/webhooks/__test/shippo/track body= {...}
[TEST] 🚀 Shippo webhook received! event=track_updated
[TEST] ⚠️ Signature verification skipped (test mode)
[STEP-4] Sending borrower SMS for tracking ...
✅ [STEP-4] Borrower SMS sent ...
```

## Deployment Checklist

1. ✅ Code changes complete
2. ⬜ Add `TEST_ENDPOINTS=1` to Render test environment
3. ⬜ Redeploy test service
4. ⬜ Test endpoint with curl or test script
5. ⬜ Verify SMS delivery (check logs)

## Suggested Commit Message

```
feat(webhooks): add dev-only Shippo test route and ensure JSON parsing; bypass signature in test
```


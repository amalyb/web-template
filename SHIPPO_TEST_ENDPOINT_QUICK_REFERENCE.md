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
  "tracking_number": "1Z999AA10123456784",
  "carrier": "ups",
  "status": "TRANSIT",
  "txId": "8e123456-7890-1234-5678-901234567890"
}
```

- `tracking_number` (required): Tracking number
- `carrier` (optional): Default "ups"
- `status` (optional): Default "TRANSIT"
  - First-scan: "TRANSIT", "IN_TRANSIT", "ACCEPTED", "ACCEPTANCE"
  - Delivery: "DELIVERED"
- `txId` (optional): Transaction ID for direct lookup

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
# Test first-scan SMS
curl -X POST http://localhost:3000/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{
    "tracking_number": "1Z999AA10123456784",
    "status": "TRANSIT",
    "txId": "your-transaction-id-here"
  }'

# Or use the test script
node test-shippo-webhook-endpoint.js
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


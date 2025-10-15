# Webhook Test Endpoint Fix - Cookie Bypass

## Problem

When testing the Shippo tracking webhook with curl, we encountered this runtime error:

```
TypeError: Cannot read properties of undefined (reading 'cookies')
    at readCookie (...sharetribe-flex-sdk-node.js:14283)
    at getUserToken (.../server/api-util/sdk.js:66)
    at getTrustedSdk (.../server/api-util/sdk.js:124)
    at /server/webhooks/shippoTracking.js:583
```

**Root Cause:** The test endpoint was using `getTrustedSdk()` from `server/api-util/sdk.js`, which requires a request object with cookies for authentication. When testing with curl (no browser session), there are no cookies, causing the crash.

## Solution

Modified **only the test endpoint** (`/api/webhooks/__test/shippo/track`) to:

1. ✅ **Bypass cookie/session authentication** completely
2. ✅ **Use Integration SDK** from `server/api-util/integrationSdk.js` instead
3. ✅ **Require `txId` in JSON body** (don't infer from cookies)
4. ✅ **Fetch transaction** with `integrationSdk.transactions.show({ id: txId })`
5. ✅ **Send SMS based on status:**
   - Step-4 SMS (`item_shipped_to_borrower`) for `ACCEPTED`/`IN_TRANSIT`/`TRANSIT`
   - Step-6 SMS (`item_delivered_to_borrower`) for `DELIVERED`
6. ✅ **Respect `metadata.direction === "return"`** (skip borrower SMS)
7. ✅ **Return `{ ok: true }` JSON** on success
8. ✅ **Clean logging** with `[WEBHOOK:TEST]` and `[SMS:OUT]` prefixes

## Changes Made

### File: `server/webhooks/shippoTracking.js`

#### 1. Added Integration SDK Import

```javascript
const { getTrustedSdk: getIntegrationSdk } = require('../api-util/integrationSdk');
```

#### 2. Completely Rewrote Test Endpoint Handler

The new test endpoint:
- **NO cookie dependencies** - works with curl
- Uses `getIntegrationSdk()` instead of cookie-based SDK
- Simplified logic focused on testing
- Clear logging for debugging

## Production Webhook Unchanged

🚨 **IMPORTANT:** The production webhook (`POST /api/webhooks/shippo`) is **completely unchanged**. It still uses the original cookie-based SDK and signature verification.

## Testing

### Test with curl (now works!)

```bash
# Test Step-4 SMS (item shipped to borrower)
curl -X POST http://localhost:3500/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{
    "txId": "your-transaction-id-here",
    "status": "TRANSIT",
    "metadata": { "direction": "outbound" }
  }'

# Test Step-6 SMS (item delivered to borrower)
curl -X POST http://localhost:3500/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{
    "txId": "your-transaction-id-here",
    "status": "DELIVERED",
    "metadata": { "direction": "outbound" }
  }'

# Test return shipment (should skip borrower SMS)
curl -X POST http://localhost:3500/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{
    "txId": "your-transaction-id-here",
    "status": "TRANSIT",
    "metadata": { "direction": "return" }
  }'
```

### Or use the test script

```bash
node test-webhook-fix.js <txId> TRANSIT
node test-webhook-fix.js <txId> DELIVERED
node test-webhook-fix.js <txId> TRANSIT '{"direction":"return"}'
```

## Log Output

The fixed endpoint produces clean, structured logs:

```
[WEBHOOK:TEST] start path=/api/webhooks/__test/shippo/track body= {...}
[WEBHOOK:TEST] Fetching transaction: abc123-def456-...
[WEBHOOK:TEST] phase=TRANSIT direction=outbound
[SMS:OUT] tag=item_shipped_to_borrower to=+15551234567 msg="Sherbrt 🍧: 🚚 "Item Name" is on its way! Track: https://short.link/xyz"
[WEBHOOK:TEST] SMS sent successfully to +15551234567
```

## API Reference

### POST `/api/webhooks/__test/shippo/track`

**Request Body:**

```json
{
  "txId": "transaction-uuid-here",
  "status": "TRANSIT | IN_TRANSIT | ACCEPTED | DELIVERED",
  "metadata": {
    "direction": "outbound | return"
  }
}
```

**Response (Success):**

```json
{
  "ok": true,
  "message": "Shipped SMS sent",
  "transactionId": "abc123-def456-...",
  "borrowerPhone": "+15551234567",
  "tag": "item_shipped_to_borrower"
}
```

**Response (Return Shipment):**

```json
{
  "ok": true,
  "message": "Return shipment - no borrower SMS"
}
```

**Response (Error):**

```json
{
  "error": "Transaction not found",
  "txId": "invalid-id"
}
```

## Environment Requirements

The test endpoint requires these environment variables:

- `TEST_ENDPOINTS=true` - enables the test route
- `INTEGRATION_CLIENT_ID` - Integration API credentials
- `INTEGRATION_CLIENT_SECRET` - Integration API credentials
- `TWILIO_ACCOUNT_SID` - for sending SMS
- `TWILIO_AUTH_TOKEN` - for sending SMS
- `TWILIO_PHONE_NUMBER` - sender phone number

## Benefits

✅ **No more cookie errors** when testing with curl
✅ **Simplified test flow** - just provide txId and status
✅ **Accurate testing** - uses the same Integration SDK as production background jobs
✅ **Clean separation** - test endpoint vs production webhook
✅ **Better debugging** - structured logs with clear tags
✅ **Respects business logic** - skips borrower SMS for returns

## Related Files

- `server/webhooks/shippoTracking.js` - webhook handlers (modified)
- `server/api-util/integrationSdk.js` - Integration SDK wrapper (unchanged)
- `server/api-util/sdk.js` - cookie-based SDK (unchanged)
- `test-webhook-fix.js` - test script (new)

---

**Status:** ✅ Complete - Test endpoint now bypasses cookies and uses Integration SDK


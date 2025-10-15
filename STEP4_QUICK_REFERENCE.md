# Step-4 SMS Quick Reference 🚀

## Test Endpoint

```bash
POST /api/webhooks/__test/shippo/track
```

### Outbound (Borrower SMS)
```bash
curl -X POST http://localhost:3500/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{"txId":"<YOUR-TX-ID>","status":"TRANSIT"}'
```

### Return (Lender SMS)
```bash
curl -X POST http://localhost:3500/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{"txId":"<YOUR-TX-ID>","status":"TRANSIT","metadata":{"direction":"return"}}'
```

### Using Test Script
```bash
node test-step4-sms.js <txId>
node test-step4-sms.js <txId> ACCEPTED usps
node test-step4-sms.js <txId> IN_TRANSIT ups
```

## Status Mapping

| Status | Phase | Action |
|--------|-------|--------|
| `ACCEPTED` | SHIPPED | ✅ Send Step-4 SMS |
| `IN_TRANSIT` | SHIPPED | ✅ Send Step-4 SMS |
| `TRANSIT` | SHIPPED | ✅ Send Step-4 SMS |
| `DELIVERED` | DELIVERED | ✅ Send Step-6 SMS |
| Other | OTHER | ❌ Ignore |

## SMS Tags

```javascript
SMS_TAGS.ITEM_SHIPPED_TO_BORROWER      // Step 4: outbound shipped
SMS_TAGS.DELIVERY_TO_BORROWER          // Step 6: outbound delivered
SMS_TAGS.RETURN_FIRST_SCAN_TO_LENDER   // Step 10: return shipped
```

## Code Examples

### Update ProtectedData
```javascript
const { upsertProtectedData } = require('./lib/txData');

await upsertProtectedData(txId, {
  outboundShippedAt: new Date().toISOString()
});
```

### Send SMS
```javascript
const { sendSMS } = require('./api-util/sendSMS');
const { SMS_TAGS } = require('./lib/sms/tags');

await sendSMS(phone, message, {
  role: 'customer',
  transactionId: txId,
  tag: SMS_TAGS.ITEM_SHIPPED_TO_BORROWER,
  meta: { listingId }
});
```

### Check Status Phase
```javascript
const { toCarrierPhase } = require('./lib/statusMap');

const phase = toCarrierPhase('IN_TRANSIT'); // → 'SHIPPED'
if (phase === 'SHIPPED') {
  // Send Step-4 SMS
}
```

## Verification

### Logs
```bash
tail -f logs/server.log | grep "SMS:OUT"
tail -f logs/server.log | grep "STEP-4"
```

### Expected Log Output
```
[SMS:OUT] tag=item_shipped_to_borrower to=+1XXX... meta={"listingId":"..."} body="..."
✅ [STEP-4] Borrower SMS sent for tracking 1Z..., txId=abc123-...
```

### Check ProtectedData
```javascript
// In Flex Console or via API
protectedData.shippingNotification.firstScan.sent === true
protectedData.shippingNotification.firstScan.sentAt === "2025-01-15T..."
```

## Environment Variables

```bash
# Required
INTEGRATION_CLIENT_ID=xxx
INTEGRATION_CLIENT_SECRET=xxx
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_MESSAGING_SERVICE_SID=xxx

# For testing
TEST_ENDPOINTS=1
SMS_DRY_RUN=1              # Optional: log without sending
ONLY_PHONE=+15551234567    # Optional: only send to this number
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Test endpoint returns 404 | Set `TEST_ENDPOINTS=1` |
| No SMS sent | Check Twilio env vars, check `SMS_DRY_RUN` |
| Wrong person gets SMS | Check `metadata.direction` |
| Duplicate SMS | Check logs for "idempotent" message |
| ProtectedData not updating | Check Integration SDK credentials |

## Files

```
server/
├── lib/
│   ├── sms/
│   │   ├── tags.js          ✨ SMS tag constants
│   │   └── sendSms.js       ✨ SMS wrapper
│   ├── txData.js            ✨ ProtectedData helper
│   └── statusMap.js         ✨ Status normalization
├── webhooks/
│   └── shippoTracking.js    🔧 Enhanced
└── api-util/
    └── integrationSdk.js    ✅ Already robust

test-step4-sms.js            ✨ Test script
STEP4_SMS_IMPLEMENTATION.md  📖 Full docs
```

## Next Steps

1. Run test: `node test-step4-sms.js <txId>`
2. Check logs for `[SMS:OUT] tag=item_shipped_to_borrower`
3. Verify Twilio delivery receipt
4. Check protectedData in Flex Console
5. Test return flow with `metadata.direction=return`

---

**Quick test:** `node test-step4-sms.js <txId>`

**Full docs:** `STEP4_SMS_IMPLEMENTATION.md`


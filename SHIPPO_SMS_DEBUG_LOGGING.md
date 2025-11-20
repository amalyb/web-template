# Shippo SMS Debug Logging - Implementation Complete

## Changes Made

### 1. Enhanced Webhook Handler Logging (`server/webhooks/shippoTracking.js`)

Added comprehensive logging after `sendSMS()` call for delivery SMS:

```javascript
// [SHIPPO_SMS_DEBUG] Log the full result for delivery SMS debugging
if (isDelivery) {
  console.log(`[SHIPPO_SMS_DEBUG] delivered SMS result:`, JSON.stringify({
    skipped: smsResult?.skipped || false,
    reason: smsResult?.reason || null,
    sent: smsResult?.sent || false,
    sid: smsResult?.sid || null,
    suppressed: smsResult?.suppressed || false,
    to: borrowerPhone,
    transactionId: transaction.id,
    tag: SMS_TAGS.DELIVERY_TO_BORROWER
  }, null, 2));
}
```

This log line will show exactly which guard prevented SMS from being sent:
- `skipped: true, reason: 'dry_run'` → SMS_DRY_RUN is enabled
- `skipped: true, reason: 'only_phone_filter'` → ONLY_PHONE filter mismatch
- `skipped: true, reason: 'missing_twilio_credentials'` → Twilio credentials missing
- `skipped: true, reason: 'invalid_phone_format'` → Borrower phone format issue
- `sent: true, sid: 'SM...'` → SMS was successfully sent

### 2. Enhanced sendSMS() Logging (`server/api-util/sendSMS.js`)

Added `[SHIPPO_SMS_DEBUG]` log lines for each guard that can skip SMS:
- DRY_RUN guard
- ONLY_PHONE filter
- Missing Twilio credentials
- Invalid phone format
- Invalid E.164 format

---

## Steps to Tail Logs and Test

### Step 1: Deploy Changes

1. Commit and push the changes:
   ```bash
   git add server/webhooks/shippoTracking.js server/api-util/sendSMS.js
   git commit -m "Add enhanced SMS debug logging for delivery webhook"
   git push
   ```

2. Wait for Render to deploy (or deploy manually)

### Step 2: Tail Render Logs

**Option A: Render Dashboard**
1. Go to your Render dashboard
2. Select your web service
3. Click "Logs" tab
4. Filter by `[SHIPPO_SMS_DEBUG]` or `[SHIPPO DELIVERY DEBUG]`

**Option B: Render CLI**
```bash
# Install Render CLI if needed
npm install -g render-cli

# Login
render login

# Tail logs (replace SERVICE_NAME with your service name)
render logs --service SERVICE_NAME --tail | grep -E "SHIPPO_SMS_DEBUG|SHIPPO DELIVERY DEBUG"
```

**Option C: Direct SSH/Shell Access**
If you have shell access to your Render instance:
```bash
# Tail logs
tail -f /path/to/logs | grep -E "SHIPPO_SMS_DEBUG|SHIPPO DELIVERY DEBUG"
```

### Step 3: Replay Webhook (Test)

**Using the replay script:**
```bash
# Make sure you have a sample webhook payload
node server/scripts/replayShippoWebhook.js server/scripts/sample-shippo-delivered.json
```

**Or manually trigger via curl:**
```bash
curl -X POST https://your-domain.com/api/webhooks/shippo \
  -H "Content-Type: application/json" \
  -d @server/scripts/sample-shippo-delivered.json
```

### Step 4: Check Logs for Debug Output

Look for these log lines in order:

1. **Pre-send configuration check:**
   ```
   [SHIPPO DELIVERY DEBUG] 📤 SMS configuration check:
   [SHIPPO DELIVERY DEBUG]   SMS_DRY_RUN: ENABLED/DISABLED
   [SHIPPO DELIVERY DEBUG]   ONLY_PHONE: +1234567890 or NOT SET
   [SHIPPO DELIVERY DEBUG]   Twilio credentials: PRESENT/MISSING
   [SHIPPO DELIVERY DEBUG]   to: +1234567890
   ```

2. **Guard-specific skip logs (if SMS is skipped):**
   ```
   [SHIPPO_SMS_DEBUG] SMS skipped due to DRY_RUN: ...
   [SHIPPO_SMS_DEBUG] SMS skipped due to ONLY_PHONE filter: ...
   [SHIPPO_SMS_DEBUG] SMS skipped due to missing credentials: ...
   ```

3. **Final result (most important):**
   ```
   [SHIPPO_SMS_DEBUG] delivered SMS result: {
     "skipped": true/false,
     "reason": "dry_run" | "only_phone_filter" | "missing_twilio_credentials" | null,
     "sent": true/false,
     "sid": "SM..." | null,
     "to": "+1234567890",
     "transactionId": "...",
     "tag": "item_delivered_to_borrower"
   }
   ```

---

## Quick Sanity Checklist (Render Live Environment)

While waiting for deployment, check these in Render's dashboard:

### 1. SMS_DRY_RUN
- **Location:** Render Dashboard → Your Service → Environment
- **Expected:** Either **not set** or explicitly `0`
- **If set to `1`:** SMS will be logged but NOT sent

### 2. ONLY_PHONE
- **Location:** Render Dashboard → Your Service → Environment
- **Expected:** **Unset** (not present)
- **If set:** Only SMS to that specific number will be sent
- **Action if set:** Clear it, redeploy, then replay webhook

### 3. Borrower Phone on Transaction

Use the debug script to check the borrower phone:
```bash
node server/scripts/debugShippoDeliveryForTx.js <transactionId>
```

Look for:
```
📱 [SHIPPO DELIVERY DEBUG] Borrower Contact Info (all lookup paths):
  1. customer.profile.protectedData.phone: +1234567890
  2. protectedData.customerPhone: NOT FOUND
  3. metadata.customerPhone: NOT FOUND
  
  → Final borrower phone: +1234567890
```

**If it prints `NOT FOUND`:** That's the smoking gun - borrower phone is missing from transaction.

---

## What the Logs Will Tell You

### Case 1: SMS_DRY_RUN Enabled
```
[SHIPPO_SMS_DEBUG] delivered SMS result: {
  "skipped": true,
  "reason": "dry_run",
  "sent": false,
  "sid": null
}
```
**Fix:** Set `SMS_DRY_RUN=0` or unset it in Render environment variables.

### Case 2: ONLY_PHONE Filter Mismatch
```
[SHIPPO_SMS_DEBUG] delivered SMS result: {
  "skipped": true,
  "reason": "only_phone_filter",
  "sent": false,
  "sid": null,
  "to": "+15551234567"
}
```
**Fix:** Unset `ONLY_PHONE` in Render environment variables, or set it to the borrower's phone number.

### Case 3: Missing Twilio Credentials
```
[SHIPPO_SMS_DEBUG] delivered SMS result: {
  "skipped": true,
  "reason": "missing_twilio_credentials",
  "sent": false,
  "sid": null
}
```
**Fix:** Set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in Render environment variables.

### Case 4: Invalid Phone Format
```
[SHIPPO_SMS_DEBUG] delivered SMS result: {
  "skipped": true,
  "reason": "invalid_phone_format" | "invalid_e164_format",
  "sent": false,
  "sid": null,
  "to": "invalid-phone"
}
```
**Fix:** Check borrower phone in transaction - use `debugShippoDeliveryForTx.js` to inspect.

### Case 5: SMS Successfully Sent
```
[SHIPPO_SMS_DEBUG] delivered SMS result: {
  "skipped": false,
  "reason": null,
  "sent": true,
  "sid": "SM1234567890abcdef",
  "to": "+15551234567"
}
```
**Status:** ✅ SMS was sent successfully. Check Twilio dashboard for delivery status.

---

## Next Steps After Reviewing Logs

1. **If SMS was skipped:** Fix the root cause (env var, phone format, etc.)
2. **If SMS was sent but not received:** Check Twilio dashboard for delivery status
3. **If borrower phone is missing:** Investigate why phone wasn't saved during booking
4. **If webhook never arrives:** Check Shippo dashboard for webhook delivery status

---

## Files Modified

- `server/webhooks/shippoTracking.js` - Added `[SHIPPO_SMS_DEBUG] delivered SMS result` log
- `server/api-util/sendSMS.js` - Added guard-specific `[SHIPPO_SMS_DEBUG]` logs

---

## Testing Checklist

- [ ] Changes deployed to Render
- [ ] Logs are tailing successfully
- [ ] Webhook replayed (or real webhook received)
- [ ] `[SHIPPO_SMS_DEBUG] delivered SMS result` log appears
- [ ] Root cause identified from log output
- [ ] Fix applied (if needed)
- [ ] Retested after fix


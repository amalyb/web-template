# Shipping SMS Forensic Analysis Report
**Date:** 2025-01-27  
**Transaction ID:** `6912605f-7d45-4f12-a382-5e135aee0829`  
**Tracking Number:** `1ZB8F618YN86050063`  
**Transaction URL:** https://sherbrt.com/sale/6912605f-7d45-4f12-a382-5e135aee0829

---

## Executive Summary

This document provides a forensic analysis of why shipping/tracking SMS notifications were not sent for the specified transaction. The analysis is based on code review and provides a systematic checklist for investigating the root cause.

### ⚠️ CRITICAL FINDING: Potential Metadata Mismatch

**Label Creation (line 524):** Sets `metadata: JSON.stringify({ txId })`  
**Webhook Handler (line 301):** Expects `metadata.transactionId`

This mismatch could prevent the primary transaction lookup method from working. The webhook handler may need to parse `metadata` as JSON if Shippo sends it as a string, or the label creation should use `transactionId` as the key instead of `txId`.

---

## 1. Implementation Confirmation

### A. First Scan / In-Transit SMS Trigger

**File:** `server/webhooks/shippoTracking.js`  
**Function:** `handleTrackingWebhook()` (lines 228-578)  
**Route:** `POST /api/webhooks/shippo` (mounted at `/api/webhooks/shippo`)

#### Status Values That Trigger First Scan SMS:
- `TRANSIT`
- `IN_TRANSIT`
- `ACCEPTED`
- `ACCEPTANCE`

**Code Reference (lines 284-287):**
```javascript
const firstScanStatuses = ['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE'];
const isFirstScan = firstScanStatuses.includes(upperStatus);
```

#### Transaction Lookup Logic:

**Primary Method (lines 300-312):**
1. Uses `metadata.transactionId` from Shippo webhook payload
   - If present, directly fetches transaction: `sdk.transactions.show({ id: metadata.transactionId })`

**Fallback Method (lines 314-324):**
2. Searches last 100 transactions by tracking number
   - Queries: `sdk.transactions.query({ limit: 100, include: ['customer', 'listing'] })`
   - Matches against `protectedData.outboundTrackingNumber` or `protectedData.returnTrackingNumber`

#### Borrower Phone Lookup (lines 158-191):

The code checks three locations in order:
1. `transaction.relationships.customer.data.attributes.profile.protectedData.phone`
2. `transaction.attributes.protectedData.customerPhone`
3. `transaction.attributes.metadata.customerPhone`

Phone numbers are normalized to E.164 format via `normalizePhoneNumber()` (lines 92-120).

#### SMS Guards That Can Suppress SMS:

**File:** `server/api-util/sendSMS.js`

1. **`SMS_DRY_RUN=1`** (line 67)
   - Logs SMS without sending
   - Returns early: `return Promise.resolve()`

2. **`ONLY_PHONE=+1234567890`** (lines 68, 96-102)
   - Only sends to specific phone number
   - Compares normalized phone numbers
   - Returns early if borrower phone doesn't match

3. **Missing Twilio Credentials** (lines 110-113)
   - Missing `TWILIO_ACCOUNT_SID` or `TWILIO_AUTH_TOKEN`
   - Logs warning and returns early

4. **Missing `TWILIO_MESSAGING_SERVICE_SID`** (lines 185-192)
   - Falls back to `TWILIO_PHONE_NUMBER`
   - Logs error but still attempts to send

### B. Delivery SMS Trigger

**Status Values That Trigger Delivery SMS:**
- `DELIVERED` (line 286)

**Code Reference:**
```javascript
const isDelivery = upperStatus === 'DELIVERED';
```

Transaction and phone lookup logic is identical to first scan SMS.

### C. Webhook Configuration

**Webhook URL:** `https://sherbrt.com/api/webhooks/shippo`  
**Expected Event:** `track_updated`

**Signature Verification (lines 237-250):**
- Requires `SHIPPO_WEBHOOK_SECRET` environment variable
- Uses HMAC SHA256 signature verification
- If secret not set, skips verification (test mode)

**Mode Filtering (lines 274-281):**
- If `SHIPPO_MODE` is set, filters webhooks by `event.mode`
- Only processes webhooks matching the configured mode
- Returns 200 OK silently if mode doesn't match

---

## 2. Transaction Data Trace Checklist

### Manual Verification Steps:

**Using Flex SDK or Admin Tools:**

1. **Fetch Transaction:**
   ```javascript
   const tx = await sdk.transactions.show({
     id: '6912605f-7d45-4f12-a382-5e135aee0829',
     include: ['customer', 'provider', 'listing']
   });
   ```

2. **Check Tracking Number Storage:**
   - `tx.attributes.protectedData.outboundTrackingNumber` should equal `1ZB8F618YN86050063`
   - `tx.attributes.protectedData.returnTrackingNumber` (if applicable)

3. **Check Shippo Metadata:**
   - `tx.attributes.protectedData.shippoShipmentId`
   - `tx.attributes.metadata.shippoLabelId` (if stored)

4. **Check Borrower Phone:**
   - `tx.relationships.customer.data.attributes.profile.protectedData.phone`
   - `tx.attributes.protectedData.customerPhone`
   - `tx.attributes.metadata.customerPhone`

5. **Check SMS Sent Flags:**
   - `tx.attributes.protectedData.shippingNotification.firstScan.sent`
   - `tx.attributes.protectedData.shippingNotification.delivered.sent`

### Critical Questions:

**Q1: Is `1ZB8F618YN86050063` stored on the transaction?**
- **Check:** `protectedData.outboundTrackingNumber === '1ZB8F618YN86050063'`
- **If NO:** Label was not properly linked to transaction
- **Impact:** Webhook fallback search may fail if transaction is older than last 100

**Q2: Was `metadata.transactionId` set on Shippo label?**
- **Check:** Shippo dashboard → Labels → Find label for `1ZB8F618YN86050063` → Check metadata
- **Expected:** `metadata.transactionId = '6912605f-7d45-4f12-a382-5e135aee0829'`
- **If NO:** Primary lookup method will fail, must rely on fallback

**Q3: Is borrower phone available?**
- **Check:** All three phone lookup locations
- **If NO:** SMS cannot be sent (returns 400 error)

---

## 3. Log Search Checklist

### Search Server Logs For:

**Transaction ID:**
```bash
grep -r "6912605f-7d45-4f12-a382-5e135aee0829" /path/to/logs
```

**Tracking Number:**
```bash
grep -r "1ZB8F618YN86050063" /path/to/logs
```

**Shippo Webhook Events:**
```bash
grep -r "Shippo webhook received" /path/to/logs
grep -r "track_updated" /path/to/logs
```

**Specific Log Patterns to Find:**

1. **Webhook Received:**
   ```
   🚀 Shippo webhook received! event=track_updated
   📦 Tracking Number: 1ZB8F618YN86050063
   ```

2. **Transaction Lookup:**
   ```
   🔍 Looking up transaction by metadata.transactionId: 6912605f-7d45-4f12-a382-5e135aee0829
   ✅ Found transaction by metadata.transactionId: 6912605f-7d45-4f12-a382-5e135aee0829
   ```
   OR
   ```
   🔍 Falling back to search by tracking number: 1ZB8F618YN86050063
   ✅ Found transaction 6912605f-7d45-4f12-a382-5e135aee0829 with tracking number 1ZB8F618YN86050063
   ```

3. **Status Evaluation:**
   ```
   ✅ Status is TRANSIT - processing first scan webhook
   ```
   OR
   ```
   ✅ Status is DELIVERED - processing delivery webhook
   ```

4. **Phone Lookup:**
   ```
   📱 Found phone in customer profile: +1234567890
   📱 Borrower phone: +1234567890
   ```

5. **SMS Guards:**
   ```
   [sms][DRY_RUN] would send: { to: '+1234567890', ... }
   ```
   OR
   ```
   [sms] ONLY_PHONE set, skipping { to: '+1234567890', ONLY_PHONE: '+1987654321', ... }
   ```
   OR
   ```
   ⚠️ Twilio env vars missing — skipping SMS
   ```

6. **SMS Sent:**
   ```
   ✅ [STEP-4] Borrower SMS sent for tracking 1ZB8F618YN86050063, txId=6912605f-7d45-4f12-a382-5e135aee0829
   ```
   OR
   ```
   ✅ delivery SMS sent successfully to +1234567890
   ```

7. **Errors:**
   ```
   ❌ Could not find transaction for this tracking update
   ```
   OR
   ```
   ⚠️ No borrower phone number found - cannot send SMS
   ```
   OR
   ```
   ❌ Failed to send first scan SMS to +1234567890
   ```

### If No Log Hits Found:

**This indicates:**
- Webhook never reached the server
- Webhook URL misconfigured in Shippo dashboard
- Webhook signature verification failed (403 error, may not be logged)
- `SHIPPO_MODE` filter rejected the webhook silently

---

## 4. Environment Variables Check

### Required Variables (Read-Only Check):

**SMS Configuration:**
```bash
SMS_DRY_RUN          # Should be unset or '0' in production
ONLY_PHONE           # Should be unset in production
TWILIO_ACCOUNT_SID   # Must be set
TWILIO_AUTH_TOKEN    # Must be set
TWILIO_MESSAGING_SERVICE_SID  # Preferred, or TWILIO_PHONE_NUMBER
```

**Shippo Configuration:**
```bash
SHIPPO_MODE          # 'live' or 'test' - filters webhooks by mode
SHIPPO_WEBHOOK_SECRET # Required for signature verification
SHIPPO_API_TOKEN     # Required for label creation
```

**Check Production Environment:**
- Render Dashboard → Environment → Check all above variables
- Document current values (without exposing secrets)

---

## 5. Root Cause Analysis Framework

### Decision Tree:

```
Did webhook reach handleTrackingWebhook()?
├─ NO → Check:
│   ├─ Webhook URL in Shippo dashboard: https://sherbrt.com/api/webhooks/shippo
│   ├─ SHIPPO_MODE filter (if set, webhook event.mode must match)
│   ├─ Signature verification (if SHIPPO_WEBHOOK_SECRET set, signature must be valid)
│   └─ Server logs for 403/404 errors
│
└─ YES → Check:
    ├─ Status evaluation:
    │   ├─ Was status TRANSIT/IN_TRANSIT/ACCEPTED/ACCEPTANCE? (first scan)
    │   └─ Was status DELIVERED? (delivery)
    │
    ├─ Transaction lookup:
    │   ├─ Did metadata.transactionId match? (primary)
    │   └─ Did tracking number search find transaction? (fallback)
    │
    ├─ Borrower phone:
    │   └─ Was phone found in any of 3 locations?
    │
    ├─ SMS guards:
    │   ├─ SMS_DRY_RUN=1? (disables sending)
    │   ├─ ONLY_PHONE set? (filters recipients)
    │   └─ Twilio credentials present?
    │
    └─ Idempotency:
        ├─ First scan: protectedData.shippingNotification.firstScan.sent === true?
        └─ Delivery: protectedData.shippingNotification.delivered.sent === true?
```

### Common Root Causes:

1. **Label Not Linked to Transaction (METADATA MISMATCH)**
   - **Symptom:** `metadata.transactionId` not found in webhook payload
   - **Root Cause:** Label creation sets `metadata: JSON.stringify({ txId })` (line 524)
   - **Webhook Expects:** `metadata.transactionId` (line 301)
   - **Potential Issue:** Shippo may send metadata as JSON string, not parsed object
   - **Fix:** Check if webhook payload has `metadata` as string that needs parsing, or update label creation to use `transactionId` key instead of `txId`
   - **Code Location:** `server/api/transition-privileged.js:524` vs `server/webhooks/shippoTracking.js:267,301`

2. **Tracking Number Not Stored**
   - **Symptom:** `protectedData.outboundTrackingNumber` not set on transaction
   - **Fix:** Ensure label creation saves tracking number to transaction (see `server/api/transition-privileged.js`)

3. **Webhook Never Received**
   - **Symptom:** No log entries for this tracking number
   - **Fix:** Verify webhook URL in Shippo dashboard, check webhook delivery logs

4. **Mode Mismatch**
   - **Symptom:** Webhook received but silently ignored
   - **Fix:** Check `SHIPPO_MODE` matches webhook `event.mode`, or unset `SHIPPO_MODE`

5. **SMS Guards Active**
   - **Symptom:** Logs show `[sms][DRY_RUN]` or `ONLY_PHONE` filtering
   - **Fix:** Disable `SMS_DRY_RUN` and `ONLY_PHONE` in production

6. **Missing Borrower Phone**
   - **Symptom:** Logs show "No borrower phone number found"
   - **Fix:** Ensure phone is stored in customer profile or transaction protectedData

7. **Idempotency Flag Set**
   - **Symptom:** Logs show "SMS already sent - skipping (idempotent)"
   - **Fix:** This is expected behavior - SMS was already sent previously

---

## 6. Verification Commands

### Check Transaction Data (Using Existing Script):

```bash
node server/scripts/debugTransactionPhones.js 6912605f-7d45-4f12-a382-5e135aee0829
```

### Check Shippo Webhook Logs (Shippo Dashboard):

1. Log into Shippo Dashboard
2. Navigate to Settings → Webhooks
3. Find webhook for `https://sherbrt.com/api/webhooks/shippo`
4. Check delivery logs for tracking number `1ZB8F618YN86050063`
5. Verify:
   - Webhook was sent
   - Response status (200 = success, 403/404/500 = failure)
   - Payload included `metadata.transactionId`

### Check Server Logs (Render Dashboard):

1. Log into Render Dashboard
2. Navigate to service logs
3. Search for:
   - `6912605f-7d45-4f12-a382-5e135aee0829`
   - `1ZB8F618YN86050063`
   - `Shippo webhook received`
   - `track_updated`

---

## 7. Minimal Fix Recommendations

### For Future Shipments:

1. **Fix Metadata Mismatch:**
   ```javascript
   // CURRENT (line 524): metadata: JSON.stringify({ txId })
   // WEBHOOK EXPECTS: metadata.transactionId
   
   // OPTION A: Update label creation to use transactionId key
   metadata: JSON.stringify({ transactionId: txId })
   
   // OPTION B: Update webhook handler to parse JSON string
   const metadata = typeof data.metadata === 'string' 
     ? JSON.parse(data.metadata) 
     : (data.metadata || {});
   ```

2. **Ensure Tracking Number is Saved:**
   ```javascript
   // After label creation
   await sdk.transactions.updateMetadata({
     id: transaction.id,
     protectedData: {
       outboundTrackingNumber: label.tracking_number,
       outboundCarrier: label.carrier,
       // ... other fields
     }
   });
   ```

3. **Verify Webhook Configuration:**
   - Shippo Dashboard → Webhooks → Verify URL: `https://sherbrt.com/api/webhooks/shippo`
   - Verify event type: `track_updated`
   - Copy webhook secret to `SHIPPO_WEBHOOK_SECRET`

4. **Disable SMS Guards in Production:**
   - Ensure `SMS_DRY_RUN` is NOT set to `1`
   - Ensure `ONLY_PHONE` is NOT set (or remove after testing)

5. **Verify Environment Variables:**
   - `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` must be set
   - `TWILIO_MESSAGING_SERVICE_SID` preferred (or `TWILIO_PHONE_NUMBER`)

---

## 8. Next Steps

1. **Run Transaction Data Check:**
   - Use `debug-shipping-sms.js` script (if SDK access works)
   - Or manually fetch transaction via Flex Admin/API

2. **Check Shippo Dashboard:**
   - Verify webhook configuration
   - Check webhook delivery logs for this tracking number

3. **Check Server Logs:**
   - Search Render logs for transaction ID and tracking number
   - Look for webhook receipt and processing logs

4. **Verify Environment Variables:**
   - Check Render environment settings
   - Document current values (without secrets)

5. **Based on Findings:**
   - If webhook never received → Fix webhook URL/configuration
   - If transaction not found → Fix label metadata/tracking storage
   - If phone missing → Fix phone storage
   - If guards active → Disable in production
   - If already sent → Check idempotency flags

---

**End of Forensic Analysis Report**


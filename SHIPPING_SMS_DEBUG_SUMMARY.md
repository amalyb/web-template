# Shipping SMS Debug Summary
**Transaction:** `6912605f-7d45-4f12-a382-5e135aee0829`  
**Tracking:** `1ZB8F618YN86050063`

## Quick Answer

Based on code review, here's what to check:

### 1. Check if Webhook Was Received

**In Render Logs, search for:**
- `6912605f-7d45-4f12-a382-5e135aee0829`
- `1ZB8F618YN86050063`
- `Shippo webhook received`

**If NO matches:** Webhook never reached server → Check Shippo dashboard webhook configuration

**If YES matches:** Continue to step 2

### 2. Check Transaction Lookup

**Look for these log patterns:**
```
🔍 Looking up transaction by metadata.transactionId: 6912605f-7d45-4f12-a382-5e135aee0829
✅ Found transaction by metadata.transactionId
```
OR
```
🔍 Falling back to search by tracking number: 1ZB8F618YN86050063
✅ Found transaction 6912605f-7d45-4f12-a382-5e135aee0829
```

**If you see:** `❌ Could not find transaction` → Transaction lookup failed

**Likely cause:** Metadata mismatch (see Critical Finding below)

### 3. Check Borrower Phone

**Look for:**
```
📱 Borrower phone: +1234567890
```
OR
```
⚠️ No borrower phone number found - cannot send SMS
```

**If phone missing:** SMS cannot be sent (returns 400)

### 4. Check SMS Guards

**Look for:**
```
[sms][DRY_RUN] would send
```
OR
```
[sms] ONLY_PHONE set, skipping
```
OR
```
⚠️ Twilio env vars missing — skipping SMS
```

**If any found:** SMS was suppressed by guard

### 5. Check Status Evaluation

**Look for:**
```
✅ Status is TRANSIT - processing first scan webhook
```
OR
```
✅ Status is DELIVERED - processing delivery webhook
```
OR
```
ℹ️ Status 'PRE_TRANSIT' is not DELIVERED or first-scan status - ignoring webhook
```

**If status ignored:** Webhook received but status didn't match trigger conditions

---

## Critical Finding: Metadata Mismatch

**Label Creation (`server/api/transition-privileged.js:524`):**
```javascript
metadata: JSON.stringify({ txId })  // ← Uses "txId" key
```

**Webhook Handler (`server/webhooks/shippoTracking.js:301`):**
```javascript
if (metadata.transactionId) {  // ← Expects "transactionId" key
```

**Impact:** Primary transaction lookup method will fail if Shippo sends metadata as JSON string with `txId` key instead of `transactionId`.

**Fallback:** Code falls back to searching last 100 transactions by tracking number, but this may fail if:
- Transaction is older than last 100
- Tracking number not stored on transaction

---

## Most Likely Root Causes (in order)

1. **Metadata mismatch** → Primary lookup fails, fallback may fail if tx not in last 100
2. **Webhook never received** → Check Shippo dashboard webhook URL/configuration
3. **SMS guards active** → `SMS_DRY_RUN=1` or `ONLY_PHONE` set in production
4. **Status not matching** → Webhook received but status was `PRE_TRANSIT` or other non-trigger status
5. **Borrower phone missing** → Phone not stored in transaction/customer profile

---

## Immediate Actions

1. **Check Render logs** for transaction ID and tracking number
2. **Check Shippo dashboard** → Webhooks → Delivery logs for this tracking number
3. **Verify webhook URL** in Shippo: `https://sherbrt.com/api/webhooks/shippo`
4. **Check environment variables** in Render:
   - `SMS_DRY_RUN` should NOT be `1`
   - `ONLY_PHONE` should NOT be set
   - `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` must be set

---

## Fix for Future Shipments

**Update label creation to use `transactionId` key:**

```javascript
// server/api/transition-privileged.js:524
metadata: JSON.stringify({ transactionId: txId })  // ← Changed from txId
```

**OR update webhook handler to parse JSON and handle both keys:**

```javascript
// server/webhooks/shippoTracking.js:267
let metadata = data.metadata || {};
if (typeof metadata === 'string') {
  metadata = JSON.parse(metadata);
}
// Support both txId and transactionId keys
const transactionId = metadata.transactionId || metadata.txId;
```

---

## Full Analysis

See `SHIPPING_SMS_FORENSIC_ANALYSIS.md` for complete forensic analysis with all code references and detailed investigation steps.


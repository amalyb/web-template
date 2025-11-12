# Shipping/Tracking SMS Audit Report
**Date:** 2025-01-27  
**Branch:** main  
**Purpose:** Audit all code paths that send Twilio SMS based on shipping/tracking events

---

## Executive Summary

✅ **Both SMS triggers are implemented on main branch and wired into production Express server**

⚠️ **MESSAGE MISMATCH:** The actual SMS messages differ from the expected messages specified in the audit request.

---

## 1. Code Path Analysis

### A. First Scan / In-Transit SMS ("Item is on its way")

**File:** `server/webhooks/shippoTracking.js`  
**Function:** `handleTrackingWebhook()` (lines 228-578)  
**Route:** `POST /api/webhooks/shippo` (line 581)

#### Status Values It Listens For:
- `TRANSIT` (line 285)
- `IN_TRANSIT` (line 285)
- `ACCEPTED` (line 285)
- `ACCEPTANCE` (line 285)

**Status Detection Logic:**
```javascript
const firstScanStatuses = ['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE'];
const isFirstScan = firstScanStatuses.includes(upperStatus);
```

#### Transaction & Phone Lookup:

**Transaction Lookup (lines 296-329):**
1. **Primary:** Uses `metadata.transactionId` from Shippo webhook payload
2. **Fallback:** Searches last 100 transactions by `outboundTrackingNumber` or `returnTrackingNumber`

**Borrower Phone Lookup (lines 158-191):**
1. `transaction.relationships.customer.data.attributes.profile.protectedData.phone`
2. `transaction.attributes.protectedData.customerPhone`
3. `transaction.attributes.metadata.customerPhone`

Phone numbers are normalized to E.164 format via `normalizePhoneNumber()` (lines 92-120).

#### Actual SMS Message (line 492):
```
Sherbrt 🍧: 🚚 "[Item Title]" is on its way! Track: [short tracking link]
```

**Expected Message:**
```
🚚 [Item] is on its way! Track here: [tracking link].
```

**Status:** ⚠️ **MESSAGE MISMATCH** - Different format and branding

#### Environment Variables / Feature Flags:

**Can Disable SMS:**
- `SMS_DRY_RUN=1` - Logs SMS without sending (line 67 in `sendSMS.js`)
- `ONLY_PHONE=+1234567890` - Only sends to specific phone number (line 68 in `sendSMS.js`)
- Missing `TWILIO_ACCOUNT_SID` or `TWILIO_AUTH_TOKEN` - Skips SMS (lines 110-113 in `sendSMS.js`)
- Missing `TWILIO_MESSAGING_SERVICE_SID` - Falls back to `TWILIO_PHONE_NUMBER` (lines 185-192 in `sendSMS.js`)

**Webhook Filtering:**
- `SHIPPO_MODE=test|live` - Filters webhook events by mode (lines 275-281)
- `SHIPPO_WEBHOOK_SECRET` - Required for signature verification (lines 238-244)

#### Express Server Wiring:

✅ **PROPERLY WIRED:**
- `server/webhooks/shippoTracking.js` exports Express router (line 716)
- `server/apiRouter.js` imports and mounts at `/webhooks` (line 18, 65)
- `server/index.js` mounts apiRouter at `/api` (line 340)
- **Final URL:** `POST https://sherbrt.com/api/webhooks/shippo`

**Verification:**
```javascript
// server/apiRouter.js:18
const shippoWebhook = require('./webhooks/shippoTracking');

// server/apiRouter.js:65
router.use('/webhooks', shippoWebhook);

// server/index.js:340
app.use('/api', apiRouter);
```

---

### B. Delivery SMS ("Item has arrived")

**File:** `server/webhooks/shippoTracking.js`  
**Function:** `handleTrackingWebhook()` (lines 228-578)  
**Route:** `POST /api/webhooks/shippo` (line 581)

#### Status Values It Listens For:
- `DELIVERED` (line 286)

**Status Detection Logic:**
```javascript
const isDelivery = upperStatus === 'DELIVERED';
```

#### Transaction & Phone Lookup:
Same as First Scan SMS (see section A above).

#### Actual SMS Message (line 456):
```
Your Sherbrt borrow was delivered! Don't forget to take pics and tag @shoponsherbrt while you're slaying in your borrowed fit! 📸✨
```

**Expected Message:**
```
✨ Your item has arrived! Sip, slay, and tag @sherbrt 💕 Enjoy until [Return Date].
```

**Status:** ⚠️ **MESSAGE MISMATCH** - Completely different message, missing return date

#### Environment Variables / Feature Flags:
Same as First Scan SMS (see section A above).

#### Express Server Wiring:
Same as First Scan SMS (see section A above).

---

## 2. Idempotency & Duplicate Prevention

### First Scan SMS:
- **ProtectedData Flag:** `protectedData.shippingNotification.firstScan.sent` (line 428)
- **In-Memory Cache:** `firstScanCache` Map with 24h TTL (lines 15-26, 429-440)
- **Cache Key:** `firstscan:${trackingNumber}`

### Delivery SMS:
- **ProtectedData Flag:** `protectedData.shippingNotification.delivered.sent` (line 421)

**Idempotency Check (lines 420-441):**
```javascript
if (isDelivery && protectedData.shippingNotification?.delivered?.sent === true) {
  console.log('ℹ️ Delivery SMS already sent - skipping (idempotent)');
  return res.status(200).json({ message: 'Delivery SMS already sent - idempotent' });
}
```

---

## 3. Other Code Paths Checked

### ❌ No UPS-Specific Webhook Handler Found
- No separate UPS webhook endpoint found
- Shippo webhook handles all carriers (UPS, USPS, FedEx)

### ❌ No Tracking Polling Found
- No scheduled jobs or cron tasks that poll carrier APIs for status updates
- All tracking updates come via Shippo webhooks

### ✅ Transition-Privileged Handler
- `server/api/transition-privileged.js` handles label creation but **does not send tracking SMS**
- Tracking SMS is **only** sent via Shippo webhook (`server/webhooks/shippoTracking.js`)

---

## 4. Message Comparison

| Aspect | Expected | Actual | Status |
|--------|----------|--------|--------|
| **First Scan Emoji** | 🚚 | 🚚 | ✅ Match |
| **First Scan Branding** | None | "Sherbrt 🍧:" | ⚠️ Different |
| **First Scan Text** | "[Item] is on its way!" | '"[Item Title]" is on its way!' | ⚠️ Different |
| **First Scan Link** | "Track here:" | "Track:" | ⚠️ Different |
| **Delivery Emoji** | ✨ | 📸✨ | ⚠️ Different |
| **Delivery Branding** | None | "Your Sherbrt borrow" | ⚠️ Different |
| **Delivery Text** | "Your item has arrived!" | "was delivered!" | ⚠️ Different |
| **Delivery Tag** | "@sherbrt" | "@shoponsherbrt" | ⚠️ Different |
| **Return Date** | "Enjoy until [Return Date]" | Missing | ❌ Missing |

---

## 5. Recommendations

### Immediate Actions Required:

1. **Update First Scan SMS Message** (line 492 in `server/webhooks/shippoTracking.js`):
   ```javascript
   // Current:
   message = `Sherbrt 🍧: 🚚 "${listingTitle}" is on its way! Track: ${shortTrackingUrl}`;
   
   // Should be:
   message = `🚚 ${listingTitle} is on its way! Track here: ${shortTrackingUrl}`;
   ```

2. **Update Delivery SMS Message** (line 456 in `server/webhooks/shippoTracking.js`):
   ```javascript
   // Current:
   message = "Your Sherbrt borrow was delivered! Don't forget to take pics and tag @shoponsherbrt while you're slaying in your borrowed fit! 📸✨";
   
   // Should be:
   const returnDate = transaction.attributes.booking?.end || 
                     protectedData.return?.dueAt ||
                     transaction.attributes.deliveryEnd;
   const formattedReturnDate = returnDate ? formatDate(returnDate) : 'your return date';
   message = `✨ Your item has arrived! Sip, slay, and tag @sherbrt 💕 Enjoy until ${formattedReturnDate}.`;
   ```

3. **Add Return Date Formatting Helper:**
   - Extract return date from transaction
   - Format as readable date (e.g., "January 15" or "Jan 15")
   - Handle missing return date gracefully

### Verification Checklist:

- [ ] Verify Shippo webhook URL in dashboard points to `https://sherbrt.com/api/webhooks/shippo`
- [ ] Check Shippo webhook logs for tracking number `1Z8F...` for events: `pre_transit`, `in_transit`, `delivered`
- [ ] Check Render server logs for webhook calls and SMS send attempts
- [ ] Verify Twilio console shows outbound SMS to borrower phone
- [ ] Confirm `SMS_DRY_RUN` is **not** set to `1` in production
- [ ] Verify `TWILIO_MESSAGING_SERVICE_SID` is set in production
- [ ] Test with a real shipment to confirm messages match expected format

---

## 6. Environment Variable Checklist

### Required for SMS to Work:
```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...  # Preferred
TWILIO_PHONE_NUMBER=+1...            # Fallback if messaging service not set
SHIPPO_API_TOKEN=shippo_...
SHIPPO_WEBHOOK_SECRET=...            # For signature verification
PUBLIC_BASE_URL=https://sherbrt.com  # For status callbacks
```

### Optional (for testing/debugging):
```bash
SMS_DRY_RUN=1                        # Disables actual SMS sending
ONLY_PHONE=+15551234567             # Only send to this number
SHIPPO_MODE=live                     # Filter webhooks by mode
VERBOSE=1                            # Enhanced logging
```

---

## 7. Code Flow Diagram

```
Shippo/UPS Carrier
    ↓
Shippo Webhook (track_updated event)
    ↓
POST https://sherbrt.com/api/webhooks/shippo
    ↓
server/webhooks/shippoTracking.js::handleTrackingWebhook()
    ↓
[Status Check]
    ├─→ TRANSIT/IN_TRANSIT/ACCEPTED → First Scan SMS
    └─→ DELIVERED → Delivery SMS
    ↓
[Transaction Lookup]
    ├─→ metadata.transactionId (preferred)
    └─→ Search by tracking number (fallback)
    ↓
[Phone Lookup]
    ├─→ customer.profile.protectedData.phone
    ├─→ transaction.protectedData.customerPhone
    └─→ transaction.metadata.customerPhone
    ↓
[Idempotency Check]
    ├─→ First Scan: protectedData + in-memory cache
    └─→ Delivery: protectedData flag
    ↓
server/api-util/sendSMS.js::sendSMS()
    ↓
[Guards]
    ├─→ SMS_DRY_RUN=1? → Log only
    ├─→ ONLY_PHONE set? → Filter
    └─→ Twilio credentials? → Skip
    ↓
Twilio API (client.messages.create())
    ↓
SMS Delivered to Borrower
```

---

## 8. Testing Endpoint

**Test Endpoint Available** (if `TEST_ENDPOINTS` env var is set):
- `POST /api/webhooks/__test/shippo/track`
- Bypasses signature verification
- Accepts: `{ txId, status, metadata }`
- Useful for testing without real Shippo webhooks

---

## Summary

✅ **Code exists and is properly wired**  
✅ **Status detection logic is correct**  
✅ **Transaction and phone lookup is robust**  
✅ **Idempotency is implemented**  
⚠️ **SMS messages need to be updated to match expected format**  
❌ **Return date is missing from delivery SMS**

**Next Steps:**
1. Update SMS messages to match expected format
2. Add return date extraction and formatting
3. Test with real shipment
4. Verify webhook configuration in Shippo dashboard


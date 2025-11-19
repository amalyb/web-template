# Borrower SMS Debug Analysis: "Processing at UPS Facility" Not Triggering SMS

## Executive Summary

**Root Cause:** The webhook handler only checks for statuses `['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE']`, but UPS "Processing at UPS Facility" likely comes through as `PRE_TRANSIT` status, which is **not** in the allowed list.

## 1. Code Locations

### Webhook Handler
- **File:** `server/webhooks/shippoTracking.js`
- **Function:** `handleTrackingWebhook()` (lines 228-708)
- **Route:** `POST /api/webhooks/shippo` (line 711)

### SMS Sending Function
- **File:** `server/webhooks/shippoTracking.js`
- **Function:** `handleTrackingWebhook()` → lines 601-639 (first scan SMS)
- **SMS Template:** `Sherbrt 🍧: 🚚 "${listingTitle}" is on its way! Track: ${shortTrackingUrl}`
- **Tag:** `SMS_TAGS.ITEM_SHIPPED_TO_BORROWER` (line 649)

### Status Mapping
- **File:** `server/lib/statusMap.js`
- **SHIPPED_STATUSES:** `['ACCEPTED', 'ACCEPTANCE', 'IN_TRANSIT', 'TRANSIT', 'PICKUP']` (lines 11-17)

## 2. Current Triggering Conditions

### Checklist for Borrower Shipping SMS:

1. ✅ **Shippo webhook received** - Handler receives POST to `/api/webhooks/shippo`
2. ✅ **Signature verified** (if `SHIPPO_WEBHOOK_SECRET` is set)
3. ✅ **Mode check passed** - `event.mode` matches `SHIPPO_MODE` env var
4. ❌ **Status check** - Status must be in `['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE']` OR `'DELIVERED'`
5. ✅ **Direction check** - `metadata.direction !== 'return'` (or tracking number doesn't match return tracking)
6. ✅ **Transaction found** - Via `metadata.transactionId` OR tracking number search
7. ✅ **Borrower phone present** - Extracted via `getBorrowerPhone()`
8. ✅ **Idempotency check** - `protectedData.shippingNotification.firstScan.sent !== true`
9. ✅ **SMS feature flags** - `SMS_DRY_RUN` and `ONLY_PHONE` env vars checked in `sendSMS()`

### Problem: Status Check Too Narrow

**Line 304:** `const firstScanStatuses = ['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE'];`

UPS "Processing at UPS Facility" likely sends status `PRE_TRANSIT` or `UNKNOWN`, which are **NOT** in this list.

## 3. Shippo Status Mapping

### Current Status Values Treated as "Shipped"

The code checks for these exact strings:
- `TRANSIT` - Generic transit status
- `IN_TRANSIT` - UPS/FedEx in-transit status
- `ACCEPTED` - USPS accepted status
- `ACCEPTANCE` - Alternative spelling

### Missing Status: `PRE_TRANSIT`

UPS "Processing at UPS Facility" typically corresponds to:
- **Status:** `PRE_TRANSIT`
- **Status Details:** "Processing at UPS Facility" or "Origin Scan"

The code currently **ignores** `PRE_TRANSIT` status (line 308-311), so webhooks with this status are silently rejected.

## 4. Outbound vs Return Filtering

**Lines 360-362:** Direction detection logic:
```javascript
const isReturnTracking = (metadata.direction === 'return') ||
                        (trackingNumber === protectedData.returnTrackingNumber) ||
                        (trackingNumber === returnData.label?.trackingNumber);
```

**Status:** ✅ **Working correctly** - Outbound shipments are properly identified when `metadata.direction !== 'return'`.

## 5. ID + Tracking Wiring

**Lines 319-343:** Transaction lookup:
1. **Primary:** `metadata.transactionId` or `metadata.txId` (line 281)
2. **Fallback:** Search by tracking number (line 334-342)

**Status:** ✅ **Working correctly** - Both methods are implemented.

**Missing:** `substatus` is referenced (lines 592, 631) but **never extracted** from the webhook payload.

## 6. Root Cause Analysis

### The Problem

1. **Status Extraction (line 266):** Only extracts `data.tracking_status?.status`
2. **Status Check (line 304):** Only checks for `['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE']`
3. **Missing:** `PRE_TRANSIT` is not included, even though it represents a facility scan
4. **Missing:** `status_details`/`substatus` is not extracted or checked

### Why "Processing at UPS Facility" Doesn't Trigger SMS

When UPS scans a package at a facility, Shippo sends:
```json
{
  "tracking_status": {
    "status": "PRE_TRANSIT",
    "status_details": "Processing at UPS Facility"
  }
}
```

The webhook handler checks line 304:
```javascript
const firstScanStatuses = ['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE'];
const isFirstScan = firstScanStatuses.includes(upperStatus); // false for PRE_TRANSIT
```

Since `PRE_TRANSIT` is not in the list, `isFirstScan` is `false`, and the webhook is ignored (line 308-311).

## 7. Proposed Fix

### Option 1: Add PRE_TRANSIT to Status List (Simple)
- Add `PRE_TRANSIT` to `firstScanStatuses` array
- **Pros:** Simple, covers UPS facility scans
- **Cons:** May trigger SMS before package is actually picked up (if label created but not scanned)

### Option 2: Check Status Details for Facility Scans (Robust)
- Extract `status_details` from webhook payload
- Check if `status_details` contains facility scan indicators ("Processing at", "Origin Scan", "Facility")
- Only trigger SMS if `PRE_TRANSIT` has a facility scan OR status is in existing list
- **Pros:** More accurate, only triggers on actual scans
- **Cons:** More complex, requires parsing status_details

### Recommended: Option 2 (Robust)

Update the code to:
1. Extract `status_details` from `data.tracking_status?.status_details`
2. Add `PRE_TRANSIT` to status list **only if** status_details indicates a facility scan
3. Update `statusMap.js` to include `PRE_TRANSIT` in `SHIPPED_STATUSES` (with facility scan check)

## 8. Implementation Plan

1. ✅ Extract `status_details` from webhook payload
2. ✅ Add facility scan detection logic
3. ✅ Update `firstScanStatuses` to include `PRE_TRANSIT` when facility scan detected
4. ✅ Update `statusMap.js` to include `PRE_TRANSIT` in `SHIPPED_STATUSES`
5. ✅ Extract `substatus` for logging (currently referenced but not extracted)
6. ✅ Test with test endpoint using `PRE_TRANSIT` status

## 9. Testing Checklist

After implementing the fix:

- [ ] Created outbound label with `metadata.direction: "outbound"`
- [ ] Shippo webhook fired with UPS status "Processing at UPS Facility" (`PRE_TRANSIT`)
- [ ] Webhook handler logged receipt and mapped to correct transaction
- [ ] Status check passed (PRE_TRANSIT with facility scan detected)
- [ ] Borrower shipping SMS sent via Twilio
- [ ] SMS content matches template: `Sherbrt 🍧: 🚚 "[Item]" is on its way! Track: [link]`
- [ ] Idempotency check prevents duplicate SMS


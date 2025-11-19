# Borrower SMS Fix: UPS "Processing at UPS Facility" Status

## Root Cause

The webhook handler was only checking for statuses `['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE']`, but UPS "Processing at UPS Facility" sends status `PRE_TRANSIT` with `status_details: "Processing at UPS Facility"`, which was **not** in the allowed list.

## Solution Implemented

### 1. Extract `status_details` from Webhook Payload

**File:** `server/webhooks/shippoTracking.js` (line 267-268)

```javascript
const statusDetails = data.tracking_status?.status_details || data.tracking_status?.substatus || '';
const substatus = statusDetails; // For backward compatibility with existing code
```

### 2. Add Facility Scan Detection Logic

**File:** `server/webhooks/shippoTracking.js` (lines 309-325)

```javascript
// Facility scan indicators in status_details (UPS "Processing at UPS Facility", "Origin Scan", etc.)
const facilityScanIndicators = [
  'PROCESSING AT',
  'ORIGIN SCAN',
  'FACILITY',
  'PICKED UP',
  'ACCEPTED AT',
  'RECEIVED AT'
];
const hasFacilityScan = facilityScanIndicators.some(indicator => 
  upperStatusDetails.includes(indicator)
);

// Base first-scan statuses
const firstScanStatuses = ['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE'];
// PRE_TRANSIT counts as first scan if it has a facility scan indicator
const isPreTransitWithScan = upperStatus === 'PRE_TRANSIT' && hasFacilityScan;

const isFirstScan = firstScanStatuses.includes(upperStatus) || isPreTransitWithScan;
```

### 3. Update Status Map

**File:** `server/lib/statusMap.js` (line 17)

Added `PRE_TRANSIT` to `SHIPPED_STATUSES`:
```javascript
const SHIPPED_STATUSES = new Set([
  'ACCEPTED',
  'ACCEPTANCE',
  'IN_TRANSIT',
  'TRANSIT',
  'PICKUP',
  'PRE_TRANSIT',   // UPS: Processing at facility (when status_details indicates facility scan)
]);
```

### 4. Enhanced Logging

**File:** `server/webhooks/shippoTracking.js` (lines 290-294, 331-334)

- Added logging for `status_details`
- Added specific log message when `PRE_TRANSIT` is detected without facility scan indicator

### 5. Updated Test Endpoint

**File:** `server/webhooks/shippoTracking.js` (lines 748, 786-793)

- Test endpoint now accepts `status_details` parameter
- Test endpoint includes same facility scan detection logic

## Files Changed

1. **server/webhooks/shippoTracking.js**
   - Extract `status_details` from webhook payload
   - Add facility scan detection for `PRE_TRANSIT` status
   - Update status check logic to include `PRE_TRANSIT` with facility scans
   - Enhanced logging
   - Updated test endpoint

2. **server/lib/statusMap.js**
   - Added `PRE_TRANSIT` to `SHIPPED_STATUSES`

## How It Works Now

### Before Fix
- Webhook with `status: "PRE_TRANSIT"` → **Ignored** (not in status list)
- SMS **not sent** to borrower

### After Fix
- Webhook with `status: "PRE_TRANSIT"` + `status_details: "Processing at UPS Facility"` → **Detected as facility scan**
- `PRE_TRANSIT` with facility scan → Treated as `isFirstScan = true`
- SMS **sent** to borrower

## Testing

### Test with Test Endpoint

```bash
# Test PRE_TRANSIT with facility scan (should trigger SMS)
curl -X POST http://localhost:3500/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{
    "txId": "your-tx-id",
    "status": "PRE_TRANSIT",
    "status_details": "Processing at UPS Facility",
    "metadata": { "direction": "outbound" }
  }'

# Test PRE_TRANSIT without facility scan (should NOT trigger SMS)
curl -X POST http://localhost:3500/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{
    "txId": "your-tx-id",
    "status": "PRE_TRANSIT",
    "status_details": "Label Created",
    "metadata": { "direction": "outbound" }
  }'
```

## Verification Checklist

After deploying this fix, verify:

- [ ] Created outbound label with `metadata.direction: "outbound"`
- [ ] Shippo webhook fired with UPS status "Processing at UPS Facility" (`PRE_TRANSIT` with `status_details`)
- [ ] Webhook handler logged receipt: `📋 Status Details: Processing at UPS Facility`
- [ ] Status check passed: `✅ Status is PRE_TRANSIT - processing first scan webhook`
- [ ] Facility scan detected: `hasFacilityScan = true`
- [ ] Borrower shipping SMS sent via Twilio
- [ ] SMS content matches template: `Sherbrt 🍧: 🚚 "[Item]" is on its way! Track: [link]`
- [ ] Idempotency check prevents duplicate SMS

## Status Values That Trigger SMS

### First Scan / Shipped Statuses:
- `TRANSIT` - Generic transit status
- `IN_TRANSIT` - UPS/FedEx in-transit status
- `ACCEPTED` - USPS accepted status
- `ACCEPTANCE` - Alternative spelling
- `PRE_TRANSIT` - **NEW:** Only if `status_details` contains facility scan indicator

### Delivery Status:
- `DELIVERED` - Package delivered

## Facility Scan Indicators

The following keywords in `status_details` indicate a facility scan:
- "Processing at"
- "Origin Scan"
- "Facility"
- "Picked Up"
- "Accepted at"
- "Received at"

## Backward Compatibility

✅ **Fully backward compatible:**
- Existing statuses (`TRANSIT`, `IN_TRANSIT`, `ACCEPTED`, `ACCEPTANCE`) continue to work
- `PRE_TRANSIT` without facility scan indicator is still ignored (prevents false positives)
- Return shipments are still correctly filtered out
- Idempotency checks remain in place

## Summary

The fix ensures that UPS "Processing at UPS Facility" status (which comes as `PRE_TRANSIT` with facility scan details) now properly triggers the borrower shipping SMS, while maintaining backward compatibility and preventing false positives from label creation events.


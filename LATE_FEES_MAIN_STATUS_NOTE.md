# Late Fees Main Branch Implementation Summary

**Date:** December 2025  
**Branch:** `main`  
**Status:** ✅ **COMPLETE**

---

## Overview

Updated main branch to adopt the "stop fees once scanned" policy (matching test branch) and implemented all cleanup items from `LATE_FEE_OVERDUE_SMS_STATUS_REPORT.md`.

---

## Changes Implemented

### 1. ✅ "Stop Fees Once Scanned" Policy (Main → Test Alignment)

**File:** `server/lib/lateFees.js`

- **Changed:** Replaced `hasCarrierScan()` and `isDelivered()` logic with `isScanned()` function
- **Policy:** Late fees now stop once package is scanned (accepted/in_transit), matching test branch behavior
- **Impact:** Softer policy - fees stop when carrier accepts package, not when delivered

**Key Changes:**
- Introduced `isScanned()` helper function (matches test branch)
- Updated `applyCharges()` to return early if `isScanned()` is true
- Late fees only accrue for days when item is late and not yet scanned
- Replacement only happens if there is no scan by Day 5 late

---

### 2. ✅ Cleanup Item #3: Day-of-Return SMS Tracking Check

**File:** `server/scripts/sendReturnReminders.js`

- **Added:** Tracking status check before sending day-of-return SMS
- **Logic:** Skips SMS if package already scanned (`firstScanAt`, `status === 'accepted'`, or `status === 'in_transit'`)
- **Impact:** Prevents sending unnecessary reminders when borrower has already shipped

**Code Location:** Lines 172-193

---

### 3. ✅ Cleanup Item #5: Dynamic Replacement Amount in Day-5 SMS

**File:** `server/scripts/sendOverdueReminders.js`

- **Changed:** Day-5 SMS now uses actual replacement value from listing instead of hardcoded $50
- **Implementation:** Uses `getReplacementValue(listing)` function from `lateFees.js`
- **Fallback:** Defaults to $50 if replacement value cannot be determined
- **Impact:** SMS message now shows accurate replacement amount that matches actual charge

**Code Location:** Lines 270-281

---

### 4. ✅ Cleanup Item #6: T-1 Reminder Real Label Usage

**File:** `server/scripts/sendReturnReminders.js`

- **Changed:** T-1 reminder now checks for real Shippo label URLs (`returnQrUrl`, `returnLabelUrl`)
- **Removed:** Placeholder URL creation logic
- **Behavior:** Skips T-1 reminder if no real label exists (label should have been created during accept transition)
- **Logging:** Added logging to indicate label source (QR vs label URL)

**Code Location:** Lines 140-168

**Note:** Creating a new Shippo label in T-1 reminder would require addresses, parcel info, etc. Since labels are created during accept transition, this implementation ensures we use the real label or skip the reminder if it doesn't exist.

---

### 5. ✅ Cleanup Item #7: Feature Flag Support

**Files:** `server/lib/lateFees.js`, `server/scripts/sendOverdueReminders.js`

- **Added:** `LATE_FEES_ENABLED` environment variable support
- **Default:** Enabled (only disabled if explicitly set to `'false'` or `'0'`)
- **Behavior:** Short-circuits late fee evaluation if disabled
- **Logging:** Logs when feature is disabled

**Code Locations:**
- `lateFees.js`: Lines 21-22, 168-172
- `sendOverdueReminders.js`: Lines 23-24, 79-82

---

### 6. ✅ Cleanup Item #8: Enhanced Logging

**Files:** `server/lib/lateFees.js`, `server/scripts/sendOverdueReminders.js`

**lateFees.js:**
- Consistent `[late-fees]` prefix for all log messages
- Logs when late fee is calculated and applied (with amount)
- Logs when replacement is triggered (with amount & listing id)
- Enhanced success message showing all charges applied

**sendOverdueReminders.js:**
- Consistent `[overdue-reminders]` prefix for all log messages
- Added transaction evaluation counter
- Enhanced charge logging with `daysLate` and item details
- Summary includes transactions evaluated count

**Code Locations:**
- `lateFees.js`: All console.log statements updated with `[late-fees]` prefix
- `sendOverdueReminders.js`: All console.log statements updated with `[overdue-reminders]` prefix, lines 419-431

---

## Testing Checklist

### Scenario 1: Item Late Then Scanned (Fees Stop)
1. Create transaction with return date in past
2. Verify late fees accrue for days before scan
3. Simulate carrier scan (`firstScanAt` or `status: 'accepted'`)
4. Run `sendOverdueReminders.js`
5. **Expected:** No new late fees added after scan

### Scenario 2: Item Never Scanned (Fees Continue + Replacement)
1. Create transaction with return date 5+ days in past
2. Ensure no carrier scan (`firstScanAt` is null, `status` is not 'accepted'/'in_transit')
3. Run `sendOverdueReminders.js` daily
4. **Expected:** 
   - Late fees accrue each day until Day 5
   - Replacement charge applied on Day 5
   - SMS sent with dynamic replacement amount

### Scenario 3: T-1 + Day-of SMS Label Links
1. Create transaction with return date tomorrow (T-1)
2. Ensure return label exists (`returnQrUrl` or `returnLabelUrl` in protectedData)
3. Run `sendReturnReminders.js` on T-1 day
4. **Expected:** T-1 SMS sent with real label short link
5. On return date, run again
6. **Expected:** Day-of SMS sent with real label short link (if not scanned)

### Scenario 4: Day-of SMS Tracking Check
1. Create transaction with return date today
2. Set `firstScanAt` or `status: 'accepted'` in returnData
3. Run `sendReturnReminders.js`
4. **Expected:** Day-of SMS skipped (package already scanned)

### Scenario 5: Verify Logs in Render
1. Check Render logs for `[late-fees]` prefix messages
2. Check Render logs for `[overdue-reminders]` prefix messages
3. Check Render logs for `[return-reminders]` prefix messages
4. **Expected:** All logs are grep-able and include transaction IDs, amounts, and status

---

## Files Modified

1. `server/lib/lateFees.js`
   - Policy change: Stop fees once scanned
   - Feature flag support
   - Enhanced logging
   - Export `getReplacementValue` function

2. `server/scripts/sendOverdueReminders.js`
   - Dynamic replacement amount in Day-5 SMS
   - Feature flag support
   - Enhanced logging with metrics

3. `server/scripts/sendReturnReminders.js`
   - Day-of-return tracking check
   - T-1 reminder real label usage
   - Improved logging

---

## Environment Variables

### New Variable
- `LATE_FEES_ENABLED` (optional)
  - Default: `true` (enabled)
  - Set to `'false'` or `'0'` to disable late fee charging
  - Affects both `lateFees.js` and `sendOverdueReminders.js`

---

## Next Steps

1. ✅ All cleanup items implemented
2. ⏳ Test in test environment using scenarios above
3. ⏳ Verify logs in Render for new prefixes
4. ⏳ Monitor for any issues with "stop fees once scanned" policy
5. ⏳ Consider aligning test branch with main if needed (future work)

---

## Notes

- **Policy Change:** Main branch now matches test branch's softer "stop fees once scanned" policy
- **Backward Compatibility:** All existing idempotency flags and metadata keys remain unchanged
- **No Breaking Changes:** Changes are additive/behavioral improvements only

---

**Implementation Complete:** December 2025  
**All cleanup items from status report addressed**


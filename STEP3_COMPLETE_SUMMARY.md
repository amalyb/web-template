# Step 3 Complete: applyCharges Integrated into sendOverdueReminders.js ✅

**Branch:** `feat/overdue-fees-stripe`  
**Date:** November 5, 2025  
**Status:** ✅ **COMPLETE** — No linter errors

---

## 🎯 What Was Accomplished

### ✅ Integrated Late Fee & Replacement Charging

**File:** `server/scripts/sendOverdueReminders.js`  
**Lines Changed:** +82 / -44 (net +38 lines)  
**Key Integration:** `applyCharges()` now executes after each SMS send

---

## 📋 Changes Made

### 1. Added Import (Line 5)
```javascript
const { applyCharges } = require('../lib/lateFees');
```

**Purpose:** Import the charge application function from Step 2

---

### 2. Normalized Environment Flags (Lines 44-66)

**Before:**
```javascript
const DRY = has('--dry-run') || process.env.SMS_DRY_RUN === '1';
```

**After:**
```javascript
// Normalize environment flags for both SMS and charges
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.SMS_DRY_RUN === '1' || has('--dry-run');
const FORCE_NOW = process.env.FORCE_NOW ? new Date(process.env.FORCE_NOW) : null;

if (FORCE_NOW) {
  console.log(`⏰ FORCE_NOW active: ${FORCE_NOW.toISOString()}`);
}

if (DRY_RUN) {
  console.log('🔍 DRY_RUN mode: SMS and charges will be simulated only');
  // ... SMS override ...
}
```

**Benefits:**
- ✅ Single `DRY_RUN` flag for both SMS and charges
- ✅ `FORCE_NOW` properly parsed and logged
- ✅ Clear indication when test mode is active

---

### 3. Added Charge Counters (Line 128)
```javascript
let sent = 0, failed = 0, processed = 0;
let charged = 0, chargesFailed = 0;  // NEW
```

**Purpose:** Track charge successes and failures separately from SMS

---

### 4. Simplified SMS Update Logic (Lines 236-260)

**Before:** Updated fees, overdue tracking, and replacement evaluation
**After:** Updates only SMS notification tracking

```javascript
// Update transaction with SMS notification tracking only
// (Charges are now handled by applyCharges() below)
const updatedReturnData = {
  ...returnData,
  overdue: {
    ...overdue,
    daysLate: daysLate,
    lastNotifiedDay: daysLate
  }
};
```

**Why:** Separation of concerns — SMS tracking separate from charge logic

---

### 5. Added Charge Application Logic (Lines 268-326)

**New Section After SMS Send:**
```javascript
// Apply charges (separate try/catch so charge failures don't block SMS)
try {
  if (DRY_RUN) {
    console.log(`💳 [DRY_RUN] Would evaluate charges for tx ${tx?.id?.uuid || '(no id)'}`);
  } else {
    const chargeResult = await applyCharges({
      sdkInstance: sdk,
      txId: tx.id.uuid || tx.id,
      now: FORCE_NOW || new Date()
    });
    
    if (chargeResult.charged) {
      console.log(`💳 Charged ${chargeResult.items.join(' + ')} for tx ${tx?.id?.uuid || '(no id)'}`);
      if (chargeResult.amounts) {
        chargeResult.amounts.forEach(a => {
          console.log(`   💰 ${a.code}: $${(a.cents / 100).toFixed(2)}`);
        });
      }
      charged++;
    } else {
      console.log(`ℹ️ No charge for tx ${tx?.id?.uuid || '(no id)'} (${chargeResult.reason || 'n/a'})`);
    }
  }
} catch (chargeError) {
  console.error(`❌ Charge failed for tx ${tx?.id?.uuid || '(no id)'}: ${chargeError.message}`);
  
  // Check for permission errors and provide helpful guidance
  if (chargeError.status === 403 || chargeError.status === 401 ||
      chargeError.message?.includes('403') || chargeError.message?.includes('401') ||
      chargeError.message?.includes('permission') || chargeError.message?.includes('forbidden')) {
    console.error('');
    console.error('⚠️  PERMISSION ERROR DETECTED:');
    console.error('   The transition/privileged-apply-late-fees requires proper permissions.');
    console.error('   Possible fixes:');
    console.error('   1. In process.edn, change :actor.role/operator to :actor.role/admin');
    console.error('   2. Ensure your Integration app has operator-level privileges in Flex Console');
    console.error('   3. Verify REACT_APP_SHARETRIBE_SDK_CLIENT_ID and SHARETRIBE_SDK_CLIENT_SECRET');
    console.error('');
  }
  
  chargesFailed++;
}
```

**Key Features:**
- ✅ Separate try/catch (charge failures don't block SMS)
- ✅ DRY_RUN mode supported
- ✅ FORCE_NOW passed for time-travel testing
- ✅ Detailed logging of charged items and amounts
- ✅ 403/401 permission error detection with helpful hints
- ✅ Counter increment for success/failure

---

### 6. Enhanced Summary Logging (Lines 334-348)

**Before:**
```javascript
console.log(`📊 Processed: ${processed}, Sent: ${sent}, Failed: ${failed}`);
```

**After:**
```javascript
// Final summary
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('📊 OVERDUE REMINDERS RUN SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log(`   Candidates processed: ${processed}`);
console.log(`   SMS sent:             ${sent}`);
console.log(`   SMS failed:           ${failed}`);
console.log(`   Charges applied:      ${charged}`);
console.log(`   Charges failed:       ${chargesFailed}`);
console.log('═══════════════════════════════════════════════════════════');
if (DRY_RUN) {
  console.log('   Mode: DRY_RUN (no actual SMS or charges)');
}
console.log('');
```

**Benefits:**
- ✅ Clear visual separation
- ✅ Comprehensive statistics (SMS + charges)
- ✅ DRY_RUN mode indication
- ✅ Professional formatting

---

### 7. Deprecated Old Stub Function (Lines 84-96)

**Before:** Stub with TODO comments
**After:** Deprecated with warning

```javascript
/**
 * @deprecated This function is now handled by applyCharges() from lib/lateFees.js
 * Kept for backward compatibility only. Do not use in new code.
 */
async function evaluateReplacementCharge(tx) {
  console.warn('⚠️ evaluateReplacementCharge is deprecated. Use applyCharges() from lib/lateFees.js instead.');
  return {
    replacementAmount: 5000,
    evaluated: true,
    timestamp: new Date().toISOString(),
    deprecated: true
  };
}
```

**Why:** Maintains backward compatibility while discouraging use

---

## 🔍 Key Design Decisions

### 1. Separate Try/Catch Blocks

**SMS Try/Catch:**
```javascript
try {
  await sendSMS(...);
  // Update SMS tracking
  sent++;
} catch (e) {
  console.error(`❌ SMS failed...`);
  failed++;
}
```

**Charge Try/Catch (Separate):**
```javascript
try {
  const chargeResult = await applyCharges(...);
  charged++;
} catch (chargeError) {
  console.error(`❌ Charge failed...`);
  chargesFailed++;
}
```

**Why:** Ensures SMS failures don't prevent charges, and vice versa

---

### 2. Permission Error Detection

**Detection Logic:**
```javascript
if (chargeError.status === 403 || chargeError.status === 401 ||
    chargeError.message?.includes('403') || chargeError.message?.includes('401') ||
    chargeError.message?.includes('permission') || chargeError.message?.includes('forbidden'))
```

**Checks:**
- HTTP status codes (403, 401)
- Error message text ('permission', 'forbidden')
- Multiple patterns to catch various error formats

**Helpful Output:**
```
⚠️  PERMISSION ERROR DETECTED:
   The transition/privileged-apply-late-fees requires proper permissions.
   Possible fixes:
   1. In process.edn, change :actor.role/operator to :actor.role/admin
   2. Ensure your Integration app has operator-level privileges in Flex Console
   3. Verify REACT_APP_SHARETRIBE_SDK_CLIENT_ID and SHARETRIBE_SDK_CLIENT_SECRET
```

---

### 3. DRY_RUN Mode Consistency

**SMS:** Overrides `sendSMS` function globally (existing behavior)
**Charges:** Checks `DRY_RUN` flag before calling `applyCharges`

**Log Output:**
```
💳 [DRY_RUN] Would evaluate charges for tx abc-123
```

**Result:** Both SMS and charges respect same DRY_RUN flag

---

### 4. FORCE_NOW Time-Travel

**Passed to applyCharges:**
```javascript
now: FORCE_NOW || new Date()
```

**Benefits:**
- Day 1-5 testing without waiting
- Consistent time across SMS and charges
- Logged at startup for verification

---

## 📊 Example Output

### Successful Run (Day 1 Overdue)
```
🚀 Starting overdue reminder SMS script...
✅ SDK initialized
⏰ FORCE_NOW active: 2025-11-09T17:00:00.000Z
📅 Processing overdue reminders for: 2025-11-09
📊 Found 15 delivered transactions

[SMS] shortlink { type: 'overdue', short: 'https://sherbrt.com/r/a1B2c3', ... }
[SMS:OUT] tag=overdue_day1_to_borrower to=+1555... body="⚠️ Due yesterday..."
💾 Updated transaction with SMS notification tracking for tx abc-123
[lateFees] Processing transaction abc-123...
[lateFees] Return due: 2025-11-08, Now: 2025-11-09
[lateFees] Days late: 1
[lateFees] Adding late fee: $15 for day 1
[lateFees] Calling transition with 1 line items...
[lateFees] ✅ Charges applied successfully
💳 Charged late-fee for tx abc-123
   💰 late-fee: $15.00

═══════════════════════════════════════════════════════════
📊 OVERDUE REMINDERS RUN SUMMARY
═══════════════════════════════════════════════════════════
   Candidates processed: 15
   SMS sent:             12
   SMS failed:           0
   Charges applied:      12
   Charges failed:       0
═══════════════════════════════════════════════════════════
```

---

### DRY_RUN Mode
```
🚀 Starting overdue reminder SMS script...
🔍 DRY_RUN mode: SMS and charges will be simulated only
✅ SDK initialized
📅 Processing overdue reminders for: 2025-11-09
📊 Found 15 delivered transactions

[SMS:OUT] tag=overdue_day1_to_borrower to=+1555... dry-run=true
💾 Updated transaction with SMS notification tracking for tx abc-123
💳 [DRY_RUN] Would evaluate charges for tx abc-123

═══════════════════════════════════════════════════════════
📊 OVERDUE REMINDERS RUN SUMMARY
═══════════════════════════════════════════════════════════
   Candidates processed: 15
   SMS sent:             12
   SMS failed:           0
   Charges applied:      0
   Charges failed:       0
═══════════════════════════════════════════════════════════
   Mode: DRY_RUN (no actual SMS or charges)
```

---

### Day 5 with Replacement
```
[lateFees] Processing transaction abc-123...
[lateFees] Days late: 5
[lateFees] Adding late fee: $15 for day 5
[lateFees] Adding replacement charge: $120
[lateFees] Calling transition with 2 line items...
[lateFees] ✅ Charges applied successfully
💳 Charged late-fee + replacement for tx abc-123
   💰 late-fee: $15.00
   💰 replacement: $120.00
```

---

### Permission Error Example
```
❌ Charge failed for tx abc-123: 403 Forbidden

⚠️  PERMISSION ERROR DETECTED:
   The transition/privileged-apply-late-fees requires proper permissions.
   Possible fixes:
   1. In process.edn, change :actor.role/operator to :actor.role/admin
   2. Ensure your Integration app has operator-level privileges in Flex Console
   3. Verify REACT_APP_SHARETRIBE_SDK_CLIENT_ID and SHARETRIBE_SDK_CLIENT_SECRET
```

---

### Already Scanned (No Charges)
```
[lateFees] Package already scanned - no charges apply
ℹ️ No charge for tx abc-123 (already-scanned)
```

---

## ✅ Requirements Checklist

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Import `applyCharges` | ✅ | Line 5 |
| Normalize `DRY_RUN` flag | ✅ | Line 45 |
| Add `FORCE_NOW` support | ✅ | Lines 49, 293 |
| Call `applyCharges` after SMS | ✅ | Lines 268-326 |
| Separate try/catch blocks | ✅ | SMS: 220-265, Charges: 268-326 |
| DRY_RUN for charges | ✅ | Lines 287-288 |
| Detailed charge logging | ✅ | Lines 296-302 |
| Permission error detection | ✅ | Lines 312-323 |
| Helpful 403/401 guidance | ✅ | Lines 315-321 |
| Enhanced summary | ✅ | Lines 334-348 |
| Charge counters | ✅ | Lines 128, 303, 325 |
| Backward compatibility | ✅ | Lines 84-96 (deprecated) |

---

## 🧪 Testing Commands

### Test Day 1 (DRY_RUN)
```bash
export FORCE_NOW=2025-11-09T17:00:00Z  # Day 1 overdue
export DRY_RUN=1
node server/scripts/sendOverdueReminders.js
```

**Expected Output:**
```
💳 [DRY_RUN] Would evaluate charges for tx abc-123
Charges applied:      0
```

---

### Test Day 1 (Real Charges, Test Mode)
```bash
export FORCE_NOW=2025-11-09T17:00:00Z
export ONLY_PHONE=+15551234567  # Your test phone
unset DRY_RUN

node server/scripts/sendOverdueReminders.js
```

**Expected Output:**
```
💳 Charged late-fee for tx abc-123
   💰 late-fee: $15.00
Charges applied:      1
```

**Verify:**
- Stripe test dashboard shows $15 charge
- Transaction protectedData updated
- SMS received

---

### Test Day 5 (Replacement)
```bash
export FORCE_NOW=2025-11-13T17:00:00Z  # Day 5 overdue
export ONLY_PHONE=+15551234567

node server/scripts/sendOverdueReminders.js
```

**Expected Output:**
```
💳 Charged late-fee + replacement for tx abc-123
   💰 late-fee: $15.00
   💰 replacement: $120.00
Charges applied:      1
```

---

### Test Idempotency (Run Twice)
```bash
# Run 1
export FORCE_NOW=2025-11-09T17:00:00Z
node server/scripts/sendOverdueReminders.js

# Run 2 (same day)
node server/scripts/sendOverdueReminders.js
```

**Expected Output (Run 2):**
```
ℹ️ No charge for tx abc-123 (no-op)
Charges applied:      0
```

---

## 📁 Files Changed

```
modified:   server/scripts/sendOverdueReminders.js (+82/-44 lines)

new file:   STEP3_COMPLETE_SUMMARY.md (this file)
```

---

## 🔗 Integration Summary

### Complete Flow

1. **Script Start** → Initialize SDK, parse env flags
2. **Query Transactions** → Get delivered transactions
3. **For Each Overdue:**
   - Calculate days late
   - Send SMS reminder (separate try/catch)
   - Apply charges via `applyCharges()` (separate try/catch)
   - Update counters
4. **Print Summary** → Show SMS + charge statistics

### Dependencies

**From Previous Steps:**
- ✅ Step 1: `process.edn` transition (`:transition/privileged-apply-late-fees`)
- ✅ Step 2: `lateFees.js` module (`applyCharges` function)

**Calls:**
- `applyCharges()` from `lib/lateFees.js`
- `sendSMS()` from `api-util/sendSMS.js`
- `sdk.transactions.query()` (Flex SDK)
- `sdk.transactions.update()` (Flex SDK)

---

## 🚀 Next Steps

### Step 4: Deploy to Flex Console

1. **Upload process.edn**
   - Navigate to Flex Console → Advanced → Transaction Process
   - Upload modified `process.edn` from Step 1
   - Verify `:transition/privileged-apply-late-fees` appears

2. **Define Line Item Codes**
   - Navigate to Line Items section
   - Add `late-fee`: "Late Return Fee ($15/day)"
   - Add `replacement`: "Item Replacement Charge"

3. **Verify Off-Session Setup**
   - Check `:transition/request-payment` action
   - May need to add `:setup-future-usage "off_session"` config

4. **Test in Console Test Environment**
   - Create test transaction
   - Mark as delivered
   - Run script with FORCE_NOW to trigger charges

---

### Step 5: Staging Deployment

```bash
# Deploy to staging
git add server/scripts/sendOverdueReminders.js
git add server/lib/lateFees.js
git add ext/transaction-processes/default-booking/process.edn
git commit -m "feat: implement late fees and replacement charging"
git push origin feat/overdue-fees-stripe

# Test in staging environment
ssh staging
export DRY_RUN=1
export FORCE_NOW=2025-11-13T17:00:00Z
node server/scripts/sendOverdueReminders.js
```

---

## ✅ Step 3 Status: COMPLETE

**Integration:** ✅ Complete  
**Linter:** ✅ No errors  
**Error Handling:** ✅ Robust (separate try/catch + permission hints)  
**Testing:** ✅ DRY_RUN + FORCE_NOW supported  
**Logging:** ✅ Comprehensive summary  

**Ready for Step 4:** Deploy to Flex Console and test with real transactions

---

**Questions or Issues?** Review the git diff above or check `LATEFEES_MODULE_QUICK_REF.md` for usage examples.


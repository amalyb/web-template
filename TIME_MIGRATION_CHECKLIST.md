# Time Helper Migration Checklist

## 🎯 Code Patterns to Replace

### Pattern 1: Getting Today's Date

**Before:**
```javascript
const today = process.env.FORCE_TODAY || yyyymmdd(Date.now());
```

**After:**
```javascript
const { getToday } = require('../util/time');
const today = getToday();
```

**Files affected:**
- `server/scripts/sendShipByReminders.js:96`
- `server/scripts/sendReturnReminders.js:81`
- `server/scripts/sendOverdueReminders.js:100`

---

### Pattern 2: Getting Tomorrow's Date

**Before:**
```javascript
const tomorrow = process.env.FORCE_TOMORROW || yyyymmdd(Date.now() + 24 * 60 * 60 * 1000);
```

**After:**
```javascript
const { getTomorrow } = require('../util/time');
const tomorrow = getTomorrow();
```

**Files affected:**
- `server/scripts/sendReturnReminders.js:82`

---

### Pattern 3: Getting Current Time

**Before:**
```javascript
const now = new Date();
```

**After:**
```javascript
const { getNow } = require('../util/time');
const now = getNow();
```

**Files affected:**
- `server/scripts/sendShipByReminders.js:82` (in `isMorningOf`)
- `server/scripts/sendOverdueReminders.js:322` (in scheduling)

---

### Pattern 4: Creating Timestamps

**Before:**
```javascript
outboundPurchasedAt: new Date().toISOString()
sentAt: new Date().toISOString()
timestamp: new Date().toISOString()
```

**After:**
```javascript
const { timestamp } = require('../util/time');

outboundPurchasedAt: timestamp()
sentAt: timestamp()
timestamp: timestamp()
```

**Files affected:**
- `server/api/transition-privileged.js:98, 367, 519, 579, 1026`
- `server/webhooks/shippoTracking.js:350, 406, 411, 429, 434`
- `server/scripts/sendReturnReminders.js:166, 222`
- `server/scripts/sendOverdueReminders.js:89`

---

### Pattern 5: Duplicated Helper Functions

**Before:**
```javascript
// Duplicated in each script
function yyyymmdd(d) {
  return new Date(d).toISOString().split('T')[0];
}

function diffDays(date1, date2) {
  const d1 = new Date(date1 + 'T00:00:00.000Z');
  const d2 = new Date(date2 + 'T00:00:00.000Z');
  return Math.ceil((d1 - d2) / (1000 * 60 * 60 * 24));
}

function addDays(date, days) {
  const result = new Date(date + 'T00:00:00.000Z');
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isSameDay(date1, date2) {
  return yyyymmdd(date1) === yyyymmdd(date2);
}
```

**After:**
```javascript
// Import from centralized helper
const { yyyymmdd, diffDays, addDays, isSameDay } = require('../util/time');

// Remove local implementations
```

**Files affected:**
- `server/scripts/sendShipByReminders.js:60-78`
- `server/scripts/sendReturnReminders.js:70-71`
- `server/scripts/sendOverdueReminders.js:59-67`

---

## ✅ Migration Tasks

### Phase 1: Create Time Helper (NEW)
- [ ] Create `server/util/time.js`
  - [ ] Add `getNow()` with `FORCE_NOW` support
  - [ ] Add `getToday()` with `FORCE_TODAY` support
  - [ ] Add `getTomorrow()` with `FORCE_TOMORROW` support
  - [ ] Add `yyyymmdd(d)` helper
  - [ ] Add `diffDays(date1, date2)` helper
  - [ ] Add `addDays(date, days)` helper
  - [ ] Add `isSameDay(date1, date2)` helper
  - [ ] Add `isMorningOf(date)` helper
  - [ ] Add `timestamp()` helper
  - [ ] Add `getNext9AM()` helper
- [ ] Create `server/util/time.test.js`
  - [ ] Test `getNow()` with/without `FORCE_NOW`
  - [ ] Test `getToday()` with/without `FORCE_TODAY`
  - [ ] Test `getTomorrow()` with/without `FORCE_TOMORROW`
  - [ ] Test all helper functions
  - [ ] Test timezone handling

### Phase 2: Migrate Reminder Scripts (HIGH PRIORITY)

#### `server/scripts/sendShipByReminders.js`
- [ ] Import time helpers at top
  ```javascript
  const { getToday, diffDays, addDays, isSameDay, isMorningOf } = require('../util/time');
  ```
- [ ] Replace line 96: `const today = getToday();`
- [ ] Replace line 82 in `isMorningOf()`: Use `getNow()` instead of `new Date()`
- [ ] Remove local helpers (lines 60-84)
- [ ] Test with `FORCE_TODAY` and `FORCE_NOW`

#### `server/scripts/sendReturnReminders.js`
- [ ] Import time helpers at top
  ```javascript
  const { getToday, getTomorrow, yyyymmdd } = require('../util/time');
  ```
- [ ] Replace line 81: `const today = getToday();`
- [ ] Replace line 82: `const tomorrow = getTomorrow();`
- [ ] Replace line 166, 222: Use `timestamp()` instead of `new Date().toISOString()`
- [ ] Remove local helper (lines 70-72)
- [ ] Test with `FORCE_TODAY` and `FORCE_TOMORROW`

#### `server/scripts/sendOverdueReminders.js`
- [ ] Import time helpers at top
  ```javascript
  const { getToday, getNow, getNext9AM, diffDays, timestamp } = require('../util/time');
  ```
- [ ] Replace line 100: `const today = getToday();`
- [ ] Replace line 89: Use `timestamp()` instead of `new Date().toISOString()`
- [ ] Replace line 322: Use `getNow()` instead of `new Date()`
- [ ] Replace lines 323-335: Use `getNext9AM()` for scheduling
- [ ] Remove local helpers (lines 59-67)
- [ ] Test with `FORCE_TODAY` and `FORCE_NOW`

### Phase 3: Migrate Transaction Handlers (MEDIUM PRIORITY)

#### `server/api/transition-privileged.js`
- [ ] Import time helper at top
  ```javascript
  const { timestamp } = require('../util/time');
  ```
- [ ] Replace line 98: `updatedAt: timestamp()`
- [ ] Replace line 367: `outboundPurchasedAt: timestamp()`
- [ ] Replace line 519: `returnPurchasedAt: timestamp()`
- [ ] Replace line 579: `sentAt: timestamp()`
- [ ] Replace line 1026: `acceptedAt: timestamp()`
- [ ] Test with `FORCE_NOW`

#### `server/webhooks/shippoTracking.js`
- [ ] Import time helper at top
  ```javascript
  const { timestamp } = require('../util/time');
  ```
- [ ] Replace line 350: `firstScanAt: timestamp()`
- [ ] Replace lines 406, 429: `timestamp: timestamp()`
- [ ] Replace lines 411, 434: `sentAt: timestamp()`
- [ ] Test with `FORCE_NOW`

#### `server/lib/shipping.js`
- [ ] Import time helper at top (if needed for future enhancements)
- [ ] Document that `computeShipByDate()` uses transaction data, not current time
- [ ] Consider adding `FORCE_NOW` support if needed for testing

### Phase 4: Update Documentation (LOW PRIORITY)
- [ ] Update `docs/sms-links.md` to mention time helper
- [ ] Document `FORCE_NOW`, `FORCE_TODAY`, `FORCE_TOMORROW` usage
- [ ] Add testing examples with time overrides
- [ ] Update README with new env vars

### Phase 5: Optional - Rate Limiting & Idempotency
- [ ] Evaluate if `sendSMS.js` needs `FORCE_NOW` support
- [ ] Evaluate if `idempotency.js` needs `FORCE_NOW` support
- [ ] Migrate if necessary for testing

---

## 🧪 Testing Checklist

### Unit Tests
- [ ] Run `npm test server/util/time.test.js`
- [ ] Verify all functions work with and without FORCE_* vars
- [ ] Test edge cases (leap years, DST transitions, etc.)

### Integration Tests

#### Test 1: Ship-by Reminder (t-24)
```bash
export FORCE_TODAY=2025-01-18
export FORCE_NOW=2025-01-18T10:00:00.000Z
node server/scripts/sendShipByReminders.js
```
Expected: Transaction with shipByDate=2025-01-19 triggers t-24 reminder

#### Test 2: Return Reminder (t-1)
```bash
export FORCE_TODAY=2025-01-20
export FORCE_TOMORROW=2025-01-21
node server/scripts/sendReturnReminders.js
```
Expected: Transaction with deliveryEnd=2025-01-21 triggers t-1 reminder

#### Test 3: Overdue Reminder
```bash
export FORCE_TODAY=2025-01-25
node server/scripts/sendOverdueReminders.js
```
Expected: Transaction with returnDate=2025-01-20 triggers day-5 overdue

#### Test 4: Morning-of Logic
```bash
export FORCE_NOW=2025-01-20T07:00:00.000Z  # 7 AM UTC
node server/scripts/sendShipByReminders.js
```
Expected: Detects morning-of for shipByDate=2025-01-20

#### Test 5: Scheduling Logic
```bash
export FORCE_NOW=2025-01-20T14:00:00.000Z
node server/scripts/sendOverdueReminders.js
```
Expected: Calculates next 9 AM PST correctly

### Regression Tests
- [ ] Run all existing tests
- [ ] Verify no behavior changes without FORCE_* vars
- [ ] Check SMS logs for correct timestamps
- [ ] Verify transaction protectedData timestamps

---

## 📊 Progress Tracker

| Task | Status | Assignee | Notes |
|------|--------|----------|-------|
| Create `server/util/time.js` | ⬜ Not Started | | |
| Create `server/util/time.test.js` | ⬜ Not Started | | |
| Migrate `sendShipByReminders.js` | ⬜ Not Started | | |
| Migrate `sendReturnReminders.js` | ⬜ Not Started | | |
| Migrate `sendOverdueReminders.js` | ⬜ Not Started | | |
| Migrate `transition-privileged.js` | ⬜ Not Started | | |
| Migrate `shippoTracking.js` | ⬜ Not Started | | |
| Update documentation | ⬜ Not Started | | |
| Integration testing | ⬜ Not Started | | |

**Legend:** ⬜ Not Started | 🟡 In Progress | ✅ Complete | ❌ Blocked

---

## 🚨 Gotchas & Considerations

### 1. **UTC vs Local Time**
- Current code uses UTC implicitly
- Business operates in PST/PDT (America/Los_Angeles)
- Consider timezone-aware scheduling in future

### 2. **Timestamp Format**
- All timestamps currently use ISO format: `2025-01-15T09:30:00.000Z`
- Maintain this format for consistency
- `timestamp()` helper should return ISO string

### 3. **Date String Format**
- All date strings currently use `YYYY-MM-DD` format
- Maintain this format for consistency
- `yyyymmdd()` helper ensures this

### 4. **Scheduling Intervals**
- Ship-by reminders: Every 1 hour
- Return reminders: Every 1 hour
- Overdue reminders: Daily at 9 AM PST
- Don't change intervals during migration

### 5. **Backward Compatibility**
- Without FORCE_* vars, behavior should be identical
- Existing cron jobs should continue to work
- No changes to transaction data structure

### 6. **Testing in Production**
- Never set FORCE_* vars in production
- Use only in test/staging environments
- Log warnings if FORCE_* vars detected

---

## 📚 Reference

See also:
- `TIME_SOURCE_ANALYSIS.md` - Detailed analysis
- `TIME_ANALYSIS_QUICK_REFERENCE.md` - Quick reference table
- `docs/time-travel-testing.md` - **Time travel testing guide with FORCE_* variables**
- `docs/sms-links.md` - SMS links documentation

---

## ✅ Implementation Complete

All tasks have been completed:

✅ Created `server/util/time.js` with all time functions  
✅ Created `server/util/time.test.js` with comprehensive tests  
✅ Migrated all reminder scripts to use time helper  
✅ Migrated transaction handlers to use `timestamp()`  
✅ Migrated webhook handlers to use `timestamp()`  
✅ Removed all duplicate helper functions  
✅ Added `logTimeState()` logging to all jobs  
✅ Created comprehensive documentation

**Environment Variables:**
- `FORCE_NOW` - Override current timestamp (ISO format)
- `FORCE_TODAY` - Override today's date (YYYY-MM-DD)
- `FORCE_TOMORROW` - Override tomorrow's date (YYYY-MM-DD)
- `TZ` - Timezone (default: America/Los_Angeles)

**See `docs/time-travel-testing.md` for complete testing guide.**

---

**Estimated Total Time:** 3-4 hours ✅ **COMPLETE**  
**Last Updated:** October 15, 2025


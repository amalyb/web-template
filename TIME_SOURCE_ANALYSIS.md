# Time Source and Scheduling Logic Analysis - Sherbrt SMS & Reminder Jobs

## 🔍 Executive Summary

**Current State:**
- ❌ **No centralized time helper** - Each script duplicates time functions
- ✅ **Partial FORCE_* support** - Only `FORCE_TODAY` and `FORCE_TOMORROW` exist
- ❌ **No FORCE_NOW support** - All scripts use `new Date()` or `Date.now()` directly
- ⚠️ **Mixed time libraries** - Uses both `moment` and native `Date` objects
- ⚠️ **No timezone handling** - All date calculations use UTC, but no explicit timezone support

**Recommendation:**
Create `server/util/time.js` to centralize all time functions with full `FORCE_NOW`, `FORCE_TODAY`, and `FORCE_TOMORROW` support.

---

## 📊 Detailed Findings Table

| File | Function/Purpose | Current Time Source | Reads FORCE_* | Timezone | Needs Centralization? |
|------|-----------------|---------------------|---------------|----------|----------------------|
| `server/scripts/sendShipByReminders.js` | `sendShipByReminders()` | `Date.now()` | ✅ `FORCE_TODAY` | UTC (implicit) | ✅ **YES** |
| `server/scripts/sendReturnReminders.js` | `sendReturnReminders()` | `Date.now()` | ✅ `FORCE_TODAY`, `FORCE_TOMORROW` | UTC (implicit) | ✅ **YES** |
| `server/scripts/sendOverdueReminders.js` | `sendOverdueReminders()` | `Date.now()` | ✅ `FORCE_TODAY` | UTC (implicit) | ✅ **YES** |
| `server/api/transition-privileged.js` | Label creation timestamps | `new Date()` | ❌ No | System local | ✅ **YES** |
| `server/webhooks/shippoTracking.js` | Tracking event timestamps | `new Date()` | ❌ No | System local | ✅ **YES** |
| `server/lib/shipping.js` | `computeShipByDate()` | `new Date(startISO)` | ❌ No | System local | ✅ **YES** |
| `server/api-util/dates.js` | Date calculations | `moment()` | ❌ No | UTC (moment default) | ⚠️ **Partial** |
| `server/api-util/lineItemHelpers.js` | Line item calculations | `moment-timezone` | ❌ No | UTC | ⚠️ **Partial** |
| `server/api-util/sendSMS.js` | Rate limiting | `Date.now()` | ❌ No | System local | ✅ **YES** |
| `server/api-util/idempotency.js` | Idempotency cache | `Date.now()` | ❌ No | System local | ✅ **YES** |

---

## 🔬 Deep Dive by Category

### 1. Reminder Scripts (HIGH PRIORITY)

#### `server/scripts/sendShipByReminders.js`
**Lines: 60-97**

```javascript
// Local helper functions (duplicated)
function yyyymmdd(d) {
  return new Date(d).toISOString().split('T')[0];
}

function diffDays(date1, date2) {
  const d1 = new Date(date1 + 'T00:00:00.000Z'); // Force UTC
  const d2 = new Date(date2 + 'T00:00:00.000Z'); // Force UTC
  return Math.ceil((d1 - d2) / (1000 * 60 * 60 * 24));
}

function addDays(date, days) {
  const result = new Date(date + 'T00:00:00.000Z'); // Force UTC
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isSameDay(date1, date2) {
  return yyyymmdd(date1) === yyyymmdd(date2);
}

function isMorningOf(date) {
  const now = new Date();  // ❌ Not overridable
  const target = new Date(date + 'T00:00:00.000Z');
  return isSameDay(now, target) && now.getUTCHours() >= 6 && now.getUTCHours() < 12;
}

async function sendShipByReminders() {
  const today = process.env.FORCE_TODAY || yyyymmdd(Date.now());  // ✅ Has override
  const todayDate = new Date(today);
  // ... rest of logic
}
```

**Current FORCE_* Support:**
- ✅ `FORCE_TODAY` - Supported for determining today's date
- ❌ `FORCE_NOW` - Not supported (line 82: `const now = new Date()`)

**Scheduling:**
- Line 315: `setInterval(async () => { ... }, 3600000)` - Runs every hour
- No timezone-aware scheduling

---

#### `server/scripts/sendReturnReminders.js`
**Lines: 70-84**

```javascript
function yyyymmdd(d) {
  return new Date(d).toISOString().split('T')[0];
}

async function sendReturnReminders() {
  const today = process.env.FORCE_TODAY || yyyymmdd(Date.now());     // ✅ Has override
  const tomorrow = process.env.FORCE_TOMORROW || yyyymmdd(Date.now() + 24 * 60 * 60 * 1000);  // ✅ Has override
  const tMinus1 = yyyymmdd(new Date(today).getTime() - 24 * 60 * 60 * 1000);  // ❌ Calculated from FORCE_TODAY
  
  // ... rest of logic
}
```

**Current FORCE_* Support:**
- ✅ `FORCE_TODAY` - Supported
- ✅ `FORCE_TOMORROW` - Supported
- ❌ `FORCE_NOW` - Not needed (script only uses date, not time)

**Scheduling:**
- Line 258: `setInterval(async () => { ... }, 3600000)` - Runs every hour

---

#### `server/scripts/sendOverdueReminders.js`
**Lines: 59-101**

```javascript
function yyyymmdd(d) {
  return new Date(d).toISOString().split('T')[0];
}

function diffDays(date1, date2) {
  const d1 = new Date(date1 + 'T00:00:00.000Z');
  const d2 = new Date(date2 + 'T00:00:00.000Z');
  return Math.ceil((d1 - d2) / (1000 * 60 * 60 * 24));
}

async function sendOverdueReminders() {
  const today = process.env.FORCE_TODAY || yyyymmdd(Date.now());  // ✅ Has override
  const todayDate = new Date(today);
  // ... rest of logic
}
```

**Current FORCE_* Support:**
- ✅ `FORCE_TODAY` - Supported
- ❌ `FORCE_NOW` - Not supported

**Scheduling:**
- Lines 322-335: More sophisticated scheduling
  ```javascript
  const now = new Date();  // ❌ Not overridable
  const next9AM = new Date(now);
  // ... calculate next 9 AM
  setTimeout(() => {
    runDaily();
    setInterval(runDaily, 24 * 60 * 60 * 1000);
  }, millisToNext9AM);
  ```

---

### 2. Transaction & Webhook Handlers (MEDIUM PRIORITY)

#### `server/api/transition-privileged.js`
**Multiple uses:**

```javascript
// Line 46: Shippo timestamp conversion
return new Date(seconds * 1000).toISOString();

// Line 98: Step tracking
updatedAt: new Date().toISOString()

// Line 367: Label purchase timestamp
outboundPurchasedAt: new Date().toISOString(),

// Line 519: Return label timestamp
returnPurchasedAt: new Date().toISOString(),

// Line 579: Notification timestamp
labelCreated: { sent: true, sentAt: new Date().toISOString() }

// Line 1026: Acceptance timestamp
acceptedAt: new Date().toISOString()
```

**Current FORCE_* Support:**
- ❌ None - All use `new Date()` directly

**Impact:**
- Timestamps in protectedData may not match test scenarios
- Difficult to test time-dependent logic (e.g., label expiry)

---

#### `server/webhooks/shippoTracking.js`
**Multiple uses:**

```javascript
// Line 350: First scan timestamp
firstScanAt: new Date().toISOString()

// Line 406, 429: Tracking status timestamps
timestamp: new Date().toISOString(),

// Line 411, 434: Notification timestamps
delivered: { sent: true, sentAt: new Date().toISOString() }
firstScan: { sent: true, sentAt: new Date().toISOString() }
```

**Current FORCE_* Support:**
- ❌ None

---

### 3. Utility Libraries

#### `server/lib/shipping.js`
**Purpose:** Calculate ship-by dates

```javascript
function computeShipByDate(tx) {
  const leadDays = Number(process.env.SHIP_LEAD_DAYS || 2);
  const startISO = getBookingStartISO(tx);
  const start = new Date(startISO);  // ❌ Not overridable
  start.setHours(0, 0, 0, 0);
  
  const shipBy = new Date(start);
  shipBy.setDate(shipBy.getDate() - leadDays);
  return shipBy;
}
```

**Current FORCE_* Support:**
- ❌ None
- Only reads `SHIP_LEAD_DAYS` env var

**Impact:**
- Ship-by date calculations can't be tested with fixed dates

---

#### `server/api-util/dates.js`
**Purpose:** Date arithmetic helpers

```javascript
const moment = require('moment');

exports.nightsBetween = (startDate, endDate) => {
  const nights = moment(endDate).diff(startDate, 'days');
  // ...
};

exports.daysBetween = (startDate, endDate) => {
  const days = moment(endDate).diff(startDate, 'days');
  // ...
};
```

**Library:** `moment` (no timezone)
**Current FORCE_* Support:**
- ❌ None - Uses moment with default UTC

**Status:** ✅ **Keep as-is** - Pure functions that don't need current time

---

#### `server/api-util/lineItemHelpers.js`
**Purpose:** Line item calculations with hours

```javascript
const moment = require('moment-timezone/builds/moment-timezone-with-data-10-year-range.min');

// Line 173
return moment(endDate).diff(moment(startDate), 'hours', true);
```

**Library:** `moment-timezone` (with 10-year range data)
**Timezone Support:** ✅ Available but not actively used
**Current FORCE_* Support:**
- ❌ None

**Status:** ✅ **Keep as-is** - Pure functions for calculations

---

### 4. Other Time Usage

#### `server/api-util/sendSMS.js`
```javascript
// Line 40: Rate limiting
const now = Date.now();
```

**Purpose:** Idempotency key generation
**Current FORCE_* Support:** ❌ None

---

#### `server/api-util/idempotency.js`
```javascript
// Line 5: Cache key generation
const now = Date.now();
```

**Purpose:** Idempotency cache
**Current FORCE_* Support:** ❌ None

---

#### `server/resources/sitemap.js` & `server/resources/robotsTxt.js`
**Multiple cache timestamp checks:**
```javascript
if (Date.now() - cachedData.timestamp < ttl * 1000) { ... }
const age = Math.floor((Date.now() - timestamp) / 1000);
```

**Current FORCE_* Support:** ❌ None
**Status:** ✅ **Keep as-is** - Infrastructure caching, doesn't need test overrides

---

## 🔑 Key Findings

### 1. **No Centralized Time Helper**
- Each script duplicates functions: `yyyymmdd()`, `diffDays()`, `addDays()`, `isSameDay()`
- Code duplication across 3 reminder scripts
- Inconsistent implementations (e.g., `isMorningOf` only in ship-by reminders)

### 2. **Partial FORCE_* Support**
| Environment Variable | Support Status | Used By |
|---------------------|----------------|---------|
| `FORCE_TODAY` | ✅ Implemented | Ship-by, Return, Overdue reminders |
| `FORCE_TOMORROW` | ✅ Implemented | Return reminders only |
| `FORCE_NOW` | ❌ Not implemented | None |
| `FORCE_DATE` | ❌ Not implemented | None |

### 3. **Mixed Time Libraries**
- **`moment`**: Used in `dates.js` for date arithmetic
- **`moment-timezone`**: Used in `lineItemHelpers.js` with 10-year timezone data
- **Native `Date`**: Used everywhere else
- **No timezone awareness** in reminder scripts (all use UTC implicitly)

### 4. **Scheduling Mechanisms**
- **Ship-by reminders**: `setInterval` every 1 hour
- **Return reminders**: `setInterval` every 1 hour
- **Overdue reminders**: Smart scheduling - runs daily at 9 AM, but uses `new Date()` directly (line 322)

### 5. **Timezone Handling**
- ⚠️ **No explicit timezone support** in reminder scripts
- All scripts use UTC implicitly via `.toISOString().split('T')[0]`
- `moment-timezone` available but not used for current time
- No `America/Los_Angeles` references found
- Business operates in PST/PDT but code uses UTC

---

## 💡 Recommendations

### Option 1: Create `server/util/time.js` (RECOMMENDED)

**Why:**
- ✅ Single source of truth for all time operations
- ✅ Consistent FORCE_* support across all scripts
- ✅ Easy to test and maintain
- ✅ Can add timezone support in one place
- ✅ Follows existing pattern (`server/util/url.js`, `server/util/contact.js`)

**What to include:**

```javascript
// server/util/time.js
const moment = require('moment-timezone');

// Configuration
const TIMEZONE = process.env.TZ || 'America/Los_Angeles';

/**
 * Get current time with FORCE_NOW override support
 */
function getNow() {
  const forced = process.env.FORCE_NOW;
  if (forced) {
    console.log(`[TIME] Using FORCE_NOW=${forced}`);
    return new Date(forced);
  }
  return new Date();
}

/**
 * Get current date (YYYY-MM-DD) with FORCE_TODAY override
 */
function getToday() {
  const forced = process.env.FORCE_TODAY;
  if (forced) {
    console.log(`[TIME] Using FORCE_TODAY=${forced}`);
    return forced;
  }
  return yyyymmdd(getNow());
}

/**
 * Get tomorrow's date (YYYY-MM-DD) with FORCE_TOMORROW override
 */
function getTomorrow() {
  const forced = process.env.FORCE_TOMORROW;
  if (forced) {
    console.log(`[TIME] Using FORCE_TOMORROW=${forced}`);
    return forced;
  }
  const now = getNow();
  return yyyymmdd(now.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Convert timestamp to YYYY-MM-DD
 */
function yyyymmdd(d) {
  return new Date(d).toISOString().split('T')[0];
}

/**
 * Calculate difference in days between two dates
 */
function diffDays(date1, date2) {
  const d1 = new Date(date1 + 'T00:00:00.000Z');
  const d2 = new Date(date2 + 'T00:00:00.000Z');
  return Math.ceil((d1 - d2) / (1000 * 60 * 60 * 24));
}

/**
 * Add days to a date
 */
function addDays(date, days) {
  const result = new Date(date + 'T00:00:00.000Z');
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Check if two dates are the same day
 */
function isSameDay(date1, date2) {
  return yyyymmdd(date1) === yyyymmdd(date2);
}

/**
 * Check if current time is morning of given date (6 AM - 12 PM UTC)
 */
function isMorningOf(date) {
  const now = getNow();  // ✅ Now uses FORCE_NOW
  const target = new Date(date + 'T00:00:00.000Z');
  return isSameDay(now, target) && now.getUTCHours() >= 6 && now.getUTCHours() < 12;
}

/**
 * Get current timestamp in ISO format
 */
function timestamp() {
  return getNow().toISOString();
}

/**
 * Get next 9 AM (for daily scheduling)
 */
function getNext9AM() {
  const now = getNow();
  const next9AM = new Date(now);
  next9AM.setUTCHours(17, 0, 0, 0); // 9 AM PST = 17:00 UTC
  
  if (now >= next9AM) {
    next9AM.setUTCDate(next9AM.getUTCDate() + 1);
  }
  
  return next9AM;
}

module.exports = {
  getNow,
  getToday,
  getTomorrow,
  yyyymmdd,
  diffDays,
  addDays,
  isSameDay,
  isMorningOf,
  timestamp,
  getNext9AM,
  TIMEZONE,
};
```

**Migration Plan:**

1. **Create `server/util/time.js`** with all functions above
2. **Update reminder scripts** to import from time helper:
   ```javascript
   const { getToday, getTomorrow, diffDays, addDays, isSameDay, isMorningOf } = require('../util/time');
   ```
3. **Update transaction handlers** to use `timestamp()`:
   ```javascript
   const { timestamp } = require('../util/time');
   // Replace: new Date().toISOString()
   // With: timestamp()
   ```
4. **Update webhook handlers** similarly
5. **Add tests** in `server/util/time.test.js`
6. **Remove duplicated functions** from individual scripts

---

### Option 2: Extend `server/api-util/dates.js` (NOT RECOMMENDED)

**Pros:**
- Already exists
- Already uses `moment`

**Cons:**
- ❌ Located in `api-util` (not general utility)
- ❌ Only has pure functions (no current time logic)
- ❌ Doesn't match the pattern (`api-util` is for API-specific helpers)
- ❌ Would mix concerns (date arithmetic vs current time)

---

## 🎯 Action Items

### High Priority
1. ✅ **Create `server/util/time.js`** with centralized time functions
2. ✅ **Add `FORCE_NOW` support** to all time operations
3. ✅ **Migrate reminder scripts** to use time helper
4. ✅ **Update transaction handlers** to use time helper

### Medium Priority
5. ⚠️ **Migrate webhook handlers** to use time helper
6. ⚠️ **Add timezone support** (America/Los_Angeles) for business hours
7. ⚠️ **Update scheduling logic** to use time helper

### Low Priority
8. 💭 **Consider deprecating `moment`** in favor of native `Date` + time helper
9. 💭 **Add timezone-aware scheduling** (e.g., 9 AM PST instead of UTC)

---

## 📝 Testing Strategy

### Environment Variables for Testing

```bash
# Test specific date
export FORCE_TODAY=2025-01-15

# Test specific time
export FORCE_NOW=2025-01-15T09:30:00.000Z

# Test tomorrow logic
export FORCE_TOMORROW=2025-01-16

# Run reminder script
node server/scripts/sendShipByReminders.js
```

### Example Test Scenarios

**Scenario 1: Test t-24 ship-by reminder**
```bash
export FORCE_TODAY=2025-01-18
export FORCE_NOW=2025-01-18T10:00:00.000Z
# Transaction with shipByDate=2025-01-19 should trigger t-24 reminder
```

**Scenario 2: Test return reminder**
```bash
export FORCE_TODAY=2025-01-20
export FORCE_TOMORROW=2025-01-21
# Transaction with deliveryEnd=2025-01-21 should trigger t-1 reminder
```

**Scenario 3: Test morning-of logic**
```bash
export FORCE_NOW=2025-01-20T07:00:00.000Z  # 7 AM UTC (morning hours)
# Should detect morning-of for shipByDate=2025-01-20
```

---

## 🔄 Dependency Summary

### Current Libraries
- ✅ **`moment`** - Used in `dates.js` (pure functions)
- ✅ **`moment-timezone`** - Used in `lineItemHelpers.js` (with 10-year timezone data)
- ✅ **Native `Date`** - Used everywhere else

### Recommendation
- **Keep `moment-timezone`** for `lineItemHelpers.js` (already has timezone data)
- **Use native `Date`** in new time helper for simplicity
- **Optionally add `moment-timezone`** to time helper if timezone-aware scheduling is needed

---

## 📊 Summary Table

| Category | Current State | Proposed State | Effort |
|----------|---------------|----------------|--------|
| **Time Helper** | ❌ None | ✅ `server/util/time.js` | Medium |
| **FORCE_NOW** | ❌ Not supported | ✅ Supported everywhere | Medium |
| **FORCE_TODAY** | ✅ Partial (3 scripts) | ✅ Centralized | Low |
| **FORCE_TOMORROW** | ✅ Partial (1 script) | ✅ Centralized | Low |
| **Code Duplication** | ❌ High (3 scripts) | ✅ None | Low |
| **Timezone Support** | ❌ None (implicit UTC) | ⚠️ Optional (future) | High |
| **Testability** | ⚠️ Partial | ✅ Complete | Medium |

**Total Effort Estimate:** 3-4 hours (helper creation + migration + testing)

---

**Next Steps:**
1. Review this analysis
2. Approve creation of `server/util/time.js`
3. Implement time helper with tests
4. Migrate scripts one by one
5. Update documentation

**Files to Create:**
- `server/util/time.js`
- `server/util/time.test.js`

**Files to Modify:**
- `server/scripts/sendShipByReminders.js`
- `server/scripts/sendReturnReminders.js`
- `server/scripts/sendOverdueReminders.js`
- `server/api/transition-privileged.js`
- `server/webhooks/shippoTracking.js`
- `server/lib/shipping.js`


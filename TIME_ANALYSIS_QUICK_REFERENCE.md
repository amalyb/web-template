# Time Source Analysis - Quick Reference Table

## 📊 Current Time Handling by File

| File | Function | Uses | Reads FORCE_* | Needs Centralization? | Priority |
|------|----------|------|---------------|----------------------|----------|
| `server/scripts/sendShipByReminders.js` | `sendShipByReminders()` | `Date.now()` + local helpers | ✅ `FORCE_TODAY` | ✅ **YES** | 🔴 HIGH |
| `server/scripts/sendShipByReminders.js` | `isMorningOf()` | `new Date()` | ❌ No | ✅ **YES** | 🔴 HIGH |
| `server/scripts/sendReturnReminders.js` | `sendReturnReminders()` | `Date.now()` + local helper | ✅ `FORCE_TODAY`, `FORCE_TOMORROW` | ✅ **YES** | 🔴 HIGH |
| `server/scripts/sendOverdueReminders.js` | `sendOverdueReminders()` | `Date.now()` + local helper | ✅ `FORCE_TODAY` | ✅ **YES** | 🔴 HIGH |
| `server/scripts/sendOverdueReminders.js` | Scheduling (`next9AM`) | `new Date()` | ❌ No | ✅ **YES** | 🔴 HIGH |
| `server/api/transition-privileged.js` | Timestamps (6 locations) | `new Date()` | ❌ No | ✅ **YES** | 🟡 MEDIUM |
| `server/webhooks/shippoTracking.js` | Timestamps (4 locations) | `new Date()` | ❌ No | ✅ **YES** | 🟡 MEDIUM |
| `server/lib/shipping.js` | `computeShipByDate()` | `new Date(startISO)` | ❌ No | ✅ **YES** | 🟡 MEDIUM |
| `server/api-util/dates.js` | `nightsBetween()`, `daysBetween()` | `moment()` | ❌ No | ✅ No (pure functions) | 🟢 LOW |
| `server/api-util/lineItemHelpers.js` | Hour calculations | `moment-timezone` | ❌ No | ✅ No (pure functions) | 🟢 LOW |
| `server/api-util/sendSMS.js` | Rate limiting | `Date.now()` | ❌ No | ⚠️ Maybe | 🟢 LOW |
| `server/api-util/idempotency.js` | Cache keys | `Date.now()` | ❌ No | ⚠️ Maybe | 🟢 LOW |
| `server/resources/sitemap.js` | Cache timestamps | `Date.now()` | ❌ No | ❌ No (infrastructure) | ⬜ N/A |
| `server/resources/robotsTxt.js` | Cache timestamps | `Date.now()` | ❌ No | ❌ No (infrastructure) | ⬜ N/A |

---

## 🔑 Key Statistics

- **Total files with time logic:** 14
- **Files needing centralization:** 8 (HIGH/MEDIUM priority)
- **Current FORCE_* support:** 3 files (partial)
- **Duplicated helper functions:** `yyyymmdd()`, `diffDays()`, `addDays()`, `isSameDay()` (across 3 scripts)
- **Libraries in use:** Native `Date`, `moment`, `moment-timezone`

---

## ✅ Recommendation Summary

### Create `server/util/time.js`

**Centralize these functions:**
- `getNow()` - ✅ Supports `FORCE_NOW`
- `getToday()` - ✅ Supports `FORCE_TODAY`
- `getTomorrow()` - ✅ Supports `FORCE_TOMORROW`
- `yyyymmdd()` - Date formatting
- `diffDays()` - Date arithmetic
- `addDays()` - Date arithmetic
- `isSameDay()` - Date comparison
- `isMorningOf()` - Time-of-day check
- `timestamp()` - ISO timestamp generation
- `getNext9AM()` - Scheduling helper

**Migration Priority:**
1. 🔴 **HIGH:** Reminder scripts (3 files)
2. 🟡 **MEDIUM:** Transaction handlers (2 files)
3. 🟡 **MEDIUM:** Shipping logic (1 file)
4. 🟢 **LOW:** Rate limiting & idempotency (2 files)

---

## 🧪 Test Environment Variables

```bash
# Override current time
export FORCE_NOW=2025-01-15T09:30:00.000Z

# Override today's date
export FORCE_TODAY=2025-01-15

# Override tomorrow's date
export FORCE_TOMORROW=2025-01-16
```

---

## 📝 Next Action

**Implement `server/util/time.js`** to eliminate code duplication and add comprehensive `FORCE_NOW` support across all time operations.

**Estimated Effort:** 3-4 hours
- Helper creation: 1 hour
- Unit tests: 1 hour
- Migration: 1-2 hours
- Testing: 30 minutes

---

See `TIME_SOURCE_ANALYSIS.md` for detailed analysis and implementation recommendations.


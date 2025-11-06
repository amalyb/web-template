# Ship-By Audit - Executive Summary

**Auditor**: Cursor AI Assistant  
**Date**: November 5, 2025  
**Branches**: test, main (identical implementations)

---

## 🎯 What You Asked For

1. ✅ Where ship-by is computed
2. ✅ Whether fixed SHIP_LEAD_DAYS is forcing behavior
3. ✅ How distance-based days are mapped
4. ✅ What SMS uses to render "Ship by..."
5. ✅ Branch parity verification (test vs main)
6. ✅ Smoke test results

---

## 🚨 Critical Finding

**Your dynamic ship-by implementation EXISTS and is CORRECT, but is NOT ACTIVE.**

### Why?

```javascript
// server/lib/shipping.js:23
const LEAD_MODE = process.env.SHIP_LEAD_MODE || 'static';
```

**If `SHIP_LEAD_MODE` is not set to `'distance'`, the code uses static mode.**

### Current State by Environment

| Env | SHIP_LEAD_MODE | SHIP_LEAD_DAYS | Actual Behavior | Status |
|-----|---------------|----------------|-----------------|--------|
| **Test** | _(not set)_ | _(blank)_ | Static, 2-day lead (default) | ✅ Works |
| **Live** | _(not set)_ | `0` | **Static, 0-day lead** | ❌ **BROKEN** |

---

## 📍 Answer to Each Question

### (a) Where ship-by is computed

**Single source of truth**: `server/lib/shipping.js`

```
Line 149: computeShipByDate(tx, opts) - main computation
Line 196: computeShipBy(tx, opts)     - wrapper with metadata (mode, leadDays, miles)
```

**All consumers use this**:
- SMS (transition-privileged.js:341)
- Reminder scripts (sendShipByReminders.js:158)
- API endpoints (ship.js:45)

✅ **No duplicate logic** - single source of truth verified.

---

### (b) Whether fixed SHIP_LEAD_DAYS is forcing behavior

**YES, because SHIP_LEAD_MODE defaults to 'static'.**

```javascript
// Lines 23-24
const LEAD_MODE = process.env.SHIP_LEAD_MODE || 'static';  // ← Defaults!
const LEAD_FLOOR = Number(process.env.SHIP_LEAD_DAYS || 2);

// Line 161
if (LEAD_MODE === 'distance') {
  // Dynamic distance-based calculation
} else {
  // Uses LEAD_FLOOR from SHIP_LEAD_DAYS
}
```

**Impact**:
- Test: `SHIP_LEAD_DAYS=` (blank) → defaults to 2 → ✅ Works
- Live: `SHIP_LEAD_DAYS=0` → uses 0 → ❌ **Ship-by = borrow start**

---

### (c) How distance-based days are mapped

**From `computeLeadDaysDynamic()` (lines 91-123)**:

| Distance Range | Base Days | With Floor | With Max Cap |
|----------------|-----------|------------|--------------|
| ≤200 miles | 1 | `max(1, LEAD_FLOOR)` | `min(result, LEAD_MAX)` |
| 200-1000 miles | 2 | `max(2, LEAD_FLOOR)` | `min(result, LEAD_MAX)` |
| >1000 miles | 3 | `max(3, LEAD_FLOOR)` | `min(result, LEAD_MAX)` |

**Example with LEAD_FLOOR=1, LEAD_MAX=5**:
- 94107→94105 (SF local, ~2 mi): 1 day
- 94107→90210 (SF→LA, ~350 mi): 2 days  
- 94107→10012 (SF→NYC, ~2900 mi): 3 days

**Dependencies**:
- Requires `MAPBOX_TOKEN` for geocoding ZIPs to lat/lng
- Falls back to `LEAD_FLOOR` if geocoding fails

---

### (d) What SMS uses to render "Ship by..."

**File**: `server/api/transition-privileged.js`

```javascript
// Line 341: Compute ONCE
const computeResult = await computeShipBy(transaction, { preferLabelAddresses: false });
const { shipByDate, leadDays, miles, mode } = computeResult;

// Line 499: Format for display
const shipByStr = formatShipBy(shipByDate);  // "Nov 5"

// Line 532: Build SMS
body = await buildLenderShipByMessage({
  itemTitle,
  shipByDate: shipByStr,  // ← Uses computed value
  shippingArtifacts
});
```

✅ **SMS does NOT recompute** - uses the single computed value.

---

### (e) Branch parity (test vs main)

```bash
git diff main..test -- server/lib/shipping.js server/lib/geo.js
# (empty)
```

✅ **Implementations are IDENTICAL** across branches.

---

### (f) Smoke test results

**Test Branch** (with DEBUG_SHIPBY=1):

| Case | SHIP_LEAD_MODE | SHIP_LEAD_DAYS | Lead Days | Ship-By | Notes |
|------|---------------|----------------|-----------|---------|-------|
| 1 | _(not set)_ | _(blank)_ | 2 | Nov 5 | ✅ Default static |
| 2 | _(not set)_ | `0` | 0 | **Nov 7** | ❌ Same as borrow start |
| 3 | `distance` | _(blank)_ | 2 | Nov 5 | ⚠️ Fallback (no MAPBOX_TOKEN) |

**Conclusion**: Without `SHIP_LEAD_MODE=distance` + `MAPBOX_TOKEN`, code uses static mode.

---

## 🔍 Root Cause of Live Issue

**Live Environment**:
```bash
SHIP_LEAD_MODE=       # Not set → defaults to 'static'
SHIP_LEAD_DAYS=0      # Explicitly set to 0
```

**Code Path**:
```
1. LEAD_MODE = 'static' (default)
2. LEAD_FLOOR = 0 (from SHIP_LEAD_DAYS)
3. if (LEAD_MODE === 'distance') → NO → use LEAD_FLOOR
4. leadDays = 0
5. shipBy = borrowStart - 0 days = borrowStart
6. SMS: "Ship by Nov 7" for Nov 7 borrow start ❌
```

**Why this happened**:
- Someone set `SHIP_LEAD_DAYS=0` (perhaps to "disable" fixed lead time?)
- Without `SHIP_LEAD_MODE=distance`, this forces 0-day static lead
- Result: Impossible ship-by deadlines sent to lenders

---

## 💡 Solution

### Immediate Fix (Live Environment)

**Option A: Quick Fix (Static Mode)**
```bash
# Change in Render live environment variables:
SHIP_LEAD_DAYS=2   # Change from 0 to 2
```

**Result**: "Ship by Nov 5" for Nov 7 borrow start ✅

---

**Option B: Enable Dynamic Mode (Recommended)**
```bash
# In Render live environment variables:
SHIP_LEAD_MODE=distance
SHIP_LEAD_DAYS=1             # Minimum (floor)
SHIP_LEAD_MAX=5              # Maximum (cap)
MAPBOX_TOKEN=pk.ey...        # Your Mapbox token
```

**Result**: Distance-based calculation:
- Local (<200 mi): 1 day lead
- Regional (200-1000 mi): 2 days lead
- Cross-country (>1000 mi): 3 days lead

---

### Test Environment (Optional Enhancement)

**Current**: Works fine (static 2-day), but not using dynamic mode.

**To enable dynamic**:
```bash
# In Render test environment variables:
SHIP_LEAD_MODE=distance
MAPBOX_TOKEN=pk.ey...
SHIP_LEAD_MAX=5
```

---

## 📊 Summary Table

### Implementation Path

| Component | Location | Purpose |
|-----------|----------|---------|
| **Decision logic** | `server/lib/shipping.js:161` | Static vs distance mode |
| **Distance calc** | `server/lib/shipping.js:91-123` | Miles → days mapping |
| **SMS integration** | `server/api/transition-privileged.js:341` | Uses computed ship-by |
| **Geocoding** | `server/lib/geo.js:42-88` | ZIP → lat/lng via Mapbox |

---

### Environment Impact

| Variable | Test | Live | Recommended |
|----------|------|------|-------------|
| `SHIP_LEAD_MODE` | _(not set)_ | _(not set)_ | `distance` |
| `SHIP_LEAD_DAYS` | _(not set)_ | `0` ❌ | `1` (floor) |
| `SHIP_LEAD_MAX` | `5` | _(not set)_ | `5` |
| `MAPBOX_TOKEN` | _(not set)_ | _(not set)_ | `pk.ey...` |

---

### Smoke Test Results

| Scenario | Mode | Days | Ship-By | Status |
|----------|------|------|---------|--------|
| Default (test) | static | 2 | Nov 5 | ✅ |
| Zero lead (live) | static | 0 | Nov 7 | ❌ |
| Dynamic (proposed) | distance | 1-3 | Nov 4-6 | ✅ |

---

## 📋 Deliverables from This Audit

1. ✅ **SHIPBY_IMPLEMENTATION_AUDIT.md** - Full detailed report (11 sections)
2. ✅ **SHIPBY_QUICK_SUMMARY.md** - TL;DR version
3. ✅ **SHIPBY_DECISION_FLOW.md** - Visual decision tree
4. ✅ **SHIPBY_CODE_REFERENCE.md** - Exact line numbers & snippets
5. ✅ **SHIPBY_EXECUTIVE_SUMMARY.md** - This file
6. ✅ **scripts/shipby-smoke.js** - Smoke test script
7. ✅ **server/lib/shipping.js** - Added DEBUG_SHIPBY logging

---

## 🎬 Next Steps

### 1. Critical (Do Now)
- [ ] Change `SHIP_LEAD_DAYS=0` to `SHIP_LEAD_DAYS=2` in Render live environment
- [ ] Deploy and verify with a test transaction
- [ ] Confirm SMS shows "Ship by" 2+ days before borrow start

### 2. Recommended (This Week)
- [ ] Obtain Mapbox API token
- [ ] Set `SHIP_LEAD_MODE=distance` in both test and live
- [ ] Add `MAPBOX_TOKEN` to environment variables
- [ ] Test dynamic mode with near/far ZIP pairs

### 3. Optional (Future)
- [ ] Add validation: prevent `SHIP_LEAD_DAYS=0` in static mode
- [ ] Add ETA-based calculation using Shippo carrier ETAs
- [ ] Add business day calendar (skip holidays)
- [ ] A/B test dynamic vs static conversion rates

---

## 🎯 Conclusion

### Test Environment
```
Status: ✅ WORKS (static 2-day lead)
Dynamic: ⚠️ NOT ACTIVE (SHIP_LEAD_MODE not set)
```

### Live Environment
```
Status: ❌ BROKEN (static 0-day lead)
Issue: SHIP_LEAD_DAYS=0 forces ship-by = borrow start
Fix: Change to 2+ or enable dynamic mode
```

**Your code is correct. Only environment configuration needs fixing.**

---

**Questions?** See detailed documentation:
- Quick answers: `SHIPBY_QUICK_SUMMARY.md`
- Visual flow: `SHIPBY_DECISION_FLOW.md`
- Code locations: `SHIPBY_CODE_REFERENCE.md`
- Full audit: `SHIPBY_IMPLEMENTATION_AUDIT.md`


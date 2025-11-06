# Ship-By Implementation Quick Summary

## TL;DR - Critical Finding

🚨 **Your dynamic ship-by code exists but is NOT active** because `SHIP_LEAD_MODE` is not set to `'distance'`.

- **Test env**: Static mode, 2-day lead → ✅ Works
- **Live env**: Static mode, **0-day lead** → ❌ **BROKEN** (ship-by = borrow date)

---

## (a) Where Ship-By is Computed

**File**: `server/lib/shipping.js`

```javascript
// Line 149: computeShipByDate() - main computation
// Line 196: computeShipBy() - wrapper with metadata (mode, leadDays, miles)
```

**Single source of truth**: All code paths (SMS, reminders, API) call these functions.

---

## (b) Whether Fixed SHIP_LEAD_DAYS is Forcing Behavior

**YES** - Here's how:

```javascript
// Lines 23-24
const LEAD_MODE = process.env.SHIP_LEAD_MODE || 'static';  // ← Defaults to 'static'!
const LEAD_FLOOR = Number(process.env.SHIP_LEAD_DAYS || 2);

// Line 161
if (LEAD_MODE === 'distance') {
  // Distance-based calculation (ONLY if SHIP_LEAD_MODE='distance')
} else {
  // Uses LEAD_FLOOR (from SHIP_LEAD_DAYS)
}
```

**The Problem**:
- If `SHIP_LEAD_MODE` is **not set** → defaults to `'static'` → uses `SHIP_LEAD_DAYS`
- Test: `SHIP_LEAD_DAYS=` (blank) → defaults to 2 ✅
- Live: `SHIP_LEAD_DAYS=0` → uses 0 ❌

---

## (c) How Distance-Based Days Are Mapped

**From `computeLeadDaysDynamic()` (lines 91-123)**:

| Distance | Days | With LEAD_FLOOR | With LEAD_MAX |
|----------|------|-----------------|---------------|
| ≤200 miles | 1 | `max(1, LEAD_FLOOR)` | `min(result, 5)` |
| 200-1000 miles | 2 | `max(2, LEAD_FLOOR)` | `min(result, 5)` |
| >1000 miles | 3 | `max(3, LEAD_FLOOR)` | `min(result, 5)` |

**Example**: 94107→10012 (SF→NYC, ~2900 miles) → 3 days (capped at LEAD_MAX=5)

**Dependencies**:
- Requires `SHIP_LEAD_MODE=distance`
- Requires `MAPBOX_TOKEN` for geocoding
- Falls back to `LEAD_FLOOR` if ZIPs missing or geocoding fails

---

## (d) What SMS Uses to Render "Ship by …"

**File**: `server/api/transition-privileged.js`

```javascript
// Line 341: Compute once
const computeResult = await computeShipBy(transaction, { preferLabelAddresses: false });
const { shipByDate, leadDays, miles, mode } = computeResult;

// Line 499: Format for display
const shipByStr = formatShipBy(shipByDate);  // e.g., "Nov 5"

// Line 532: Use in SMS
body = await buildLenderShipByMessage({
  itemTitle,
  shipByDate: shipByStr,
  shippingArtifacts
});
```

✅ **SMS does NOT recompute** - it uses the value from `computeShipBy()`.

---

## Test Results Summary

| Environment | SHIP_LEAD_MODE | SHIP_LEAD_DAYS | Actual Behavior | Status |
|-------------|---------------|----------------|-----------------|--------|
| **Test** | _(not set)_ | _(blank)_ | Static, 2-day lead | ✅ Works |
| **Live** | _(not set)_ | `0` | Static, **0-day lead** | ❌ **BROKEN** |

### Smoke Test Output (Test Branch)

```
Case 1: SHIP_LEAD_DAYS= (blank)
  Mode: static, Lead Days: 2, Ship-by: Nov 5 ✅

Case 2: SHIP_LEAD_DAYS=0
  Mode: static, Lead Days: 0, Ship-by: Nov 7 ❌ (same as borrow start!)

Case 3: SHIP_LEAD_MODE=distance (no MAPBOX_TOKEN)
  Mode: distance, Lead Days: 2 (fallback), Ship-by: Nov 5 ⚠️
```

---

## Conclusion by Environment

### Test Environment
```
Current: SHIP_LEAD_DAYS= (blank) → static mode, 2-day lead
Status: ✅ WORKS (but not dynamic)
```

**To enable dynamic**:
```bash
SHIP_LEAD_MODE=distance
MAPBOX_TOKEN=<your_token>
SHIP_LEAD_MAX=5
```

### Live Environment
```
Current: SHIP_LEAD_DAYS=0 → static mode, 0-day lead
Status: ❌ BROKEN - "Ship by Nov 7" for Nov 7 borrow start
```

**Immediate fix** (choose one):

**Option A**: Fix static mode (quick)
```bash
SHIP_LEAD_DAYS=2  # Change from 0 to 2
```

**Option B**: Enable dynamic mode (recommended)
```bash
SHIP_LEAD_MODE=distance
SHIP_LEAD_DAYS=  # Remove or blank (becomes floor only)
SHIP_LEAD_MAX=5
MAPBOX_TOKEN=<your_token>
```

---

## Branch Parity

```bash
git diff main..test -- server/lib/shipping.js server/lib/geo.js
# (empty - branches are identical)
```

✅ **Test and main have identical ship-by implementation**.

---

## Quick Diagnostic Commands

```bash
# Run smoke test (test branch)
DEBUG_SHIPBY=1 node scripts/shipby-smoke.js --borrow-start 2025-11-07 --origin 94107 --dest 10012

# Test with SHIP_LEAD_DAYS=0 (reproduces live issue)
DEBUG_SHIPBY=1 SHIP_LEAD_DAYS=0 node scripts/shipby-smoke.js --borrow-start 2025-11-07 --origin 94107 --dest 10012

# Test dynamic mode (requires MAPBOX_TOKEN)
DEBUG_SHIPBY=1 SHIP_LEAD_MODE=distance MAPBOX_TOKEN=<token> node scripts/shipby-smoke.js --borrow-start 2025-11-07 --origin 94107 --dest 10012
```

---

## Files Modified (This Audit)

1. `server/lib/shipping.js` - Added DEBUG_SHIPBY logging (lines 185-208)
2. `scripts/shipby-smoke.js` - New smoke test script
3. `SHIPBY_IMPLEMENTATION_AUDIT.md` - Full detailed report
4. `SHIPBY_QUICK_SUMMARY.md` - This file

**No production code changes required** - the implementation is correct. Only environment variable configuration needs fixing.

---

**Next Step**: Change `SHIP_LEAD_DAYS=0` to `SHIP_LEAD_DAYS=2` in live Render environment immediately.


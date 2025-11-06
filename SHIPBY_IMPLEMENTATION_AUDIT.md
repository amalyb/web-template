# Ship-By Implementation Audit Report

**Date**: November 5, 2025  
**Branches Audited**: `test` and `main`  
**Goal**: Verify dynamic ship-by implementation and identify why live environment shows incorrect dates

---

## Executive Summary

**Critical Finding**: Your codebase has dynamic ship-by logic implemented, but it is **NOT ACTIVE** in either test or live environments because `SHIP_LEAD_MODE` is not set to `'distance'`.

### Current Behavior by Environment

| Environment | SHIP_LEAD_MODE | SHIP_LEAD_DAYS | Result |
|-------------|---------------|----------------|---------|
| **Test (Render)** | _(not set → 'static')_ | _(blank → defaults to 2)_ | ✅ Static 2-day lead time |
| **Live (Render)** | _(not set → 'static')_ | `0` | ❌ **Static 0-day lead time** (ship-by = borrow date) |

**Root Cause**: Live environment has `SHIP_LEAD_DAYS=0`, which forces ship-by to equal the borrow start date (e.g., "Ship by Nov 7" for a Nov 7 booking), which is what you observed.

---

## 1. Implementation Path

### Primary Function
**File**: `server/lib/shipping.js`  
**Function**: `computeShipByDate()` (lines 149-211)  
**Wrapper**: `computeShipBy()` (lines 196-230) - returns metadata including `mode`, `leadDays`, `miles`

### Supporting Functions
- `computeLeadDaysDynamic()` (lines 91-123) - distance-based lead time calculation
- `resolveZipsFromTx()` (lines 48-79) - extracts origin/destination ZIPs
- `formatShipBy()` (line 232) - formats date as "Nov 5"

### Geolocation Support
**File**: `server/lib/geo.js`  
- `geocodeZip()` - uses Mapbox API (requires `MAPBOX_TOKEN`)
- `haversineMiles()` - calculates distance between coordinates

---

## 2. Mode Selection Logic

### Environment Variables (Lines 23-25)
```javascript
const LEAD_MODE = process.env.SHIP_LEAD_MODE || 'static';
const LEAD_FLOOR = Number(process.env.SHIP_LEAD_DAYS || 2);
const LEAD_MAX = Number(process.env.SHIP_LEAD_MAX || 5);
```

### Decision Tree (Lines 159-168)
```javascript
let leadDays = LEAD_FLOOR;

if (LEAD_MODE === 'distance') {
  const { fromZip, toZip } = await resolveZipsFromTx(tx, opts);
  console.log('[ship-by] zips', { fromZip, toZip });
  leadDays = await computeLeadDaysDynamic({ fromZip, toZip });
} else {
  // static (existing behavior)
  console.log('[ship-by:static]', { chosenLeadDays: leadDays });
}
```

### Critical Insight
The code **only uses dynamic mode if `SHIP_LEAD_MODE === 'distance'`**. There is no automatic detection based on whether `SHIP_LEAD_DAYS` is blank. If `SHIP_LEAD_MODE` is not set:
- Defaults to `'static'`
- Uses `LEAD_FLOOR` (from `SHIP_LEAD_DAYS` with fallback to 2)
- **Ignores distance entirely**

---

## 3. Distance-Based Mapping (When Active)

From `computeLeadDaysDynamic()` (lines 99-110):

| Distance | Raw Calculation | With Floor | With Max Cap |
|----------|----------------|------------|--------------|
| ≤200 miles | 1 day | `max(1, LEAD_FLOOR)` | `min(result, LEAD_MAX)` |
| 200-1000 miles | 2 days | `max(2, LEAD_FLOOR)` | `min(result, LEAD_MAX)` |
| >1000 miles | 3 days | `max(3, LEAD_FLOOR)` | `min(result, LEAD_MAX)` |

**Example**: With `SHIP_LEAD_DAYS=0` and `SHIP_LEAD_MAX=5`:
- 94107→94105 (near): 1 day  
- 94107→10012 (cross-country): 3 days  
- All capped at 5 days max

**Fallback**: If ZIPs are missing or geocoding fails → uses `LEAD_FLOOR`

---

## 4. SMS Integration

### Computation Location
**File**: `server/api/transition-privileged.js`  
**Lines**: 341-342

```javascript
const computeResult = await computeShipBy(transaction, { preferLabelAddresses: false });
const { shipByDate, leadDays, miles, mode } = computeResult;
```

### SMS Message Generation
**Lines**: 532-538

```javascript
body = await buildLenderShipByMessage({
  itemTitle,
  shipByDate: shipByStr,  // Uses formatShipBy(shipByDate)
  shippingArtifacts
});
```

### Verification
✅ **SMS uses the computed ship-by date** - no independent recalculation  
✅ **Single source of truth** - all code paths use `computeShipBy()`  
✅ **Reminder script** (`sendShipByReminders.js`) also uses centralized `computeShipByDate()`

---

## 5. Branch Parity

### Files Compared
- `server/lib/shipping.js`
- `server/lib/geo.js`
- `server/api/transition-privileged.js`

### Result
```bash
git diff main..test -- server/lib/shipping.js server/lib/geo.js
# (empty output)
```

✅ **Implementations are IDENTICAL** across test and main branches (excluding the DEBUG_SHIPBY logging added during this audit)

---

## 6. Smoke Test Results

### Test Branch (Current)

| Case | Env Vars | Lead Mode | Distance (mi) | Lead Days | Ship-By |
|------|----------|-----------|---------------|-----------|---------|
| 1. Near (default) | `SHIP_LEAD_DAYS=` (blank) | `static` | (not computed) | 2 | Nov 5 |
| 2. Far (default) | `SHIP_LEAD_DAYS=` (blank) | `static` | (not computed) | 2 | Nov 5 |
| 3. Explicit fixed | `SHIP_LEAD_DAYS=2` | `static` | (not computed) | 2 | Nov 5 |
| 4. Zero lead | `SHIP_LEAD_DAYS=0` | `static` | (not computed) | 0 | **Nov 7** |

### With Dynamic Mode (Test)

| Case | Env Vars | Lead Mode | Distance (mi) | Lead Days | Ship-By |
|------|----------|-----------|---------------|-----------|---------|
| 5. Dynamic fallback | `SHIP_LEAD_MODE=distance` (no token) | `distance` | (not computed) | 2 | Nov 5 |

**Note**: Without `MAPBOX_TOKEN`, distance mode falls back to `LEAD_FLOOR` (2 days by default).

---

## 7. Root Cause Analysis

### Test Environment (Render)
```bash
SHIP_LEAD_MODE=     # Not set → defaults to 'static'
SHIP_LEAD_DAYS=     # Not set → defaults to 2
SHIP_LEAD_MAX=5     # Set
```

**Result**: ✅ Static 2-day lead time (acceptable, but not dynamic)

### Live Environment (Render)
```bash
SHIP_LEAD_MODE=     # Not set → defaults to 'static'
SHIP_LEAD_DAYS=0    # Explicitly set to 0
```

**Result**: ❌ **Static 0-day lead time** → "Ship by Nov 7" for Nov 7 borrow start

### Why Live is Broken
- `SHIP_LEAD_DAYS=0` forces **0 lead days**
- Ship-by date calculation: `borrowStart - 0 days = borrowStart`
- SMS shows: "Ship by Nov 7" (same day as borrow start)
- Lenders receive impossible deadlines

---

## 8. Recommendations

### Immediate Fix (Live Environment)
**Option A**: Enable Dynamic Mode (Recommended)
```bash
# Render live environment variables
SHIP_LEAD_MODE=distance
SHIP_LEAD_DAYS=        # Remove or leave blank (becomes floor fallback only)
SHIP_LEAD_MAX=5
MAPBOX_TOKEN=<your_mapbox_token>   # Required for geocoding
```

**Option B**: Fix Static Mode (Quick Fix)
```bash
# Render live environment variables
SHIP_LEAD_MODE=static   # Explicit
SHIP_LEAD_DAYS=2        # Change from 0 to 2
SHIP_LEAD_MAX=5
```

### Code Enhancement (Optional - Not Required Now)
The current implementation is correct. However, for clarity, you could:

1. **Add explicit mode flag semantics** (already implemented correctly)
   - ✅ `SHIP_LEAD_MODE=distance` → use distance-based calculation
   - ✅ `SHIP_LEAD_MODE=static` → use `SHIP_LEAD_DAYS`

2. **Guard against SHIP_LEAD_DAYS=0 in static mode** (optional safety check)
   ```javascript
   const LEAD_FLOOR = Math.max(1, Number(process.env.SHIP_LEAD_DAYS || 2));
   ```
   This ensures minimum 1-day lead time in static mode.

3. **Add startup warning** (optional)
   ```javascript
   if (LEAD_MODE === 'distance' && !process.env.MAPBOX_TOKEN) {
     console.warn('[shipping] WARN: SHIP_LEAD_MODE=distance but no MAPBOX_TOKEN; will fall back to static floor');
   }
   ```
   (Already logs this in `geo.js` line 13-15)

---

## 9. Diagnostic Logging

### Added DEBUG_SHIPBY Flag
**File**: `server/lib/shipping.js` (lines 185-208)

```javascript
if (process.env.DEBUG_SHIPBY === '1') {
  console.info('[shipby] borrowStart=%s leadMode=%s fixedLeadDays=%s distanceMi=%s dynamicDays=%s chosenDays=%s shipBy=%s',
    startISO,
    LEAD_MODE,
    LEAD_MODE === 'static' ? leadDays : null,
    distanceMiles !== null ? Math.round(distanceMiles) : null,
    LEAD_MODE === 'distance' ? leadDays : null,
    leadDays,
    adjusted.toISOString()
  );
}
```

### Usage
```bash
# Enable diagnostic logging
DEBUG_SHIPBY=1 node server/index.js

# Or in Render environment variables
DEBUG_SHIPBY=1
```

### Smoke Test Script
**File**: `scripts/shipby-smoke.js`

```bash
# Test default behavior
DEBUG_SHIPBY=1 node scripts/shipby-smoke.js --borrow-start 2025-11-07 --origin 94107 --dest 94105

# Test with explicit SHIP_LEAD_DAYS
DEBUG_SHIPBY=1 SHIP_LEAD_DAYS=0 node scripts/shipby-smoke.js --borrow-start 2025-11-07 --origin 94107 --dest 10012

# Test dynamic mode (requires MAPBOX_TOKEN)
DEBUG_SHIPBY=1 SHIP_LEAD_MODE=distance MAPBOX_TOKEN=<token> node scripts/shipby-smoke.js --borrow-start 2025-11-07 --origin 94107 --dest 10012
```

---

## 10. Conclusion

### Summary by Environment

#### Test (Render) - Current State
```
Environment: SHIP_LEAD_DAYS= (blank), SHIP_LEAD_MAX=5
Actual Behavior: Static mode, 2-day lead time (code default)
Expected: ✅ Works, but not using dynamic distance-based calculation
```

**Verdict**: Functional but not optimal. To enable dynamic mode, set `SHIP_LEAD_MODE=distance` and provide `MAPBOX_TOKEN`.

#### Live (Render) - Current State
```
Environment: SHIP_LEAD_DAYS=0
Actual Behavior: Static mode, 0-day lead time
Expected: ❌ BROKEN - ship-by equals borrow start date
```

**Verdict**: **Critical issue**. `SHIP_LEAD_DAYS=0` forces same-day shipping deadlines. Change to `SHIP_LEAD_DAYS=2` immediately or enable dynamic mode.

---

## 11. Action Items

### Critical (Do Immediately)
1. ✅ **Fix live environment**: Change `SHIP_LEAD_DAYS=0` to `SHIP_LEAD_DAYS=2` (or enable dynamic mode)
2. ✅ **Verify fix**: Deploy and test with a real transaction
3. ✅ **Monitor logs**: Enable `DEBUG_SHIPBY=1` temporarily to confirm behavior

### Recommended (Next Steps)
1. ⚠️ **Enable dynamic mode** in both test and live:
   - Set `SHIP_LEAD_MODE=distance`
   - Provide `MAPBOX_TOKEN`
   - Test with various ZIP pairs
2. ⚠️ **Document environment variables** in your deployment guide
3. ⚠️ **Add validation** to prevent `SHIP_LEAD_DAYS=0` in static mode (optional)

### Optional (Future Enhancement)
1. 💡 **Add ETA-based calculation**: Use Shippo carrier ETAs instead of distance buckets
2. 💡 **Add business day logic**: Skip weekends/holidays in lead time calculation (partially implemented for Sundays)
3. 💡 **A/B test**: Compare dynamic vs static mode conversion rates

---

## Appendix: Environment Variable Reference

| Variable | Values | Default | Purpose |
|----------|--------|---------|---------|
| `SHIP_LEAD_MODE` | `'static'` \| `'distance'` | `'static'` | Selects fixed vs distance-based calculation |
| `SHIP_LEAD_DAYS` | `0-N` | `2` | Fixed lead days (static mode) or floor (distance mode) |
| `SHIP_LEAD_MAX` | `1-N` | `5` | Maximum lead days (caps distance calculations) |
| `MAPBOX_TOKEN` | API key | _(none)_ | Required for `SHIP_LEAD_MODE=distance` |
| `DEBUG_SHIPBY` | `'1'` \| _(unset)_ | _(unset)_ | Enable structured logging for ship-by calculations |
| `SHIP_ADJUST_SUNDAY` | `'1'` \| `'0'` | `'1'` | Move Sunday ship-by to Saturday |

---

**Report generated by**: Cursor AI Assistant  
**Audit artifacts**:
- Diagnostic logging added to `server/lib/shipping.js`
- Smoke test script: `scripts/shipby-smoke.js`
- Test results captured above

**Next**: Apply critical fix to live environment and verify with smoke tests.


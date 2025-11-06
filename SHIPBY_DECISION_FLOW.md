# Ship-By Decision Flow - Code Path Visualization

## Decision Tree

```
┌─────────────────────────────────────────────────┐
│  computeShipByDate() called                     │
│  server/lib/shipping.js:149                     │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  Read environment variables:                    │
│  • SHIP_LEAD_MODE (default: 'static')          │
│  • SHIP_LEAD_DAYS (default: 2)                 │
│  • SHIP_LEAD_MAX  (default: 5)                 │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
           ┌──────────────┐
           │ LEAD_MODE == │
           │ 'distance' ? │
           └──────┬───────┘
                  │
         ┌────────┴────────┐
         │                 │
      YES│                 │NO
         │                 │
         ▼                 ▼
┌─────────────────┐  ┌─────────────────┐
│ DISTANCE MODE   │  │  STATIC MODE    │
├─────────────────┤  ├─────────────────┤
│ 1. Get ZIPs     │  │ leadDays =      │
│    from TX      │  │ LEAD_FLOOR      │
│ 2. Geocode via  │  │                 │
│    Mapbox       │  │ (SHIP_LEAD_DAYS)│
│ 3. Calculate    │  └────────┬────────┘
│    distance     │           │
│ 4. Map to days: │           │
│    ≤200mi: 1d   │           │
│    ≤1000mi: 2d  │           │
│    >1000mi: 3d  │           │
│ 5. Apply floor  │           │
│    & max cap    │           │
└────────┬────────┘           │
         │                    │
         └──────────┬─────────┘
                    │
                    ▼
         ┌──────────────────┐
         │ Calculate date:  │
         │ borrowStart      │
         │ - leadDays       │
         └─────────┬────────┘
                   │
                   ▼
         ┌─────────────────┐
         │ Adjust if       │
         │ Sunday?         │
         │ (move to Sat)   │
         └─────────┬───────┘
                   │
                   ▼
         ┌─────────────────┐
         │ Return shipBy   │
         │ Date object     │
         └─────────────────┘
```

---

## Current Configuration Analysis

### Test Environment (Render)

```
Input:
  SHIP_LEAD_MODE = (not set)
  SHIP_LEAD_DAYS = (not set)
  SHIP_LEAD_MAX  = 5

Resolved:
  LEAD_MODE      = 'static'  ← defaults
  LEAD_FLOOR     = 2         ← defaults
  LEAD_MAX       = 5

Decision Path:
  ┌─────────────────┐
  │ LEAD_MODE ==    │
  │ 'distance'?     │
  └────┬────────────┘
       │
       NO (it's 'static')
       │
       ▼
  ┌─────────────────┐
  │ Use LEAD_FLOOR  │
  │ leadDays = 2    │
  └────┬────────────┘
       │
       ▼
  ┌─────────────────────┐
  │ borrowStart - 2 days│
  │ Nov 7 → Nov 5       │
  └─────────────────────┘

Result: ✅ "Ship by Nov 5" (works, but not dynamic)
```

### Live Environment (Render)

```
Input:
  SHIP_LEAD_MODE = (not set)
  SHIP_LEAD_DAYS = 0         ← PROBLEM!
  SHIP_LEAD_MAX  = (not set)

Resolved:
  LEAD_MODE      = 'static'  ← defaults
  LEAD_FLOOR     = 0         ← uses SHIP_LEAD_DAYS=0
  LEAD_MAX       = 5         ← defaults

Decision Path:
  ┌─────────────────┐
  │ LEAD_MODE ==    │
  │ 'distance'?     │
  └────┬────────────┘
       │
       NO (it's 'static')
       │
       ▼
  ┌─────────────────┐
  │ Use LEAD_FLOOR  │
  │ leadDays = 0    │ ← ZERO DAYS!
  └────┬────────────┘
       │
       ▼
  ┌─────────────────────┐
  │ borrowStart - 0 days│
  │ Nov 7 → Nov 7       │ ← SAME DAY
  └─────────────────────┘

Result: ❌ "Ship by Nov 7" (impossible - same as borrow start!)
```

### Proposed Fix: Dynamic Mode

```
Input:
  SHIP_LEAD_MODE = 'distance'  ← SET THIS
  SHIP_LEAD_DAYS = (blank)
  SHIP_LEAD_MAX  = 5
  MAPBOX_TOKEN   = <token>     ← REQUIRED

Resolved:
  LEAD_MODE      = 'distance'
  LEAD_FLOOR     = 2 (fallback)
  LEAD_MAX       = 5

Decision Path:
  ┌─────────────────┐
  │ LEAD_MODE ==    │
  │ 'distance'?     │
  └────┬────────────┘
       │
       YES ← Takes this path now!
       │
       ▼
  ┌──────────────────────────┐
  │ Get ZIPs from TX:        │
  │ providerZip: 94107       │
  │ customerZip: 10012       │
  └────┬─────────────────────┘
       │
       ▼
  ┌──────────────────────────┐
  │ Geocode via Mapbox:      │
  │ 94107: 37.76, -122.39    │
  │ 10012: 40.75, -74.00     │
  └────┬─────────────────────┘
       │
       ▼
  ┌──────────────────────────┐
  │ Calculate distance:      │
  │ haversine = 2567 miles   │
  └────┬─────────────────────┘
       │
       ▼
  ┌──────────────────────────┐
  │ Map to days:             │
  │ >1000 miles → 3 days     │
  │ max(3, LEAD_FLOOR=2) = 3 │
  │ min(3, LEAD_MAX=5) = 3   │
  └────┬─────────────────────┘
       │
       ▼
  ┌─────────────────────┐
  │ borrowStart - 3 days│
  │ Nov 7 → Nov 4       │
  └─────────────────────┘

Result: ✅ "Ship by Nov 4" (dynamic, distance-based)
```

---

## Code Snippets - Exact Decision Points

### 1. Mode Selection (Line 161)

```javascript
if (LEAD_MODE === 'distance') {
  const { fromZip, toZip } = await resolveZipsFromTx(tx, opts);
  console.log('[ship-by] zips', { fromZip, toZip });
  leadDays = await computeLeadDaysDynamic({ fromZip, toZip });
} else {
  // static (existing behavior)
  console.log('[ship-by:static]', { chosenLeadDays: leadDays });
}
```

**Key**: No automatic detection. It's a hard switch based on `SHIP_LEAD_MODE`.

### 2. Distance Mapping (Lines 99-110)

```javascript
let lead = LEAD_FLOOR;
if (miles <= 200) {
  lead = Math.max(1, LEAD_FLOOR);
} else if (miles <= 1000) {
  lead = Math.max(2, LEAD_FLOOR);
} else {
  lead = Math.max(3, LEAD_FLOOR);
}

// Cap to LEAD_MAX
lead = Math.min(lead, LEAD_MAX);
```

**Key**: Distance buckets are simple and tuneable. `LEAD_FLOOR` ensures minimum, `LEAD_MAX` caps maximum.

### 3. Date Calculation (Line 171)

```javascript
const shipBy = new Date(start);
shipBy.setUTCDate(shipBy.getUTCDate() - leadDays);
```

**Key**: Simple subtraction. `leadDays=0` → `shipBy = start` (the bug in live).

---

## Environment Variable Impact Matrix

| Var | Not Set | Blank (`=`) | `0` | `2` | `'distance'` |
|-----|---------|-------------|-----|-----|--------------|
| **SHIP_LEAD_MODE** | → `'static'` | → `'static'` | → `'static'` | → `'static'` | → `'distance'` |
| **SHIP_LEAD_DAYS** | → `2` (default) | → `2` (default) | → `0` ⚠️ | → `2` ✅ | → floor only |
| **SHIP_LEAD_MAX** | → `5` (default) | → `5` (default) | → `0` ⚠️ | → `2` | → caps dynamic |

### Dangerous Combinations

❌ `SHIP_LEAD_DAYS=0` + `SHIP_LEAD_MODE=(not set)`  
→ Static mode, 0-day lead (ship-by = borrow start)

❌ `SHIP_LEAD_MODE=distance` + no `MAPBOX_TOKEN`  
→ Falls back to `LEAD_FLOOR`, but logs warning

⚠️ `SHIP_LEAD_MODE=(not set)` + `SHIP_LEAD_DAYS=(blank)`  
→ Works (static, 2-day), but not dynamic

### Recommended Combinations

✅ **Static Mode** (simple, predictable):
```bash
SHIP_LEAD_MODE=static
SHIP_LEAD_DAYS=2
```

✅ **Dynamic Mode** (distance-based, optimal):
```bash
SHIP_LEAD_MODE=distance
SHIP_LEAD_DAYS=1        # floor (minimum)
SHIP_LEAD_MAX=5         # cap (maximum)
MAPBOX_TOKEN=<token>    # required
```

---

## Tracing a Real Transaction

Let's trace a transaction with `borrowStart=2025-11-07`, `providerZip=94107`, `customerZip=10012`:

### Current Live (BROKEN)

```
1. computeShipByDate() called
   └─> LEAD_MODE = 'static' (not set → defaults)
   └─> LEAD_FLOOR = 0 (SHIP_LEAD_DAYS=0)

2. if (LEAD_MODE === 'distance')? NO → goto static path
   └─> leadDays = LEAD_FLOOR = 0

3. shipBy = 2025-11-07 - 0 days = 2025-11-07
   
4. formatShipBy(2025-11-07) → "Nov 7"

5. SMS: "Ship by Nov 7" ← SAME AS BORROW START ❌
```

### Proposed Dynamic (FIXED)

```
1. computeShipByDate() called
   └─> LEAD_MODE = 'distance' (explicitly set)
   └─> LEAD_FLOOR = 2 (fallback)
   └─> LEAD_MAX = 5 (cap)

2. if (LEAD_MODE === 'distance')? YES → goto distance path

3. resolveZipsFromTx()
   └─> fromZip = '94107' (lender)
   └─> toZip = '10012' (borrower)

4. computeLeadDaysDynamic()
   └─> geocodeZip('94107') → {lat: 37.76, lng: -122.39}
   └─> geocodeZip('10012') → {lat: 40.75, lng: -74.00}
   └─> haversineMiles() → 2567 miles
   └─> miles > 1000 → base = 3 days
   └─> max(3, LEAD_FLOOR=2) = 3
   └─> min(3, LEAD_MAX=5) = 3
   └─> leadDays = 3

5. shipBy = 2025-11-07 - 3 days = 2025-11-04

6. formatShipBy(2025-11-04) → "Nov 4"

7. SMS: "Ship by Nov 4" ← 3 DAYS BEFORE BORROW START ✅
```

---

## Summary

| Environment | Path Taken | Lead Days | Ship-By | Status |
|-------------|-----------|-----------|---------|--------|
| Test | Static (default) | 2 | Nov 5 | ✅ Works |
| Live | Static (SHIP_LEAD_DAYS=0) | 0 | Nov 7 | ❌ Broken |
| Proposed | Dynamic (w/ token) | 3 (distance) | Nov 4 | ✅ Optimal |

**Root Cause**: Missing `SHIP_LEAD_MODE=distance` + incorrect `SHIP_LEAD_DAYS=0` in live.

**Fix**: Set `SHIP_LEAD_MODE=distance` and provide `MAPBOX_TOKEN`, or change `SHIP_LEAD_DAYS` to 2+.


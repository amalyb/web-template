# Ship-By Code Reference - Exact Locations

## Quick Lookup Table

| What | File | Lines | Function |
|------|------|-------|----------|
| **Main ship-by computation** | `server/lib/shipping.js` | 149-211 | `computeShipByDate()` |
| **Metadata wrapper** | `server/lib/shipping.js` | 196-230 | `computeShipBy()` |
| **Mode selection logic** | `server/lib/shipping.js` | 161-168 | _(inside computeShipByDate)_ |
| **Distance calculation** | `server/lib/shipping.js` | 91-123 | `computeLeadDaysDynamic()` |
| **ZIP resolution** | `server/lib/shipping.js` | 48-79 | `resolveZipsFromTx()` |
| **Date formatting** | `server/lib/shipping.js` | 232-243 | `formatShipBy()` |
| **Environment variables** | `server/lib/shipping.js` | 23-25 | _(module-level constants)_ |
| **Geocoding** | `server/lib/geo.js` | 42-88 | `geocodeZip()` |
| **Distance formula** | `server/lib/geo.js` | 23-34 | `haversineMiles()` |
| **SMS integration** | `server/api/transition-privileged.js` | 341-342 | _(inside transition handler)_ |
| **SMS message builder** | `server/lib/sms/buildLenderShipByMessage.js` | 47-96 | `buildLenderShipByMessage()` |
| **Reminder script** | `server/scripts/sendShipByReminders.js` | 158-171 | _(inside sendShipByReminders)_ |

---

## Code Snippets by Location

### 1. Environment Variable Setup (Lines 23-25)

```javascript
// server/lib/shipping.js
const LEAD_MODE = process.env.SHIP_LEAD_MODE || 'static';
const LEAD_FLOOR = Number(process.env.SHIP_LEAD_DAYS || 2);
const LEAD_MAX = Number(process.env.SHIP_LEAD_MAX || 5);
```

**Variables Used**:
- `SHIP_LEAD_MODE`: `'static'` | `'distance'` (default: `'static'`)
- `SHIP_LEAD_DAYS`: Number (default: 2)
- `SHIP_LEAD_MAX`: Number (default: 5)

---

### 2. Mode Selection Decision (Lines 161-168)

```javascript
// server/lib/shipping.js - inside computeShipByDate()
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

**Decision Point**: Hard switch on `LEAD_MODE`. No automatic detection.

---

### 3. Distance-to-Days Mapping (Lines 99-110)

```javascript
// server/lib/shipping.js - inside computeLeadDaysDynamic()
// Buckets (tuneable): ≤200mi:1d, 200–1000mi:2d, >1000mi:3d
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

**Tuning Points**:
- Change `200`, `1000` thresholds for different buckets
- Change `1`, `2`, `3` base days for each bucket
- `LEAD_FLOOR` ensures minimum (e.g., always at least 1 or 2 days)
- `LEAD_MAX` caps maximum (e.g., never more than 5 days)

---

### 4. Ship-By Date Calculation (Line 171)

```javascript
// server/lib/shipping.js - inside computeShipByDate()
const shipBy = new Date(start);
shipBy.setUTCDate(shipBy.getUTCDate() - leadDays);
```

**Formula**: `shipBy = borrowStart - leadDays`

**Example**:
- `borrowStart = 2025-11-07`, `leadDays = 2` → `shipBy = 2025-11-05`
- `borrowStart = 2025-11-07`, `leadDays = 0` → `shipBy = 2025-11-07` ⚠️

---

### 5. Sunday Adjustment (Lines 174-183)

```javascript
// server/lib/shipping.js - inside computeShipByDate()
const ADJUST_SUNDAY = String(process.env.SHIP_ADJUST_SUNDAY || '1') === '1';
const adjusted = ADJUST_SUNDAY ? adjustIfSundayUTC(shipBy) : shipBy;

if (ADJUST_SUNDAY && adjusted.getTime() !== shipBy.getTime()) {
  console.log('[ship-by:adjust]', {
    originalISO: shipBy.toISOString(),
    adjustedISO: adjusted.toISOString(),
    reason: 'sunday_to_saturday',
  });
}
```

**Behavior**: If ship-by falls on Sunday, move to Saturday (assumes no Sunday shipping).

---

### 6. Debug Logging (Lines 185-208) - NEW

```javascript
// server/lib/shipping.js - inside computeShipByDate()
// DEBUG_SHIPBY structured logging (guarded)
if (process.env.DEBUG_SHIPBY === '1') {
  const { fromZip, toZip } = await resolveZipsFromTx(tx, opts);
  let distanceMiles = null;
  if (LEAD_MODE === 'distance' && fromZip && toZip) {
    try {
      const [fromLL, toLL] = await Promise.all([geocodeZip(fromZip), geocodeZip(toZip)]);
      if (fromLL && toLL) {
        distanceMiles = haversineMiles([fromLL.lat, fromLL.lng], [toLL.lat, toLL.lng]);
      }
    } catch (e) {
      // ignore
    }
  }
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

**Usage**: Set `DEBUG_SHIPBY=1` to see detailed logging of every ship-by calculation.

---

### 7. SMS Integration (Lines 341-342, 499, 532-538)

```javascript
// server/api/transition-privileged.js - inside label purchase flow
// STEP 1: Compute ship-by ONCE
const computeResult = await computeShipBy(transaction, { preferLabelAddresses: false });
const { shipByDate, leadDays, miles, mode } = computeResult;

// ... (rate selection, label purchase) ...

// STEP 2: Format for SMS
const shipByStr = formatShipBy(shipByDate);

// STEP 3: Build SMS message
body = await buildLenderShipByMessage({
  itemTitle,
  shipByDate: shipByStr,  // e.g., "Nov 5"
  shippingArtifacts
});

// STEP 4: Send SMS
await sendSMS(lenderPhone, body, { ... });
```

**Key**: SMS uses the **already-computed** ship-by date. No recalculation.

---

### 8. Geocoding (Lines 42-88)

```javascript
// server/lib/geo.js
async function geocodeZip(zip) {
  if (!zip) return null;
  const key = String(zip).trim();
  if (_zipCache.has(key)) {
    return _zipCache.get(key);
  }

  if (!MAPBOX_TOKEN) {
    // No geocoding possible; return null to trigger fallback
    return null;
  }

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      key
    )}.json?types=postcode&limit=1&access_token=${MAPBOX_TOKEN}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    // ... parse response and cache ...
  } catch (err) {
    console.warn(`[geo] Geocoding error for ${key}:`, err.message);
    return null;
  }
}
```

**Dependencies**:
- Requires `MAPBOX_TOKEN` environment variable
- Uses in-memory cache to avoid repeated API calls
- Falls back gracefully (returns `null`) if token missing or API fails

---

## Grep Patterns for Finding References

```bash
# Find all ship-by computation calls
rg -n "computeShipBy|computeShipByDate" server/ src/

# Find all SMS ship-by message usage
rg -n "buildLenderShipByMessage|Ship by|shipByDate" server/ src/

# Find all environment variable references
rg -n "SHIP_LEAD_MODE|SHIP_LEAD_DAYS|SHIP_LEAD_MAX" server/ src/

# Find distance calculation usage
rg -n "computeLeadDaysDynamic|haversineMiles|geocodeZip" server/

# Find reminder script references
rg -n "sendShipByReminders" server/scripts/
```

---

## Testing Entry Points

### 1. Unit Test (Smoke Script)
```bash
# File: scripts/shipby-smoke.js
DEBUG_SHIPBY=1 node scripts/shipby-smoke.js \
  --borrow-start 2025-11-07 \
  --origin 94107 \
  --dest 10012
```

### 2. Integration Test
```bash
# Create a test transaction
# In your test suite or via API:
POST /api/transition/{txId}/transition/transition/accept
# → Triggers computeShipBy() in transition-privileged.js
```

### 3. Reminder Script Test
```bash
# File: server/scripts/sendShipByReminders.js
source .env.test && DIAG=1 DRY_RUN=1 node server/scripts/sendShipByReminders.js
```

---

## Common Issues and Fixes

### Issue 1: Ship-by = Borrow Start (0-day lead)

**Symptom**: "Ship by Nov 7" for Nov 7 borrow start

**Cause**: `SHIP_LEAD_DAYS=0` in static mode

**Fix**:
```bash
# Option A: Use static mode with non-zero days
SHIP_LEAD_DAYS=2

# Option B: Use dynamic mode
SHIP_LEAD_MODE=distance
MAPBOX_TOKEN=<token>
```

### Issue 2: Dynamic Mode Not Working

**Symptom**: `SHIP_LEAD_MODE=distance` but still using static 2-day lead

**Cause**: Missing `MAPBOX_TOKEN` or geocoding failures

**Check**:
```bash
# Look for this log at startup:
[geo] MAPBOX_TOKEN not set; distance mode will fall back to static

# Or during computation:
[ship-by] distance mode fallback: <error message>
```

**Fix**:
```bash
MAPBOX_TOKEN=pk.ey...  # Your Mapbox public token
```

### Issue 3: Wrong ZIPs Used

**Symptom**: Distance calculation uses wrong ZIPs

**Cause**: ZIPs not saved to transaction protectedData at accept/booking

**Check**:
```bash
# Enable logging
DEBUG_SHIPBY=1

# Look for:
[ship-by] PD zips {
  providerZip: '94107',  # ← Should be lender ZIP
  customerZip: '10012',  # ← Should be borrower ZIP
  usedFrom: '94107',
  usedTo: '10012'
}
```

**Fix**: Ensure `providerZip` and `customerZip` are saved during accept/booking transitions.

---

## Files Modified During This Audit

| File | Change | Purpose |
|------|--------|---------|
| `server/lib/shipping.js` | Added DEBUG_SHIPBY logging (lines 185-208) | Diagnostic visibility |
| `scripts/shipby-smoke.js` | New file | Quick smoke testing |
| `SHIPBY_IMPLEMENTATION_AUDIT.md` | New file | Full detailed report |
| `SHIPBY_QUICK_SUMMARY.md` | New file | TL;DR version |
| `SHIPBY_DECISION_FLOW.md` | New file | Visual decision tree |
| `SHIPBY_CODE_REFERENCE.md` | New file (this) | Code location reference |

---

**Next**: Apply environment variable fixes and test in staging/live.


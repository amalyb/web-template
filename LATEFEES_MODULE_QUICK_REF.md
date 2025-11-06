# lateFees Module - Quick Reference

**File:** `server/lib/lateFees.js`  
**Lines:** 319  
**Export:** `{ applyCharges }`

---

## 🚀 Quick Start

```javascript
const { applyCharges } = require('./lib/lateFees');

const result = await applyCharges({
  sdkInstance: sdk,      // Flex SDK instance
  txId: 'abc-123-...',   // Transaction UUID
  now: new Date()        // Current time (or FORCE_NOW for testing)
});

if (result.charged) {
  console.log(`Charged: ${result.items.join(', ')}`);
} else {
  console.log(`Skipped: ${result.reason}`);
}
```

---

## 📋 Return Values

### Success (Charges Applied)
```javascript
{
  charged: true,
  items: ['late-fee', 'replacement'],
  amounts: [
    { code: 'late-fee', cents: 1500 },
    { code: 'replacement', cents: 12000 }
  ],
  lateDays: 5
}
```

### No-Op (Nothing to Charge)
```javascript
{
  charged: false,
  reason: 'already-scanned',  // or 'not-overdue', 'no-op'
  lateDays: 3,
  scannedAt: '2025-11-10T15:30:00.000Z'
}
```

---

## 🔍 Charge Logic

| Condition | Charge | Amount |
|-----------|--------|--------|
| Day 1+ late, not charged today | Late fee | $15 |
| Day 2+ late, not charged today | Late fee | $15 |
| Day 3+ late, not charged today | Late fee | $15 |
| Day 4+ late, not charged today | Late fee | $15 |
| Day 5+ late, not scanned, not charged before | Late fee + Replacement | $15 + listing value |

**Stops Charging:**
- ✅ Package scanned by carrier (`firstScanAt` or status `accepted`/`in_transit`)
- ✅ Already charged today (idempotency)
- ✅ Replacement already charged (one-time only)

---

## 🔐 Idempotency

**Late Fees:** Max 1 charge per day
- Tracked by: `protectedData.return.lastLateFeeDayCharged` (YYYY-MM-DD)
- Example: `'2025-11-09'`

**Replacement:** Max 1 charge ever
- Tracked by: `protectedData.return.replacementCharged` (boolean)
- Example: `true`

**Audit Trail:**
```javascript
protectedData.return.chargeHistory = [
  {
    date: '2025-11-09',
    items: [{ code: 'late-fee', amount: 1500 }],
    timestamp: '2025-11-09T17:00:00.000Z'
  },
  // ...
]
```

---

## 📊 Configuration

```javascript
const TZ = 'America/Los_Angeles';  // Timezone for date calculations
const LATE_FEE_CENTS = 1500;       // $15/day
```

**To Change:**
- Edit constants at top of file
- All calculations use these values

---

## 🧪 Testing

### Time-Travel Testing
```javascript
const result = await applyCharges({
  sdkInstance: sdk,
  txId: 'abc-123',
  now: '2025-11-13T10:00:00.000Z'  // Day 5 overdue
});
```

### DRY_RUN Mode
```javascript
// In sendOverdueReminders.js
if (DRY_RUN) {
  console.log('[DRY_RUN] Would call applyCharges:', { txId, now });
  return;
}
const result = await applyCharges({ sdkInstance, txId, now });
```

---

## 🚨 Error Handling

**Throws on:**
- Transaction not found
- Listing not found
- Missing return due date
- Missing replacement value
- Flex API errors

**Error Format:**
```javascript
Error: Failed to apply late fees for transaction abc-123: No replacement value found
  .txId = 'abc-123'
  .timestamp = '2025-11-09T17:00:00.000Z'
  .originalError = [underlying error]
```

---

## 📖 Dependencies

- ✅ `dayjs` with `utc` and `timezone` plugins
- ✅ Flex SDK instance (Integration or trusted)
- ✅ Process.edn transition: `:transition/privileged-apply-late-fees`

---

## 🔗 Integration

**Called By:**
- `server/scripts/sendOverdueReminders.js`

**Calls:**
- `sdkInstance.transactions.show({ id, include: ['listing'] })`
- `sdkInstance.transactions.transition({ id, transition, params })`

**Reads From:**
- `transaction.attributes.protectedData.return.*`
- `transaction.attributes.booking.end`
- `listing.attributes.publicData.*`

**Writes To:**
- `transaction.attributes.protectedData.return.lastLateFeeDayCharged`
- `transaction.attributes.protectedData.return.replacementCharged`
- `transaction.attributes.protectedData.return.chargeHistory[]`

---

## 💡 Tips

1. **Always pass `now`** for consistent testing (don't rely on `Date.now()`)
2. **Check `result.charged`** before logging success
3. **Log `result.reason`** when charges skipped for debugging
4. **Set replacement value** in listing publicData before Day 5

---

## ✅ Status

- ✅ Created: 319 lines
- ✅ Linter: No errors
- ✅ JSDoc: All functions documented
- ✅ Ready for integration into sendOverdueReminders.js

---

**Next:** Step 3 - Integrate into `sendOverdueReminders.js`


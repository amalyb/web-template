# Time Travel & Testing Overrides

## Overview

The Sherbrt reminder system supports "time travel" testing via environment variables. This allows you to test time-dependent logic (reminders, scheduling, timestamps) without waiting for real time to pass.

## Environment Variables

### `FORCE_NOW`

Override the current timestamp for all time operations.

**Format:** ISO 8601 timestamp  
**Example:** `2025-01-15T09:30:00.000Z` or `2025-01-15T09:30:00-08:00`

**Affects:**
- `getNow()` - Returns the forced timestamp
- `timestamp()` - Returns the forced timestamp in ISO format
- `isMorningOf()` - Uses forced time for hour checks
- `getNext9AM()` - Calculates next 9 AM from forced time
- All transaction/webhook timestamps

**Usage:**
```bash
export FORCE_NOW=2025-01-15T09:30:00.000Z
node server/scripts/sendShipByReminders.js
```

### `FORCE_TODAY`

Override today's date (YYYY-MM-DD format).

**Format:** `YYYY-MM-DD`  
**Example:** `2025-01-15`

**Affects:**
- `getToday()` - Returns the forced date
- All reminder date calculations

**Usage:**
```bash
export FORCE_TODAY=2025-01-15
node server/scripts/sendShipByReminders.js
```

**Note:** If both `FORCE_NOW` and `FORCE_TODAY` are set, `FORCE_TODAY` takes precedence for `getToday()`.

### `FORCE_TOMORROW`

Override tomorrow's date (YYYY-MM-DD format).

**Format:** `YYYY-MM-DD`  
**Example:** `2025-01-16`

**Affects:**
- `getTomorrow()` - Returns the forced date
- Return reminder calculations

**Usage:**
```bash
export FORCE_TOMORROW=2025-01-16
node server/scripts/sendReturnReminders.js
```

**Note:** If both `FORCE_NOW` and `FORCE_TOMORROW` are set, `FORCE_TOMORROW` takes precedence for `getTomorrow()`.

### `TZ` (Optional)

Set the timezone for the application.

**Default:** `America/Los_Angeles`  
**Format:** IANA timezone identifier  
**Example:** `America/New_York`, `Europe/London`

**Note:** Currently documented but not fully utilized. The codebase uses UTC for most calculations.

---

## Testing Scenarios

### Scenario 1: Test Ship-By Reminder (t-24)

Test that a reminder is sent 24 hours before the ship-by date.

**Setup:**
```bash
export FORCE_TODAY=2025-01-18
export FORCE_NOW=2025-01-18T10:00:00.000Z
```

**Expected:** Transaction with `shipByDate=2025-01-19` should trigger t-24 reminder.

**Verification:**
```bash
node server/scripts/sendShipByReminders.js
# Look for log: [SMS][shipby_t24_to_lender] link=... strategy=... txId=...
```

### Scenario 2: Test Return Reminder (t-1)

Test that a reminder is sent 1 day before the return is due.

**Setup:**
```bash
export FORCE_TODAY=2025-01-20
export FORCE_TOMORROW=2025-01-21
```

**Expected:** Transaction with `deliveryEnd=2025-01-21` should trigger t-1 return reminder.

**Verification:**
```bash
node server/scripts/sendReturnReminders.js
# Look for log: [TIME] now=... today=2025-01-20 tomorrow=2025-01-21
```

### Scenario 3: Test Overdue Reminder (Day 5)

Test that an overdue reminder is sent on the 5th day after the return date.

**Setup:**
```bash
export FORCE_TODAY=2025-01-25
```

**Expected:** Transaction with `returnDate=2025-01-20` should trigger day-5 overdue reminder with fees.

**Verification:**
```bash
node server/scripts/sendOverdueReminders.js
# Look for log: 💸 Overdue fees: day 5 = $75.00
```

### Scenario 4: Test Morning-of Reminder

Test that a "morning-of" reminder is sent on the ship-by date during morning hours (6 AM - 12 PM UTC).

**Setup:**
```bash
export FORCE_NOW=2025-01-20T07:00:00.000Z  # 7 AM UTC
```

**Expected:** Transaction with `shipByDate=2025-01-20` should trigger morning-of reminder.

**Verification:**
```bash
node server/scripts/sendShipByReminders.js
# Should detect isMorningOf('2025-01-20') = true
```

### Scenario 5: Test Scheduling Logic

Test that the daily scheduler calculates the correct next run time.

**Setup:**
```bash
export FORCE_NOW=2025-01-20T14:00:00.000Z  # 2 PM UTC (before 9 AM PT)
```

**Expected:** Next 9 AM PT should be calculated as later today (17:00 UTC).

**Verification:**
```bash
node server/scripts/sendOverdueReminders.js
# Look for log: ⏰ Next run scheduled for: 2025-01-20T17:00:00.000Z
```

### Scenario 6: Test Timestamp Generation

Test that transaction timestamps respect `FORCE_NOW`.

**Setup:**
```bash
export FORCE_NOW=2025-12-25T12:00:00.000Z
```

**Expected:** All generated timestamps should use the forced time.

**Test:**
```javascript
const { timestamp } = require('./server/util/time');
console.log(timestamp()); // => '2025-12-25T12:00:00.000Z'
```

---

## Logging

When FORCE_* variables are set, the system logs them:

```
[TIME] FORCE_NOW=2025-01-15T09:30:00.000Z
[TIME] FORCE_TODAY=2025-01-15
[TIME] FORCE_TOMORROW=2025-01-16
[TIME] now=2025-01-15T09:30:00.000Z today=2025-01-15 tomorrow=2025-01-16
```

This makes it easy to verify that overrides are working correctly.

---

## Best Practices

### 1. Always Clear Variables After Testing

```bash
unset FORCE_NOW
unset FORCE_TODAY
unset FORCE_TOMORROW
```

Or start a new shell session.

### 2. Use Consistent Time Zones

When setting `FORCE_NOW`, use UTC (suffix with `Z`) or specify the timezone:
```bash
export FORCE_NOW=2025-01-15T09:30:00.000Z     # UTC
export FORCE_NOW=2025-01-15T09:30:00-08:00    # PST
```

### 3. Test Edge Cases

- Midnight transitions
- Month/year boundaries
- Leap years
- Daylight saving time transitions
- Weekend vs. weekday logic

### 4. Document Your Test Scenarios

Create a test script with comments:

```bash
#!/bin/bash
# Test ship-by reminder t-24 scenario

export FORCE_TODAY=2025-01-18
export FORCE_NOW=2025-01-18T10:00:00.000Z

echo "Testing t-24 ship-by reminder..."
node server/scripts/sendShipByReminders.js

unset FORCE_TODAY
unset FORCE_NOW
```

### 5. Never Use in Production

**⚠️ WARNING:** Never set FORCE_* variables in production environments. These are for testing only.

Add checks in production deployment scripts:
```bash
if [ "$NODE_ENV" = "production" ] && [ -n "$FORCE_NOW" ]; then
  echo "ERROR: FORCE_NOW cannot be set in production"
  exit 1
fi
```

---

## Affected Files

### Reminder Scripts
- `server/scripts/sendShipByReminders.js`
- `server/scripts/sendReturnReminders.js`
- `server/scripts/sendOverdueReminders.js`

### Transaction Handlers
- `server/api/transition-privileged.js`

### Webhooks
- `server/webhooks/shippoTracking.js`

### Utilities
- `server/util/time.js` (core time helper)
- `server/lib/shipping.js` (ship-by date calculations)

---

## API Reference

See `server/util/time.js` for the complete API.

**Key Functions:**
- `getNow()` - Get current time (respects `FORCE_NOW`)
- `getToday()` - Get today's date (respects `FORCE_TODAY`)
- `getTomorrow()` - Get tomorrow's date (respects `FORCE_TOMORROW`)
- `timestamp()` - Get ISO timestamp (respects `FORCE_NOW`)
- `isMorningOf(date)` - Check if current time is morning of date (respects `FORCE_NOW`)
- `getNext9AM()` - Get next 9 AM PT (respects `FORCE_NOW`)
- `logTimeState()` - Log current time state with all overrides

---

## Troubleshooting

### Variables Not Working

**Problem:** FORCE_* variables seem to have no effect.

**Solutions:**
1. Verify variables are exported: `echo $FORCE_NOW`
2. Check logs for `[TIME]` prefix showing the override
3. Ensure you're running the script in the same shell where variables are set
4. Restart the Node process if running in daemon mode

### Inconsistent Results

**Problem:** Some timestamps use forced time, others don't.

**Possible Causes:**
1. Some code still uses `new Date()` directly instead of time helper
2. Check migration checklist in `TIME_MIGRATION_CHECKLIST.md`
3. Search codebase for remaining `new Date()` calls:
   ```bash
   grep -r "new Date()" server/
   ```

### Timezone Confusion

**Problem:** Times don't match expected values.

**Solutions:**
1. Always use UTC format for `FORCE_NOW`: `2025-01-15T09:30:00.000Z`
2. Remember: 9 AM PT ≈ 17:00 UTC (16:00 during DST)
3. Use online timezone converters to verify

---

## Examples

### Complete Test Session

```bash
# Set up test environment
export FORCE_NOW=2025-01-15T09:30:00.000Z
export FORCE_TODAY=2025-01-15
export FORCE_TOMORROW=2025-01-16

# Test ship-by reminders
echo "=== Testing Ship-By Reminders ==="
node server/scripts/sendShipByReminders.js

# Test return reminders
echo "=== Testing Return Reminders ==="
node server/scripts/sendReturnReminders.js

# Test overdue reminders
echo "=== Testing Overdue Reminders ==="
node server/scripts/sendOverdueReminders.js

# Clean up
unset FORCE_NOW
unset FORCE_TODAY
unset FORCE_TOMORROW

echo "✅ Test session complete"
```

### Unit Test Example

```javascript
describe('Time helper with FORCE_NOW', () => {
  beforeEach(() => {
    process.env.FORCE_NOW = '2025-01-15T09:30:00.000Z';
  });

  afterEach(() => {
    delete process.env.FORCE_NOW;
  });

  it('should return forced timestamp', () => {
    const { timestamp } = require('../server/util/time');
    expect(timestamp()).toBe('2025-01-15T09:30:00.000Z');
  });
});
```

---

## Related Documentation

- `server/util/time.js` - Time helper implementation
- `server/util/time.test.js` - Time helper unit tests
- `TIME_SOURCE_ANALYSIS.md` - Analysis of current time handling
- `TIME_MIGRATION_CHECKLIST.md` - Migration checklist and tasks
- `docs/sms-links.md` - SMS links configuration

---

**Last Updated:** October 15, 2025  
**Version:** 1.0


# Overdue SMS Template Fix

**Issue:** Day 3 and Day 4 templates are missing the QR/return label link.

## Current vs Required

### Day 3 (72 hours late)

**Current (line 250):**
```javascript
message = `⏰ 3 days late. Fees continue. Ship today to avoid full replacement.`;
```

**Required:**
```javascript
message = `⏰ 3 days late. Fees continue. Ship today to avoid full replacement: ${shortUrl}`;
```

### Day 4 (96 hours late)

**Current (line 253):**
```javascript
message = `⚠️ 4 days late. Ship immediately to prevent replacement charges.`;
```

**Required:**
```javascript
message = `⚠️ 4 days late. Ship immediately to prevent replacement charges: ${shortUrl}`;
```

## Apply Fix

**File:** `server/scripts/sendOverdueReminders.js`

```bash
# On test branch
git checkout test
```

### Diff to Apply

```diff
diff --git a/server/scripts/sendOverdueReminders.js b/server/scripts/sendOverdueReminders.js
index d59ac05..XXXXXXX 100644
--- a/server/scripts/sendOverdueReminders.js
+++ b/server/scripts/sendOverdueReminders.js
@@ -247,10 +247,10 @@ async function sendOverdueReminders() {
         message = `🚫 2 days late. $15/day fees are adding up. Ship now: ${shortUrl}`;
         tag = 'overdue_day2_to_borrower';
       } else if (daysLate === 3) {
-        message = `⏰ 3 days late. Fees continue. Ship today to avoid full replacement.`;
+        message = `⏰ 3 days late. Fees continue. Ship today to avoid full replacement: ${shortUrl}`;
         tag = 'overdue_day3_to_borrower';
       } else if (daysLate === 4) {
-        message = `⚠️ 4 days late. Ship immediately to prevent replacement charges.`;
+        message = `⚠️ 4 days late. Ship immediately to prevent replacement charges: ${shortUrl}`;
         tag = 'overdue_day4_to_borrower';
       } else {
         // Day 5+
```

## Testing After Fix

```bash
# Run diagnostic to verify templates
node scripts/diagnose-overdue.js --transaction <tx-id> --matrix

# Check Day 3 and Day 4 output includes shortUrl
# Expected: "...full replacement: https://sherbrt.com/r/..."
```

## Commit Message

```
fix: Add QR links to Day 3 & Day 4 overdue SMS templates

- Day 3 template now includes return label link
- Day 4 template now includes return label link
- Matches requirements for escalation SMS copy
- Provides borrowers convenient one-tap return access

Fixes: Day 3 & Day 4 templates in overdue reminders
Ref: docs/overdue_late_fee_status.md
```


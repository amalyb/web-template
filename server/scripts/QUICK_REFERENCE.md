# 🚀 Flex API Diagnostics - Quick Reference

## One-Line Commands

### Full Diagnostics
```bash
source .env.test && node server/scripts/flex-diagnose.js
```

### Test Overdue Reminders
```bash
source .env.test && DIAG=1 DRY_RUN=1 FORCE_NOW=2025-11-09T09:00:00-08:00 node server/scripts/sendOverdueReminders.js
```

### Test Return Reminders
```bash
source .env.test && DIAG=1 DRY_RUN=1 node server/scripts/sendReturnReminders.js
```

### Test Ship-By Reminders
```bash
source .env.test && DIAG=1 DRY_RUN=1 node server/scripts/sendShipByReminders.js
```

---

## What to Look For

### ✅ Success Indicators
```
✓ PASS Marketplace client ID format (abcdef…wxyz)
✓ PASS Integration client ID format (flex-i…wxyz)
✓ PASS Base URL correct: https://flex-api.sharetribe.com
✓ PASS Marketplace SDK query successful
✓ PASS Integration API auth successful
✓ PASS Integration SDK query successful
```

### ❌ Failure Patterns

#### 400 Bad Request
```
[DIAG] Query error details: {
  status: 400,
  data: { errors: [...] }
}
```
**Check:** Parameter naming, state values, query format

#### 401/403 Permission Error
```
❌ Charge failed: Request failed with status code 403
⚠️  PERMISSION ERROR DETECTED
```
**Check:** Integration client permissions, process.edn actor roles

#### Base URL Error
```
✗ FAIL Base URL must NOT include /v1
```
**Fix:** Remove `/v1` from `SHARETRIBE_SDK_BASE_URL`

---

## Secret Masking Reference

| Type | Input | Output |
|------|-------|--------|
| Client ID | `abcdef1234567890wxyz` | `abcdef…wxyz` |
| Client Secret | `super_secret_string_64_chars...` | `length=64` |
| Access Token | `eyJhbGciOiJSUzI1NiIsInR5...` | `eyJhbGci…` |

---

## Common Fixes

### Wrong Base URL
```bash
# .env.test - WRONG
SHARETRIBE_SDK_BASE_URL=https://flex-api.sharetribe.com/v1

# .env.test - CORRECT
SHARETRIBE_SDK_BASE_URL=https://flex-api.sharetribe.com
```

### Permission Fix (process.edn)
```clojure
{:name :transition/privileged-apply-late-fees
 :actor [:actor.role/admin]  ; Changed from :operator
 :from [:state/delivered]
 :to :state/delivered}
```

### SDK Parameter Reference
```javascript
// Marketplace SDK (what we use for queries)
readSdk.transactions.query({
  state: 'delivered',
  per_page: 100,        // snake_case ✅
  include: ['customer']
})

// Integration SDK (if we switch)
integSdk.transactions.query({
  state: 'delivered',
  perPage: 100,         // camelCase ✅
  include: ['customer']
})
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `flex-diagnose.js` | Comprehensive system check |
| `DIAGNOSTICS.md` | Full documentation |
| `DIAGNOSTIC_SUMMARY.md` | Implementation summary |
| `QUICK_REFERENCE.md` | This file |

---

**Emergency Debug:**
```bash
# Show masked env vars
source .env.test
echo "Marketplace ID: ${REACT_APP_SHARETRIBE_SDK_CLIENT_ID:0:6}…${REACT_APP_SHARETRIBE_SDK_CLIENT_ID: -4}"
echo "Integration ID: ${INTEGRATION_CLIENT_ID:0:6}…${INTEGRATION_CLIENT_ID: -4}"
echo "Base URL: ${SHARETRIBE_SDK_BASE_URL:-${REACT_APP_SHARETRIBE_SDK_BASE_URL:-https://flex-api.sharetribe.com}}"
```


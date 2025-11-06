# Flex API Diagnostics Guide

This document describes the diagnostic tools and procedures for troubleshooting 400 errors from Sharetribe Flex API in reminder scripts.

## 🔧 Diagnostic Tools

### 1. `flex-diagnose.js` - Comprehensive API Health Check

A standalone diagnostic script that performs comprehensive validation of your Flex API setup.

**Usage:**
```bash
source .env.test
node server/scripts/flex-diagnose.js
```

**What it checks:**

1. **Environment Variable Audit** (with secret masking)
   - ✅ Marketplace SDK credentials format
   - ✅ Integration SDK credentials format  
   - ✅ Base URL correctness (no `/v1` suffix)
   - ✅ Marketplace name configuration

2. **Marketplace SDK Probe**
   - Tests `listings.query({ perPage: 1 })`
   - Validates basic read access

3. **Integration API Direct Auth**
   - Direct POST to `/v1/auth/token`
   - Validates credentials and scope
   - Shows masked access token

4. **Integration SDK Probe**
   - Tests `transactions.query({ perPage: 1 })`
   - Validates privileged access

5. **Root Cause Diagnosis**
   - Analyzes failures and suggests fixes
   - Common issues: param naming, base URL, permissions

**Exit codes:**
- `0` = All checks passed
- `1` = One or more checks failed

---

### 2. DIAG Mode - Enhanced Error Logging

All reminder scripts now support `DIAG=1` mode for detailed error diagnostics.

**Usage:**
```bash
DIAG=1 DRY_RUN=1 FORCE_NOW=2025-11-09T09:00:00-08:00 \
  node server/scripts/sendOverdueReminders.js
```

**What it logs:**

**At startup:**
```
[DIAG] Using SDKs: read=Marketplace, integ=Integration
[DIAG] Marketplace clientId: abcdef…wxyz
[DIAG] Integration clientId: flex-i…wxyz
[DIAG] Base URL: https://flex-api.sharetribe.com
```

**On query errors:**
```javascript
[DIAG] Query error details: {
  endpoint: 'transactions.query',
  status: 400,
  data: { errors: [...] },
  query: { state: 'delivered', per_page: 100 },
  errorMessage: '...',
  errorCode: '...'
}
```

**On transition errors:**
```javascript
[DIAG] Charge error details: {
  endpoint: 'transactions.transition (via applyCharges)',
  status: 400,
  data: { errors: [...] },
  txId: '...',
  errorMessage: '...'
}
```

---

## 🔍 Diagnostic Sequence

Run this sequence to diagnose 400 errors:

### Step 1: Environment Setup
```bash
source .env.test
```

### Step 2: Run Comprehensive Diagnostics
```bash
node server/scripts/flex-diagnose.js
```

Expected output:
- ✅ All environment checks PASS
- ✅ Marketplace SDK query successful
- ✅ Integration API auth successful
- ✅ Integration SDK query successful

### Step 3: Test Reminder Script with DIAG Mode
```bash
DIAG=1 DRY_RUN=1 FORCE_NOW=2025-11-09T09:00:00-08:00 \
  node server/scripts/sendOverdueReminders.js
```

Watch for:
- SDK initialization logs
- Query parameter format (per_page vs perPage)
- Error response bodies with full details

### Step 4: Analyze Error Details

If you see a 400 error, examine the `data.errors` array:

```json
{
  "errors": [{
    "status": 400,
    "code": "unknown-param",
    "title": "Unknown parameter",
    "detail": "Parameter 'per_page' is not supported",
    "source": {
      "parameter": "per_page"
    }
  }]
}
```

---

## 🐛 Common Root Causes

### 1. Base URL includes `/v1`
**Symptom:** All API calls fail with connection errors

**Fix:**
```bash
# Wrong
SHARETRIBE_SDK_BASE_URL=https://flex-api.sharetribe.com/v1

# Correct
SHARETRIBE_SDK_BASE_URL=https://flex-api.sharetribe.com
```

The SDK handles API versioning internally.

---

### 2. Parameter naming mismatch

**Symptom:** 400 error with "unknown parameter" or "invalid parameter"

**Marketplace SDK (snake_case):**
```javascript
readSdk.transactions.query({
  state: 'delivered',
  per_page: 100,          // snake_case
  created_at: date,       // snake_case
  include: ['customer']
})
```

**Integration SDK (camelCase):**
```javascript
integSdk.transactions.query({
  state: 'delivered',
  perPage: 100,           // camelCase
  createdAt: date,        // camelCase
  include: ['customer']
})
```

**Our scripts use Marketplace SDK for reads**, so we use `per_page` (snake_case).

---

### 3. Integration client ID format

**Symptom:** Auth fails with 401/403

**Check:**
```bash
echo $INTEGRATION_CLIENT_ID
# Must start with: flex-integration-api-client-
```

If it doesn't, regenerate in Flex Console → Build → Integrations.

---

### 4. Missing permissions for transitions

**Symptom:** 403 on `transactions.transition()` calls

**Fix in `process.edn`:**
```clojure
{:name :transition/privileged-apply-late-fees
 :actor [:actor.role/admin]           ; Changed from :operator
 :actions [...]
 :to :state/delivered}
```

**AND** ensure Integration API client has operator/admin role in Flex Console.

---

### 5. Wrong transaction state for transition

**Symptom:** 400 with "transition not allowed in current state"

**Debug:**
```javascript
console.log('Transaction state:', tx.attributes.state);
console.log('Attempting transition:', transitionName);
```

**Fix:** Check `process.edn` for allowed states:
```clojure
{:name :transition/privileged-apply-late-fees
 :from [:state/delivered]             ; Must be in this state
 :to :state/delivered}
```

---

### 6. Process not active

**Symptom:** 400 or 404 for transitions

**Check:** Flex Console → Build → Transaction processes
- Ensure the modified process is marked as **Active**
- Re-publish after changes to `process.edn`

---

## 📊 Secret Masking

All diagnostic tools mask secrets:

| Variable | Mask Format | Example |
|----------|-------------|---------|
| Client ID | First 6 + last 4 | `abcdef…wxyz` |
| Client Secret | Length only | `length=64` |
| Access Token | First 8 chars | `eyJhbGci…` |

This is safe for logging and sharing with team members for debugging.

---

## 🚀 Quick Reference

### Run full diagnostics
```bash
source .env.test && node server/scripts/flex-diagnose.js
```

### Test overdue reminders with diagnostics
```bash
source .env.test
DIAG=1 DRY_RUN=1 FORCE_NOW=2025-11-09T09:00:00-08:00 \
  node server/scripts/sendOverdueReminders.js
```

### Test return reminders with diagnostics
```bash
source .env.test
DIAG=1 DRY_RUN=1 node server/scripts/sendReturnReminders.js
```

### Test ship-by reminders with diagnostics
```bash
source .env.test
DIAG=1 DRY_RUN=1 node server/scripts/sendShipByReminders.js
```

---

## 🔒 Security Notes

1. **Never commit `.env.test`** - already in `.gitignore`
2. **Use DIAG=1 only in development** - full error bodies may contain sensitive data
3. **Masked values are safe to share** - but still avoid posting in public forums
4. **Rotate credentials** if accidentally exposed

---

## 📝 What Changed

### Added Files
- `server/scripts/flex-diagnose.js` - Comprehensive diagnostic tool

### Modified Files
- `server/scripts/sendOverdueReminders.js` - Added DIAG mode logging
- `server/scripts/sendReturnReminders.js` - Added DIAG mode logging
- `server/scripts/sendShipByReminders.js` - Added DIAG mode logging

### What We DIDN'T Change
- No behavior modifications to reminder logic
- No changes to SDK initialization
- No changes to query parameters (still using correct formats)
- No refactoring of existing code

---

## 📞 Next Steps

1. Run `flex-diagnose.js` to validate environment
2. If all passes, run reminder scripts with `DIAG=1`
3. If 400 error persists, examine the error body details
4. Match error to "Common Root Causes" above
5. Apply the suggested fix
6. Re-run diagnostics to confirm

---

**Last Updated:** 2025-11-05


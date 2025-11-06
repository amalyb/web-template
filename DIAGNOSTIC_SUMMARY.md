# Diagnostic Tools - Implementation Summary

## ✅ What Was Implemented

### 1. Comprehensive Diagnostic Script
**File:** `server/scripts/flex-diagnose.js`

A standalone tool that validates your entire Flex API setup:

- ✅ **Environment audit** with secret masking (first 6 + last 4 chars)
- ✅ **Marketplace SDK probe** (listings.query test)
- ✅ **Integration API direct auth** (token endpoint test)
- ✅ **Integration SDK probe** (transactions.query test)
- ✅ **Root cause analysis** with actionable recommendations

**Exit codes:**
- `0` = All probes successful
- `1` = One or more failures detected

### 2. DIAG Mode for Reminder Scripts
**Files Modified:**
- `server/scripts/sendOverdueReminders.js`
- `server/scripts/sendReturnReminders.js`
- `server/scripts/sendShipByReminders.js`

**Added features:**
- Startup logging with masked credentials
- Enhanced error logging for query failures
- Enhanced error logging for transition failures
- Specific hints for 400/403/401 errors
- Full error body inspection when `DIAG=1`

### 3. Documentation
**Files Created:**
- `server/scripts/DIAGNOSTICS.md` - Comprehensive guide
- `DIAGNOSTIC_SUMMARY.md` - This file

---

## 🔍 Environment Variable Checks

The diagnostic script validates these variables (with safe masking):

| Variable | Check | Mask Format |
|----------|-------|-------------|
| `REACT_APP_SHARETRIBE_SDK_CLIENT_ID` | Format & length | `abcdef…wxyz` |
| `SHARETRIBE_SDK_CLIENT_SECRET` | Length > 20 | `length=64` |
| `INTEGRATION_CLIENT_ID` | Must start with `flex-integration-api-client-` | `flex-i…wxyz` |
| `INTEGRATION_CLIENT_SECRET` | Length > 20 | `length=64` |
| `SHARETRIBE_SDK_BASE_URL` | Must NOT include `/v1` | Full URL shown |
| `REACT_APP_SHARETRIBE_SDK_BASE_URL` | Must NOT include `/v1` | Full URL shown |
| `REACT_APP_MARKETPLACE_NAME` | Present (optional) | Full name shown |

**PASS/FAIL Table Format:**
```
✓ PASS Marketplace client ID format (abcdef…wxyz)
✓ PASS Marketplace client secret (length=64)
✓ PASS Integration client ID format (flex-i…wxyz)
✓ PASS Integration client secret (length=64)
✓ PASS Base URL correct: https://flex-api.sharetribe.com
✓ PASS Marketplace name: "Shop on Sherbrt"
```

---

## 🚀 How to Run Diagnostics

### Step 1: Full System Check
```bash
cd /Users/amaliabornstein/shop-on-sherbet-cursor
source .env.test
node server/scripts/flex-diagnose.js
```

**Expected output:**
```
🔍 Sharetribe Flex API Diagnostic Tool
Starting comprehensive diagnostics...

═══════════════════════════════════════════════════════════
1️⃣  ENVIRONMENT VARIABLE AUDIT
═══════════════════════════════════════════════════════════

Marketplace SDK Credentials:
  REACT_APP_SHARETRIBE_SDK_CLIENT_ID: abcdef…wxyz
  SHARETRIBE_SDK_CLIENT_SECRET:       length=64

Integration SDK Credentials:
  INTEGRATION_CLIENT_ID:              flex-i…wxyz
  INTEGRATION_CLIENT_SECRET:          length=64

Configuration:
  Base URL:                           https://flex-api.sharetribe.com
  Marketplace Name:                   Shop on Sherbrt

Validation Results:
✓ PASS Marketplace client ID format (abcdef…wxyz)
✓ PASS Marketplace client secret (length=64)
✓ PASS Integration client ID format (flex-i…wxyz)
✓ PASS Integration client secret (length=64)
✓ PASS Base URL correct: https://flex-api.sharetribe.com
✓ PASS Marketplace name: "Shop on Sherbrt"

Environment Score: 6/6 checks passed

═══════════════════════════════════════════════════════════
2️⃣  MARKETPLACE SDK PROBE
═══════════════════════════════════════════════════════════

ℹ INFO Initializing Marketplace SDK...
ℹ INFO Querying listings (perPage: 1)...
✓ PASS Marketplace SDK query successful
  Listings returned: 1
  Total listings:    42
  Per page:          1

[... additional probes ...]
```

### Step 2: Test Reminder Script with Diagnostics
```bash
source .env.test
DIAG=1 DRY_RUN=1 FORCE_NOW=2025-11-09T09:00:00-08:00 \
  node server/scripts/sendOverdueReminders.js
```

**Additional output with DIAG=1:**
```
🚀 Starting overdue reminder SMS script...
✅ SDKs initialized (read + integ)
[DIAG] Using SDKs: read=Marketplace, integ=Integration
[DIAG] Marketplace clientId: abcdef…wxyz
[DIAG] Integration clientId: flex-i…wxyz
[DIAG] Base URL: https://flex-api.sharetribe.com
📅 Processing overdue reminders for: 2025-11-09
```

**If there's a 400 error:**
```
[DIAG] Query error details: {
  endpoint: 'transactions.query',
  status: 400,
  data: {
    errors: [
      {
        status: 400,
        code: 'unknown-param',
        title: 'Unknown parameter',
        detail: "Parameter 'per_page' is not supported",
        source: { parameter: 'per_page' }
      }
    ]
  },
  query: { state: 'delivered', per_page: 100 },
  errorMessage: 'Request failed with status code 400',
  errorCode: 'ERR_BAD_REQUEST'
}

⚠️  400 BAD REQUEST - Possible causes:
   1. Invalid query parameters (check per_page vs perPage)
   2. Invalid state value or filter
   3. Malformed include parameter

   API Errors:
   [0] Unknown parameter
```

### Step 3: Run All Three Reminder Scripts
```bash
# Overdue reminders
DIAG=1 DRY_RUN=1 FORCE_NOW=2025-11-09T09:00:00-08:00 \
  node server/scripts/sendOverdueReminders.js

# Return reminders  
DIAG=1 DRY_RUN=1 node server/scripts/sendReturnReminders.js

# Ship-by reminders
DIAG=1 DRY_RUN=1 node server/scripts/sendShipByReminders.js
```

---

## 🔒 Secret Masking - Examples

All secrets are masked for safe logging:

```javascript
// Client IDs: First 6 + last 4
REACT_APP_SHARETRIBE_SDK_CLIENT_ID=abcdef1234567890wxyz
// Logged as: abcdef…wxyz

// Client Secrets: Length only
SHARETRIBE_SDK_CLIENT_SECRET=super_secret_64_char_string...
// Logged as: length=64

// Access Tokens: First 8 chars
access_token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
// Logged as: eyJhbGci…
```

**Safe to share:**
- ✅ Masked client IDs
- ✅ Secret lengths
- ✅ Token prefixes
- ✅ Base URLs
- ✅ Error messages (without full bodies)

**Never share:**
- ❌ Full client secrets
- ❌ Full access tokens
- ❌ Full client IDs (unless masked)

---

## 🐛 Common Issues & Fixes

### Issue 1: Base URL includes /v1
**Symptom:**
```
✗ FAIL Base URL must NOT include /v1 (got: https://flex-api.sharetribe.com/v1)
```

**Fix in `.env.test`:**
```bash
# Wrong
SHARETRIBE_SDK_BASE_URL=https://flex-api.sharetribe.com/v1

# Correct
SHARETRIBE_SDK_BASE_URL=https://flex-api.sharetribe.com
```

---

### Issue 2: Parameter naming (per_page vs perPage)
**Symptom:**
```
[DIAG] Query error details: {
  status: 400,
  data: { errors: [{ detail: "Unknown parameter 'per_page'" }] }
}
```

**Current code (CORRECT for Marketplace SDK):**
```javascript
readSdk.transactions.query({
  state: 'delivered',
  per_page: 100,  // ✅ snake_case for Marketplace SDK
  include: ['customer']
})
```

**If using Integration SDK (not currently):**
```javascript
integSdk.transactions.query({
  state: 'delivered',
  perPage: 100,   // ✅ camelCase for Integration SDK
  include: ['customer']
})
```

---

### Issue 3: Integration client ID format
**Symptom:**
```
✗ FAIL Integration client ID must start with 'flex-integration-api-client-'
```

**Check:**
```bash
echo $INTEGRATION_CLIENT_ID
# Should output: flex-integration-api-client-abc123...
```

**Fix:** Regenerate in Flex Console → Build → Integrations

---

### Issue 4: Permission errors on transitions
**Symptom:**
```
❌ Charge failed: Request failed with status code 403

⚠️  PERMISSION ERROR DETECTED:
   The transition/privileged-apply-late-fees requires proper permissions.
```

**Fix 1 - In `process.edn`:**
```clojure
{:name :transition/privileged-apply-late-fees
 :actor [:actor.role/admin]  ; Change from :operator to :admin
 :from [:state/delivered]
 :to :state/delivered}
```

**Fix 2 - In Flex Console:**
1. Go to Build → Integrations
2. Find your Integration API client
3. Ensure it has operator/admin privileges
4. Re-publish the process if you changed `process.edn`

---

### Issue 5: Wrong transaction state
**Symptom:**
```
⚠️  400 BAD REQUEST - Possible causes:
   2. Transaction state doesn't allow this transition
```

**Debug in DIAG mode:**
```javascript
console.log('[DIAG] Transaction state:', tx.attributes.state);
// Output: [DIAG] Transaction state: accepted
```

**Fix:** Check `process.edn` to ensure the transition is allowed from that state:
```clojure
{:name :transition/privileged-apply-late-fees
 :from [:state/delivered]    ; Transition only works from 'delivered'
 :to :state/delivered}
```

---

## 📊 What We DIDN'T Change

**Important: No behavior modifications**

- ✅ No changes to SDK initialization logic
- ✅ No changes to query parameters (still using correct formats)
- ✅ No changes to transition calls
- ✅ No changes to business logic
- ✅ No refactoring of existing code

**We only added:**
- Diagnostic logging (behind `DIAG=1` flag)
- Error body inspection
- Helpful error hints
- Standalone diagnostic tool

---

## 📝 Next Steps

1. **Run diagnostics:**
   ```bash
   source .env.test && node server/scripts/flex-diagnose.js
   ```

2. **If diagnostics pass but reminder scripts still fail:**
   ```bash
   DIAG=1 DRY_RUN=1 FORCE_NOW=2025-11-09T09:00:00-08:00 \
     node server/scripts/sendOverdueReminders.js
   ```

3. **Examine the `[DIAG]` output** for:
   - Actual query parameters being sent
   - Full error response body
   - Transaction states vs. transition requirements

4. **Match error to common issues** above

5. **Apply fix** and re-run

6. **Report findings:**
   - Share masked credentials (safe)
   - Share error messages
   - Share diagnostic output
   - Never share full secrets

---

## 🔧 Files Changed

### Created
- ✅ `server/scripts/flex-diagnose.js` (589 lines)
- ✅ `server/scripts/DIAGNOSTICS.md` (371 lines)
- ✅ `DIAGNOSTIC_SUMMARY.md` (this file)

### Modified
- ✅ `server/scripts/sendOverdueReminders.js` (+40 lines of diagnostics)
- ✅ `server/scripts/sendReturnReminders.js` (+40 lines of diagnostics)
- ✅ `server/scripts/sendShipByReminders.js` (+40 lines of diagnostics)

**Total:** 3 new files, 3 modified files, ~1100 lines of diagnostic code

---

**Last Updated:** 2025-11-05  
**Status:** ✅ Ready for testing


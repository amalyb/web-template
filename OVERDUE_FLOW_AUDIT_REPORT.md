# Overdue Flow Implementation Audit Report

**Date:** November 5, 2025  
**Branches Audited:** `test`, `main`  
**Auditor:** AI Code Assistant  
**Status:** ✅ Both branches identical; implementation complete but with critical gaps

---

## Executive Summary

The Overdue flow (borrower SMS reminders + late fee tracking + Day-5 replacement evaluation) is **implemented and consistent across both `test` and `main` branches**. The core infrastructure is robust:

- ✅ **Daily scheduler** via Render worker daemon (runs at 9 AM UTC)
- ✅ **Time-travel testing** via `FORCE_NOW` / `FORCE_TODAY` environment variables
- ✅ **SMS escalation cadence** with 5 distinct day-based templates (Day 1-5+)
- ✅ **Idempotency guards** prevent duplicate SMS per day via `lastNotifiedDay` tracking
- ✅ **Carrier scan detection** via webhook-backed `firstScanAt` timestamp
- ✅ **Fee calculation** at $15/day starting Day 1 (stored in transaction protectedData)
- ✅ **Shortlinks** for compact SMS (QR/label URLs)
- ⚠️ **Replacement charge evaluation** is a stub (logs intent but does NOT charge Stripe)

### Critical Gaps vs Policy

1. **🚨 NO ACTUAL FEE CHARGING** — Fees are calculated and tracked but never charged to Stripe/Flex
2. **🚨 NO ACTUAL REPLACEMENT CHARGING** — Day-5 replacement is evaluated but not charged
3. **⚠️ Day-3/4 SMS missing shortlink** — Policy specifies shortlinks for all messages
4. **⚠️ No "in transit" late fee accrual** — Policy says fees continue if item ships late
5. **⚠️ Hardcoded replacement amount** — Should pull from listing `retailPrice` or custom field

---

## Branch Parity Check

### Files Compared

| File | Test Branch | Main Branch | Status |
|------|-------------|-------------|--------|
| `server/scripts/sendOverdueReminders.js` | 349 lines | 349 lines | ✅ **IDENTICAL** |
| `server/util/time.js` | 255 lines | 255 lines | ✅ **IDENTICAL** |
| `server/webhooks/shippoTracking.js` | Lines 340-417 | Lines 340-417 | ✅ **IDENTICAL** |
| `render.yaml` | Lines 39-48 | Lines 39-48 | ✅ **IDENTICAL** |
| `server/api-util/sendSMS.js` | 221 lines | 221 lines | ✅ **IDENTICAL** |
| `server/api-util/shortlink.js` | 200 lines | 200 lines | ✅ **IDENTICAL** |

### Conclusion

**Both branches are 100% identical** for the overdue flow. No divergence detected. This audit applies equally to both `test` and `main`.

---

## Implementation Details

### A. Triggering & Schedule

#### Scheduler Configuration

**Location:** `render.yaml:39-48`

```yaml
- type: worker
  name: overdue-reminders
  env: node
  plan: starter
  buildCommand: yarn install && yarn run render-build
  startCommand: node server/scripts/sendOverdueReminders.js --daemon
  nodeVersion: 20.10.0
  envVars:
    - key: NODE_ENV
      value: production
```

**Cadence:** Daily at **9 AM UTC** (1 AM PT / 2 AM PDT)

**Daemon Logic:** `server/scripts/sendOverdueReminders.js:312-342`
- Calculates next 9 AM UTC on startup
- Uses `setTimeout` + `setInterval` for recurring runs
- Runs immediately on startup for testing

#### 24h Enforcement

**Idempotency Guard:** `server/scripts/sendOverdueReminders.js:177-184`

```javascript
const overdue = returnData.overdue || {};
const lastNotifiedDay = overdue.lastNotifiedDay;

if (lastNotifiedDay === daysLate) {
  console.log(`📅 Already notified for day ${daysLate} for tx ${tx?.id?.uuid || '(no id)'}`);
  continue;
}
```

- Prevents duplicate SMS for the same `daysLate` value
- Updated after each successful send: `lastNotifiedDay: daysLate`
- Stored in `transaction.protectedData.return.overdue.lastNotifiedDay`

---

### B. Time Basis

#### Late Days Calculation

**Formula:** `server/scripts/sendOverdueReminders.js:101-102, 128`

```javascript
const today = process.env.FORCE_TODAY || yyyymmdd(Date.now());
const todayDate = new Date(today);
const daysLate = diffDays(todayDate, returnDate);
```

**diffDays Implementation:** `server/util/time.js:122-126`

```javascript
function diffDays(date1, date2) {
  const d1 = new Date(date1 + 'T00:00:00.000Z'); // Force UTC
  const d2 = new Date(date2 + 'T00:00:00.000Z'); // Force UTC
  return Math.ceil((d1 - d2) / (1000 * 60 * 60 * 24));
}
```

- **Timezone:** Always UTC (avoids daylight saving issues)
- **Rounding:** `Math.ceil` rounds up (partial days count as full days)
- **Return Date:** `deliveryEnd` attribute from transaction

#### FORCE_NOW Support

**Location:** `server/util/time.js:42-49`

```javascript
function getNow() {
  const forced = process.env.FORCE_NOW;
  if (forced) {
    console.log(`[TIME] FORCE_NOW=${forced}`);
    return new Date(forced);
  }
  return new Date();
}
```

**Usage in sendOverdueReminders:**
- `FORCE_TODAY` overrides `today` calculation (line 101)
- Used for time-travel testing (see docs/time-travel-testing.md)

**Example:**
```bash
FORCE_TODAY=2025-11-13 node server/scripts/sendOverdueReminders.js
```

---

### C. Candidate Query

#### Flex Query

**Location:** `server/scripts/sendOverdueReminders.js:107-111`

```javascript
const query = {
  state: 'delivered',
  include: ['customer', 'listing'],
  per_page: 100
};
```

**Filters Applied:**
1. **State:** Only `delivered` transactions
2. **Has deliveryEnd:** Skip if missing (line 125)
3. **Overdue:** `daysLate >= 1` (line 131)
4. **Not scanned:** Skip if `returnData.firstScanAt` exists (line 137-140)
5. **Has borrower phone:** Skip if missing (line 151-154)
6. **ONLY_PHONE filter:** Optional env var for testing (line 156-159)

#### Carrier Scan Exclusion

**Location:** `server/scripts/sendOverdueReminders.js:136-140`

```javascript
// Skip if already scanned (in transit)
if (returnData.firstScanAt) {
  console.log(`✅ Return already in transit for tx ${tx?.id?.uuid || '(no id)'}`);
  continue;
}
```

**Source:** `firstScanAt` is set by webhook handler when carrier accepts package.

---

### D. Carrier Scan Detection

#### Source: Webhook-Backed Persistence

**Webhook Handler:** `server/webhooks/shippoTracking.js:344-417`

**Trigger Statuses:** `TRANSIT`, `IN_TRANSIT`, `ACCEPTED`, `ACCEPTANCE` (line 285)

**Persistence Logic:** Lines 386-403

```javascript
// Update transaction with return first scan timestamp
const result = await upsertProtectedData(txId, {
  return: {
    ...returnData,
    firstScanAt: timestamp() // ← respects FORCE_NOW
  }
}, { source: 'webhook' });
```

**Idempotency:** Line 349-352
- Checks `returnData.firstScanAt` before processing
- Returns 200 if already set (prevents duplicate lender SMS)

**Statuses Considered "Carrier Scan":**
- ✅ `ACCEPTED` — Carrier accepted package
- ✅ `IN_TRANSIT` — Package in transit
- ✅ `ACCEPTANCE` — Alternate spelling
- ✅ `TRANSIT` — Alternate spelling
- ❌ `PRE_TRANSIT` — **NOT** considered a scan (label created but not picked up)

**Detection Method:** Shippo webhook push (not on-demand polling)

---

### E. SMS Content

#### Templates

**Location:** `server/scripts/sendOverdueReminders.js:192-213`

| Day | Emoji | Message | Shortlink |
|-----|-------|---------|-----------|
| 1 | ⚠️ | "Due yesterday. Please ship today to avoid $15/day late fees. QR: {link}" | ✅ Yes |
| 2 | 🚫 | "2 days late. $15/day fees are adding up. Ship now: {link}" | ✅ Yes |
| 3 | ⏰ | "3 days late. Fees continue. Ship today to avoid full replacement." | ❌ **Missing** |
| 4 | ⚠️ | "4 days late. Ship immediately to prevent replacement charges." | ❌ **Missing** |
| 5+ | 🚫 | "5 days late. You may be charged full replacement ($50). Avoid this by shipping today: {link}" | ✅ Yes |

**Variables Inserted:**
- `{shortUrl}` — QR/label shortlink via `shortLink()` function (lines 174-175)
- `${replacementAmount/100}` — Hardcoded $50 (line 210-211)

**Missing Variables vs Policy:**
- ❌ Borrower first name
- ❌ Listing title
- ❌ Due date
- ❌ Actual replacement value from listing

**SMS Tag Format:** `overdue_day{N}_to_borrower` (e.g., `overdue_day1_to_borrower`)

---

### F. Shortlinks

#### How Built

**Function:** `server/api-util/shortlink.js:156-193`

```javascript
function shortLink(url) {
  if (!SHORTLINK_ENABLED || !redis || !secret) {
    return url; // Fallback to original URL
  }
  
  return makeShortToken(url)
    .then(token => `${SHORTLINK_BASE}/${token}`)
    .catch(err => url);
}
```

**Token Format:** 10 characters = 6-char ID (base62) + 4-char HMAC

**Example:** `https://www.sherbrt.com/r/a1B2c3d4e5`

#### Label Source Priority

**Location:** `server/scripts/sendOverdueReminders.js:167-172`

```javascript
const returnLabelUrl = returnData.label?.url ||
                      protectedData.returnLabelUrl ||
                      protectedData.returnLabel ||
                      protectedData.shippingLabelUrl ||
                      protectedData.returnShippingLabel ||
                      `https://sherbrt.com/return/${tx?.id?.uuid || tx?.id}`;
```

**Fallback:** If no label found, generates placeholder URL (last line).

#### UPS vs USPS Mode

**Configuration:** `server/lib/env.js:23-36`

```javascript
const UPS_LINK_MODE = (process.env.UPS_LINK_MODE || 'qr,label')
  .split(',').map(s => s.trim()).filter(Boolean);

const USPS_LINK_MODE = (process.env.USPS_LINK_MODE || 'label')
  .split(',').map(s => s.trim()).filter(Boolean);
```

**Defaults:**
- UPS: `qr,label` (prefer QR, fallback to label)
- USPS: `label` (USPS has no QR codes)

---

### G. Late Fees

#### Calculation

**Location:** `server/scripts/sendOverdueReminders.js:186-190`

```javascript
const fees = returnData.fees || {};
const perDayCents = fees.perDayCents || 1500; // $15/day default
const feesStartedAt = fees.startedAt || new Date(returnDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
const totalCents = perDayCents * daysLate;
```

**Formula:**
- **Daily Rate:** $15/day (1500 cents) — hardcoded default
- **Start Date:** `returnDate + 24 hours` (Day 1 late)
- **Total Fees:** `$15 × daysLate`

**Example:**
- Day 1: $15
- Day 2: $30
- Day 3: $45
- Day 5: $75

#### Storage

**Location:** `server/scripts/sendOverdueReminders.js:232-245`

```javascript
const updatedReturnData = {
  ...returnData,
  fees: {
    ...fees,
    perDayCents: perDayCents,
    totalCents: totalCents,
    startedAt: feesStartedAt
  },
  overdue: {
    ...overdue,
    daysLate: daysLate,
    lastNotifiedDay: daysLate
  }
};
```

**Persisted To:** `transaction.protectedData.return.fees` (line 256-264)

#### 🚨 CRITICAL GAP: No Actual Charging

**Current State:** Fees are **calculated and logged** but **never charged to Stripe**.

**Evidence:** Lines 255-268 only update `protectedData` — no Stripe API calls.

**Missing:**
- Stripe `PaymentIntent` capture
- Line item creation in Flex transaction
- Idempotency key for charge
- Charge confirmation/receipt

---

### H. Day-5 Replacement

#### Evaluation Trigger

**Location:** `server/scripts/sendOverdueReminders.js:247-253`

```javascript
// Evaluate replacement on Day 5 if not already evaluated
if (daysLate === 5 && !overdue.replacementEvaluated) {
  const replacementResult = await evaluateReplacementCharge(tx);
  updatedReturnData.overdue.replacementEvaluated = true;
  updatedReturnData.overdue.replacementEvaluation = replacementResult;
  console.log(`🔍 Evaluated replacement charge for Day 5: $${replacementResult.replacementAmount/100}`);
}
```

**Guard:** `!overdue.replacementEvaluated` prevents re-evaluation.

#### Replacement Value Source

**Current Implementation:** `server/scripts/sendOverdueReminders.js:76-92`

```javascript
async function evaluateReplacementCharge(tx) {
  // Stub function for replacement charge evaluation
  console.log(`🔍 Evaluating replacement charge for tx ${tx?.id?.uuid || tx?.id}`);
  
  // TODO: Implement actual replacement charge logic
  // This would typically involve:
  // 1. Getting the listing price/value
  // 2. Calculating replacement cost
  // 3. Recording the charge intent
  // 4. Potentially initiating Stripe charge
  
  return {
    replacementAmount: 5000, // $50.00 in cents
    evaluated: true,
    timestamp: new Date().toISOString()
  };
}
```

**🚨 CRITICAL GAP:**
1. **Hardcoded $50** — Should pull from listing metadata
2. **Stub function** — Only logs, does NOT charge Stripe
3. **No preconditions** — Doesn't verify carrier scan status
4. **No idempotency key** for charge

**Suggested Source:**
- `listing.attributes.publicData.retailPrice` (if exists)
- `listing.attributes.price.amount` × multiplier (e.g., 2x for replacement)
- Custom field in `listing.publicData.replacementValue`

---

### I. Safety & Idempotency

#### SMS Duplicate Prevention

**Mechanism 1: Per-Day Guard** — `server/scripts/sendOverdueReminders.js:177-184`

```javascript
const lastNotifiedDay = overdue.lastNotifiedDay;

if (lastNotifiedDay === daysLate) {
  console.log(`📅 Already notified for day ${daysLate} for tx ${tx?.id?.uuid || '(no id)'}`);
  continue;
}
```

**Mechanism 2: Twilio Deduplication** — `server/api-util/sendSMS.js:34-61`

```javascript
function isDuplicateSend(transactionId, transition, role) {
  const key = `${transactionId}:${transition}:${role}`;
  const now = Date.now();
  const lastSent = recentSends.get(key);
  
  if (lastSent && (now - lastSent) < DUPLICATE_WINDOW_MS) {
    return true; // Duplicate detected within 60s window
  }
  
  recentSends.set(key, now);
  return false;
}
```

**Window:** 60 seconds (in-memory Map, resets on restart)

#### Fee/Replacement Idempotency

**Current State:**
- ✅ **Replacement evaluation:** Guarded by `replacementEvaluated` flag (line 248)
- ❌ **Fee charges:** NOT IMPLEMENTED
- ❌ **Replacement charges:** NOT IMPLEMENTED

**Missing:**
- Stripe idempotency keys
- Redis lock for concurrent protection
- Flex transaction transition guards

---

### J. Observability

#### Logging

**Namespace:** No formal namespace (uses emoji prefixes)

**Key Logs:**

| Log | Location | Purpose |
|-----|----------|---------|
| `🚀 Starting overdue reminder SMS script...` | Line 95 | Script start |
| `📅 Processing overdue reminders for: {date}` | Line 104 | Current date |
| `📊 Found {N} delivered transactions` | Line 117 | Candidate count |
| `✅ Return already in transit for tx {id}` | Line 138 | Skipped (scanned) |
| `⚠️ No borrower phone for tx {id}` | Line 152 | Skipped (no phone) |
| `📅 Already notified for day {N} for tx {id}` | Line 182 | Skipped (duplicate) |
| `[SMS:OUT] tag={tag} to={phone} body={msg}` | Line 156 | SMS sent |
| `💾 Updated transaction fees and overdue tracking` | Line 265 | Persistence success |
| `📊 Processed: {N}, Sent: {N}, Failed: {N}` | Line 282 | Summary |

**Missing:**
- Structured logging (JSON format)
- Error rate tracking
- Per-recipient success/fail details in summary
- Fee/replacement charge attempts

#### DRY_RUN Mode

**Activation:** `server/scripts/sendOverdueReminders.js:43, 48-58`

```javascript
const DRY = has('--dry-run') || process.env.SMS_DRY_RUN === '1';

if (DRY) {
  sendSMS = async (to, body, opts = {}) => {
    console.log(`[SMS:OUT] tag=${tag} to=${to} body=${body} dry-run=true`);
    return { dryRun: true };
  };
}
```

**Effect:**
- ✅ Suppresses Twilio SMS
- ✅ Logs all targets
- ❌ Does NOT suppress protectedData updates (still persists to Flex)
- ❌ Does NOT suppress fee/replacement charges (but those aren't implemented anyway)

**Usage:**
```bash
SMS_DRY_RUN=1 node server/scripts/sendOverdueReminders.js
# or
node server/scripts/sendOverdueReminders.js --dry-run
```

---

### K. Environment Variables

#### Required Variables

| Variable | Purpose | Example | Required |
|----------|---------|---------|----------|
| `REACT_APP_SHARETRIBE_SDK_CLIENT_ID` | Flex SDK client ID | `abc123...` | ✅ Yes |
| `SHARETRIBE_SDK_CLIENT_SECRET` | Flex SDK secret | `secret123...` | ✅ Yes |
| `REACT_APP_SHARETRIBE_SDK_BASE_URL` | Flex API base URL | `https://flex-api.sharetribe.com` (no /v1) | ✅ Yes |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | `AC...` | ✅ Yes |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | `...` | ✅ Yes |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio messaging service | `MG...` | ✅ Yes |
| `LINK_SECRET` | HMAC secret for shortlinks | `random-secret` | ✅ Yes (if shortlinks enabled) |
| `PUBLIC_BASE_URL` | Public site URL | `https://www.sherbrt.com` | ✅ Yes (for shortlinks) |

#### Optional Variables

| Variable | Purpose | Default | Notes |
|----------|---------|---------|-------|
| `FORCE_TODAY` | Override today's date | Current date | For testing |
| `FORCE_NOW` | Override current timestamp | Current time | For testing |
| `SMS_DRY_RUN` | Suppress SMS sends | `0` | Set to `1` for testing |
| `ONLY_PHONE` | Filter to single phone | None | E.164 format: `+15551234567` |
| `LIMIT` | Max SMS to send | None | Integer (e.g., `10`) |
| `VERBOSE` | Detailed logging | `0` | Set to `1` |
| `UPS_LINK_MODE` | UPS link preference | `qr,label` | Comma-separated |
| `USPS_LINK_MODE` | USPS link preference | `label` | Comma-separated |
| `SHORTLINK_ENABLED` | Enable shortlinks | `true` | Set to `0` to disable |
| `SHORTLINK_BASE` | Shortlink base URL | Derived from `PUBLIC_BASE_URL` | Override if needed |
| `SHORTLINK_TTL_DAYS` | Shortlink expiry | `21` | Days |

#### Feature Flags

**None detected.** No feature flags gating late fees or replacement charges.

---

## Parity & Diff

### Summary

**Status:** ✅ **NO DIVERGENCE** between `test` and `main` branches.

**Files Checked:**
- `server/scripts/sendOverdueReminders.js` — Identical (349 lines)
- `server/util/time.js` — Identical (255 lines)
- `server/webhooks/shippoTracking.js` — Identical (717 lines)
- `server/api-util/sendSMS.js` — Identical (221 lines)
- `server/api-util/shortlink.js` — Identical (200 lines)
- `render.yaml` — Identical (48 lines for overdue worker)

**Conclusion:** Both branches share the same implementation. All findings apply to both.

---

## Gaps vs Policy

### 1. 🚨 CRITICAL: No Actual Fee Charging

**Policy:** $15/day late fees starting Day 1.

**Current State:**
- ✅ Fees calculated correctly
- ✅ Fees tracked in `protectedData.return.fees`
- ❌ **Fees NEVER charged to Stripe**

**Impact:** Borrowers see SMS warnings but are never charged. No enforcement.

**To Implement:**
1. Integrate Stripe PaymentIntent API
2. Add idempotency key: `overdue-fee-{txId}-day-{daysLate}`
3. Capture existing PaymentIntent or create separate charge
4. Log charge result in `protectedData.return.fees.charges[]`

---

### 2. 🚨 CRITICAL: No Actual Replacement Charging

**Policy:** Charge full replacement value on Day 5 if no carrier scan.

**Current State:**
- ✅ Evaluation triggered on Day 5
- ✅ Guard prevents re-evaluation (`replacementEvaluated` flag)
- ❌ **Hardcoded $50** (should use listing price)
- ❌ **Stub function** — only logs, doesn't charge

**Impact:** Borrowers see Day 5 SMS but are never charged replacement.

**To Implement:**
1. Pull replacement value from listing:
   ```javascript
   const listing = included.get(listingKey);
   const replacementAmount = listing?.attributes?.publicData?.replacementValue || 
                            listing?.attributes?.price?.amount * 2;
   ```
2. Call Stripe to charge replacement
3. Add idempotency key: `overdue-replacement-{txId}`
4. Log charge in `protectedData.return.overdue.replacementCharge`

---

### 3. ⚠️ Day 3-4 SMS Missing Shortlink

**Policy:** All overdue messages include QR/label shortlink.

**Current State:**
- Day 1: ✅ Has shortlink
- Day 2: ✅ Has shortlink
- Day 3: ❌ **Missing** (line 203)
- Day 4: ❌ **Missing** (line 206)
- Day 5+: ✅ Has shortlink

**Fix:** Add `{shortUrl}` to Day 3-4 messages.

**Example:**
```javascript
} else if (daysLate === 3) {
  message = `⏰ 3 days late. Fees continue. Ship today to avoid full replacement: ${shortUrl}`;
  tag = 'overdue_day3_to_borrower';
} else if (daysLate === 4) {
  message = `⚠️ 4 days late. Ship immediately to prevent replacement charges: ${shortUrl}`;
  tag = 'overdue_day4_to_borrower';
}
```

---

### 4. ⚠️ No "In Transit" Late Fee Accrual

**Policy:** "If 'in transit': continue to accrue late fees until scanned, but no replacement charge."

**Current State:**
- ❌ Script skips all transactions where `firstScanAt` exists (line 137-140)
- ❌ Fees stop accruing once package is scanned

**Impact:** If borrower ships late but item is in transit, they avoid ongoing fees.

**To Implement:**
1. Remove `firstScanAt` skip for fee calculation
2. Add logic:
   ```javascript
   if (returnData.firstScanAt && daysLate >= 5) {
     // In transit but shipped late: accrue fees, skip replacement
     // Don't send SMS, just update fees
   }
   ```
3. Continue sending SMS only if NOT scanned

---

### 5. ⚠️ Missing Variables in SMS

**Policy Expects:**
- Borrower first name
- Listing title
- Due date
- Actual replacement value

**Current Messages:**
- ❌ Generic (no personalization)
- ❌ Hardcoded $50 replacement

**Fix:**
```javascript
const borrowerName = customer?.attributes?.profile?.firstName || 'there';
const listingTitle = listing?.attributes?.title || 'your item';
const dueDate = yyyymmdd(returnDate);
const replacementValue = listing?.attributes?.publicData?.replacementValue || 5000;

// Day 1 example:
message = `⚠️ Hi ${borrowerName}, "${listingTitle}" was due ${dueDate}. Please ship today to avoid $15/day late fees. QR: ${shortUrl}`;
```

---

### 6. ⚠️ Hardcoded Replacement Amount

**Location:** `server/scripts/sendOverdueReminders.js:88, 210`

**Current:** `5000` cents ($50)

**Should Be:**
```javascript
const listing = included.get(listingKey);
const replacementAmount = listing?.attributes?.publicData?.replacementValue || 
                         listing?.attributes?.publicData?.retailPrice || 
                         listing?.attributes?.price?.amount * 2 ||
                         5000; // Fallback
```

---

## Safety & Robustness Assessment

### ✅ Strengths

1. **Idempotency:** Per-day SMS guard prevents duplicates
2. **Time-travel testing:** Full `FORCE_NOW` / `FORCE_TODAY` support
3. **DRY_RUN mode:** Safe testing without sending SMS
4. **Webhook-backed scan detection:** No polling overhead
5. **Render worker:** Auto-restarts, daily scheduling
6. **Shortlink fallback:** Returns original URL if shortlink fails
7. **ONLY_PHONE filter:** Single-recipient testing

### ⚠️ Weaknesses

1. **In-memory cache:** `recentSends` Map resets on restart (60s window)
2. **No structured logging:** Hard to parse, no JSON output
3. **No charge implementation:** Fees/replacement are tracked but not enforced
4. **Hardcoded values:** $15/day and $50 replacement
5. **Missing variables:** No personalization in SMS
6. **No error aggregation:** Per-recipient failures not tracked
7. **No late shipment accrual:** Fees stop once scanned

---

## Verification Commands

### 1. Dry-Run with Controlled Clock

**Test Day-1 Overdue:**
```bash
# Set date to 1 day after a known return date
export FORCE_TODAY=2025-11-09  # If return date is 2025-11-08
export SMS_DRY_RUN=1
export VERBOSE=1

node server/scripts/sendOverdueReminders.js
```

**Expected Output:**
```
🚀 Starting overdue reminder SMS script...
[TIME] FORCE_TODAY=2025-11-09
📅 Processing overdue reminders for: 2025-11-09
📊 Found N delivered transactions
📬 To +1555... (tx abc123, 1 days late) → ⚠️ Due yesterday...
[SMS:OUT] tag=overdue_day1_to_borrower to=+1555... body="..." dry-run=true
💾 Updated transaction fees and overdue tracking for tx abc123
📊 Processed: N, Sent: M, Failed: 0
```

---

### 2. Test Day-5 Replacement Evaluation

**Setup:**
```bash
export FORCE_TODAY=2025-11-13  # If return date is 2025-11-08
export SMS_DRY_RUN=1
export VERBOSE=1

node server/scripts/sendOverdueReminders.js
```

**Expected Output:**
```
📬 To +1555... (tx abc123, 5 days late) → 🚫 5 days late...
🔍 Evaluating replacement charge for tx abc123
🔍 Evaluated replacement charge for Day 5: $50
[SMS:OUT] tag=overdue_day5_to_borrower to=+1555... body="..." dry-run=true
💾 Updated transaction fees and overdue tracking for tx abc123
```

---

### 3. Real Run (Single Recipient)

**Setup:**
```bash
export ONLY_PHONE=+15551234567  # Replace with test phone
export LIMIT=1  # Safety: max 1 SMS

node server/scripts/sendOverdueReminders.js
```

**Expected:**
- SMS delivered to `+15551234567` only
- All other borrowers skipped

---

### 4. Tail Logs for Twilio Sends

**Local:**
```bash
node server/scripts/sendOverdueReminders.js | grep -E '(SMS|overdue|Processed)'
```

**Render:**
```bash
render logs -s overdue-reminders --tail
```

**Filter:**
```bash
render logs -s overdue-reminders | grep -E '\[SMS:OUT\]|Processed|Failed'
```

---

### 5. Test Carrier Scan Detection

**Simulate Webhook:**
```bash
# Requires TEST_ENDPOINTS=1 in .env

curl -X POST http://localhost:3000/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{
    "txId": "abc123-def456-...",
    "status": "IN_TRANSIT",
    "metadata": { "direction": "return" }
  }'
```

**Expected:**
- Sets `firstScanAt` in `transaction.protectedData.return`
- Next overdue run will skip this transaction

---

## Recommendations

### Priority 1: Implement Fee & Replacement Charging

**Timeline:** 2-3 days

**Tasks:**
1. Add Stripe integration to `evaluateReplacementCharge()`
2. Add daily fee charging in main loop (after SMS send)
3. Implement idempotency keys
4. Pull replacement value from listing metadata
5. Add charge logging to protectedData
6. Test with Stripe test mode

**Files to Modify:**
- `server/scripts/sendOverdueReminders.js` (add Stripe calls)
- Create: `server/lib/stripe.js` (charge helpers)
- Create: `server/lib/fees.js` (fee calculation + charging)

---

### Priority 2: Fix Day 3-4 SMS Shortlinks

**Timeline:** 15 minutes

**Change:**
```javascript
} else if (daysLate === 3) {
  message = `⏰ 3 days late. Fees continue. Ship today to avoid full replacement: ${shortUrl}`;
  tag = 'overdue_day3_to_borrower';
} else if (daysLate === 4) {
  message = `⚠️ 4 days late. Ship immediately to prevent replacement charges: ${shortUrl}`;
  tag = 'overdue_day4_to_borrower';
}
```

---

### Priority 3: Personalize SMS Messages

**Timeline:** 1 hour

**Add:**
```javascript
const borrowerName = customer?.attributes?.profile?.firstName || 'there';
const listingTitle = listing?.attributes?.title || 'your item';
```

**Update all messages** to include `${borrowerName}` and `"${listingTitle}"`.

---

### Priority 4: Implement Late Shipment Fee Accrual

**Timeline:** 1-2 hours

**Logic:**
```javascript
if (returnData.firstScanAt && daysLate >= 5) {
  // Item is in transit but was shipped late
  // Accrue fees but skip replacement and SMS
  console.log(`📦 In transit but shipped late: tx ${tx.id}, ${daysLate} days`);
  
  // Update fees silently (no SMS)
  await sdk.transactions.update({
    id: tx.id,
    attributes: {
      protectedData: {
        ...protectedData,
        return: {
          ...returnData,
          fees: {
            perDayCents: 1500,
            totalCents: 1500 * daysLate,
            startedAt: feesStartedAt,
            inTransitAccrual: true
          }
        }
      }
    }
  });
  
  continue; // Skip SMS send
}
```

---

### Priority 5: Add Structured Logging

**Timeline:** 1 hour

**Replace:**
```javascript
console.log(`📊 Processed: ${processed}, Sent: ${sent}, Failed: ${failed}`);
```

**With:**
```javascript
console.log(JSON.stringify({
  event: 'overdue_reminders_complete',
  timestamp: new Date().toISOString(),
  stats: { processed, sent, failed },
  recipientDetails: [...] // Array of { txId, phone, daysLate, status }
}));
```

---

## Conclusion

### Overall Robustness: **6/10**

**What Works:**
- ✅ Scheduling, SMS escalation, idempotency, time-travel testing, carrier scan detection

**What's Missing:**
- 🚨 **Actual fee charging** (critical)
- 🚨 **Actual replacement charging** (critical)
- ⚠️ Day 3-4 shortlinks, personalization, late shipment accrual

### Deployment Readiness

**Status:** ⚠️ **NOT PRODUCTION-READY** until Stripe charging is implemented.

**Current State:**
- ✅ Safe to deploy (no charges will occur)
- ⚠️ SMS will send but fees won't be enforced

**Recommendation:** Implement Priority 1 (Stripe charging) before enabling overdue-reminders worker in production.

---

**Report Generated:** November 5, 2025  
**Next Review:** After Stripe integration (Priority 1)


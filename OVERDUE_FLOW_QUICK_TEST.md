# Overdue Flow Quick Test Guide

**Branch:** test (identical to main)  
**Last Updated:** November 5, 2025

---

## 🚨 Quick Status

**Implementation:** ✅ Complete infrastructure, ❌ Missing Stripe charging  
**Branch Parity:** ✅ test and main are **identical**  
**Production Ready:** ⚠️ **NO** — fees calculated but not charged

---

## Quick Verification Commands

### 1. Dry-Run Test (Day 1 Overdue)

```bash
# Set environment
export FORCE_TODAY=2025-11-09  # Adjust: 1 day after a known return date
export SMS_DRY_RUN=1
export VERBOSE=1

# Run script
node server/scripts/sendOverdueReminders.js

# Expected output:
# 🚀 Starting overdue reminder SMS script...
# [TIME] FORCE_TODAY=2025-11-09
# 📅 Processing overdue reminders for: 2025-11-09
# 📊 Found N delivered transactions
# 📬 To +1555... (tx abc123, 1 days late) → ⚠️ Due yesterday...
# [SMS:OUT] tag=overdue_day1_to_borrower to=+1555... dry-run=true
# 💾 Updated transaction fees and overdue tracking for tx abc123
# 📊 Processed: N, Sent: M, Failed: 0
```

---

### 2. Test Day-5 Replacement Evaluation

```bash
export FORCE_TODAY=2025-11-13  # 5 days after return date (e.g., 2025-11-08)
export SMS_DRY_RUN=1

node server/scripts/sendOverdueReminders.js | grep -E '(replacement|day 5)'

# Expected:
# 🔍 Evaluating replacement charge for tx abc123
# 🔍 Evaluated replacement charge for Day 5: $50
# [SMS:OUT] tag=overdue_day5_to_borrower ... body="🚫 5 days late..."
```

---

### 3. Real Run (Single Test Phone)

```bash
# CAUTION: Sends real SMS!
export ONLY_PHONE=+15551234567  # Replace with YOUR test phone
export LIMIT=1

node server/scripts/sendOverdueReminders.js

# Verify SMS received on test phone
```

---

### 4. Check Carrier Scan Detection

```bash
# Requires TEST_ENDPOINTS=1 in .env

curl -X POST http://localhost:3000/api/webhooks/__test/shippo/track \
  -H "Content-Type: application/json" \
  -d '{
    "txId": "YOUR_TX_UUID",
    "status": "IN_TRANSIT",
    "metadata": { "direction": "return" }
  }'

# Expected response:
# { "ok": true, "message": "Return shipment - no borrower SMS" }

# Verify firstScanAt was set:
# Check transaction.protectedData.return.firstScanAt
```

---

### 5. Verify Scheduling (Daemon Mode)

```bash
# Start daemon
node server/scripts/sendOverdueReminders.js --daemon

# Expected logs:
# 🔄 Starting overdue reminders daemon (daily at 9 AM UTC)
# ⏰ Next run scheduled for: 2025-11-06T09:00:00.000Z
# 🚀 Starting overdue reminder SMS script... (runs immediately)
```

**Production:** Render worker runs with `--daemon` flag (see `render.yaml:44`)

---

## Key Findings Summary

### ✅ What Works

1. **Daily scheduler** — Render worker daemon, 9 AM UTC
2. **SMS escalation** — Days 1-5+ with distinct messages
3. **Idempotency** — `lastNotifiedDay` prevents duplicate SMS
4. **Carrier scan detection** — Webhook sets `firstScanAt`, script skips scanned returns
5. **Fee calculation** — $15/day, stored in `protectedData.return.fees`
6. **Replacement evaluation** — Triggered Day 5, guarded by `replacementEvaluated` flag
7. **Time-travel testing** — `FORCE_TODAY` / `FORCE_NOW` support
8. **DRY_RUN mode** — Safe testing without sending SMS
9. **Shortlinks** — QR/label URLs compressed for SMS

### 🚨 Critical Gaps

1. **NO STRIPE CHARGING** — Fees calculated but never charged
2. **NO REPLACEMENT CHARGING** — Day-5 evaluation is a stub (logs only)
3. **Day 3-4 missing shortlink** — Policy requires links for all messages
4. **Hardcoded $50 replacement** — Should pull from listing metadata
5. **No "in transit" fee accrual** — Policy says fees continue if shipped late
6. **No personalization** — SMS lacks borrower name, listing title

---

## Environment Variables

### Required

```bash
export REACT_APP_SHARETRIBE_SDK_CLIENT_ID="abc123..."
export SHARETRIBE_SDK_CLIENT_SECRET="secret123..."
export REACT_APP_SHARETRIBE_SDK_BASE_URL="https://flex-api.sharetribe.com"  # NO /v1 suffix

export TWILIO_ACCOUNT_SID="AC..."
export TWILIO_AUTH_TOKEN="..."
export TWILIO_MESSAGING_SERVICE_SID="MG..."

export LINK_SECRET="random-secret-key"
export PUBLIC_BASE_URL="https://www.sherbrt.com"
```

### Testing Overrides

```bash
export FORCE_TODAY=2025-11-09         # Override today's date
export FORCE_NOW=2025-11-09T10:00:00Z # Override current timestamp
export SMS_DRY_RUN=1                  # Suppress SMS sends
export ONLY_PHONE=+15551234567        # Filter to single recipient
export LIMIT=10                       # Max SMS to send
export VERBOSE=1                      # Detailed logging
```

---

## SMS Templates

| Day | Message | Shortlink |
|-----|---------|-----------|
| 1 | ⚠️ Due yesterday. Please ship today to avoid $15/day late fees. QR: {link} | ✅ Yes |
| 2 | 🚫 2 days late. $15/day fees are adding up. Ship now: {link} | ✅ Yes |
| 3 | ⏰ 3 days late. Fees continue. Ship today to avoid full replacement. | ❌ **Missing** |
| 4 | ⚠️ 4 days late. Ship immediately to prevent replacement charges. | ❌ **Missing** |
| 5+ | 🚫 5 days late. You may be charged full replacement ($50). Avoid this by shipping today: {link} | ✅ Yes |

**Note:** Day 3-4 missing shortlinks is a known gap (see Priority 2 in full report).

---

## Files to Review

| File | Lines | Purpose |
|------|-------|---------|
| `server/scripts/sendOverdueReminders.js` | 1-349 | Main script logic |
| `server/util/time.js` | 1-255 | Time helpers (FORCE_NOW support) |
| `server/webhooks/shippoTracking.js` | 344-417 | Sets `firstScanAt` on carrier scan |
| `server/api-util/sendSMS.js` | 1-221 | Twilio SMS sending |
| `server/api-util/shortlink.js` | 1-200 | Shortlink generation |
| `render.yaml` | 39-48 | Render worker configuration |

---

## Next Steps

### Priority 1: Implement Stripe Charging

**Timeline:** 2-3 days  
**Files to Create:**
- `server/lib/stripe.js` — Charge helpers
- `server/lib/fees.js` — Fee calculation + charging

**Files to Modify:**
- `server/scripts/sendOverdueReminders.js` — Add Stripe calls

**Tasks:**
1. Add daily fee charging (after SMS send)
2. Add replacement charging on Day 5
3. Pull replacement value from listing metadata
4. Implement idempotency keys
5. Test with Stripe test mode

### Priority 2: Fix Day 3-4 Shortlinks

**Timeline:** 15 minutes  
**Location:** `server/scripts/sendOverdueReminders.js:203, 206`

**Change:**
```javascript
} else if (daysLate === 3) {
  message = `⏰ 3 days late. Fees continue. Ship today to avoid full replacement: ${shortUrl}`;
} else if (daysLate === 4) {
  message = `⚠️ 4 days late. Ship immediately to prevent replacement charges: ${shortUrl}`;
}
```

### Priority 3: Personalize SMS

**Timeline:** 1 hour  
**Add:** Borrower name, listing title, actual replacement value

---

## Robustness Score: 6/10

**Strengths:**
- ✅ Scheduling, idempotency, time-travel testing, carrier detection

**Weaknesses:**
- 🚨 No actual charging (critical gap)
- ⚠️ Missing shortlinks, personalization, late shipment accrual

---

## Production Readiness

**Status:** ⚠️ **NOT PRODUCTION-READY**

**Why:** Fees are calculated but never charged. SMS will send but enforcement is missing.

**Recommendation:** Deploy only after implementing Priority 1 (Stripe charging).

---

**Full Report:** See `OVERDUE_FLOW_AUDIT_REPORT.md` for complete details.


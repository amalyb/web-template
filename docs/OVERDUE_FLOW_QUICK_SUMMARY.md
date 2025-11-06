# Overdue Flow - Quick Summary

**📋 Full Report:** See `docs/overdue_late_fee_status.md`  
**Date:** November 6, 2025

---

## 🚨 Critical Findings

### Main Branch Status: ❌ NOT PRODUCTION-READY

**The `main` branch only sends SMS reminders. It does NOT charge late fees or replacement charges.**

| Feature | Test Branch | Main Branch |
|---------|-------------|-------------|
| SMS Reminders | ✅ Works | ✅ Works |
| Late Fee Charging ($15/day) | ✅ **IMPLEMENTED** | ❌ **STUB ONLY** |
| Day-5 Replacement | ✅ **IMPLEMENTED** | ❌ **STUB ONLY** |
| Stripe Integration | ✅ **WIRED** | ❌ **NOT WIRED** |
| Idempotency Guards | ✅ **PRESENT** | ❌ **MISSING** |

---

## ✅ What's Working (Test Branch)

1. **✅ Scheduler:** Render worker runs daily at 9 AM UTC
2. **✅ SMS Templates:** All 5 templates present (Day 1-5)
3. **✅ Charging Logic:** Full implementation in `server/lib/lateFees.js`
4. **✅ Idempotency:** No double-charging, tracks `lastLateFeeDayCharged` and `replacementCharged`
5. **✅ Carrier Scan:** Stops charges when package is scanned
6. **✅ Flex Transition:** `privileged-apply-late-fees` defined in process.edn
7. **✅ Diagnostic Tool:** New script at `scripts/diagnose-overdue.js`

---

## ❌ Issues Found

### High Priority

1. **❌ BLOCKER: Main branch lacks charging implementation**
   - Fix: Merge `server/lib/lateFees.js` from test → main
   - Fix: Update `sendOverdueReminders.js` to use `applyCharges()`

2. **❌ BLOCKER: Main branch missing Integration SDK env vars**
   - Fix: Add `INTEGRATION_CLIENT_ID` and `INTEGRATION_CLIENT_SECRET` to Render

3. **❌ Day 3 & 4 SMS missing QR links**
   - Current: "3 days late. Fees continue. Ship today to avoid full replacement."
   - Should be: "... Ship today to avoid full replacement. QR: {shortUrl}"

4. **⚠️ Policy Mismatch: "In Transit" handling**
   - Requirement: "Keep late fees but no replacement charge"
   - Current code: Stops both fees AND replacement when "in transit"
   - Needs clarification and possible code update

### Medium Priority

5. **⚠️ No feature flags** (can't disable charging without code deploy)
6. **⚠️ Hardcoded values** (late fee amount, Day-5 threshold)
7. **⚠️ Missing personalization** (no borrower name, no item title in SMS)

---

## 🔧 Quick Test Commands

### Test Branch (Has Full Implementation)

```bash
# Switch to test branch
git checkout test

# Dry-run overdue script
DRY_RUN=1 node server/scripts/sendOverdueReminders.js

# Diagnostic for specific transaction
FORCE_NOW="2025-11-10T12:00:00Z" node scripts/diagnose-overdue.js --transaction abc-123-def

# 5-day escalation simulation
node scripts/diagnose-overdue.js --transaction abc-123-def --matrix
```

### Main Branch (SMS Only)

```bash
# Switch to main branch
git checkout main

# Dry-run overdue script (will NOT charge, only log)
DRY_RUN=1 node server/scripts/sendOverdueReminders.js
```

---

## 📊 Business Rules Status

| Rule | Status | Notes |
|------|--------|-------|
| Every 24h after return date | ✅ PASS | Scheduled at 9 AM UTC daily |
| $15/day late fee | ✅ PASS | Correct amount (1500 cents) |
| Start on Day 1 late | ✅ PASS | `if (lateDays >= 1)` |
| Stop on carrier scan | ⚠️ POLICY | Stops on "in transit" (clarify if should continue) |
| Day-5 replacement charge | ✅ PASS | Charges full listing value |
| Idempotent (no double-charge) | ✅ PASS | Tracks by date + boolean flag |
| SMS escalation (5 templates) | ⚠️ PARTIAL | Day 3 & 4 missing links |

---

## 🚀 Path to Production

### Step 1: Merge Code (test → main)
```bash
git checkout main
git merge test -- server/lib/lateFees.js
git merge test -- server/scripts/sendOverdueReminders.js
# Review diffs carefully
```

### Step 2: Fix SMS Templates
```javascript
// Day 3 (line 250)
message = `⏰ 3 days late. Fees continue. Ship today to avoid full replacement: ${shortUrl}`;

// Day 4 (line 253)
message = `⚠️ 4 days late. Ship immediately to prevent replacement charges: ${shortUrl}`;
```

### Step 3: Add Environment Variables (Render)

```bash
# Add to main branch Render environment
INTEGRATION_CLIENT_ID=<from-flex-console>
INTEGRATION_CLIENT_SECRET=<from-flex-console>

# Verify existing
TWILIO_ACCOUNT_SID=<should-exist>
TWILIO_AUTH_TOKEN=<should-exist>
TWILIO_MESSAGING_SERVICE_SID=<should-exist>
PUBLIC_BASE_URL=https://sherbrt.com
```

### Step 4: Add Feature Flags (Recommended)

```bash
# Allow easy disable if issues detected
LATE_FEES_ENABLED=true
REPLACEMENT_CHARGE_ENABLED=true
```

### Step 5: Test on Staging

```bash
# Run diagnostic on staging with real transaction
FORCE_NOW="2025-11-10T12:00:00Z" node scripts/diagnose-overdue.js --transaction <real-tx-id>

# Run full script in dry-run
DRY_RUN=1 node server/scripts/sendOverdueReminders.js
```

### Step 6: Deploy & Monitor

- [ ] Deploy to main
- [ ] Monitor Render logs for 48 hours
- [ ] Check Stripe dashboard for charges
- [ ] Monitor customer support tickets
- [ ] Review for double-charge incidents

---

## 📞 Diagnostic Tool Usage

**File:** `scripts/diagnose-overdue.js` (NEW)

### Basic Dry-Run
```bash
FORCE_NOW="2025-11-11T12:00:00Z" node scripts/diagnose-overdue.js --transaction abc-123-def
```

**Output includes:**
- Days late calculation
- Carrier scan status
- SMS preview (exact message that would be sent)
- Charge preview (late fee + replacement amounts)
- Idempotency check (what's already been charged)
- Business logic decision tree

### 5-Day Matrix Simulation
```bash
node scripts/diagnose-overdue.js --transaction abc-123-def --matrix
```

**Output:** Complete 5-day escalation sequence showing:
- Day 1: First late fee + Day 1 SMS
- Day 2: Second late fee + Day 2 SMS
- Day 3: Third late fee + Day 3 SMS
- Day 4: Fourth late fee + Day 4 SMS
- Day 5: Fifth late fee + replacement charge + Day 5 SMS

---

## 🎯 Recommended Action Plan

### Immediate (Before Any Production Deployment)

1. ✅ **Clarify "in transit" policy** - Finance/Operations decision needed
2. ✅ **Merge late fee code from test → main** - Engineering task
3. ✅ **Fix SMS templates (Day 3 & 4)** - Engineering task
4. ✅ **Add Integration SDK credentials to Render** - DevOps task

### Short-Term (Week 1)

5. ✅ **Add feature flags** - Engineering task
6. ✅ **Set up monitoring/alerting** - DevOps task
7. ✅ **Test on staging with real data** - QA task
8. ✅ **Prepare rollback plan** - Operations task

### Medium-Term (Month 1)

9. ⚠️ **Add personalization to SMS** - Product/Engineering
10. ⚠️ **Build admin dashboard** - Engineering task
11. ⚠️ **Make values configurable** - Engineering task

---

## 📂 Key Files

| File | Purpose |
|------|---------|
| `docs/overdue_late_fee_status.md` | **Full detailed report (this audit)** |
| `server/lib/lateFees.js` | Core charging logic (test branch only) |
| `server/scripts/sendOverdueReminders.js` | Main overdue script |
| `scripts/diagnose-overdue.js` | Diagnostic tool (NEW) |
| `ext/transaction-processes/default-booking/process.edn` | Flex transition definition |
| `render.yaml` | Scheduler configuration |

---

## ⚠️ WARNINGS

1. **Do NOT deploy main branch to production** until late fee code is merged
2. **Do NOT set SMS_DRY_RUN=0** on production until thoroughly tested on staging
3. **Do NOT enable on main** without verifying Integration SDK credentials
4. **Do have a rollback plan** ready before first production run
5. **Do monitor closely** for first week after enabling

---

## 📞 Support

**Questions or issues?**
- Review full report: `docs/overdue_late_fee_status.md`
- Run diagnostic: `scripts/diagnose-overdue.js --help`
- Check logs: Render Dashboard → overdue-reminders worker
- Stripe dashboard: https://dashboard.stripe.com

**Last Updated:** November 6, 2025  
**Next Review:** After test → main merge


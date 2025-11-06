# Final Test Instructions - Ready to Execute

**Status:** ✅ Code complete, ⚠️ Environment variables needed to run tests  
**Branch:** `feat/overdue-prod-parity` ✅  
**Transaction ID:** `690d06cf-24c8-45af-8ad7-aec8e7d51b62` ✅  
**Diagnostic Tool:** `scripts/diagnose-overdue.js` ✅

---

## ⚠️ Issue: Environment Variables Not Accessible

The diagnostic tool requires these environment variables:
- `REACT_APP_SHARETRIBE_SDK_CLIENT_ID`
- `SHARETRIBE_SDK_CLIENT_SECRET`
- `INTEGRATION_CLIENT_ID` (optional but recommended)
- `INTEGRATION_CLIENT_SECRET` (optional but recommended)

**Your `.env` file exists** but is gitignored for security (correct!).

---

## 🚀 Run Tests Manually (Copy & Paste)

Open a **new terminal window** and run:

```bash
# Navigate to project
cd /Users/amaliabornstein/shop-on-sherbet-cursor

# Confirm branch
git branch --show-current
# Should show: feat/overdue-prod-parity

# Load environment variables
source .env

# Verify they loaded
echo "SDK Client ID set: $([ -n "$REACT_APP_SHARETRIBE_SDK_CLIENT_ID" ] && echo 'YES ✅' || echo 'NO ❌')"
echo "SDK Secret set: $([ -n "$SHARETRIBE_SDK_CLIENT_SECRET" ] && echo 'YES ✅' || echo 'NO ❌')"
echo "Integration ID set: $([ -n "$INTEGRATION_CLIENT_ID" ] && echo 'YES ✅' || echo 'NO ❌')"

# Create outputs directory
mkdir -p test-outputs

# Test 1: 5-Day Matrix Simulation
echo "Running matrix test..."
node scripts/diagnose-overdue.js \
  --transaction 690d06cf-24c8-45af-8ad7-aec8e7d51b62 \
  --matrix \
  2>&1 | tee test-outputs/main-branch-matrix.txt

# Check exit code
echo "Matrix test exit code: $?"

# Test 2: Single Day (Force NOW)
echo "Running single day test..."
FORCE_NOW="2025-11-11T12:00:00Z" \
  node scripts/diagnose-overdue.js \
  --transaction 690d06cf-24c8-45af-8ad7-aec8e7d51b62 \
  2>&1 | tee test-outputs/main-branch-forcenow.txt

# Check exit code
echo "Single day test exit code: $?"

# Test 3: Idempotency Check (run twice)
echo "Running idempotency test (run 1)..."
FORCE_NOW="2025-11-11T12:00:00Z" \
  node scripts/diagnose-overdue.js \
  --transaction 690d06cf-24c8-45af-8ad7-aec8e7d51b62 \
  2>&1 | tee test-outputs/idempotency-run1.txt

echo "Running idempotency test (run 2 - same time)..."
FORCE_NOW="2025-11-11T12:00:00Z" \
  node scripts/diagnose-overdue.js \
  --transaction 690d06cf-24c8-45af-8ad7-aec8e7d51b62 \
  2>&1 | tee test-outputs/idempotency-run2.txt

# Compare runs
echo "Comparing idempotency runs..."
diff test-outputs/idempotency-run1.txt test-outputs/idempotency-run2.txt > test-outputs/idempotency-diff.txt || true

# Show summary
echo ""
echo "══════════════════════════════════════════════════"
echo "✅ TESTS COMPLETE - Review outputs in test-outputs/"
echo "══════════════════════════════════════════════════"
ls -lh test-outputs/
```

---

## 📋 What to Look For in Outputs

### Test 1: Matrix Output (`main-branch-matrix.txt`)

**Should show 5 days:**

```
▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
   DAY 1 LATE: 2025-11-XX
▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼

📊 Days late: 1
📱 SMS: ⚠️ Due yesterday. Please ship today to avoid $15/day late fees. QR: https://...
💳 Late Fee: $15.00
💰 TOTAL: $15.00

▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
   DAY 3 LATE: 2025-11-XX  ← CHECK THIS
▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼

📊 Days late: 3
📱 SMS: ⏰ 3 days late. Fees continue. Ship today to avoid full replacement: https://...
        ✅ VERIFY: Link should be present after "replacement:"
💳 Late Fee: $15.00
💰 TOTAL: $15.00

▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
   DAY 4 LATE: 2025-11-XX  ← CHECK THIS
▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼

📊 Days late: 4
📱 SMS: ⚠️ 4 days late. Ship immediately to prevent replacement charges: https://...
        ✅ VERIFY: Link should be present after "charges:"
💳 Late Fee: $15.00
💰 TOTAL: $15.00

▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
   DAY 5 LATE: 2025-11-XX
▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼

📊 Days late: 5
💳 Late Fee: $15.00
💳 Replacement: $XXX.XX  ← Should appear on Day 5
💰 TOTAL: $XXX.XX (fee + replacement)
```

### Test 2: Single Day Output (`main-branch-forcenow.txt`)

**Should show:**
- Transaction diagnostic header
- Days late calculation
- Carrier status check
- Policy status: `delivered=false, carrierHasPackage=...`
- SMS preview with link
- Charge preview with amounts
- Idempotency status

### Test 3: Idempotency (`idempotency-diff.txt`)

**Should show differences:**
- Run 1: "✅ Late Fee: $15.00" (will charge)
- Run 2: "❌ Late Fee: $15.00 - SKIP: Already charged today"

---

## ✅ Verification Checklist

After running tests, check these items:

### Critical Fixes Verification
- [ ] **Day 3 SMS includes link** - Look for `: https://` at end
- [ ] **Day 4 SMS includes link** - Look for `: https://` at end
- [ ] **Day 5 shows replacement** - Both late fee AND replacement

### Policy Changes Verification
- [ ] **Policy logging shows new functions** - Look for `hasCarrierScan`, `isDelivered`
- [ ] **Late fees on all days** - Day 1-5 each show $15.00

### Technical Verification
- [ ] **No errors or crashes** - All tests complete successfully
- [ ] **Idempotency works** - Run 2 shows "already charged"
- [ ] **Exit codes are 0** - No failures

---

## 📊 Quick Sanity Check

After running tests, check the outputs:

```bash
# View first 120 lines of all outputs
tail -n +1 test-outputs/*.txt | sed -n '1,120p'

# Search for key patterns
grep -E "Days late|SMS|Charge|Idempotency|carrierHasPackage|delivered=" test-outputs/*.txt

# Count occurrences
echo "Day 3 SMS with link:"
grep "3 days late.*https://" test-outputs/main-branch-matrix.txt && echo "✅ PASS" || echo "❌ FAIL"

echo "Day 4 SMS with link:"
grep "4 days late.*https://" test-outputs/main-branch-matrix.txt && echo "✅ PASS" || echo "❌ FAIL"

echo "Day 5 replacement:"
grep "Replacement:" test-outputs/main-branch-matrix.txt | grep -E "\$[0-9]+" && echo "✅ PASS" || echo "❌ FAIL"

echo "Policy logging:"
grep "hasCarrierScan\|isDelivered" test-outputs/*.txt && echo "✅ PASS" || echo "❌ FAIL"
```

---

## 🎯 Expected Results

### ✅ All Tests Should Pass

**Matrix test:**
- Exit code: 0
- Shows all 5 days
- Day 3 & 4 have links
- Day 5 has replacement
- No errors

**Single day test:**
- Exit code: 0
- Shows correct calculation
- SMS preview correct
- Charge preview correct

**Idempotency test:**
- Run 1 and Run 2 differ
- Run 2 says "already charged"
- No double-charge

---

## 📝 Document Results

Create a summary:

```bash
cat > test-outputs/TEST_SUMMARY.md << 'EOF'
# Test Results Summary

**Date:** $(date)
**Branch:** feat/overdue-prod-parity
**Transaction ID:** 690d06cf-24c8-45af-8ad7-aec8e7d51b62

## Matrix Test
- **Status:** [PASS/FAIL]
- **Day 3 link:** [YES/NO]
- **Day 4 link:** [YES/NO]
- **Day 5 replacement:** [YES/NO]
- **Exit code:** [0 or error]

## Single Day Test
- **Status:** [PASS/FAIL]
- **Exit code:** [0 or error]

## Idempotency Test
- **Status:** [PASS/FAIL]
- **No double-charge:** [YES/NO]

## Overall
- **All tests passing:** [YES/NO]
- **Ready for production:** [YES/NO]
- **Blockers:** [None / List issues]

## Notes
[Add any observations]
EOF

# Edit with actual results
nano test-outputs/TEST_SUMMARY.md
```

---

## 🚀 After Tests Pass

### 1. Commit Test Outputs

```bash
git add test-outputs/
git commit -m "test: Add dry-run validation outputs

- Matrix test (5-day simulation)
- Single day test (FORCE_NOW)
- Idempotency verification
- All tests passing
- Transaction: 690d06cf-24c8-45af-8ad7-aec8e7d51b62
- Day 3 & 4 SMS links verified
- Policy changes verified
- Ready for review"
```

### 2. Push Branch

```bash
# Push to remote
git push origin feat/overdue-prod-parity
```

### 3. Open PR

**Use the PR description from:** `PR_DESCRIPTION_OVERDUE_PROD_PARITY.md`

**Add to PR:**
- Link to test outputs (in repo)
- Paste key excerpts (Day 3/4 SMS, policy logging)
- Note: "All dry-run tests passing"

**Request reviews from:**
- Engineering (code review)
- Finance (policy approval)
- Operations (deployment readiness)

---

## ❌ If Tests Fail

### Error: "Missing SDK creds"
```bash
# Environment not loaded
source .env

# Verify
env | grep SHARETRIBE
```

### Error: "Transaction not found"
```bash
# Transaction doesn't exist or wrong format
# Get a different transaction ID from Flex Console
```

### Error: Module not found
```bash
# Wrong branch
git checkout feat/overdue-prod-parity

# Check file exists
ls scripts/diagnose-overdue.js
```

### Day 3/4 links missing
```bash
# Check the code
grep -A1 "3 days late\|4 days late" server/scripts/sendOverdueReminders.js

# Should see:
# message = `⏰ 3 days late... : ${shortUrl}`;
# message = `⚠️ 4 days late... : ${shortUrl}`;
```

---

## 📞 Quick Reference

**Files:**
- `PR_DESCRIPTION_OVERDUE_PROD_PARITY.md` - PR description template
- `docs/overdue_late_fee_status.md` - Full audit
- `docs/OVERDUE_FLOW_QUICK_SUMMARY.md` - Quick reference
- `IMPLEMENTATION_COMPLETE_SUMMARY.md` - Status overview

**Branch:** `feat/overdue-prod-parity`  
**Transaction ID:** `690d06cf-24c8-45af-8ad7-aec8e7d51b62`  
**Test time:** ~15-20 minutes  

---

## ✅ Final Checklist

Before opening PR:

- [ ] Environment variables loaded (`source .env`)
- [ ] All 3 tests run successfully
- [ ] Test outputs saved in `test-outputs/`
- [ ] Day 3 SMS link verified in output
- [ ] Day 4 SMS link verified in output
- [ ] Day 5 replacement verified in output
- [ ] Idempotency verified (no double-charge)
- [ ] Test summary documented
- [ ] Test outputs committed to git
- [ ] Branch pushed to remote
- [ ] PR opened with description
- [ ] Reviews requested

---

**You're almost there! Just need to run these commands in a terminal with your environment loaded.** 🚀

**Time needed:** 15-20 minutes  
**Commands:** Copy & paste from above  
**Next:** Open PR after tests pass


# Run Dry Tests NOW - Step-by-Step Guide

**Date:** November 6, 2025  
**Status:** ⚠️ **ACTION REQUIRED** - You need to run these tests manually

---

## ⚠️ Important Note

The diagnostic tests require:
1. **Network access** to Flex API
2. **Real transaction IDs** from your Sharetribe database
3. **Environment variables** loaded (from `.env` or `.env.test`)

I've prepared everything for you, but **you need to run the commands below** with your actual transaction IDs.

---

## 📋 Prerequisites

### 1. Find Test Transaction IDs

You need 1-2 transaction IDs that meet these criteria:
- State: `delivered` (booking completed)
- Return date is in the past (overdue)
- Has borrower phone number
- Ideally has different statuses for different tests:
  - One with no carrier scan (not yet shipped back)
  - One with carrier scan (in transit)
  - One delivered back (optional)

**How to find transaction IDs:**

**Option A: Flex Console**
```
1. Go to: https://flex-console.sharetribe.com
2. Navigate to: Build → Console → Transactions
3. Filter by state: "delivered"
4. Sort by: Most recent
5. Click a transaction → Copy UUID from URL
   Example URL: .../transactions/abc-123-def-456
   Transaction ID: abc-123-def-456
```

**Option B: Query via API** (if you have access)
```bash
# Example query to find recent delivered transactions
curl -X POST https://flex-api.sharetribe.com/v1/api/transactions/query \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"state":"delivered","per_page":5}'
```

**Option C: Database Query** (if direct access)
```sql
SELECT id, state, created_at 
FROM transactions 
WHERE state = 'delivered' 
ORDER BY created_at DESC 
LIMIT 5;
```

---

## 🧪 Test Commands

### Setup Environment

```bash
cd /Users/amaliabornstein/shop-on-sherbet-cursor

# Load environment variables
source .env.test  # or source .env if you prefer

# Verify env vars loaded
echo "Client ID: ${REACT_APP_SHARETRIBE_SDK_CLIENT_ID:0:10}..."
echo "Twilio SID: ${TWILIO_ACCOUNT_SID:0:10}..."
```

---

## 📊 Test 1: Baseline from TEST Branch

**Purpose:** Establish current behavior as reference

```bash
# Switch to test branch
git checkout test

# REPLACE <TEST_TX_ID> with your actual transaction ID
TEST_TX_ID="abc-123-def-456"  # ← PUT YOUR TRANSACTION ID HERE

# Run 5-day matrix
node scripts/diagnose-overdue.js --transaction $TEST_TX_ID --matrix 2>&1 | tee test_branch_matrix.txt

# Run specific day test
FORCE_NOW="2025-11-11T12:00:00Z" node scripts/diagnose-overdue.js --transaction $TEST_TX_ID 2>&1 | tee test_branch_single.txt
```

**Expected Output:**
```
═══════════════════════════════════════════════════════════════════
📋 TRANSACTION DIAGNOSTIC: abc-123-def-456
═══════════════════════════════════════════════════════════════════
⏰ Simulation time: 2025-11-11T12:00:00.000Z (2025-11-11)
🔍 Mode: DRY_RUN (safe)

📡 Fetching transaction data...
📅 Return due: 2025-11-09
📊 Days late: 2
📦 Carrier status: N/A
✓  First scan: Not yet scanned
✓  Is scanned: ❌ NO

──────────────────────────────────────────────────────────────────
🧠 BUSINESS LOGIC EVALUATION
──────────────────────────────────────────────────────────────────
⚠️  OVERDUE: 2 day(s) late, no carrier scan

──────────────────────────────────────────────────────────────────
📱 SMS THAT WOULD BE SENT
──────────────────────────────────────────────────────────────────
   To:      +15551234567
   Tag:     overdue_day2_to_borrower
   Message: 🚫 2 days late. $15/day fees are adding up. Ship now: https://sherbrt.com/r/abc123
   ✅ SEND: New notification for day 2

──────────────────────────────────────────────────────────────────
💳 CHARGES THAT WOULD BE APPLIED
──────────────────────────────────────────────────────────────────
   ✅ Late Fee: $15.00 (Day 2)
      Reason: Not yet charged for 2025-11-11
   ⏳ Replacement: $250.00
      PENDING: Will charge on Day 5 (3 days from now)

   💰 TOTAL TODAY: $15.00
```

---

## 📊 Test 2: Feature Branch Tests

**Purpose:** Verify main branch parity and fixes

```bash
# Switch to feature branch
git checkout feat/overdue-prod-parity

# Use same transaction ID
# REPLACE <MAIN_TX_ID> with your actual transaction ID (can be same as test)
MAIN_TX_ID="abc-123-def-456"  # ← PUT YOUR TRANSACTION ID HERE

# Run 5-day matrix
node scripts/diagnose-overdue.js --transaction $MAIN_TX_ID --matrix 2>&1 | tee main_branch_matrix.txt

# Run specific day test  
FORCE_NOW="2025-11-11T12:00:00Z" node scripts/diagnose-overdue.js --transaction $MAIN_TX_ID 2>&1 | tee main_branch_single.txt
```

**What to verify:**
- ✅ Output should be nearly identical to test branch
- ✅ Day 3 SMS should include link: `...full replacement: https://sherbrt.com/r/...`
- ✅ Day 4 SMS should include link: `...replacement charges: https://sherbrt.com/r/...`
- ✅ Policy logging should show `delivered=false, carrierHasPackage=false`

---

## 📊 Test 3: Compare Outputs

```bash
# Create comparison
echo "=== COMPARISON: TEST vs MAIN ===" > comparison.txt
echo "" >> comparison.txt

echo "### Test Branch Matrix Output:" >> comparison.txt
head -50 test_branch_matrix.txt >> comparison.txt
echo "" >> comparison.txt

echo "### Main Branch Matrix Output:" >> comparison.txt
head -50 main_branch_matrix.txt >> comparison.txt
echo "" >> comparison.txt

# Show diff
echo "### Differences:" >> comparison.txt
diff test_branch_matrix.txt main_branch_matrix.txt >> comparison.txt || true

# View comparison
cat comparison.txt
```

**Key things to look for:**
- ✅ Both branches calculate same days late
- ✅ Both branches show same late fee amounts
- ✅ Main branch has links on Day 3 & 4 (test might not)
- ✅ Policy logic shows new functions (`hasCarrierScan`, `isDelivered`)

---

## 📊 Test 4: "In Transit" Policy Test (CRITICAL)

**Purpose:** Verify the key policy change

**Setup:** You need a transaction where the package is in transit.

If you don't have one, you can manually simulate by editing the transaction's protectedData:

```javascript
// This is just for understanding - don't actually edit production data!
// protectedData.return.firstScanAt = "2025-11-10T10:00:00Z"
// OR
// protectedData.return.status = "in_transit"
```

**Test on TEST branch (old policy):**
```bash
git checkout test

IN_TRANSIT_TX_ID="your-in-transit-tx-id"  # ← Transaction with firstScanAt set

FORCE_NOW="2025-11-11T12:00:00Z" node scripts/diagnose-overdue.js \
  --transaction $IN_TRANSIT_TX_ID 2>&1 | tee test_in_transit.txt
```

**Expected (OLD POLICY):**
```
Package already scanned - no charges apply
Reason: already-scanned
```

**Test on MAIN branch (new policy):**
```bash
git checkout feat/overdue-prod-parity

FORCE_NOW="2025-11-11T12:00:00Z" node scripts/diagnose-overdue.js \
  --transaction $IN_TRANSIT_TX_ID 2>&1 | tee main_in_transit.txt
```

**Expected (NEW POLICY):**
```
Package status: delivered=false, carrierHasPackage=true
🚚 Package in transit - skipping SMS but will apply charges
✅ Late Fee: $15.00 (Day X)
   Reason: Not yet charged for 2025-11-11
❌ Replacement: $XXX.00
   SKIP: Carrier has accepted package
```

---

## 📊 Test 5: Idempotency Test

**Purpose:** Verify no double-charging

```bash
git checkout feat/overdue-prod-parity

TX_ID="abc-123-def-456"  # Your test transaction
NOW="2025-11-11T12:00:00Z"

# Run 1
echo "=== RUN 1 ===" > idempotency_test.txt
FORCE_NOW=$NOW node scripts/diagnose-overdue.js --transaction $TX_ID 2>&1 | tee -a idempotency_test.txt

echo "" >> idempotency_test.txt
echo "=== RUN 2 (same time) ===" >> idempotency_test.txt

# Run 2 (same transaction, same time)
FORCE_NOW=$NOW node scripts/diagnose-overdue.js --transaction $TX_ID 2>&1 | tee -a idempotency_test.txt

# Check for differences
cat idempotency_test.txt
```

**Expected:**
- Run 1: "✅ Late Fee: $15.00 (Day X) - Reason: Not yet charged for 2025-11-11"
- Run 2: "❌ Late Fee: $15.00 (Day X) - SKIP: Already charged today (2025-11-11)"

---

## 📊 Test Results Collection

After running all tests, collect outputs:

```bash
# Create test results directory
mkdir -p test-outputs
cd test-outputs

# Move all outputs here
mv ../test_branch_matrix.txt .
mv ../test_branch_single.txt .
mv ../main_branch_matrix.txt .
mv ../main_branch_single.txt .
mv ../test_in_transit.txt .
mv ../main_in_transit.txt .
mv ../idempotency_test.txt .
mv ../comparison.txt .

# Create summary
cat > test_summary.md << 'EOF'
# Dry-Run Test Results

**Date:** $(date)
**Branch:** feat/overdue-prod-parity
**Transaction IDs Used:** [LIST YOUR TX IDS HERE]

## Test 1: 5-Day Matrix (Test Branch)
- File: test_branch_matrix.txt
- Status: [PASS/FAIL]
- Notes: [Your observations]

## Test 2: 5-Day Matrix (Main Branch)
- File: main_branch_matrix.txt
- Status: [PASS/FAIL]
- Notes: [Your observations]

## Test 3: Policy Change (In Transit)
- Files: test_in_transit.txt, main_in_transit.txt
- Status: [PASS/FAIL]
- Verified: Late fees continue when in transit
- Notes: [Your observations]

## Test 4: Idempotency
- File: idempotency_test.txt
- Status: [PASS/FAIL]
- Verified: No double-charging
- Notes: [Your observations]

## Overall Result: [PASS/FAIL]

## Issues Found:
- [List any issues]

## Ready for Production: [YES/NO]
EOF

cd ..
```

---

## ✅ Success Criteria

After running tests, verify:

- [ ] **Test branch runs successfully** (baseline established)
- [ ] **Main branch runs successfully** (implementation works)
- [ ] **Outputs are nearly identical** (parity achieved)
- [ ] **Day 3 SMS includes link** in main branch output
- [ ] **Day 4 SMS includes link** in main branch output
- [ ] **"In transit" policy works** (fees continue, replacement stops)
- [ ] **Idempotency works** (no double-charge on second run)
- [ ] **No errors or crashes** in any test

---

## 🚫 If You Can't Run Tests

**Option A: Code Review Only**
- Skip dry-run tests
- Rely on manual code review
- Test directly on staging after merge
- Higher risk but faster

**Option B: Mock Data**
- Create a mock transaction object
- Run diagnostic with fake data
- Won't hit API but tests code paths
- Limited validation

**Option C: Staging First**
- Merge to staging branch
- Test with real staging data
- Then promote to production
- Safest but slower

---

## 📞 Troubleshooting

### Error: "ECONNREFUSED" or network errors
```bash
# Make sure environment variables are loaded
source .env.test

# Verify credentials
echo $REACT_APP_SHARETRIBE_SDK_CLIENT_ID
echo $INTEGRATION_CLIENT_ID

# Check network access
ping flex-api.sharetribe.com
```

### Error: "Transaction not found"
```bash
# Verify transaction ID format
# Should be UUID format: abc-123-def-456-ghi-789

# Try a different transaction
# Use Flex Console to find valid IDs
```

### Error: "No return due date found"
```bash
# This transaction doesn't have booking.end or return.dueAt
# Choose a different transaction that completed a booking
```

---

## 🎯 Next Steps After Tests Pass

1. ✅ **Commit test outputs**
   ```bash
   git checkout feat/overdue-prod-parity
   git add test-outputs/
   git commit -m "test: Add dry-run validation outputs"
   ```

2. ✅ **Open PR**
   - Use `PR_DESCRIPTION_OVERDUE_PROD_PARITY.md` as description
   - Attach test outputs or paste key excerpts
   - Request reviews

3. ✅ **Verify Environment Variables**
   - Check Render dashboard
   - Confirm INTEGRATION_CLIENT_ID and SECRET are set

4. ✅ **Deploy to Staging**
   - Test with real staging data
   - Monitor for 24 hours

5. ✅ **Deploy to Production**
   - Merge PR to main
   - Monitor closely for first week

---

## 📋 Quick Command Reference

```bash
# Run all tests in sequence
./run_all_dry_tests.sh  # (if you create this script)

# Or manually:
git checkout test && node scripts/diagnose-overdue.js --transaction $TX_ID --matrix > test_matrix.txt
git checkout feat/overdue-prod-parity && node scripts/diagnose-overdue.js --transaction $TX_ID --matrix > main_matrix.txt
diff test_matrix.txt main_matrix.txt
```

---

**Status:** ⚠️ **READY TO TEST**  
**Your Action:** Run the commands above with your real transaction IDs  
**Expected Time:** 15-30 minutes for all tests  
**Output:** test-outputs/ directory with all results

---

Good luck with the tests! The implementation is solid, now we just need to verify it with real data. 🚀


# Overdue Flow Dry-Run Testing Instructions

**Before merging this PR**, run these dry-run simulations on both branches.

---

## Prerequisites

1. **Find a test transaction ID:**
   ```bash
   # Option 1: Query for recent delivered transactions
   # (requires Flex API access)
   curl -X POST https://flex-api.sharetribe.com/v1/api/transactions/query \
     -H "Authorization: Bearer <token>" \
     -d '{"state":"delivered","per_page":1}'
   
   # Option 2: Check recent bookings in Flex Console
   # Navigate to: Console → Transactions → Filter by "delivered"
   # Copy the transaction ID from the URL
   
   # Option 3: Use a known test transaction
   # If you have a specific transaction for testing, use that ID
   ```

2. **Set up environment variables:**
   ```bash
   # Copy from .env or Render dashboard
   export REACT_APP_SHARETRIBE_SDK_CLIENT_ID="..."
   export SHARETRIBE_SDK_CLIENT_SECRET="..."
   export INTEGRATION_CLIENT_ID="..."
   export INTEGRATION_CLIENT_SECRET="..."
   export TWILIO_ACCOUNT_SID="..."
   export TWILIO_AUTH_TOKEN="..."
   export TWILIO_MESSAGING_SERVICE_SID="..."
   export PUBLIC_BASE_URL="https://sherbrt.com"
   ```

---

## Test Branch Dry-Runs (Baseline)

These establish the "known good" behavior before our changes.

### Test 1: 5-Day Matrix (Test Branch)

```bash
git checkout test
source .env.test  # or load env vars manually

node scripts/diagnose-overdue.js --transaction <TEST_TX_ID> --matrix
```

**Expected Output:**
- Shows Day 1-5 escalation sequence
- Late fee: $15 added each day
- Day 5: Replacement charge appears
- All SMS templates visible with links
- Idempotency flags update correctly

**Capture output to:** `test_branch_matrix.txt`

### Test 2: Force-Now Scenario (Test Branch)

```bash
# Simulate 3 days late
FORCE_NOW="2025-11-09T12:00:00Z" node scripts/diagnose-overdue.js \
  --transaction <TEST_TX_ID>
```

**Expected Output:**
- Shows "3 days late"
- Late fee: $15 for today
- Day 3 SMS template includes link (if using our branch)
- No replacement charge (not Day 5 yet)

**Capture output to:** `test_branch_force_now.txt`

---

## Main Branch Dry-Runs (After Our Changes)

These verify our implementation matches test branch behavior.

### Test 3: 5-Day Matrix (Main/Feature Branch)

```bash
git checkout feat/overdue-prod-parity
source .env  # or load env vars manually

node scripts/diagnose-overdue.js --transaction <MAIN_TX_ID> --matrix
```

**Expected Output:**
- **Should match test branch output** (Test 1)
- Late fees applied daily
- Day 5 replacement charge logic correct
- SMS templates include links on ALL days (including Day 3 & 4)
- Policy differentiation: "in transit" vs "delivered"

**Capture output to:** `main_branch_matrix.txt`

### Test 4: Force-Now Scenario (Main/Feature Branch)

```bash
# Simulate 3 days late
FORCE_NOW="2025-11-09T12:00:00Z" node scripts/diagnose-overdue.js \
  --transaction <MAIN_TX_ID>
```

**Expected Output:**
- **Should match test branch output** (Test 2)
- Day 3 SMS now includes link (our fix)
- Late fee calculation correct
- Idempotency check working

**Capture output to:** `main_branch_force_now.txt`

---

## Test 5: "In Transit" Policy Test (Both Branches)

Test the critical policy change: late fees continue when in transit.

### Setup
You need a transaction where:
- Return date is past (overdue)
- Package has been scanned by carrier (`firstScanAt` set OR `status = 'in_transit'`)

### Run on Test Branch (Old Policy)
```bash
git checkout test
FORCE_NOW="2025-11-09T12:00:00Z" node scripts/diagnose-overdue.js \
  --transaction <IN_TRANSIT_TX_ID>
```

**Expected (Old Policy):**
- "Package already scanned - no charges apply"
- Exits early, no late fees

### Run on Main Branch (New Policy)
```bash
git checkout feat/overdue-prod-parity
FORCE_NOW="2025-11-09T12:00:00Z" node scripts/diagnose-overdue.js \
  --transaction <IN_TRANSIT_TX_ID>
```

**Expected (New Policy):**
- "Package in transit"
- Late fees CONTINUE (not stopped)
- Replacement charges STOPPED (correct)
- SMS SKIPPED (less annoying)

**Capture outputs to:**
- `test_branch_in_transit.txt`
- `main_branch_in_transit.txt`

---

## Test 6: "Delivered" Policy Test (Both Branches)

Verify charges stop when package is delivered.

### Setup
You need a transaction where:
- Return date is past (overdue)
- Package has been delivered (`status = 'delivered'`)

### Run on Both Branches
```bash
# Should behave identically
FORCE_NOW="2025-11-09T12:00:00Z" node scripts/diagnose-overdue.js \
  --transaction <DELIVERED_TX_ID>
```

**Expected (Both):**
- "Package already delivered - no charges apply"
- No late fees, no replacement, no SMS

**Capture outputs to:**
- `test_branch_delivered.txt`
- `main_branch_delivered.txt`

---

## Test 7: Idempotency Test (Main Branch)

Verify running twice doesn't double-charge.

```bash
git checkout feat/overdue-prod-parity

# Run 1
FORCE_NOW="2025-11-09T12:00:00Z" node scripts/diagnose-overdue.js \
  --transaction <TEST_TX_ID> > run1.txt

# Run 2 (same time)
FORCE_NOW="2025-11-09T12:00:00Z" node scripts/diagnose-overdue.js \
  --transaction <TEST_TX_ID> > run2.txt

# Compare
diff run1.txt run2.txt
```

**Expected:**
- Run 1: "Adding late fee: $15.00"
- Run 2: "Late fee already charged today (2025-11-09)"
- No charges on Run 2 (idempotency working)

---

## Output Collection

Create a directory for test outputs:

```bash
mkdir -p test-outputs
cd test-outputs

# Run all tests and save outputs with timestamps
echo "Test run: $(date)" > test_summary.txt

# Test 1-7 outputs go here...
# test_branch_matrix.txt
# test_branch_force_now.txt
# main_branch_matrix.txt
# main_branch_force_now.txt
# test_branch_in_transit.txt
# main_branch_in_transit.txt
# test_branch_delivered.txt
# main_branch_delivered.txt
# idempotency_run1.txt
# idempotency_run2.txt
```

---

## Include in PR

Add all test outputs to the PR:

```bash
git add test-outputs/
git commit -m "test: Add dry-run outputs for overdue flow validation"
```

Or paste key excerpts into the PR description under "Testing Evidence" section.

---

## Manual Testing Checklist

After dry-runs, manually verify in code:

- [ ] Day 3 SMS includes `${shortUrl}` (line 254 in sendOverdueReminders.js)
- [ ] Day 4 SMS includes `${shortUrl}` (line 257 in sendOverdueReminders.js)
- [ ] `hasCarrierScan()` checks for accepted/in_transit (lateFees.js line 68)
- [ ] `isDelivered()` checks for delivered status (lateFees.js line 88)
- [ ] Late fee logic doesn't exit on `hasCarrierScan()` (lateFees.js line 213)
- [ ] Replacement logic blocks on `hasCarrierScan()` (lateFees.js line 258)
- [ ] SMS skipped when `isInTransit` (sendOverdueReminders.js line 221)
- [ ] Charges still applied when `isInTransit` (sendOverdueReminders.js line 319)

---

## If You Don't Have Test Transactions

If no suitable test transactions are available:

### Option A: Mock Data Test
```bash
# The diagnostic tool will fail gracefully but you can review code paths
# Set a fake transaction ID and use --dry-run
TX_ID="fake-tx-123"
FORCE_NOW="2025-11-09T12:00:00Z" DRY_RUN=1 \
  node scripts/diagnose-overdue.js --transaction $TX_ID || true
```

### Option B: Code Review Only
- Verify syntax checks pass (done ✅)
- Review all diffs manually
- Confirm policy logic in code
- Trust that integration tests will catch issues on staging

### Option C: Wait for Staging Deploy
- Deploy to staging first
- Run tests against staging environment with real data
- Then promote to production

---

## Notes

- **All tests should use DRY_RUN mode** (or the diagnostic tool which is inherently dry-run)
- **Redact PII** (phone numbers, names) before committing test outputs
- **Include timestamps** in outputs for clarity
- **Document any discrepancies** between test and main branches
- **Test both happy path and edge cases** (in transit, delivered, Day 5+)

---

## Success Criteria

✅ Test branch outputs show current behavior  
✅ Main branch outputs match test branch (parity achieved)  
✅ Day 3 & 4 SMS include links in main branch  
✅ "In transit" policy works correctly (fees continue, replacement stops)  
✅ "Delivered" policy works correctly (everything stops)  
✅ Idempotency prevents double-charging  
✅ No syntax errors or runtime crashes  

---

**Next Steps:**
1. Run tests 1-7 above
2. Collect outputs
3. Verify success criteria
4. Add outputs to PR
5. Request review
6. Deploy to staging first, then production


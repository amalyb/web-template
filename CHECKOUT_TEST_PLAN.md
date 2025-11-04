# Checkout Branch Test Plan
## Validation for `test` → `main` Merge

**Branch Under Test:** `test`  
**Target Branch:** `main`  
**Critical Changes:** ProtectedData schema, address validation, Redux state  
**Test Environment:** Staging with Stripe test mode

---

## 🎯 Test Objectives

1. Verify checkout flow works with new address validation
2. Ensure backward compatibility with old transactions
3. Confirm no speculation loops or infinite re-renders
4. Validate protectedData persists correctly through transaction lifecycle
5. Test edge cases and error handling

---

## ✅ Pre-Test Setup

### Environment Configuration
- [ ] Deploy `test` branch to staging environment
- [ ] Configure Stripe test mode keys
- [ ] Enable Shippo sandbox mode
- [ ] Set up Twilio test credentials (or use DRY_RUN mode)
- [ ] Configure Redux DevTools for state inspection
- [ ] Enable browser network tab monitoring

### Test Data Preparation
- [ ] Create test listings (various price points)
- [ ] Set up test customer accounts
- [ ] Set up test provider accounts
- [ ] Prepare test credit cards (Stripe test cards)

---

## 🧪 Test Cases

### **SECTION 1: Happy Path — Full Checkout Flow**

#### Test 1.1: Complete Checkout with All Fields
**Steps:**
1. Navigate to listing page
2. Select booking dates
3. Click "Request to book"
4. Fill in ALL address fields:
   - Name: "Test Customer"
   - Street: "123 Main St"
   - City: "San Francisco"
   - State: "CA"
   - ZIP: "94103"
   - Phone: "+14155551234"
   - Email: "test@example.com"
5. Enter Stripe test card: 4242 4242 4242 4242
6. Submit checkout

**Expected Results:**
- ✅ Checkout completes without errors
- ✅ Transaction created with status `pending`
- ✅ Console shows: `[checkout→request-payment] protectedData keys: [customerStreet, customerZip, ...]`
- ✅ Console shows: `[initiate] customerStreet: 123 Main St`
- ✅ Console shows: `[initiate] customerZip: 94103`
- ✅ Redirects to order details page
- ✅ No speculation loops (check network tab — max 2 speculate calls)

**Redux State Check:**
- [ ] `speculativeTransaction` prop exists (NOT `speculatedTransaction`)
- [ ] `speculativeInProgress` prop exists

---

#### Test 1.2: Provider Accepts Booking
**Steps:**
1. Log in as provider
2. Navigate to inbox
3. Open booking request from Test 1.1
4. Fill in provider address:
   - Street: "456 Oak Ave"
   - City: "Oakland"
   - State: "CA"
   - ZIP: "94607"
   - Phone: "+15105551234"
5. Click "Accept booking"

**Expected Results:**
- ✅ Accept transition succeeds
- ✅ Console shows: `[SHIPPO] Creating label with address: 123 Main St, 94103`
- ✅ Shippo label created successfully
- ✅ SMS sent to provider (or DRY_RUN log)
- ✅ Transaction status changes to `accepted`
- ✅ ProtectedData includes both customer AND provider addresses

**ProtectedData Verification:**
```javascript
// Check in browser console or server logs
transaction.attributes.protectedData = {
  customerStreet: "123 Main St",
  customerZip: "94103",
  providerStreet: "456 Oak Ave",
  providerZip: "94607",
  // ... other fields
}
```

---

### **SECTION 2: Backward Compatibility**

#### Test 2.1: Old Transaction Without customerStreet
**Scenario:** Transaction created before protectedData changes

**Setup:**
1. In database/admin panel, create transaction with protectedData:
   ```json
   {
     "customerName": "Old Customer",
     "customerEmail": "old@example.com",
     "customerPhone": "+14155559999"
     // NOTE: Missing customerStreet and customerZip
   }
   ```

**Steps:**
1. Log in as provider
2. Try to accept old transaction

**Expected Results:**
- 🔴 **CURRENT BEHAVIOR (BROKEN):** Accept fails with 400 error "Missing shipping address"
- ✅ **DESIRED BEHAVIOR:** Accept succeeds OR shows warning but allows manual address entry

**Fix Required:** If test fails, apply this patch:
```diff
# server/api/transition-privileged.js
- if (!hasCustomerShipAddress(finalProtectedData)) {
-   return res.status(400).json({ error: 'Missing shipping address' });
- }
+ if (!hasCustomerShipAddress(finalProtectedData)) {
+   console.warn('[accept] Missing customer address - skipping Shippo label');
+   // Allow accept to proceed without label creation
+ }
```

---

#### Test 2.2: Checkout with Minimal Fields (Legacy Flow)
**Steps:**
1. Navigate to listing
2. Select dates
3. Click "Request to book"
4. Fill ONLY required Stripe fields (not address fields)
5. Submit

**Expected Results:**
- 🔴 **CURRENT BEHAVIOR (BROKEN):** Throws error "Please fill in required address fields"
- ✅ **DESIRED BEHAVIOR:** Either collects address in separate step OR allows checkout with billing address

**Fix Required:** If blocking users, soften validation:
```diff
# CheckoutPageWithPayment.js
- if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
-   throw new Error('Please fill in the required address fields...');
- }
+ if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
+   console.warn('[checkout] Missing shipping address - using billing address as fallback');
+   // Optionally: merge from billing address
+ }
```

---

### **SECTION 3: Edge Cases & Error Handling**

#### Test 3.1: Shipping Same as Billing Checkbox
**Steps:**
1. Start checkout flow
2. Fill billing address completely
3. Check "Shipping same as billing" checkbox
4. Submit

**Expected Results:**
- ✅ Checkout succeeds
- ✅ `customerStreet` populated from billing.line1
- ✅ `customerZip` populated from billing.postalCode
- ✅ Console shows: `[StripePaymentForm] mapped customer PD: { customerStreet: "...", customerZip: "..." }`

---

#### Test 3.2: PO Box Address (Blocked)
**Steps:**
1. Start checkout
2. Enter shipping address: "PO Box 123"
3. Submit

**Expected Results:**
- ✅ Error shown: "PO Boxes are not supported for courier shipping"
- ✅ Checkout blocked (correct behavior for UPS/FedEx)

---

#### Test 3.3: Rapid Date Changes (Speculation Loop Test)
**Steps:**
1. Open checkout page
2. Open browser DevTools → Network tab
3. Change start date 5 times rapidly
4. Monitor network requests

**Expected Results:**
- ✅ Max 1-2 speculate calls per date change
- ✅ `prevKeyRef` prevents duplicate calls
- ✅ No infinite loop (requests stop after date stabilizes)
- ✅ Console shows: `[checkout] speculation key changed, fetching...`

**Failure Signs:**
- 🔴 10+ speculate calls for single date change
- 🔴 Continuous requests after date stops changing
- 🔴 Browser freezes or becomes unresponsive

---

#### Test 3.4: Empty Form Submission
**Steps:**
1. Start checkout
2. Leave all fields empty (or fill only card number)
3. Submit

**Expected Results:**
- ✅ Form validation prevents submission
- ✅ Error message shows missing fields
- ✅ No API call made
- ✅ User can correct and resubmit

---

#### Test 3.5: Network Failure During Initiate
**Steps:**
1. Open DevTools → Network tab
2. Start checkout, fill all fields
3. Before submitting: Block `initiate-privileged` endpoint (use DevTools request blocking)
4. Submit form

**Expected Results:**
- ✅ Error shown to user
- ✅ Form remains editable (not stuck in submitting state)
- ✅ `setSubmitting(false)` called in catch block
- ✅ User can retry

---

### **SECTION 4: Redux State & Props**

#### Test 4.1: Redux State Shape
**Steps:**
1. Open Redux DevTools
2. Navigate to checkout page
3. Inspect `state.CheckoutPage`

**Expected State Structure:**
```javascript
{
  speculateTransactionInProgress: false,
  speculateTransactionError: null,
  speculatedTransaction: { /* tx object */ },  // ← Still in state
  // ...
}
```

**Expected Props (in CheckoutPage component):**
```javascript
{
  speculativeTransaction: { /* tx object */ },   // ← Renamed prop
  speculativeInProgress: false,                  // ← New alias
  // ...
}
```

**Validation:**
- [ ] `speculatedTransaction` exists in STATE
- [ ] `speculativeTransaction` exists in PROPS (renamed)
- [ ] `speculativeInProgress` exists in PROPS (alias)
- [ ] No console errors about undefined props

---

#### Test 4.2: Component Prop Usage
**Steps:**
1. Search codebase for `speculatedTransaction` usage:
   ```bash
   rg "props\.speculatedTransaction" src/
   ```

**Expected Results:**
- ✅ No matches found (all should use `speculativeTransaction`)
- OR
- 🔴 Matches found → Need to update component to use new prop name

---

### **SECTION 5: ProtectedData Persistence**

#### Test 5.1: Data Flow Through Lifecycle
**Steps:**
1. Start checkout with full address
2. Monitor console logs during flow
3. After accept, inspect transaction in Redux/browser

**Expected Log Sequence:**
```
[checkout→request-payment] protectedData keys: [customerName, customerStreet, customerZip, ...]
[checkout→request-payment] customerStreet: 123 Main St
[checkout→request-payment] customerZip: 94103

[initiate] forwarding PD keys: [customerName, customerStreet, ...]
[initiate] customerStreet: 123 Main St
[initiate] customerZip: 94103

[duck] privileged speculative success: <txId>

[SHIPPO] Creating label with address: 123 Main St, 94103
[SHIPPO] Label created successfully
```

**Validation:**
- [ ] Customer fields present in checkout logs
- [ ] Customer fields present in initiate logs
- [ ] Customer fields present in accept logs
- [ ] Customer fields present in final transaction.protectedData

---

#### Test 5.2: ProtectedData Merge (Accept)
**Setup:**
1. Complete checkout (customer data saved to transaction)
2. Provider accepts and fills provider address

**Expected Merge:**
```javascript
// BEFORE accept (transaction PD):
{
  customerStreet: "123 Main St",
  customerZip: "94103",
  customerPhone: "+14155551234"
}

// Provider fills:
{
  providerStreet: "456 Oak Ave",
  providerZip: "94607",
  providerPhone: "+15105551234"
}

// AFTER accept (merged PD):
{
  customerStreet: "123 Main St",    // ✅ Preserved
  customerZip: "94103",              // ✅ Preserved
  customerPhone: "+14155551234",     // ✅ Preserved
  providerStreet: "456 Oak Ave",     // ✅ Added
  providerZip: "94607",              // ✅ Added
  providerPhone: "+15105551234"      // ✅ Added
}
```

**Validation:**
- [ ] Customer data NOT overwritten by provider data
- [ ] Provider data added to existing PD
- [ ] No blank values overwrite existing data

---

### **SECTION 6: Integration Points**

#### Test 6.1: Shippo Label Creation
**Steps:**
1. Complete full checkout → accept flow
2. Check Shippo sandbox dashboard

**Expected Results:**
- ✅ Label created with customer address: `123 Main St, San Francisco, CA 94103`
- ✅ Label created with provider return address: `456 Oak Ave, Oakland, CA 94607`
- ✅ Tracking number generated
- ✅ Console shows: `[SHIPPO] Label URL: https://...`

---

#### Test 6.2: SMS Notifications
**Steps:**
1. Complete checkout (with DRY_RUN=false or check logs if DRY_RUN=true)
2. Accept booking

**Expected SMS (DRY_RUN logs):**
```
[SMS][DRY_RUN] To: +14155551234
Message: "Sherbrt: new booking request for "Test Listing". Check your inbox: https://..."
```

**Validation:**
- [ ] Phone number from `protectedData.customerPhone` used
- [ ] Booking link includes transaction ID
- [ ] Carrier-friendly format (no emojis, one link)

---

### **SECTION 7: Performance & UX**

#### Test 7.1: Form Responsiveness
**Steps:**
1. Open checkout page
2. Rapidly type in address fields
3. Monitor console and UI responsiveness

**Expected Results:**
- ✅ No lag when typing
- ✅ Form validation updates smoothly
- ✅ No excessive re-renders (check React DevTools Profiler)
- ✅ `onFormValidityChange` called only when validity changes (not every keystroke)

---

#### Test 7.2: Console Log Volume
**Steps:**
1. Complete full checkout flow
2. Count console.log statements

**Expected Results:**
- ✅ ~10-20 relevant logs per flow (not hundreds)
- ✅ Logs only in development (`__DEV__` flag)
- ✅ No logs in production build

**Validation:**
```bash
# Build production and check
npm run build
# Open production build, complete checkout
# Console should be clean (no debug logs)
```

---

## 📋 Test Results Template

### Tester Information
- **Name:** _____________
- **Date:** _____________
- **Environment:** Staging / Local
- **Branch/Commit:** _____________

### Results Summary

| Test ID | Test Name | Pass/Fail | Notes |
|---------|-----------|-----------|-------|
| 1.1 | Complete Checkout | ☐ Pass ☐ Fail | |
| 1.2 | Provider Accept | ☐ Pass ☐ Fail | |
| 2.1 | Old Transaction | ☐ Pass ☐ Fail | |
| 2.2 | Minimal Fields | ☐ Pass ☐ Fail | |
| 3.1 | Same as Billing | ☐ Pass ☐ Fail | |
| 3.2 | PO Box Block | ☐ Pass ☐ Fail | |
| 3.3 | Speculation Loop | ☐ Pass ☐ Fail | |
| 3.4 | Empty Form | ☐ Pass ☐ Fail | |
| 3.5 | Network Failure | ☐ Pass ☐ Fail | |
| 4.1 | Redux State | ☐ Pass ☐ Fail | |
| 4.2 | Prop Usage | ☐ Pass ☐ Fail | |
| 5.1 | Data Flow | ☐ Pass ☐ Fail | |
| 5.2 | PD Merge | ☐ Pass ☐ Fail | |
| 6.1 | Shippo Label | ☐ Pass ☐ Fail | |
| 6.2 | SMS | ☐ Pass ☐ Fail | |
| 7.1 | Responsiveness | ☐ Pass ☐ Fail | |
| 7.2 | Log Volume | ☐ Pass ☐ Fail | |

### Critical Issues Found
1. _________________________________
2. _________________________________
3. _________________________________

### Recommendation
☐ **APPROVE** — All tests pass, ready to merge  
☐ **CONDITIONAL** — Minor fixes needed (list above)  
☐ **REJECT** — Critical issues, do not merge  

---

## 🚨 Rollback Plan

If critical issues found in production after merge:

### Immediate Actions
1. Revert merge commit: `git revert <merge-commit-sha>`
2. Deploy `main` branch (pre-merge state)
3. Notify team via Slack/email

### Partial Rollback (if only validation is issue)
```bash
# Cherry-pick the validation softening patch
git cherry-pick <fix-commit-sha>
git push origin main
```

### Data Repair (if protectedData corrupted)
```sql
-- Run this SQL to check affected transactions
SELECT id, protected_data->>'customerStreet', protected_data->>'customerZip'
FROM transactions
WHERE protected_data->>'customerStreet' IS NULL
  AND created_at > '2025-09-10';  -- Date test branch diverged
```

---

## ✅ Sign-Off Checklist

Before merging `test` → `main`:

- [ ] All test cases pass (0 critical failures)
- [ ] Backward compatibility verified (old transactions work)
- [ ] No speculation loops observed
- [ ] ProtectedData persists correctly through full lifecycle
- [ ] Redux state shape matches expected structure
- [ ] No breaking prop renames affecting components
- [ ] Performance acceptable (no UI lag)
- [ ] Console logs clean in production build
- [ ] Shippo integration works correctly
- [ ] SMS notifications send successfully
- [ ] Code review completed by 2+ engineers
- [ ] Staging deployment successful
- [ ] Product owner approval obtained

**Final Approval:**

- **Engineer:** _________________ Date: _______
- **QA Lead:** _________________ Date: _______
- **Product:** _________________ Date: _______

---

**Test Plan Version:** 1.0  
**Last Updated:** October 13, 2025  
**See Also:** 
- `CHECKOUT_BRANCH_AUDIT_REPORT.md` — Detailed technical analysis
- `CHECKOUT_AUDIT_QUICK_REF.md` — Quick reference guide
- `CHECKOUT_DIFF_VISUAL_SUMMARY.md` — Visual code diffs


# Test vs Main Branch Divergence Analysis
**Date:** October 14, 2025  
**Analysis:** Complete Booking flow differences between branches

---

## 🔍 Branch Divergence Summary

### Divergence Point
**Last common ancestor:** `a2d9e4277` ("Signup form opt-in")

### Commit Counts
```
                 origin/test (working)
                      /
                     /
    a2d9e4277 ------+
                     \
                      \
                 origin/main (broken)

Test branch:  125 commits ahead of merge base
Main branch:  7,649 commits ahead of merge base
```

### Branch States
- **origin/test** (Last working booking flow)
  - Tip: `b92417162` - "Fix: bookingStartISO validation"
  - Contains: 125 production-tested commits for booking flow
  - Status: ✅ Booking works correctly

- **origin/main** (Current broken state)  
  - Tip: `b9695f294` - "payments/stripe: never echo client-sent PI secret..."
  - Contains: Wave-1, Wave-2 refactors + 20+ failed hotfixes
  - Status: 🔴 Booking broken

---

## 📊 Booking-Specific File Differences

### Files Changed (test → main): 18 files

**Core Checkout Logic:**
1. `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
2. `src/containers/CheckoutPage/CheckoutPage.duck.js`
3. `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`
4. `src/containers/CheckoutPage/CheckoutPage.js`
5. `src/containers/CheckoutPage/CheckoutPageTransactionHelpers.js`
6. `src/containers/CheckoutPage/CheckoutPageWithInquiryProcess.js`

**Supporting Modules:**
7. `src/containers/CheckoutPage/CustomTopbar.js`
8. `src/containers/CheckoutPage/DetailsSideCard.js`
9. `src/containers/CheckoutPage/ErrorMessages.js`
10. `src/containers/CheckoutPage/MobileListingImage.js`
11. `src/containers/CheckoutPage/ShippingDetails/ShippingDetails.js`
12. `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.module.css`

**New Files on Main (Not in Test):**
13. `src/containers/CheckoutPage/shared/orderParams.js` ⚠️ NEW
14. `src/containers/CheckoutPage/shared/orderParamsCore.js` ⚠️ NEW
15. `src/containers/CheckoutPage/shared/selectors.js` ⚠️ NEW
16. `src/containers/CheckoutPage/shared/sessionKey.js` ⚠️ NEW

**Tests:**
17. `src/containers/CheckoutPage/__tests__/auth-guard.spec.js`

**Server:**
18. `server/api/transition-privileged.js`

### Line Changes Summary
```
18 files changed
+2,095 insertions
-336 deletions
-------------------
Net: +1,759 lines added to main
```

**Impact:** Main branch added ~1,800 lines of new code to the booking flow that test branch doesn't have.

---

## 🎯 Key Differences: Test vs Main

### What TEST Branch Has (Working ✅)

**Recent test-only commits solving real issues:**
- `b924171` - Fix: bookingStartISO validation
- `141333f` - shipping(sms): compute ship-by with expanded tx + PD fallback
- `ca7b93b` - Fix label-ready SMS: add robust ship-by date handling
- `76509c7` - label-ready SMS: add ship-by date + robust logs
- `7a00f18` - checkout+server: enforce shippable borrower address end-to-end
- `8d3c555` - Fix Shipping label sms to lender
- `d9977cf` - fix(sms): restore accept notifications with phone fallbacks
- `2920bf8` - fix(accept): relax customer validation, merge PD safely
- `708ba20` - fix(checkout): resolve customerPD error, forward protectedData
- `d4b7a31` - fix(checkout): persist customer shipping at request-payment
- `868fbff` - fix(checkout): persist customer shipping fields, prevent blanks
- `40238c3` - fix(checkout): precise guard for value/validity, one-shot speculation

**Architecture in test:**
- Clean speculation (happens once, no loops)
- Simple protectedData merging (preserves existing values)
- Stable Stripe integration (Elements mount reliably)
- Working SMS/shipping flows (customer data persisted correctly)

### What MAIN Branch Has (Broken 🔴)

**Main-only commits causing issues:**
- `6d34865c5` (Oct 8) - Wave-2: checkout scaffolding (+1,748 lines) 🔥 **ROOT CAUSE**
- `063d7925b` (Oct 8) - Wave-1: Server-core fixes 🔥 **ROOT CAUSE**
- `96d09ed04` (Oct 8) - dedupe privileged speculative tx (attempted fix)
- `45db40d21` (Oct 9) - prevent repeated initiate-privileged calls (attempted fix)
- `9543c0b29` (Oct 9) - guard initiate-privileged to stop loop (attempted fix)
- `65148b067` (Oct 10) - fix prod TDZ (process→txProcess rename)
- `3ee057af3` (Oct 10) - eliminate prod-only TDZ
- ... 15+ more hotfix attempts through Oct 13

**Issues introduced on main:**
1. **Speculation loops** - Form value streaming triggers re-speculation
2. **clientSecret confusion** - Multiple storage paths, extraction fails
3. **protectedData overwrites** - Empty form values overwrite real data
4. **TDZ errors** - Variable hoisting issues in production builds
5. **New architecture** - 4 new "shared" modules increase complexity

---

## 🔬 Detailed Diff Analysis

### 1. CheckoutPageWithPayment.js Divergence

**Test branch (working):**
```javascript
// Simple, clean speculation - happens once
useEffect(() => {
  if (pageData?.listing && !speculatedTransaction) {
    fetchSpeculatedTransaction(orderParams);
  }
}, [pageData?.listing?.id]);
```

**Main branch (broken):**
```javascript
// Complex manual loop prevention
function fetchSpeculatedTransactionIfNeeded(orderParams, pageData, fetchSpeculatedTransaction, prevKeyRef) {
  const specParams = JSON.stringify({ /* ... */ });
  
  // Manual deduplication - prone to errors
  if (prevKeyRef.current !== specParams) {
    prevKeyRef.current = specParams;
    fetchSpeculatedTransaction(...);
  }
}

// Plus: componentDidUpdate streaming form values → triggers parent re-render
```

### 2. StripePaymentForm.js Divergence

**Test branch (working):**
```javascript
class StripePaymentForm extends Component {
  componentDidMount() {
    if (!window.Stripe) {
      throw new Error('Stripe must be loaded');
    }
    // Simple initialization, no streaming
  }
}
```

**Main branch (broken):**
```javascript
class StripePaymentForm extends Component {
  componentDidUpdate(prevProps, prevState) {
    // ❌ Streams form values on EVERY keystroke
    const values = this.finalFormAPI?.getState?.()?.values || {};
    const mapped = { customerName: values.name || '', /* ... */ };
    
    if (JSON.stringify(mapped) !== this.lastValuesJSON) {
      this.lastValuesJSON = JSON.stringify(mapped);
      this.props.onFormValuesChange?.(mapped); // Triggers parent re-render!
    }
  }
}
```

### 3. CheckoutPage.duck.js Divergence

**Test branch (working):**
```javascript
const initialState = {
  speculateTransactionInProgress: false,
  speculatedTransaction: null,
  speculateTransactionError: null,
  // Clean, simple state
};
```

**Main branch (broken):**
```javascript
const initialState = {
  speculateTransactionInProgress: false,
  speculatedTransaction: null,
  speculateTransactionError: null,
  lastSpeculationKey: null,
  speculativeTransactionId: null,
  speculateStatus: 'idle',
  stripeClientSecret: null,
  lastSpeculateError: null,
  clientSecretHotfix: null, // Redundant hotfix field!
  extractedClientSecret: null, // Another redundant field!
  paymentsUnavailable: false,
  // 5+ new fields added for hotfixes
};
```

### 4. New Shared Modules (Main Only)

Main branch added 4 new modules to "break circular dependencies":
- `shared/orderParams.js` - Re-exports from core
- `shared/orderParamsCore.js` - Pure functions (87 lines)
- `shared/selectors.js` - Redux selectors
- `shared/sessionKey.js` - Session key builders

**Problem:** Added complexity without fixing root issues. Test branch doesn't need these.

---

## 🚨 Root Cause Confirmed

### The Breaking Change
**October 8, 2025** - Two commits on main branch:

1. **`063d7925b`** - Wave-1: Server-core fixes
   - Changed: `server/api/initiate-privileged.js`
   - Changed: `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
   - Added: Server-side validation, env guards

2. **`6d34865c5`** - Wave-2: checkout scaffolding & address validation
   - Massive refactor: +1,748 lines, -568 lines
   - Changed: `CheckoutPageWithPayment.js` and `StripePaymentForm.js`
   - Added: Form streaming, complex speculation guards, new shared modules

### Why Test Branch Works
Test branch **never received** Wave-1 or Wave-2 commits. Instead, it has 125 commits that:
- Fix real bugs incrementally
- Preserve working speculation architecture  
- Handle protectedData merging safely
- Maintain stable Stripe integration

### Why Main Branch Broke
Main branch received Wave-1/Wave-2, which:
- Introduced speculation loops via form streaming
- Added complex manual deduplication (fragile)
- Created confusion about clientSecret storage
- Increased complexity without adequate testing

Then 20+ hotfix commits attempted to patch symptoms without reverting the root cause.

---

## 💡 Recommended Fix Strategy

### Option 1: Merge Test into Main (SAFEST) ✅

```bash
# Test branch is the source of truth
git checkout main
git merge origin/test

# Resolve conflicts by keeping test's versions for booking files
# Then commit and push
git commit -m "Merge test branch to restore working booking flow"
git push origin main
```

**Pros:**
- Restores working booking flow immediately
- Preserves all test branch fixes (SMS, shipping, protectedData)
- Proven to work in production (70 successful deploys)

**Cons:**  
- Main's Wave-1/Wave-2 features lost (can re-introduce later with flags)
- May conflict with other main-only features

### Option 2: Cherry-Pick Test Fixes to Main

```bash
# Start from main
git checkout main
git checkout -b hotfix/apply-test-fixes

# Cherry-pick key working commits from test
git cherry-pick b924171  # bookingStartISO validation
git cherry-pick 868fbff  # prevent blank PD overwrites
git cherry-pick 40238c3  # one-shot speculation
git cherry-pick d4b7a31  # persist customer shipping
# ... continue for critical fixes

git push origin hotfix/apply-test-fixes
```

**Pros:**
- Keeps main's other features
- Surgical approach

**Cons:**
- Tedious (125 commits to review)
- May miss critical fixes
- Conflicts likely

### Option 3: Revert Main to Before Wave Commits

```bash
# Revert Wave changes on main
git checkout main
git checkout -b hotfix/revert-waves

# Revert Wave-2 and Wave-1
git revert --no-commit 6d34865c5
git revert --no-commit 063d7925b

# Revert all subsequent hotfixes
git revert --no-commit b9695f294..6d34865c5

git commit -m "Revert Wave-1/Wave-2 and hotfixes"
git push origin hotfix/revert-waves
```

**Pros:**
- Surgical removal of problematic commits
- Keeps other main features

**Cons:**
- May leave orphaned code
- Doesn't restore test's working fixes

---

## 📋 Verification Checklist

After merging test → main, verify:

### Booking Flow
- [ ] Speculation happens once (check Network tab for `/api/initiate-privileged`)
- [ ] No infinite loops (console should be quiet)
- [ ] Stripe Elements mount successfully
- [ ] `client_secret` present in Redux state
- [ ] Submit button works with valid card/address

### Data Persistence  
- [ ] protectedData contains `customer*` fields (non-empty)
- [ ] SMS sent with correct phone number
- [ ] Shipping label generated with correct address
- [ ] Transaction transitions correctly

### No Regressions
- [ ] No TDZ errors in console
- [ ] No CSP violations
- [ ] No 401/503 errors from API
- [ ] Form validation works correctly

---

## 📈 Impact Assessment

### Test Branch (125 commits)
- **Stability:** High - proven in production
- **Features:** Complete booking, SMS, shipping labels
- **Architecture:** Simple, maintainable
- **Known issues:** None reported for booking flow

### Main Branch (7,649 commits)
- **Stability:** Low - multiple critical bugs
- **Features:** Wave-1/Wave-2 refactors (broken)
- **Architecture:** Complex, multiple hotfix layers
- **Known issues:** 
  - Booking flow broken
  - Speculation loops
  - protectedData loss
  - TDZ errors
  - clientSecret extraction fails

---

## 🎯 Conclusion

**The report `_diffs/booking-regression-report.md` correctly identifies the issues**, but was comparing the 70 known-good SHAs (all from test branch) against main.

**The true divergence is:**
- **Test branch:** 125 commits of working booking fixes
- **Main branch:** 7,649 commits including broken Wave refactors

**Recommendation:** **Merge test into main** to restore working booking flow, then carefully re-introduce Wave features with:
1. Feature flags
2. Comprehensive tests
3. Incremental rollout
4. Proper code review

---

**Next Steps:**
1. Review this divergence analysis
2. Choose merge strategy (recommend: test → main)
3. Execute merge on staging
4. Validate with checklist above
5. Deploy to production when verified

---
**Analysis Complete**


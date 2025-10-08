# Where We Left Off - Quick Reference

**Generated**: 2025-10-08  
**Current main**: `edd0774` (prod/WAVE0_BASELINE) ✅  
**Current test**: `b924171` (20+ commits ahead)

---

## 📊 Wave Status at a Glance

| Wave | Feature | Status | Notes |
|------|---------|--------|-------|
| **0** | CSP Hardening | ✅ **DONE** | Merged via PRs #28-30; test has refinements |
| **1** | Infra/SSR/Env | ✅ **DONE** | Merged via PRs #31, #37; appears stable |
| **2** | Checkout Address | ⚠️ **PARTIAL** | Scaffolding merged; test has validation fixes |
| **3** | SMS Pipeline | ⚠️ **PARTIAL** | Routes merged; test has enhanced error handling |
| **4** | Shippo Integration | ⚠️ **PARTIAL** | Skeleton merged; test has full webhook impl |

**Key Finding**: All waves have scaffolding/routes in main (flag-gated), but test has critical fixes and complete implementations

---

## 📝 Last 10 Commits on main

```
edd0774  checkout: de-dup ADDR_ENABLED; use centralized envFlags  ← BASELINE
28ff591  Remove duplicate console.debug line
7298497  Handle both field naming conventions in CheckoutPageWithPayment
cfe002d  Fix CardElement onChange to update state and enable submit button
e484820  Infra/env validation (#37)
feb169c  Wave4 gates shippo sms lead days (#36)
aa974f0  Bring/wave3 sms shippo (#35)
d4bab1a  stripe(callbacks): call via props + optional chaining (#34)
56f5051  fix(checkout): wire Stripe callbacks (#33)
d0d1fd1  checkout(addr): minimal PD mapping + validation (#32)
```

---

## 🔥 File Hotspots (Pending/Diverged)

### 🔴 CRITICAL - Transaction Files
- `server/api/transition-privileged.js` - **Multiple backup versions in test** (6.js.zip, 7.js.zip, -fixed.js, .backup)
- `server/api/initiate-privileged.js` - Modified in test, critical path
- `server/api/transaction-line-items.js` - Enhanced in test

**Risk**: Main may lack stability fixes discovered during test iteration

### 🟡 HIGH - Checkout & Dependencies  
- `src/containers/CheckoutPage/CheckoutPageWithPayment.js` - Additional validation in test
- `package.json` / `package-lock.json` - Test uses npm; main has yarn artifacts
- `server/index.js` - Modified in both (merge coordination needed)

### 🟢 MEDIUM - Feature Implementations (Test Only)
- `server/webhooks/shippoTracking.js` - Full Shippo webhook tracking
- `server/api/qr.js` - QR code generation (only routes in main)
- `server/lib/shipping.js` - Ship-by date calculation
- `src/util/addressHelpers.js` - Address validation utilities
- `src/util/id.js` - UUID normalization

---

## 📈 Diff Summary: main vs test

- **Files Changed**: 135
- **Lines Added**: +38,221
- **Lines Deleted**: -14,025
- **Commits Ahead (test)**: 20+

**Test includes**:
- Critical bug fixes (bookingStartISO validation, customer address enforcement)
- Enhanced error handling (sendSMS, transition-privileged)
- Complete implementations (Shippo webhooks, QR generation, SMS ship-by logic)
- 17 debug/test scripts (test-*.js files)
- Documentation files (SMS_*, AVAILABILITY_*, etc.)

---

## 🎯 3-Step Recommendation to Proceed

### Step 1: Validate Current Main (Before Any Deploy)
```bash
# Ensure baseline is stable with all flags OFF
npm run test:smoke
npm run build
# Verify CSP, env validation, and basic checkout flow
```

**Why**: Main is at baseline with scaffolding; confirm it's stable before merging fixes

### Step 2: Cherry-Pick Critical Fixes to Main
Priority order:
1. **Transaction stability fixes** from test
   - `b924171`: Fix bookingStartISO validation
   - `37d1636`: Revert catch handler to use handleError
   - Review transition-privileged.js iterations
2. **Customer address enforcement** (`7a00f18`)
3. **SMS error handling enhancements** (`e93fb8e`)
4. **Package manager normalization** (resolve yarn vs npm)

```bash
# Example cherry-pick workflow
git checkout main
git cherry-pick b924171  # bookingStartISO fix
git cherry-pick 7a00f18  # address enforcement
# Test thoroughly between each pick
```

### Step 3: Feature-by-Feature Merge & Test
For each Wave you want to activate:
1. Merge associated utilities from test (e.g., addressHelpers.js for checkout)
2. Enable feature flag in staging
3. Run full regression suite
4. Load test critical paths (especially transaction-privileged)
5. Only then enable in production

**Order Suggestion**:
- ✅ Wave 1 (Infra/Env) - Already stable, just validate
- ⚠️ Wave 2 (Checkout) - Merge validation fixes first
- ⚠️ Wave 3 (SMS) - Requires enhanced sendSMS + error handling from test
- ⚠️ Wave 4 (Shippo) - Requires full webhook implementation from test
- ✅ Wave 0 (CSP) - Already applied, monitor

---

## ⚠️ Critical Warnings

1. **Don't enable feature flags in main until fixes are merged**  
   Test has critical stability improvements not in main

2. **Transaction files need special attention**  
   Multiple backup versions in test suggest complex debugging; understand what changed

3. **Dependencies must be synchronized**  
   Resolve yarn vs npm before any production deploy

4. **Missing utilities will cause runtime errors**  
   If you enable checkout/SMS/Shippo flags, you MUST merge supporting utils from test first

---

## 📋 Quick Commands

```bash
# Compare specific files
git diff origin/main origin/test -- server/api/transition-privileged.js

# See what's in test but not main
git log origin/main..origin/test --oneline

# Find merge base
git merge-base origin/main origin/test  # a2d9e42

# Safe merge simulation
git checkout -b test-merge-simulation main
git merge --no-commit origin/test
# Review conflicts, then abort
git merge --abort
```

---

## 🔍 Quick Status Check

**All Waves Merged?** ✅ Yes (scaffolding/routes)  
**All Waves Complete?** ❌ No (implementations in test)  
**Main Production-Ready?** ⚠️ Only with flags OFF  
**Safe to Enable Flags?** ❌ Not until test fixes merged

**Bottom Line**: Main has the foundation; test has the fixes and completions. Reconcile before activating features.

---

**Last Updated**: 2025-10-08  
**Full Report**: `reports/WHERE_WE_LEFT_OFF.md`  
**JSON Data**: `reports/WHERE_WE_LEFT_OFF.json`


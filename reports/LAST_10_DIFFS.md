# Last 10 Commits: origin/main vs origin/test - Side by Side

**Generated**: 2025-10-08  
**Analysis Period**: Last 10 commits on each branch  

---

## 📊 Side-by-Side Comparison

| # | origin/main (Sept 25) | origin/test (Sept 11-12) |
|---|----------------------|--------------------------|
| 1 | `edd0774` checkout: de-dup ADDR_ENABLED | `b924171` Fix: bookingStartISO validation |
| 2 | `28ff591` Remove duplicate console.debug | `37d1636` Reverted Catch Handler to handleError |
| 3 | `7298497` Handle both field naming conventions | `141333f` shipping(sms): compute ship-by with PD fallback |
| 4 | `cfe002d` Fix CardElement onChange state | `ca7b93b` Fix label-ready SMS: ship-by date handling |
| 5 | `e484820` Infra/env validation (#37) | `76509c7` label-ready SMS: add ship-by date |
| 6 | `feb169c` Wave4 gates shippo sms (#36) | `e93fb8e` chore(sms): sendSMS backward-compatible |
| 7 | `aa974f0` Bring/wave3 sms shippo (#35) | `7a00f18` checkout+server: enforce borrower address |
| 8 | `d4bab1a` stripe(callbacks) with props (#34) | `2e422b8` Fix client env guards: prevent "process is not defined" |
| 9 | `56f5051` fix(checkout): wire Stripe callbacks (#33) | `01dc96b` Fix checkout shipping flow |
| 10 | `d0d1fd1` checkout(addr): PD mapping (#32) | `8d3c555` Fix Shipping label sms to lender |

### Key Observation
- **main**: Latest commits from **Sept 25** (Wave merges completed)
- **test**: Latest commits from **Sept 11-12** (pre-Wave merge, active bug fixing)
- **Status**: All 10 test commits are NOT in main (completely diverged)

---

## 🔍 Detailed Analysis: Commits in test NOT in main

### Commit 1: `b924171` - Fix: bookingStartISO validation
**Author**: Amalia Bornstein  
**Date**: 2025-09-12  
**Files Changed**: 1 file, +16/-3 lines

| File | Purpose |
|------|---------|
| `server/api/initiate-privileged.js` | **Transaction initiation API**: Validates and processes booking start dates; ensures ISO format and proper timezone handling for booking requests |

**Summary**: Fixes critical validation bug for booking start dates in ISO format to prevent invalid bookings.

---

### Commit 2: `37d1636` - Reverted Catch Handler to Use handleError(res, e)
**Author**: Amalia Bornstein  
**Date**: 2025-09-12  
**Files Changed**: 1 file, +12/-21 lines

| File | Purpose |
|------|---------|
| `server/api/initiate-privileged.js` | **Transaction initiation API**: Standardizes error handling to use consistent handleError utility instead of custom catch blocks |

**Summary**: Reverts to standardized error handling pattern for consistency and proper error logging.

---

### Commit 3: `141333f` - shipping(sms): compute ship-by with expanded tx + PD fallback
**Author**: Amalia Bornstein  
**Date**: 2025-09-12  
**Files Changed**: 3 files, +40/-8 lines

| File | Purpose |
|------|---------|
| `server/api/initiate-privileged.js` | **Transaction initiation API**: Adds expanded transaction data fetching to support ship-by date calculation at booking creation |
| `server/api/transition-privileged.js` | **Transaction state machine**: Enhances ship-by SMS logic with protected data fallbacks and robust logging for label-ready notifications |
| `server/lib/shipping.js` | **Shipping utilities**: Refines ship-by date calculation with fallback logic for missing protected data fields |

**Summary**: Enhances ship-by date calculation with fallback mechanisms and expanded transaction context.

---

### Commit 4: `ca7b93b` - Fix label-ready SMS: add robust ship-by date handling
**Author**: Amalia Bornstein  
**Date**: 2025-09-11  
**Files Changed**: 2 files, +45/-32 lines

| File | Purpose |
|------|---------|
| `server/api/transition-privileged.js` | **Transaction state machine**: Improves ship-by date extraction with multiple fallback strategies and detailed logging for debugging |
| `server/lib/shipping.js` | **Shipping utilities**: Adds comprehensive date handling with validation, timezone awareness, and fallback logging for ship-by calculations |

**Summary**: Strengthens ship-by date logic with multiple fallback strategies and comprehensive error logging.

---

### Commit 5: `76509c7` - label-ready SMS: add ship-by date + robust logs
**Author**: Amalia Bornstein  
**Date**: 2025-09-11  
**Files Changed**: 1 file, +22/-21 lines

| File | Purpose |
|------|---------|
| `server/api/transition-privileged.js` | **Transaction state machine**: Ensures label-ready SMS only sends after successful Shippo label creation, with ship-by date included in message |

**Summary**: Refines SMS trigger timing to prevent premature notifications and ensure ship-by date accuracy.

---

### Commit 6: `e93fb8e` - chore(sms): make sendSMS backward-compatible
**Author**: Amalia Bornstein  
**Date**: 2025-09-11  
**Files Changed**: 4 files, +57/-82 lines

| File | Purpose |
|------|---------|
| `package.json` | **Dependencies**: Updates package metadata related to SMS/phone normalization libraries |
| `server/api-util/sendSMS.js` | **SMS utility**: Refactors to export backward-compatible default, normalizes phone to E.164 format, hardens dry-run mode |
| `server/api/transition-privileged.js` | **Transaction state machine**: Updates sendSMS import to use refactored backward-compatible export |
| `server/scripts/sendShipByReminders.js` | **Reminder script**: Refactors to use updated sendSMS utility with proper phone normalization and dry-run support |

**Summary**: Refactors SMS utility for backward compatibility, E.164 normalization, and improved dry-run handling.

---

### Commit 7: `7a00f18` - checkout+server: enforce shippable borrower address end-to-end
**Author**: Amalia Bornstein  
**Date**: 2025-09-11  
**Files Changed**: 4 files, +133/-6 lines

| File | Purpose |
|------|---------|
| `server/api/initiate-privileged.js` | **Transaction initiation API**: Validates borrower has complete shipping address before allowing booking to proceed |
| `server/api/transition-privileged.js` | **Transaction state machine**: Enforces shipping address validation at acceptance; sends lender label SMS only after Shippo success |
| `src/containers/CheckoutPage/CheckoutPageWithPayment.js` | **Checkout page (client)**: Blocks checkout submission if borrower address is incomplete; validates customerStreet and customerZip fields |
| `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js` | **Payment form (client)**: Captures and persists customer shipping address (street, city, state, zip) to transaction protectedData |

**Summary**: Implements end-to-end address validation preventing bookings without complete shipping addresses; coordinates SMS sending with Shippo label creation.

---

### Commit 8: `2e422b8` - Fix client env guards: prevent "process is not defined"
**Author**: Amalia Bornstein  
**Date**: 2025-09-11  
**Files Changed**: 7 files, +23/-12 lines

| File | Purpose |
|------|---------|
| `src/app.js` | **App entry**: Updates to use safe env flag checks preventing "process is not defined" errors in browser |
| `src/containers/CheckoutPage/CheckoutPageWithPayment.js` | **Checkout page**: Replaces unsafe NODE_ENV checks with IS_DEV/IS_TEST flags from centralized envFlags |
| `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js` | **Payment form**: Updates env guards to use safe IS_DEV/__DEV__ flags instead of direct process.env access |
| `src/util/api.js` | **API utility**: Fixes env checks to prevent runtime errors in browser context |
| `src/util/configHelpers.js` | **Config helpers**: Updates to use safe env flag patterns |
| `src/util/envFlags.js` | **Env flags (centralized)**: Enhances IS_DEV/IS_TEST/__DEV__ flag definitions with safe process checks |
| `src/util/googleMaps.js` | **Google Maps utility**: Updates env guards to prevent browser errors |

**Summary**: Fixes critical "process is not defined" runtime errors by centralizing environment flag checks with safe browser guards.

---

### Commit 9: `01dc96b` - Fix checkout shipping flow: require phone on billing
**Author**: Amalia Bornstein  
**Date**: 2025-09-11  
**Files Changed**: 1 file, +35/-1 lines

| File | Purpose |
|------|---------|
| `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js` | **Payment form**: Enforces phone number requirement on billing form; maps all customer* fields (name, email, phone, address) to protectedData |

**Summary**: Ensures phone number is captured during checkout and all customer fields are properly mapped to transaction data.

---

### Commit 10: `8d3c555` - Fix Shipping label sms to lender
**Author**: Amalia Bornstein  
**Date**: 2025-09-11  
**Files Changed**: 2 files, +113/-5 lines

| File | Purpose |
|------|---------|
| `src/containers/CheckoutPage/CheckoutPageWithPayment.js` | **Checkout page**: Adds lender shipping label notification logic to coordinate with backend SMS sending |
| `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js` | **Payment form**: Implements comprehensive shipping address capture and validation; triggers lender label SMS workflow |

**Summary**: Implements lender notification system for shipping label creation with proper address validation.

---

## 📈 Summary Statistics

### Overall Impact (test commits not in main)

| Metric | Value |
|--------|-------|
| **Total Commits** | 10 (all test commits NOT in main) |
| **Unique Files Changed** | 11 files |
| **Total Lines Added** | ~378 |
| **Total Lines Deleted** | ~181 |
| **Net Lines Changed** | +197 |

### Files Modified by Category

#### 🔴 Critical Server APIs (5 commits)
- `server/api/initiate-privileged.js` - Modified in 4 commits (booking validation, error handling, address enforcement)
- `server/api/transition-privileged.js` - Modified in 5 commits (SMS logic, ship-by dates, address validation)

#### 🟡 Shipping & SMS Infrastructure (4 commits)
- `server/lib/shipping.js` - Modified in 2 commits (ship-by calculation, fallback logic)
- `server/api-util/sendSMS.js` - Modified in 1 commit (backward compatibility, E.164 normalization)
- `server/scripts/sendShipByReminders.js` - Modified in 1 commit (refactored for new sendSMS API)

#### 🟢 Client Checkout Flow (5 commits)
- `src/containers/CheckoutPage/CheckoutPageWithPayment.js` - Modified in 3 commits (env guards, address validation, lender SMS)
- `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js` - Modified in 4 commits (env guards, phone requirement, address capture, lender SMS)

#### 🔵 Utilities & Infrastructure (1 commit)
- `src/util/envFlags.js` - Modified in 1 commit (enhanced safe env checks)
- `src/util/api.js` - Modified in 1 commit (safe env guards)
- `src/util/configHelpers.js` - Modified in 1 commit (safe env patterns)
- `src/util/googleMaps.js` - Modified in 1 commit (browser-safe env checks)
- `src/app.js` - Modified in 1 commit (safe env initialization)

#### 📦 Dependencies
- `package.json` - Modified in 1 commit (SMS/phone lib updates)

---

## 🎯 Key Themes in test (Missing from main)

### 1. **Critical Bug Fixes** (Commits 1, 2, 8)
- `b924171`: bookingStartISO validation prevents invalid date bookings
- `37d1636`: Standardized error handling in initiate-privileged
- `2e422b8`: **CRITICAL** - Fixes "process is not defined" runtime errors in browser

### 2. **Ship-by Date Enhancement** (Commits 3, 4, 5)
- Robust ship-by date calculation with multiple fallback strategies
- Comprehensive logging for debugging
- Integration with expanded transaction data

### 3. **Address Validation End-to-End** (Commit 7)
- Client-side validation blocks incomplete addresses
- Server-side enforcement at initiate and accept transitions
- Coordinates SMS sending with successful Shippo label creation

### 4. **SMS Infrastructure Improvements** (Commits 6, 9, 10)
- Backward-compatible sendSMS with E.164 normalization
- Phone number requirement in checkout
- Lender shipping label notification system

### 5. **Environment Safety** (Commit 8)
- Centralized env flag pattern prevents browser errors
- Safe process.env checks across 7 files
- Critical for production stability

---

## ⚠️ Critical Gaps: What main is Missing

### 🔴 HIGH PRIORITY (Production Breaking)
1. **"process is not defined" fix** (commit `2e422b8`)
   - Without this, checkout likely crashes in production browser
   - Affects 7 files including critical checkout flow

2. **bookingStartISO validation** (commit `b924171`)
   - Prevents invalid booking dates from being accepted
   - Direct data integrity issue

3. **Error handling standardization** (commit `37d1636`)
   - Ensures consistent error logging and responses
   - Affects debugging and monitoring

### 🟡 MEDIUM PRIORITY (Feature Completeness)
4. **Ship-by date enhancements** (commits `141333f`, `ca7b93b`, `76509c7`)
   - Required for accurate shipping notifications
   - Without this, SMS messages may have incorrect or missing dates

5. **Address validation end-to-end** (commit `7a00f18`)
   - Prevents bookings without shippable addresses
   - Business logic gap that could cause fulfillment failures

6. **SMS backward compatibility** (commit `e93fb8e`)
   - Required for stable SMS sending across different code paths
   - Phone normalization prevents SMS delivery failures

### 🟢 LOW PRIORITY (UX Improvements)
7. **Phone requirement in checkout** (commit `01dc96b`)
   - Ensures contact info captured
   - Missing causes downstream communication issues

8. **Lender label SMS** (commit `8d3c555`)
   - Notifies lenders when labels are ready
   - Feature gap but not blocking

---

## 📋 Recommendation

### Immediate Action Required
The **test branch contains critical bug fixes** that are NOT in main, particularly:
- Browser compatibility fixes (process.env guards)
- Data validation (bookingStartISO)
- Error handling standardization

### Suggested Merge Strategy
1. **Cherry-pick critical fixes** to main in this order:
   ```bash
   git cherry-pick 2e422b8  # Fix process.env errors (CRITICAL)
   git cherry-pick b924171  # Fix bookingStartISO validation
   git cherry-pick 37d1636  # Standardize error handling
   ```

2. **Test thoroughly** before proceeding with feature commits

3. **Consider full merge** of remaining commits if features are needed:
   ```bash
   git cherry-pick e93fb8e  # SMS backward compatibility
   git cherry-pick 7a00f18  # Address validation
   git cherry-pick 141333f ca7b93b 76509c7  # Ship-by enhancements
   git cherry-pick 01dc96b 8d3c555  # SMS completions
   ```

---

## 📅 Timeline Context

- **Sept 11-12**: Active bug fixing and feature enhancement in test branch
- **Sept 19-25**: Wave PRs merged to main (likely from different feature branches)
- **Current State**: main has wave scaffolding; test has critical fixes and completions

**Conclusion**: test represents an earlier iteration with critical fixes that weren't carried forward into the Wave merges to main. Main needs these fixes before production deployment.

---

**Generated**: 2025-10-08  
**Next Steps**: Review and cherry-pick critical fixes (commits 2e422b8, b924171, 37d1636) to main immediately


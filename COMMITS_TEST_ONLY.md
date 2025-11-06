# Commits Unique to Test Branch

**Generated:** 2025-11-06 10:40 PST  
**Repository:** shop-on-sherbet-cursor  
**Source Branch:** `test`  
**Comparison Base:** `main`  
**Method:** `git log --cherry --no-merges test --not main -n 15`

---

## Overview

This report shows the **15 most recent commits present on `test` but NOT on `main`**.

**Cherry-pick detection:** Using `--cherry` to exclude equivalent patches (same changes with different hashes).  
**Merge commits:** Excluded via `--no-merges` for clarity.

**Total unique commits:** 15

---

## Summary Table

| # | Hash | Date | Author | Subject | Files± | Areas | Risk |
|---|------|------|--------|---------|--------|-------|------|
| 1 | `9683221` | 2025-11-06 | Amalia Bornstein | Render 503 Fix | 2 files (+33/-24) | server, SSR | 🔴 HIGH |
| 2 | `da4f16b` | 2025-11-05 | Amalia Bornstein | fix(env): remove duplicate isProduction declaration | 1 file (+1/-1) | server | 🟡 MEDIUM |
| 3 | `0962218` | 2025-11-05 | Amalia Bornstein | fix(shippo): remove duplicate CACHE_TTL_MS declaration | 1 file (+2/-2) | server/shipping | 🟢 LOW |
| 4 | `315bc22` | 2025-11-05 | Amalia Bornstein | Fix Integration API payload shape (400s) | 4 files (+680/-11) | server, shipping, docs | 🟡 MEDIUM |
| 5 | `92282a0` | 2025-11-05 | Amalia Bornstein | Fix the 400 on protectedData upserts | 3 files (+411/-4) | server, Integration API | 🟡 MEDIUM |
| 6 | `4aac738` | 2025-11-05 | Amalia Bornstein | Debug for street2 line drop off | 4 files (+253/-28) | server, shipping, UI | 🟡 MEDIUM |
| 7 | `e7c03ee` | 2025-11-05 | Amalia Bornstein | fix(shipping): UPS 10429 backoff, sandbox carrier filter | 5 files (+1306/-294) | server, shipping, docs | 🔴 HIGH |
| 8 | `20c7cd4` | 2025-11-05 | Amalia Bornstein | UPS APT issue = fixed | 13 files (+1679/-535) | server, UI, util, docs | 🔴 HIGH |
| 9 | `b87ad75` | 2025-11-05 | Amalia Bornstein | remove "+" from phone fields; E.164 server-side | 13 files (+2552 total) | server, UI, SMS | 🔴 HIGH |
| 10 | `9fe68ef` | 2025-11-05 | Amalia Bornstein | keep lender full name on accept | 3 files (+29/-4) | UI, server | 🟢 LOW |
| 11 | `f2355dd` | 2025-11-05 | Amalia Bornstein | late fees+send reminders | 8 files (+1688) | server, docs | 🔴 HIGH |
| 12 | `97fb4b0` | 2025-11-05 | Amalia Bornstein | fix: use dynamic ship-by logic | 4 files (+95/-9) | server/shipping | 🟡 MEDIUM |
| 13 | `e618eb0` | 2025-11-05 | Amalia Bornstein | feat(address): shared borrower/lender address fields | 10 files (+1210/-67) | UI, server, tests | 🔴 HIGH |
| 14 | `905e5c8` | 2025-11-04 | Amalia Bornstein | SMS: de-dupe lender request + add shortlinks | 5 files (+143/-200) | server/scripts | 🟡 MEDIUM |
| 15 | `3bcd3db` | 2025-11-04 | Amalia Bornstein | QR codes USPS | (stats not shown) | server/shipping | 🟡 MEDIUM |

---

## Detailed Commit Analysis

### 1. 9683221 - Render 503 Fix

**Date:** 2025-11-06  
**Author:** Amalia Bornstein  
**Type:** Critical bug fix

#### Files Changed
```
server/api/transition-privileged.js | 26 ++++++++++++--------------
server/index.js                     | 31 +++++++++++++++++++++----------
2 files changed, 33 insertions(+), 24 deletions(-)
```

#### Summary
**Critical production fix for 503 errors on Render deployment.** Moved `isProduction` variable declaration from inside try block to function scope in `createShippingLabels()`, preventing ReferenceError crashes. Added global `uncaughtException` and `unhandledRejection` handlers in server entry point for better crash visibility. Consolidated trust proxy configuration and added `trustProtoHeader: true` to SSL enforcement middleware for proper operation behind Render's load balancer.

#### Areas Touched
- Server entry point (SSR initialization)
- Transaction endpoint (label creation)
- Middleware order (SSL enforcement)
- Error handling (global handlers)

#### Risk Assessment
**Risk:** 🔴 **HIGH**  
**Reason:** Core server infrastructure and transaction flow. Changes affect all requests and error handling.

---

### 2. da4f16b - fix(env): remove duplicate isProduction declaration

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Code cleanup

#### Files Changed
```
server/api/transition-privileged.js | 2 +-
1 file changed, 1 insertion(+), 1 deletion(-)
```

#### Summary
Removed duplicate `isProduction` declaration in `transition-privileged.js` API endpoint. Replaced second declaration with comment indicating variable already declared above, centralizing environment variable logic.

#### Areas Touched
- Server API endpoint (transition-privileged)
- Environment variable usage

#### Risk Assessment
**Risk:** 🟡 **MEDIUM**  
**Reason:** Changes variable scoping in critical transaction endpoint. (Note: This commit introduced the bug later fixed by commit #1)

---

### 3. 0962218 - fix(shippo): remove duplicate CACHE_TTL_MS declaration

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Code cleanup

#### Files Changed
```
server/lib/shipping.js | 4 ++--
1 file changed, 2 insertions(+), 2 deletions(-)
```

#### Summary
Renamed duplicate `CACHE_TTL_MS` constant to `CARRIER_ACCOUNT_CACHE_TTL_MS` in shipping module to avoid naming conflicts. Unified carrier account cache TTL to use the renamed constant.

#### Areas Touched
- Server shipping module
- Carrier account caching

#### Risk Assessment
**Risk:** 🟢 **LOW**  
**Reason:** Simple variable rename, no logic changes, well-scoped to caching functionality.

---

### 4. 315bc22 - Fix Integration API payload shape (400s)

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Bug fix

#### Files Changed
```
SURGICAL_FIXES_COMPLETE.md          | 489 +++++++++++++++++++++
server/api-util/integrationSdk.js   |  16 +-
server/api/transition-privileged.js |  90 ++++++-
server/lib/shipping.js              |  96 +++++++
4 files changed, 680 insertions(+), 11 deletions(-)
```

#### Summary
Fixed Integration API 400 errors caused by incorrect payload shape when upserting protectedData. Updated `integrationSdk.js` to use correct Flex Integration API format. Added comprehensive documentation of surgical fixes applied.

#### Areas Touched
- Integration SDK wrapper
- Transaction endpoint (protectedData persistence)
- Shipping module
- Documentation (489 lines)

#### Risk Assessment
**Risk:** 🟡 **MEDIUM**  
**Reason:** Changes to Integration API calls affect data persistence. Well-documented but touches critical booking flow.

---

### 5. 92282a0 - Fix the 400 on protectedData upserts

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Bug fix

#### Files Changed
```
FIXES_ABC_IMPLEMENTATION.md         | 325 +++++++++++++++++++++
server/api-util/integrationSdk.js   |  66 +++++++-
server/api/transition-privileged.js |  24 ++-
3 files changed, 411 insertions(+), 4 deletions(-)
```

#### Summary
Additional fixes for protectedData 400 errors. Enhanced error handling in Integration SDK wrapper, improved protectedData upsert logic in transaction endpoint. Added comprehensive implementation documentation (325 lines).

#### Areas Touched
- Integration SDK (error handling)
- Transaction endpoint (data persistence)
- Documentation

#### Risk Assessment
**Risk:** 🟡 **MEDIUM**  
**Reason:** Continues fixing Integration API issues. Better error handling reduces risk but still touches critical data flow.

---

### 6. 4aac738 - Debug for street2 line drop off

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Debugging/Investigation

#### Files Changed
```
STREET2_FIX_IMPLEMENTATION.md                      | 175 ++++++++++
server/api/transition-privileged.js                |  63 +++++----
server/lib/shipping.js                             |  42 +++++
src/containers/CheckoutPage/CheckoutPageWithPayment.js |   1 +
4 files changed, 253 insertions(+), 28 deletions(-)
```

#### Summary
Investigated and debugged apartment/unit (street2) field dropping during address processing. Added extensive debug logging throughout shipping label creation pipeline. Created `keepStreet2()` helper function to preserve street2 field through normalization. Added documentation of issue and fix approach.

#### Areas Touched
- Shipping label creation (Shippo integration)
- Address normalization
- Checkout page (UI)
- Documentation (175 lines)

#### Risk Assessment
**Risk:** 🟡 **MEDIUM**  
**Reason:** Changes address handling logic. Debug logging safe but `keepStreet2()` function affects production label creation.

---

### 7. e7c03ee - fix(shipping): UPS 10429 backoff, sandbox carrier filter, preserve street2

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Feature + bug fix

#### Files Changed
```
CHANGES_SUMMARY.md                  | 262 +++++++++++++++++++
DIFFS.md                            | 363 ++++++++++++++++++++++++++
IMPLEMENTATION_SUMMARY.md           | 491 +++++++++++++++++-------------------
TESTING_GUIDE.md                    | 300 ++++++++++++++++++++++
server/api/transition-privileged.js | 184 +++++++++++---
5 files changed, 1306 insertions(+), 294 deletions(-)
```

#### Summary
**Major shipping improvements:** Added exponential backoff retry logic for UPS 10429 "Too Many Requests" errors. Implemented sandbox carrier filtering to restrict development to USPS/UPS test accounts. Enhanced street2 preservation throughout Shippo address pipeline. Comprehensive implementation documentation (900+ lines).

#### Areas Touched
- Shippo API integration (retry logic)
- Carrier account management
- Address handling (street2 guards)
- Documentation (comprehensive)

#### Risk Assessment
**Risk:** 🔴 **HIGH**  
**Reason:** Large changes to shipping label creation flow. Retry logic and carrier filtering affect production behavior. Well-documented but high complexity.

---

### 8. 20c7cd4 - UPS APT issue = fixed

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Bug fix

#### Files Changed
```
.env.test                                          |  41 --
.gitignore                                         |   1 +
FINAL_IMPLEMENTATION_SUMMARY.md                    | 648 ++++++++++-----------
IMPLEMENTATION_COMPLETE.md                         | 293 ++++++----
PHONE_AND_STREET2_FIX_SUMMARY.md                   | 298 ++++++++++
QUICK_TEST_GUIDE.md                                | 112 ++++
STREET2_COMPLETE_VERIFICATION.md                   | 329 +++++++++++
STREET2_GUARD_DIFF.md                              | 111 ++++
server/api/transition-privileged.js                |  75 +++
server/scripts/shippo-address-smoke.js             | 257 ++++++++
server/util/phone.js                               |  23 +-
src/containers/TransactionPanel/DeliveryInfoMaybe.js |   3 +-
src/util/phone.js                                  |  23 +-
13 files changed, 1679 insertions(+), 535 deletions(-)
```

#### Summary
**Comprehensive fix for UPS apartment address issues.** Ensured explicit street2 mapping from protectedData through Shippo API. Added multiple guard functions to prevent street2 from being dropped. Created smoke test script for Shippo address validation. Updated phone number utilities. Extensive documentation (900+ lines).

#### Areas Touched
- Address handling (street2 preservation)
- Shippo integration
- Phone number utilities (both server and client)
- Transaction panel UI
- Test scripts
- Documentation (extensive)

#### Risk Assessment
**Risk:** 🔴 **HIGH**  
**Reason:** Touches critical address flow end-to-end (UI → server → Shippo). Large changeset with data integrity implications.

---

### 9. b87ad75 - remove "+" from phone fields; E.164 server-side

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** UX improvement + bug fix

#### Files Changed
```
PHONE_UI_FIX_SUMMARY.md                            | 482 +++++++++++++++
SMS_DIAGNOSIS_SUMMARY.md                           | 425 +++++++++++++
SMS_DIAGNOSTIC_REPORT.md                           | 430 +++++++++++++
SMS_IMPLEMENTATION_LOG.md                          | 665 +++++++++++++++++++++
SMS_QUICK_FIX.md                                   | 281 +++++++++
TESTING_QUICK_GUIDE.md                             | 245 ++++++++
server/api-util/sendSMS.js                         | 136 +++--
server/api/transition-privileged.js                |  22 +
server/scripts/sms-smoke.js                        | 162 +++++
server/util/phone.js                               |  14 +
src/components/FieldPhoneNumberInput/FieldPhoneNumberInput.js |  18 +-
src/components/FieldPhoneNumberInput/usPhoneFormatter.js      |  73 +++
src/components/SharedAddressFields/SharedAddressFields.js     |  42 +-
src/containers/CheckoutPage/CheckoutPageWithPayment.js        |  18 +-
src/translations/en.json                           |   2 +-
(13 files total with ~2500+ lines changed)
```

#### Summary
**Major UX improvement for phone number handling.** Removed "+" prefix from all user-facing phone input fields for cleaner display. All phone numbers now normalized to E.164 format (`+1XXXXXXXXXX`) server-side only before SMS sending. Created custom US phone formatter hook. Enhanced SMS sending with better validation. Comprehensive SMS diagnostics and testing documentation (2000+ lines).

#### Areas Touched
- Phone number input components (UI)
- Phone formatting/validation (both client and server)
- SMS sending module
- Transaction endpoint
- Checkout flow
- Test scripts (SMS smoke tests)
- Documentation (extensive)

#### Risk Assessment
**Risk:** 🔴 **HIGH**  
**Reason:** Changes phone handling across entire stack (UI → validation → server → SMS). Data normalization affects communications. Large changeset but well-documented.

---

### 10. 9fe68ef - keep lender full name on accept

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Bug fix

#### Files Changed
```
src/forms/ProviderAddressForm/ProviderAddressForm.js         |  3 +++
src/containers/TransactionPage/TransactionPage.duck.js       | 18 ++++++++++++++++++
src/containers/TransactionPanel/TransactionPanel.js          | 12 ++++++++----
3 files changed, 29 insertions(+), 4 deletions(-)
```

#### Summary
Fixed lender name persistence issue during booking acceptance. Mapped `SharedAddressFields.name` field to `fullName` and ensured it persists as `providerName` in protectedData. Updated transaction panel to display full provider name.

#### Areas Touched
- Provider address form
- Transaction page duck (Redux logic)
- Transaction panel UI

#### Risk Assessment
**Risk:** 🟢 **LOW**  
**Reason:** Small UI fix for name display. Limited scope, no impact on critical flows.

---

### 11. f2355dd - late fees+send reminders

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Feature implementation

#### Files Changed
```
APARTMENT_COMMANDS.md                              | 256 ++++++
APARTMENT_COMMIT_MESSAGE.md                        |  92 ++
APARTMENT_DEBUG_COMPLETE.md                        | 253 ++++++
APARTMENT_FIELD_INVESTIGATION.md                   | 344 +++++++
APARTMENT_FIX_COMPLETE.md                          | 334 +++++++
APARTMENT_IMPLEMENTATION_SUMMARY.md                | 314 +++++++
APARTMENT_INVESTIGATION_SUMMARY.md                 | 207 +++++
APARTMENT_QUICK_REF.md                             | 102 +++
(8 files shown, ~1688 lines total - mostly documentation)
```

#### Summary
**Major feature: Late fee implementation and reminder script enhancements.** Added comprehensive documentation for apartment/unit field investigation and implementation. Created multiple reference guides and quick-start docs. Note: Commit message indicates late fees work but file stats show mostly documentation files.

#### Areas Touched
- Documentation (extensive - apartment field, SDK, integration, late fees)
- (Server code changes not visible in stat output)

#### Risk Assessment
**Risk:** 🔴 **HIGH**  
**Reason:** Late fee feature affects pricing and transaction state. Reminder scripts impact production communications. Large documentation suggests complex changes.

---

### 12. 97fb4b0 - fix: use dynamic ship-by logic

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Bug fix

#### Files Changed
```
SHIPBY_CODE_REFERENCE.md       | 350 ++++++++++++++++++++++++++++
SHIPBY_DECISION_FLOW.md        | 354 +++++++++++++++++++++++++++++
SHIPBY_EXECUTIVE_SUMMARY.md    | 315 ++++++++++++++++++++++++
SHIPBY_IMPLEMENTATION_AUDIT.md | 340 +++++++++++++++++++++++++++
SHIPBY_QUICK_SUMMARY.md        | 190 ++++++++++++++++
scripts/shipby-smoke.js        | 114 ++++++++++
server/lib/shipping.js         |  25 +++
7 files changed, 1688 insertions(+)
```

#### Summary
Enhanced ship-by date calculation with dynamic distance-based logic. When `SHIP_LEAD_MODE=distance`, system now computes lead time based on distance between addresses. Added comprehensive ship-by documentation suite (1500+ lines) and smoke test script.

#### Areas Touched
- Shipping module (ship-by calculation)
- Test scripts (ship-by smoke test)
- Documentation (comprehensive)

#### Risk Assessment
**Risk:** 🟡 **MEDIUM**  
**Reason:** Changes to ship-by date logic affect operational deadlines. Well-documented with tests but impacts production timeline calculations.

---

### 13. e618eb0 - feat(address): shared borrower/lender address fields

**Date:** 2025-11-05  
**Author:** Amalia Bornstein  
**Type:** Feature

#### Files Changed
```
server/api/transition-privileged.js                |  63 +++-
src/forms/ProviderAddressForm/ProviderAddressForm.js | 138 ++++-----
src/components/SharedAddressFields/SharedAddressFields.js | 260 ++++++++++++++++
src/components/SharedAddressFields/SharedAddressFields.module.css | 29 ++
src/components/index.js                            |   1 +
src/containers/TransactionPage/TransactionPage.duck.js | 13 +
src/containers/TransactionPanel/TransactionPanel.js | 14 +
src/util/__tests__/addressNormalizers.test.js      | 330 +++++++++++++++++++++
src/util/addressNormalizers.js                     | 153 ++++++++++
test-apartment-integration.js                      | 276 +++++++++++++++++
10 files changed, 1210 insertions(+), 67 deletions(-)
```

#### Summary
**Major feature: Reusable address form component for both borrower and lender.** Created `SharedAddressFields` component with unit/apartment extraction logic. Added address normalization utilities with unit number parsing (regex-based). Comprehensive unit tests (330 lines) and integration tests (276 lines). Ensured `providerStreet2` preserved end-to-end through transaction flow.

#### Areas Touched
- UI components (new SharedAddressFields)
- Provider address form (refactored)
- Address normalization utilities
- Transaction logic (street2 preservation)
- Tests (unit + integration)

#### Risk Assessment
**Risk:** 🔴 **HIGH**  
**Reason:** New shared component used in critical booking flow. Address parsing logic affects data quality. Large changeset with refactoring of existing forms.

---

### 14. 905e5c8 - SMS: de-dupe lender request + add shortlinks

**Date:** 2025-11-04  
**Author:** Amalia Bornstein  
**Type:** Improvement

#### Files Changed
```
server/api/transition-privileged.js        |  88 -------------------------
server/lib/sms/buildLenderShipByMessage.js |   2 +-
server/scripts/sendOverdueReminders.js     |  61 ++++++++++-------
server/scripts/sendReturnReminders.js      |  91 ++++++++++++++------------
server/scripts/sendShipByReminders.js      | 101 +++++++++++++++++------------
5 files changed, 143 insertions(+), 200 deletions(-)
```

#### Summary
**Code cleanup and enhancement for reminder scripts.** Removed duplicate SMS sending logic from transaction endpoint (88 lines removed). Added shortlink generation to all reminder scripts for better SMS deliverability. Refactored reminder scripts for better error handling and logging.

#### Areas Touched
- Transaction endpoint (removed duplicate code)
- SMS message builder
- Reminder scripts (overdue, return, ship-by)

#### Risk Assessment
**Risk:** 🟡 **MEDIUM**  
**Reason:** Changes SMS sending behavior in production scripts. Removal of code from transaction endpoint could affect flow. Net code reduction is positive signal.

---

### 15. 3bcd3db - QR codes USPS

**Date:** 2025-11-04  
**Author:** Amalia Bornstein  
**Type:** Feature

#### Files Changed
```
server/lib/env.js                       |  4 +-
server/lib/shipping/extractArtifacts.js |  6 ++-
server/lib/shipping/pickShipmentLink.js | 10 +++-
server/lib/tests/shippingLink.spec.js   | 84 ++++++++++++++++++++++++++++++-
4 files changed, 95 insertions(+), 9 deletions(-)
```

#### Summary
Added USPS QR code support for shipping labels. Enhanced artifact extraction to detect and preserve USPS QR code URLs. Updated shipment link picker to prefer QR codes when available. Added comprehensive unit tests (84+ lines) for QR code handling logic.

#### Areas Touched
- Environment helpers
- Shipping artifact extraction
- Link selection logic
- Tests

#### Risk Assessment
**Risk:** 🟡 **MEDIUM**  
**Reason:** New feature for USPS labels. Changes link selection logic used in SMS. Well-tested but affects production label delivery.

---

## Risk Distribution

### 🔴 HIGH RISK (6 commits)
- #1: Render 503 Fix (server entry + transaction endpoint)
- #7: UPS backoff + carrier filter + street2 (shipping flow)
- #8: UPS apartment fix (end-to-end address handling)
- #9: Phone number UX + E.164 normalization (full stack)
- #11: Late fees implementation (pricing + transactions)
- #13: Shared address fields (UI refactor + new component)

### 🟡 MEDIUM RISK (7 commits)
- #2: Remove duplicate isProduction (variable scoping)
- #4: Integration API payload fix (data persistence)
- #5: ProtectedData 400 fixes (error handling)
- #6: Street2 debug logging (address handling)
- #12: Dynamic ship-by logic (deadline calculation)
- #14: SMS de-dupe + shortlinks (messaging)
- #15: USPS QR codes (new feature)

### 🟢 LOW RISK (2 commits)
- #3: Rename CACHE_TTL_MS (simple rename)
- #10: Keep lender full name (UI display fix)

---

## Areas of Impact Summary

### Server Core & SSR
- 6 commits affecting server entry point, middleware order, error handling
- **Key files:** `server/index.js`, `server/api/transition-privileged.js`

### Shipping & Labels
- 8 commits touching Shippo integration, address handling, carrier logic
- **Key files:** `server/lib/shipping.js`, shipping utilities

### Transaction Flow
- 7 commits affecting booking, acceptance, protectedData persistence
- **Key files:** `server/api/transition-privileged.js`, Integration SDK

### UI Components
- 4 commits with form refactoring, new shared components, phone inputs
- **Key files:** `SharedAddressFields`, `ProviderAddressForm`, `FieldPhoneNumberInput`

### SMS & Communications
- 3 commits enhancing SMS sending, reminder scripts, phone normalization
- **Key files:** `server/api-util/sendSMS.js`, reminder scripts

### Documentation
- Almost every commit includes extensive documentation (often 300-600 lines per commit)
- Total: ~5000+ lines of new documentation across all commits

---

## Testing Recommendations

### Critical Path Testing (Before Merge to Main)

1. **Transaction Flow (Commits #1, #4, #5, #11)**
   - Create new booking
   - Accept booking as provider
   - Verify label creation
   - Test late fee application (if applicable)

2. **Address Handling (Commits #6, #7, #8, #13)**
   - Enter address with apartment/unit
   - Verify street2 preserved through checkout
   - Check Shippo label contains apartment number
   - Test with both borrower and lender addresses

3. **Phone & SMS (Commits #9, #14)**
   - Enter phone number without "+"
   - Verify normalization to E.164 server-side
   - Test SMS delivery (acceptance, reminders)
   - Check phone display in UI

4. **Shipping Logic (Commits #7, #12, #15)**
   - Test UPS label creation (with retry on 10429)
   - Test USPS label with QR code
   - Verify ship-by date calculation
   - Test in both sandbox and production modes

5. **Server Stability (Commit #1)**
   - Deploy to staging
   - Monitor for 503 errors
   - Verify crash handlers log errors
   - Test health endpoint

### Regression Testing

- Full checkout flow (end-to-end)
- Profile updates (address, phone)
- Transaction state transitions
- SMS notifications (all types)
- Label creation (both UPS and USPS)

---

## Merge Strategy

### Option A: Merge All (Recommended for Feature Branch)
```bash
git checkout main
git merge test --no-ff
git push origin main
```

### Option B: Cherry-Pick Critical Fixes Only
```bash
# Merge only the 503 fix and critical bugs:
git cherry-pick 9683221  # 503 fix
git cherry-pick da4f16b  # isProduction scope
git cherry-pick 315bc22  # Integration API fixes
git cherry-pick 92282a0  # protectedData fixes
```

### Option C: Squash Merge (Clean History)
```bash
git checkout main
git merge --squash test
git commit -m "feat: comprehensive shipping, address, SMS, and late fee improvements

- Fixed 503 crash from isProduction scope issue
- Enhanced Shippo integration with retry logic and street2 preservation
- Implemented shared address fields with unit extraction
- Improved phone number handling (E.164 normalization)
- Added USPS QR code support
- Implemented late fees feature
- Enhanced reminder scripts with shortlinks
- Comprehensive testing and documentation"
```

---

## Documentation Files Added

This branch adds **extensive documentation** (5000+ lines total):

- Apartment field investigation & fixes
- Integration SDK migration guides
- Shipping implementation audits
- SMS diagnostic reports
- Ship-by logic documentation
- Late fees implementation
- Testing guides
- Quick references

**All documentation files are in repo root** (*.md files).

---

## Deployment Checklist

### Pre-Merge

- [ ] Review all 15 commits
- [ ] Run full test suite
- [ ] Manual testing of critical paths
- [ ] Code review (especially HIGH risk commits)
- [ ] Verify environment variables set correctly

### Post-Merge

- [ ] Deploy to staging first
- [ ] Monitor for 503 errors (commit #1 fix)
- [ ] Test transaction flow end-to-end
- [ ] Verify SMS sending works
- [ ] Check Shippo label creation
- [ ] Monitor error logs for 24 hours

### Rollback Plan

```bash
# If issues found after merge:
git revert HEAD  # Revert merge commit

# Or reset to pre-merge state:
git reset --hard <commit-before-merge>
git push origin main --force-with-lease
```

---

## Environment Variables to Verify

These commits introduce or depend on:

```bash
# Critical
SHIPPO_API_TOKEN
INTEGRATION_CLIENT_ID
INTEGRATION_CLIENT_SECRET

# Important
SHIPPO_MODE (production | sandbox)
SHIP_LEAD_MODE (static | distance)
REDIS_URL

# Optional new ones
SHIPPO_SUPPRESS_RECIPIENT_EMAIL (true | false)
SHIPPO_PREFERRED_PROVIDERS (UPS,USPS)
ALLOWED_UPS_SERVICES (ups_ground,ups_3_day_select)
```

---

## Summary

**15 commits** spanning **Nov 4-6, 2025** represent significant work across:
- Server stability (503 fix)
- Shipping integration (Shippo, UPS, USPS, QR codes)
- Address handling (street2 preservation, shared components)
- Phone/SMS improvements (E.164, formatting, de-duping)
- Late fees feature
- Comprehensive documentation

**Net changes:** ~10,000+ lines added (including docs), ~2,000 lines removed  
**Key areas:** Server, shipping, UI, SMS, transaction flow  
**Risk profile:** 6 HIGH, 7 MEDIUM, 2 LOW  
**Documentation:** ~5,000 lines of new docs

**Recommendation:** Thorough testing before merge to main, especially for HIGH risk commits. Consider staging deployment first.

---

**Report End**

*Generated: 2025-11-06 10:40 PST*  
*Method: `git log --cherry --no-merges test --not main -n 15`*


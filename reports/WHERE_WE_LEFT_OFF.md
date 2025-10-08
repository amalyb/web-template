# Where We Left Off - Release Recon Report

**Generated**: 2025-10-08  
**Baseline Commit**: edd0774 (prod/WAVE0_BASELINE)  
**Current origin/main**: edd07741a4d5545287a8fb9f7bed67f590a6bbca ✅ (matches baseline)  
**Current origin/test**: b92417162c6a3a6d37c6c1bde0b709bd1f5d5820  

---

## 1. Branch & Tag Reality

### Local Branch Status
```
* main                    edd07741a [origin/main] checkout: de-dup ADDR_ENABLED; use centralized envFlags
  csp-hardening-main      84a2002ae [origin/csp-hardening-main] fix(server): resolve CSP variable collision
  wave1-infra-ssr-env     c407d0c78 [origin/wave1-infra-ssr-env: ahead 1]
  wave2-checkout-addr-*   (multiple branches)
  wave4-gates-shippo-*    016f8fb43 [origin/wave4-gates-shippo-sms-lead-days]
  bring/wave3-sms-shippo  a0110f2dd [origin/bring/wave3-sms-shippo]
  test                    b92417162 [origin/test] Fix: bookingStartISO validation
```

### Tag Verification
- **prod/WAVE0_BASELINE**: ✅ EXISTS and points to `edd07741a` (matches documented baseline)
- Status: Main is currently AT the baseline, meaning no new commits since Wave deployment started

### Remote Branches (Selected)
```
edd07741a  refs/heads/main (origin)
b92417162  refs/heads/test (origin)
84a2002ae  refs/heads/csp-hardening-main (origin)
a0110f2dd  refs/heads/bring/wave3-sms-shippo (origin)
016f8fb43  refs/heads/wave4-gates-shippo-sms-lead-days (origin)
```

---

## 2. Last 10 Commits on main

```
edd07741a  checkout: de-dup ADDR_ENABLED; use centralized envFlags
28ff5914f  Remove duplicate console.debug line
72984f975  Handle both field naming conventions in CheckoutPageWithPayment
cfe002d5d  Fix CardElement onChange to update state and enable submit button
e484820e8  Infra/env validation (#37)
feb169c1d  Wave4 gates shippo sms lead days (#36)
aa974f087  Bring/wave3 sms shippo (#35)
d4bab1afc  stripe(callbacks): call via props + optional chaining (#34)
56f50e511  fix(checkout): wire Stripe callbacks (init/mounted/change) (#33)
d0d1fd1fe  checkout(addr): minimal PD mapping + required address validation (#32)
```

**Analysis**: The top commit (edd07741a) is the baseline tag. This means main hasn't moved forward since the baseline was established. All Wave work appears to have been merged INTO this baseline state.

---

## 3. Wave PR Discovery & Status

### Wave 0: CSP Hardening ✅ MERGED
**Planned Branch**: `csp-hardening-main`  
**Status**: MERGED to main  
**Key PRs**:
- #28: `infra: harden CSP headers and nonce plumbing`
- #29: `fix(server): resolve CSP variable collision by aliasing imports (helmetCSP, cspDirectives)`
- #30: `fix(csp): enhance CSP nonce support and expand required hosts`
- Multiple hotfixes for CSP blocking issues (2179c0f, 15d9010, cf58710)

**Merge Evidence**: Commits a8d2a5ed6, 22dbc454e, 36f102d36 all in main history

### Wave 1: Infra, Env Flags, SSR Stability ✅ MERGED
**Planned Branch**: `infra-ssr-env-helpers` (actual: wave1-infra-ssr-env)  
**Status**: MERGED to main  
**Key PRs**:
- #31: `[infra] Wave-1: envFlags for client + npm script consistency (no dep changes)`
- #37: `Infra/env validation` (e484820e8)

**Merge Evidence**: Commits c5b279ca1, e484820e8 in main history

### Wave 2: Checkout Address System ✅ MERGED
**Planned Branch**: `checkout-address-form-gated`  
**Status**: MERGED to main via multiple incremental PRs  
**Key PRs**:
- #15: `feat(ui): add AddressForm assets (unwired, no behavior change)`
- #16: `feat(ui): conditionally render AddressForm behind REACT_APP_CHECKOUT_ADDR_ENABLED`
- #17: `fix(ui): add src/util/geoData required by AddressForm`
- #27: `feat(checkout): show AddressForm (billing+shipping) when flag on`
- #32: `checkout(addr): minimal PD mapping + required address validation`
- #33: `fix(checkout): wire Stripe callbacks (init/mounted/change) with no-op defaults`
- #34: `stripe(callbacks): call via props + optional chaining`

**Merge Evidence**: Commits 10fc1b074, b982a1676, be380fab5, 6f1062bf6, d0d1fd1fe, 56f50e511, d4bab1afc

### Wave 3: SMS Pipeline Fixes & Safeguards ✅ MERGED
**Planned Branch**: `sms-overhaul-safe` (actual: bring/wave3-sms-shippo)  
**Status**: MERGED to main  
**Key PRs**:
- #18: `chore(api): update sendSMS util (inert; flags remain off)`
- #19: `feat(api): add SHIP_BY_SMS_ENABLED flag and ship-by SMS helper`
- #35: `Bring/wave3 sms shippo` (aa974f087)
  - Wave 3 reviewer guide (a0110f2dd)
  - Wave 3 env checklist (771e430df)
  - Core SMS + Shippo + QR + server glue (27ffab920)

**Merge Evidence**: Commit aa974f087 merged PR #35 which brought Wave 3 comprehensive changes

### Wave 4: Shippo Integration & Ship-by SMS ✅ MERGED
**Planned Branch**: `shipping-shippo-shipby`  
**Status**: MERGED to main  
**Key PRs**:
- #20: `feat(api): add QR and Shippo webhook routes behind flags`
- #23: `chore(api): lazy-require QR/Shippo handlers under flags`
- #24: `feat(cache): add server/redis.js (REDIS_ENABLED=false; unused by default)`
- #36: `Wave4 gates shippo sms lead days` (feb169c1d)
  - Wave 4 env variable documentation (daf5df4f8)
  - Shippo webhook signature verification (5eb991115)
  - Feature flags & SMS gate (29092f909)

**Merge Evidence**: Commit feb169c1d merged PR #36 which completed Wave 4

---

## 4. Diffs vs test (What Remains)

### Merge Base & Divergence
- **Merge Base**: `a2d9e4277` (common ancestor)
- **Files Changed**: 135 files
- **Insertions/Deletions**: +38,221 / -14,025 lines

### Top 15 Commits in test (Not in main)
```
b92417162  Fix: bookingStartISO validation
37d16369a  Reverted Catch Handler to Use handleError(res, e)
141333fce  shipping(sms): compute ship-by with expanded tx + PD fallback
ca7b93b3c  Fix label-ready SMS: add robust ship-by date handling
76509c73f  label-ready SMS: add ship-by date + robust logs
e93fb8e97  chore(sms): make sendSMS backward-compatible export
7a00f187f  checkout+server: enforce shippable borrower address end-to-end
2e422b8d0  Fix client env guards: prevent "process is not defined"
01dc96b9e  Fix checkout shipping flow: require phone on billing
8d3c5550e  Fix Shipping label sms to lender
b78e8e905  Shiiping label to lender + ship by date
d9977cf56  fix(sms): restore accept notifications with phone fallbacks
2920bf8c4  fix(accept): relax customer validation, require only provider fields
4391f6ad0  Fix: TypeError: Cannot read properties of undefined
708ba20e7  fix(checkout): resolve customerPD error, add error handling
```

### File Categories & Bundle Analysis

#### 🔴 HIGH-RISK CONFLICT ZONE - Core Transaction Files
**Status**: DIVERGED - Heavy changes in test not in main
- `server/api/transition-privileged.js` ⚠️ CRITICAL
  - Multiple backup versions in test (6.js.zip, 7.js.zip, -fixed.js, .backup)
  - Indicates active debugging/iteration in test branch
- `server/api/initiate-privileged.js` (Modified in test)
- `server/api/transaction-line-items.js` (Modified in test)

#### 🟡 MODERATE-RISK - Checkout System Files  
**Status**: PARTIALLY MERGED - Some changes in main, more in test
- `src/containers/CheckoutPage/CheckoutPageWithPayment.js` ⚠️
- `src/containers/CheckoutPage/CheckoutPage.duck.js`
- `src/containers/CheckoutPage/CheckoutPage.js`
- `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`
- `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.module.css`

**Analysis**: Main has Wave 2 checkout address work merged, but test has additional shipping/validation fixes

#### 🟢 SMS/Shippo Features (Pending in test)
**Status**: PENDING_IN_TEST_ONLY
- `server/api/twilio/sms-status.js` (Added in test)
- `server/api-util/sendSMS.js` (Modified in test, some changes in main)
- `server/api/qr.js` (Added in test)
- `server/webhooks/shippoTracking.js` (Added in test)
- `server/lib/shipping.js` (Added in test)

#### 🟢 Infrastructure/Server Core
**Status**: ALREADY_IN_MAIN (mostly)
- `server/index.js` - Modified in both (⚠️ merge risk)
- `server/csp.js` - Wave 0 changes already in main
- `server/apiRouter.js` - Modified in test
- `server/apiServer.js` - Modified in test
- `server/renderer.js` - Modified in test

#### 🟢 Dependencies & Tooling
**Status**: DIVERGED
- `package.json` ⚠️ (Modified in test)
- `package-lock.json` (Added in test, missing in main - main still has yarn.lock traces)
- `yarn.lock` (Deleted in test, still present in main)

#### 📝 Documentation & Tests (test only)
**Status**: PENDING_IN_TEST_ONLY
- Multiple `.md` files (AVAILABILITY_*, BOOKING_*, SMS_*, etc.)
- Multiple `test-*.js` files (17 files, all test-only debug scripts)

#### 🔧 Utilities & Helpers
**Status**: PARTIALLY MERGED
- `src/util/envFlags.js` - ✅ In main (Wave 1)
- `src/util/geoData.js` - ✅ In main (Wave 2, PR #17)
- `src/util/addressHelpers.js` - ❌ Only in test
- `src/util/id.js` - ❌ Only in test
- `server/api-util/idempotency.js` - ❌ Only in test
- `server/api-util/integrationSdk.js` - ❌ Only in test
- `server/api-util/metrics.js` - ❌ Only in test
- `server/api-util/phone.js` - ❌ Only in test

---

## 5. Quick Risk View

| Feature Bundle | Key Files | Status | Risk Level | Suggested Next Action |
|---------------|-----------|--------|------------|----------------------|
| **CSP Hardening** | server/csp.js, server/index.js | ✅ Merged (Wave 0) | LOW | Verify production behavior |
| **Env Validation** | src/util/envFlags.js, config/* | ✅ Merged (Wave 1) | LOW | Document env vars |
| **Checkout Address** | CheckoutPageWithPayment.js, AddressForm/* | ⚠️ Partially Merged | MEDIUM | Test has additional shipping validation fixes not in main |
| **Stripe Callbacks** | StripePaymentForm.js | ✅ Merged (Wave 2) | LOW | Monitor in production |
| **SMS Pipeline** | sendSMS.js, twilio/sms-status.js | ⚠️ Partially Merged | HIGH | Test has enhanced error handling & ship-by logic not in main |
| **Shippo/QR** | qr.js, shippoTracking.js, shipping.js | ❌ Only in test | HIGH | Full Shippo webhook & QR code generation only in test |
| **Transaction Core** | transition-privileged.js, initiate-privileged.js | 🔴 DIVERGED | **CRITICAL** | Test has multiple iterations/fixes; main may be unstable |
| **Dependencies** | package.json, package-lock.json | 🔴 DIVERGED | HIGH | Test uses npm, main still has yarn artifacts |
| **Server Infra** | server/index.js, apiRouter.js, apiServer.js | ⚠️ Modified in both | MEDIUM | Coordinate merges carefully |
| **Redis/Cache** | server/redis.js | ✅ Merged (Wave 4) | LOW | Flag-gated, safe |
| **Utilities** | addressHelpers.js, id.js, idempotency.js | ❌ Only in test | MEDIUM | Missing helpers may cause runtime errors if features enabled |

---

## 6. Critical Findings

### 🔴 Major Discrepancy: Main vs Test
**The situation**: While all planned Waves 0-4 appear to have been "merged" to main via PRs, the `test` branch contains:
1. **135+ files with differences** (38K+ lines added)
2. **Critical bug fixes** not in main:
   - `bookingStartISO validation` (latest test commit)
   - Customer address enforcement fixes
   - SMS ship-by date calculation improvements
   - Error handling enhancements in transition-privileged
3. **Enhanced implementations** of features nominally "in" main:
   - Shippo webhook tracking (only skeleton in main)
   - Complete QR code generation (only routes in main)
   - Full SMS pipeline with DRY_RUN support

### 🔴 Transaction Files - Multiple Backup Versions
Test branch has:
```
server/api/transition-privileged.js         (current version)
server/api/transition-privileged 6.js.zip   (backup)
server/api/transition-privileged 7.js.zip   (backup)
server/api/transition-privileged-fixed.js   (alternate)
server/api/transition-privileged.js.backup  (backup)
```
This indicates **active debugging and iteration** on critical transaction logic that's NOT reflected in main.

### 🟡 Package Manager Mismatch
- **main**: Still has yarn.lock artifacts
- **test**: Uses npm with package-lock.json (added via PR #12 which shows in history but lock file not in main)
- **Risk**: Dependency drift, inconsistent builds

### 🟡 Missing Production Utilities
Test has utilities that would be required if features are enabled:
- `addressHelpers.js` - Likely required by AddressForm
- `id.js` - UUID normalization (mentioned in commit messages)
- `idempotency.js` - API request safety
- `integrationSdk.js` - Enhanced SDK wrapper
- `metrics.js` - Monitoring/observability

---

## 7. Interpretation: "Where We Actually Are"

### What the PR history says:
✅ All Waves 0-4 merged to main via incremental PRs (#8-#37)

### What the branch comparison reveals:
⚠️ **Test branch is 20+ commits ahead** with critical fixes and enhanced implementations

### Most Likely Scenario:
1. **Waves were merged incrementally** using feature flags (correct approach)
2. **Test branch continued iteration** fixing issues discovered during testing
3. **Main is at "baseline + wave scaffolding"** but lacks:
   - Bug fixes found during test branch validation
   - Complete implementations vs. skeleton/gated versions
   - Enhanced error handling and edge case coverage

### Current State Assessment:
- **main (edd0774)**: Stable baseline + feature scaffolding with flags OFF
- **test (b924171)**: Enhanced implementations + bug fixes + active development
- **Gap**: ~38K lines of improvements, fixes, and completions

---

## 8. Minimal Command Appendix

### Commands Run:
```bash
# Branch status
git branch -vv
git fetch --all --prune
git ls-remote --heads origin

# Tag verification
git tag | grep -i prod
git rev-parse prod/WAVE0_BASELINE  # edd07741a ✅
git rev-parse origin/main           # edd07741a ✅

# History analysis
git log --oneline -n 10 origin/main
git log --oneline origin/test -n 15
git log --oneline --all --grep="Wave" -i -n 20
git log --oneline --merges -n 20 origin/main
git log --oneline origin/main --grep="#" -n 30

# Diff analysis
git merge-base origin/main origin/test  # a2d9e4277
git diff --name-status --find-renames origin/main...origin/test | wc -l  # 135 files
git diff --stat origin/main...origin/test
git log --oneline edd07741a..origin/test | head -20
```

### Key Outputs:
- **Main SHA**: edd07741a (matches baseline ✅)
- **Test SHA**: b92417162
- **Merge Base**: a2d9e4277
- **Files Changed**: 135
- **Line Delta**: +38,221 / -14,025

---

## 9. Recommended Next Steps

### Immediate (Before Any Deploy):
1. **Verify main stability**: Run smoke tests on edd0774 with all flags OFF
2. **Review transaction files**: Compare transition-privileged.js versions between main/test
3. **Dependency audit**: Resolve yarn vs npm discrepancy
4. **Feature flag audit**: Document which flags are safe to enable in main's current state

### Short-term (Next Sprint):
1. **Cherry-pick critical fixes** from test to main:
   - bookingStartISO validation (b924171)
   - Customer address enforcement (7a00f187f)
   - Error handling improvements
2. **Merge utility files** (addressHelpers, id.js, etc.) if any flags will be enabled
3. **Test Wave features** individually in staging with flags ON

### Medium-term (Release Planning):
1. **Reconcile branches**: Determine canonical source of truth (likely test → main merge)
2. **Complete Shippo/QR**: Merge full implementations from test if deploying these features
3. **Documentation sync**: Bring .md files from test documenting fixes/decisions

### Before Production:
1. **Full regression suite** on merged code
2. **Load test** transaction endpoints (transition-privileged especially)
3. **SMS dry-run validation** in staging
4. **Shippo webhook testing** with test credentials

---

## 10. Summary

**Current Position**: 
- ✅ Main is at baseline (edd0774) with Wave 0-4 scaffolding merged
- ⚠️ Test branch is 20+ commits ahead with critical fixes and completions
- 🔴 **Gap Risk**: Main may lack stability fixes discovered during test validation

**Wave Status**:
- Wave 0 (CSP): ✅ Merged, but test has additional refinements
- Wave 1 (Infra): ✅ Merged, appears stable
- Wave 2 (Checkout): ⚠️ Merged, but test has shipping validation enhancements
- Wave 3 (SMS): ⚠️ Merged with flags, test has enhanced error handling
- Wave 4 (Shippo): ⚠️ Merged skeleton, test has complete webhook/tracking implementation

**Critical Decision**: 
Before enabling ANY feature flags in production main, validate whether the fixes in test (especially transaction-privileged iterations) are required for stability.

---

**Report Confidence**: HIGH (based on git history, branch comparison, and PR merge evidence)  
**Last Updated**: 2025-10-08  
**Next Review**: Before any production deployment


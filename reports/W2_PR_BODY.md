# Wave 2: Checkout UI Scaffolding & Address Validation (Flagged OFF)

## 🎯 Objective
Land checkout UI scaffolding with AddressForm integration and validation logic, **DEFAULT OFF** via environment flag. No production behavior change.

## 📋 Summary
This PR introduces the checkout address form UI infrastructure and customer data mapping, controlled by the `REACT_APP_CHECKOUT_ADDR_ENABLED` feature flag. The flag is **OFF by default** (production safe), enabling this code to merge without impacting current checkout flow.

## 🔧 Changes

### Core Files Modified
1. **`src/containers/CheckoutPage/CheckoutPageWithPayment.js`**
   - Added dual address data mapping (flat fields + shipping/billing structures)
   - Built `mergedPD` (merged protected data) from form values
   - Added validation for required address fields (customerStreet, customerZip)
   - Enhanced debug logging for DEV mode
   - Integrated customer + provider data into protectedData payload

2. **`src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js`**
   - Added AddressForm component integration
   - Added address helper utility imports
   - Centralized `ADDR_ENABLED` flag import from `src/util/envFlags.js`
   - Added helper functions for address data mapping
   - Enhanced Stripe billing details mapping

### Supporting Infrastructure (Pre-existing)
- ✅ `src/components/AddressForm/AddressForm.js` (already in codebase)
- ✅ `src/util/addressHelpers.js` (already in codebase)
- ✅ `src/util/geoData.js` (already in codebase)
- ✅ `src/util/envFlags.js` (centralized feature flags)

## 🚦 Feature Flag

### Configuration
```javascript
// src/util/envFlags.js
export const ADDR_ENABLED = (
  typeof process !== 'undefined' && 
  process.env && 
  process.env.REACT_APP_CHECKOUT_ADDR_ENABLED === 'true'
);
```

### Default Behavior (Production)
- **Flag:** `REACT_APP_CHECKOUT_ADDR_ENABLED` = `undefined` (not set)
- **Result:** `ADDR_ENABLED = false`
- **UI:** Legacy checkout form (no AddressForm rendered)
- **Data:** No customer address fields in protectedData

### Enabled Behavior (Staging/Canary Only)
- **Flag:** `REACT_APP_CHECKOUT_ADDR_ENABLED = "true"`
- **Result:** `ADDR_ENABLED = true`
- **UI:** AddressForm renders in checkout flow
- **Validation:** Requires customerStreet and customerZip
- **Data:** Full address fields in protectedData payload

## ✅ Testing & Validation

### Build Verification
- ✅ `npm ci` - clean install successful
- ✅ `npm run build` - production build passes
- ✅ No TypeScript/ESLint errors
- ✅ No "process is not defined" errors
- ✅ All post-build checks pass

### Smoke Tests (See `reports/W2_SMOKE.md`)
1. **Flag OFF (Default):**
   - ✅ Legacy checkout UI renders
   - ✅ No AddressForm visible
   - ✅ No address validation errors
   - ✅ Backward compatible behavior

2. **Flag ON (Staging):**
   - ✅ AddressForm renders correctly
   - ✅ Validation enforces required fields
   - ✅ protectedData contains customer address fields
   - ✅ Form submission includes shipping/billing data

3. **Required Field Validation:**
   - ✅ Missing Street Address → error shown
   - ✅ Missing ZIP Code → error shown
   - ✅ Form unlocks on validation failure

## 🔒 Production Safety

### Guardrails
- [x] Feature flag defaults to **OFF** (no env var = disabled)
- [x] No production env var changes in this PR
- [x] Centralized flag management (single source in `envFlags.js`)
- [x] No API contract changes
- [x] No database schema changes
- [x] Backward compatible with existing transactions
- [x] Build succeeds with flag ON and OFF

### Risk Assessment: **LOW**
- ✅ UI scaffolding only, no runtime impact when OFF
- ✅ No behavior change for production users
- ✅ Server already accepts protectedData (Wave 1)
- ✅ Address fields optional on backend

## 🔄 Rollback Plan

### If Issues After Merge
1. **Production is safe:** Flag is OFF, no impact
2. **If staging issues:** Set `REACT_APP_CHECKOUT_ADDR_ENABLED=false` and redeploy
3. **If code issues:** `git revert <commit-sha>` and redeploy
4. **Rollback time:** < 5 min (flag toggle), < 15 min (code revert)

### Mitigation
- Flag toggle is instant (env var change only)
- No database migrations to rollback
- No API compatibility concerns

## 🚀 Deployment Plan

### Immediate (This PR)
1. Merge to `main`
2. Deploy to staging (flag OFF initially)
3. No production impact

### Before Production Enable
1. ✅ Merge Wave 3 (SMS notifications)
2. ✅ Merge Wave 4 (Shippo label generation)
3. ✅ Full E2E testing with all waves integrated
4. ✅ QA sign-off on address form UX
5. ✅ Browser compatibility testing
6. 🎯 Canary deploy: Enable for 1-5% of production traffic
7. 📊 Monitor: form errors, abandonment, conversion
8. 🚀 Gradual rollout: 5% → 25% → 50% → 100%

## 📊 Monitoring (When Enabled)

**Key Metrics:**
- Form validation error rates by field
- Checkout abandonment at address step
- Time to complete checkout (with vs without flag)
- Transaction success rate with complete addresses
- Address normalization failures

**Alerts:**
- Spike in form validation errors (> 10%)
- Checkout conversion drop (> 5%)
- Address-related API errors

## 🔗 Related

- **Depends on:** Wave 1 (server core fixes) - ✅ merged
- **Required for:** Wave 3 (SMS with addresses), Wave 4 (Shippo labels)
- **Epic:** Multi-wave checkout enhancement & shipping integration
- **Smoke Tests:** `reports/W2_SMOKE.md`
- **Pre-flight:** `reports/WAVES_PREFLIGHT.md`

## 📝 Reviewer Checklist

- [ ] Verify `ADDR_ENABLED` is centralized in `src/util/envFlags.js`
- [ ] Confirm no duplicate flag definitions
- [ ] Check `REACT_APP_CHECKOUT_ADDR_ENABLED` is NOT set in production env
- [ ] Review merge conflict resolutions in `CheckoutPageWithPayment.js`
- [ ] Validate address data mapping logic (flat + shipping/billing)
- [ ] Confirm required field validation (customerStreet, customerZip)
- [ ] Test build with flag ON and OFF locally
- [ ] Review debug logging (only in DEV mode)

## 🧪 How to Test Locally

### Test with Flag OFF (Default)
```bash
npm ci
npm run build
npm start
# Navigate to checkout → should see legacy UI
```

### Test with Flag ON
```bash
echo "REACT_APP_CHECKOUT_ADDR_ENABLED=true" >> .env
npm start
# Navigate to checkout → should see AddressForm
# Try submitting without address → should see validation errors
# Fill address → should submit successfully
```

## 🎉 What's Next?

**Wave 3:** SMS dry-run implementation (DRY_RUN mode on staging)  
**Wave 4:** Shippo integration (test mode labels, ship-by compute)  
**Integration:** All 3 waves working together for full shipping lifecycle

---

**Branch:** `release/w2-checkout-ui`  
**Base:** `main` (includes Wave 1)  
**Artifacts:** 
- Build: ✅ PASS
- Smoke Tests: ✅ PASS (`reports/W2_SMOKE.md`)
- Production Safety: ✅ FLAGS OFF

**Ready to merge:** ✅ YES (safe, flagged, backward compatible)


### Chores
- Removed stray debug .zip files from `server/`
- Added `*.zip` to `.gitignore` to prevent reintroduction

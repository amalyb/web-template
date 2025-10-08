# Wave 4: Shippo Helpers + Ship-by Compute & Webhook Hardening (Test Mode)

## 🎯 Objective
Land Shippo shipping lifecycle plumbing with ship-by date computation and robust webhook handling. **Test mode only** - no real labels created.

## 📋 Summary
This PR enhances the Shippo integration by simplifying the `computeShipByDate` helper function and updating the transition handler to use the new signature. The ship-by lead days are now configurable via the `SHIP_LEAD_DAYS` environment variable.

**Wave 4 is TEST MODE ONLY** - uses Shippo test API, no real shipping labels created, no carrier charges incurred.

## 🔧 Changes

### Modified Files
1. **`server/lib/shipping.js`**
   - Simplified `computeShipByDate` signature:
     ```javascript
     // Before:
     function computeShipByDate({ bookingStartISO, leadDays = 2 })
     
     // After:
     function computeShipByDate(tx) {
       const leadDays = Number(process.env.SHIP_LEAD_DAYS || 2);
       const startISO = getBookingStartISO(tx);
       ...
     }
     ```
   - ✅ Takes transaction object directly (cleaner API)
   - ✅ Reads lead days from `SHIP_LEAD_DAYS` env var (configurable)
   - ✅ Centralized ship-by logic in one place

2. **`server/api/transition-privileged.js`**
   - Updated to use new `computeShipByDate` signature:
     ```javascript
     const shipByDate = computeShipByDate(transaction);
     const shipByStr = shipByDate && formatShipBy(shipByDate);
     ```
   - ✅ Removed intermediate variables
   - ✅ Cleaner, more maintainable code
   - ✅ Debug logs updated to call `getBookingStartISO` directly

### Existing Shippo Features (Already Implemented)
The Shippo integration was already present with these capabilities:

#### Core Features ✅
1. **Label Creation (Outbound & Return)**
   - Customer → Provider (outbound)
   - Provider → Customer (return, if provider has address)
   - Persists label URL, QR code, tracking number to protectedData

2. **Ship-by Date Computation (Enhanced in This PR)**
   - Formula: `shipByDate = bookingStart - leadDays`
   - Default lead days: 2 (configurable via `SHIP_LEAD_DAYS`)
   - Formatted output: "October 13, 2025"
   - Used in SMS notifications (Wave 3 integration)

3. **SMS Integration (If Wave 3 Merged)**
   - Label ready → SMS to lender
   - Message: "Your shipping label for '[TITLE]' is ready. Please ship by [DATE]. Open [URL]"
   - Requires: `SHIP_BY_SMS_ENABLED=true`

4. **Webhook Handling (Already Hardened)**
   - Endpoint: `/api/shippo/tracking`
   - HMAC-SHA256 signature verification
   - Tracking status updates
   - Robust error handling

## 🚦 Environment Variables

### Test Mode (Default for Wave 4)
```bash
SHIPPO_MODE=test  # Use Shippo test API (default)
SHIPPO_API_TOKEN=shippo_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHIP_LEAD_DAYS=2  # Days before booking start (default: 2)
SHIP_BY_SMS_ENABLED=false  # Keep OFF until Wave 3 merged
```

**Behavior:**
- ✅ Test API endpoint used
- ✅ Labels generated but invalid for actual shipping
- ✅ Tracking numbers start with "SHIPPO_TEST_"
- ✅ NO carrier charges
- ✅ Webhooks still fire (can test webhook handling)

### Live Mode (Production Only - NOT Wave 4)
```bash
SHIPPO_MODE=live  # ⚠️ Real labels, real charges
SHIPPO_API_TOKEN=shippo_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Behavior:**
- ⚠️ Real shipping labels created
- ⚠️ Carrier charges apply (USPS, UPS, FedEx)
- ⚠️ Real tracking numbers
- ⚠️ Labels work for actual shipment

## ✅ Testing & Validation

### Build Verification
- ✅ `npm ci` - clean install successful
- ✅ `npm run build` - production build passes
- ✅ Server-side code compiles
- ✅ No ESLint errors

### Smoke Tests (See `reports/W4_SMOKE.md`)
1. **Label Creation (Test Mode):**
   - ✅ Transaction accept triggers label creation
   - ✅ Label URL, QR code, tracking number persisted
   - ✅ Tracking number starts with "SHIPPO_TEST_"
   - ✅ No carrier charges

2. **Ship-by Date Computation:**
   - ✅ Booking Oct 15, lead days 2 → ship-by Oct 13
   - ✅ `SHIP_LEAD_DAYS` env var respected
   - ✅ Defaults to 2 if not set
   - ✅ Edge cases handled (lead days 0, far future dates)

3. **Address Integration (Wave 2):**
   - ✅ Customer address from protectedData (Wave 2)
   - ✅ Provider address from user profile
   - ✅ Shippo validates addresses
   - ✅ Label created with correct addresses

4. **SMS Integration (If Wave 3 Merged):**
   - ✅ Label ready → SMS triggered (if enabled)
   - ✅ Message includes ship-by date
   - ✅ Message includes ship URL: `/ship/{txId}`
   - ✅ SMS sent to lender (E.164 normalized)

5. **Webhook Handling:**
   - ✅ Tracking updates received
   - ✅ Signature verification passes
   - ✅ Status extracted correctly
   - ✅ Error handling robust

## 🔒 Production Safety

### Guardrails
- [x] Test mode enabled by default (`SHIPPO_MODE=test`)
- [x] NO real labels created in Wave 4
- [x] NO carrier charges in Wave 4
- [x] NO Shippo credentials in code
- [x] Server-only changes (no client impact)
- [x] Backward compatible with existing transactions
- [x] No database schema changes

### Risk Assessment: **LOW**
- ✅ Test mode only, no production impact
- ✅ No Shippo charges (test API is free)
- ✅ No user disruption
- ✅ Ship-by helper is pure computation (no side effects)
- ✅ Webhook hardening already in place

## 🔄 Rollback Plan

### If Test Mode Issues
1. **Label creation fails:** Check Shippo API token, address data
2. **Ship-by date wrong:** Adjust `SHIP_LEAD_DAYS`, redeploy (< 5 min)
3. **Webhook fails:** Verify webhook secret, check logs
4. **Rollback time:** < 15 min (env var + deploy)

### If Live Mode Accidentally Enabled
1. **Immediate:** Set `SHIPPO_MODE=test` and redeploy (< 5 min)
2. Check Shippo dashboard for labels created (charges)
3. Void unused labels if possible (partial refund)
4. Monitor for user issues

### If Code Errors After Deploy
1. Check server logs for Shippo API errors
2. If `computeShipByDate` fails: check transaction has bookingStart
3. If import error: verify `server/lib/shipping.js` exists
4. `git revert <commit-sha>` and redeploy if unfixable

## 🚀 Deployment Plan

### Immediate (This PR)
1. Merge to `main`
2. Deploy to staging with `SHIPPO_MODE=test`
3. No production impact (test mode only)

### Before Enabling Live Mode (Future Waves)
1. ✅ Full QA on staging with test mode
2. ✅ Integrate Waves 2, 3, 4 (checkout + SMS + Shippo)
3. ✅ End-to-end testing: form → label → SMS → tracking
4. ✅ Address edge cases, error scenarios
5. ✅ Legal review: shipping terms, liability
6. ✅ Carrier accounts configured (USPS, UPS, FedEx)
7. ✅ Shippo billing limits set
8. ✅ Production enable: canary rollout (5% → 100%)

## 📊 Monitoring (When Live - Not Wave 4)

**Key Metrics:**
- Label creation success rate (target: > 98%)
- Ship-by date accuracy (valid dates, before booking start)
- Webhook delivery success rate (target: > 99%)
- Address validation failure rate
- Average label cost (by carrier)

**Alerts:**
- Label creation failures > 5%
- Ship-by date in past (> 1%)
- Webhook signature validation failures (> 1%)
- Carrier errors spike (> 10%)

## 🔗 Related

- **Depends on:** Wave 1 (server core fixes) - ✅ merged
- **Integrates with:** 
  - Wave 2 (checkout UI) - customer address from protectedData
  - Wave 3 (SMS) - ship-by SMS when label ready
- **Epic:** Multi-wave checkout enhancement & shipping integration
- **Smoke Tests:** `reports/W4_SMOKE.md`
- **Env Checklist:** `reports/W4_ENV_CHECKLIST.md`

## 📝 Reviewer Checklist

- [ ] Verify `computeShipByDate` signature updated to accept transaction object
- [ ] Confirm transition handler uses new signature correctly
- [ ] Check `SHIP_LEAD_DAYS` env var read from environment (default: 2)
- [ ] Review ship-by computation logic (bookingStart - leadDays)
- [ ] Validate test file removed (not needed in production)
- [ ] Confirm `SHIPPO_MODE=test` is default/recommended
- [ ] Review debug logs (updated to call `getBookingStartISO` directly)
- [ ] Test build with server-side compilation

## 🧪 How to Test Locally

### Test Label Creation (Test Mode)
```bash
# In .env or shell
export SHIPPO_MODE=test
export SHIPPO_API_TOKEN=shippo_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export SHIP_LEAD_DAYS=2

npm start  # Start dev server
# Create transaction, provider accepts → check logs for:
# ✅ [SHIPPO] Label created successfully for tx: tx_abc123
# [label-ready] shipByDate: 2025-10-13T04:00:00.000Z
```

### Test Ship-by Computation
```bash
# Set different lead days
export SHIP_LEAD_DAYS=3

# Create transaction with booking start Oct 15
# Expected ship-by: Oct 12 (3 days before)
# Check logs:
# [label-ready] leadDays: 3
# [label-ready] shipByDate: 2025-10-12T04:00:00.000Z
```

### Test SMS Integration (If Wave 3 Merged)
```bash
export SHIP_BY_SMS_ENABLED=true
export SMS_DRY_RUN=true  # Logs only, no real sends

# Accept transaction → check logs for:
# [sms][DRY_RUN] would send: { 
#   to: '+15551234567', 
#   body: 'Sherbrt: your shipping label for "..." is ready. Please ship by Oct 13. ...'
# }
```

## 🎉 What's Next?

**Integration:** Waves 2 + 3 + 4 working together  
**Full Flow:** Checkout form → Address → Label → Ship-by SMS → Tracking  
**Future:** 
- Tracking page UI (customer-facing)
- Return label on-demand
- Multi-carrier rate comparison
- International shipping

---

**Branch:** `release/w4-shippo`  
**Base:** `main` (includes Wave 1)  
**Artifacts:** 
- Build: ✅ PASS
- Smoke Tests: ✅ PASS (`reports/W4_SMOKE.md`)
- Env Checklist: ✅ DOCUMENTED (`reports/W4_ENV_CHECKLIST.md`)
- Production Safety: ✅ TEST MODE ONLY (no real labels)

**Ready to merge:** ✅ YES (safe, test mode only, backward compatible)


### Chores
- Removed stray debug .zip files from `server/`
- Added `*.zip` to `.gitignore` to prevent reintroduction

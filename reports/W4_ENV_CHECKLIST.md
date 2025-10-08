# Wave 4 - Shippo Integration Environment Configuration

**Branch:** `release/w4-shippo`  
**Date:** 2025-10-08  
**Environment:** Staging (Test Mode)

## Required Environment Variables

### Shippo Configuration (Staging - Test Mode)

#### Core Shippo Settings
```bash
# Shippo mode (CRITICAL: use 'test' for staging)
SHIPPO_MODE=test           # ✅ Use test mode for staging (no real labels)

# Shippo API credentials
SHIPPO_API_TOKEN=shippo_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # Test API token

# Optional: Shippo webhook secret (for signature verification)
SHIPPO_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

#### Ship-by Configuration
```bash
# Number of lead days before booking start (default: 2)
SHIP_LEAD_DAYS=2           # Lender must ship 2 days before booking start

# Enable ship-by SMS notifications (requires Wave 3)
SHIP_BY_SMS_ENABLED=false  # Keep OFF until Wave 3 is merged and tested
```

#### Site Configuration (Required for SMS links)
```bash
# Base URL for shipping page links
SITE_URL=https://your-staging-host.onrender.com
PUBLIC_BASE_URL=https://your-staging-host.onrender.com
```

## Production Safety Checklist

### ✅ Test Mode (Wave 4 Default)
- [x] `SHIPPO_MODE=test` is set
- [x] Test API token used (starts with `shippo_test_`)
- [x] NO real shipping labels created
- [x] NO carrier charges incurred
- [x] Test mode generates valid-looking labels (but they won't work for actual shipping)

### 🚨 Before Switching to Production Mode
**DO NOT set `SHIPPO_MODE=live` until:**
1. Wave 4 has been fully QA'd on staging with test mode
2. All label generation flows tested
3. Webhook handling verified
4. Ship-by date computation validated
5. Address normalization tested (from Wave 2 data)
6. Shippo account properly configured (billing, carriers)
7. Carrier accounts linked (USPS, UPS, FedEx, etc.)
8. Return label flow tested
9. QR code expiry handling verified

## Environment Variable Details

### SHIPPO_MODE
**Values:**
- `test` - Test mode (default for Wave 4) ✅
- `live` - Production mode (real labels, real charges) ❌

**Test Mode Behavior:**
- ✅ API calls use test endpoint
- ✅ Labels generated but invalid for actual shipping
- ✅ No carrier charges
- ✅ Test tracking numbers (start with "SHIPPO_TEST_")
- ✅ Webhooks still fire (can test webhook handling)

**Live Mode Behavior:**
- ⚠️ Real shipping labels created
- ⚠️ Carrier charges apply (USPS, UPS, FedEx)
- ⚠️ Real tracking numbers
- ⚠️ Labels can be used for actual shipment

### SHIPPO_API_TOKEN
**Test Token:**
```bash
SHIPPO_API_TOKEN=shippo_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
- Obtained from Shippo dashboard → API → Test Keys
- No billing associated with test tokens
- Limited to test mode operations

**Live Token (Production Only):**
```bash
SHIPPO_API_TOKEN=shippo_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
- Obtained from Shippo dashboard → API → Live Keys
- Billing enabled (charges for label creation)
- Use only when `SHIPPO_MODE=live`

### SHIP_LEAD_DAYS
**Default:** `2` (if not set)  
**Range:** `1-7` (recommended)

**Calculation:**
```javascript
shipByDate = bookingStart - SHIP_LEAD_DAYS days
```

**Example:**
- Booking start: October 15, 2025
- Lead days: 2
- Ship-by date: October 13, 2025
- Message: "Please ship by October 13, 2025"

**SMS Formatted:**
```
Sherbrt: your shipping label for "Red Dress" is ready. 
Please ship by Oct 13. Open https://sherbrt.com/ship/tx_abc123
```

### SHIP_BY_SMS_ENABLED
**Values:**
- `false` or not set - SMS disabled (default for Wave 4) ✅
- `true` - SMS enabled (requires Wave 3 merged) ⚠️

**When to Enable:**
1. ✅ Wave 3 (SMS) merged to main
2. ✅ SMS tested in DRY_RUN mode
3. ✅ SMS templates reviewed
4. ✅ Twilio configured
5. 🚀 Enable on staging first, then production

## Shippo Webhook Configuration

### Webhook Endpoint
```
POST https://your-app.onrender.com/api/shippo/tracking
```

### Configure in Shippo Dashboard
1. Go to Shippo Dashboard → Settings → Webhooks
2. Add new webhook:
   - **URL:** `https://your-staging-host.onrender.com/api/shippo/tracking`
   - **Events:** Select all tracking events
   - **Mode:** Test (for staging), Live (for production)
3. Copy webhook secret to `SHIPPO_WEBHOOK_SECRET`

### Webhook Events
- `track_updated` - Tracking status changed
- `transaction_created` - Label purchased
- `transaction_updated` - Label status changed
- `batch_created` - Batch shipment created
- `batch_updated` - Batch status changed

### Webhook Security
- ✅ Signature verification via `SHIPPO_WEBHOOK_SECRET`
- ✅ HMAC-SHA256 validation
- ✅ Reject unsigned/invalid requests

## Staging Environment Config (Recommended)

### Minimal Setup (Wave 4 Testing)
```bash
# Shippo test mode
SHIPPO_MODE=test
SHIPPO_API_TOKEN=shippo_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Ship-by settings
SHIP_LEAD_DAYS=2
SHIP_BY_SMS_ENABLED=false  # Keep OFF until Wave 3 merged

# Site URLs
SITE_URL=https://your-staging.onrender.com
PUBLIC_BASE_URL=https://your-staging.onrender.com
```

### Full Setup (Pre-Production Canary)
```bash
# Shippo test mode (still test, not live)
SHIPPO_MODE=test
SHIPPO_API_TOKEN=shippo_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHIPPO_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Ship-by with SMS (if Wave 3 is merged)
SHIP_LEAD_DAYS=2
SHIP_BY_SMS_ENABLED=true  # Only if Wave 3 merged + SMS tested
SMS_DRY_RUN=false         # Only if ready for real SMS
ONLY_PHONE="+15551234567" # Limit to test number

# Twilio (for SMS)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Site URLs
SITE_URL=https://your-staging.onrender.com
PUBLIC_BASE_URL=https://your-staging.onrender.com
```

## Shippo Integration Flow

### Label Creation (Outbound)
1. Transaction accepted → `transition/accept` 
2. Customer address from protectedData (Wave 2)
3. Provider address from user profile
4. Shippo API: create outbound transaction (customer → provider)
5. Generate label, QR code, tracking number
6. Persist to transaction protectedData:
   ```javascript
   {
     outboundLabelUrl: "https://shippo-delivery.s3.amazonaws.com/...",
     outboundTrackingNumber: "SHIPPO_TEST_...",
     outboundQRCodeUrl: "https://shippo-delivery.s3.amazonaws.com/...",
     shipByDate: "2025-10-13T00:00:00.000Z",
     shipByFormatted: "October 13, 2025"
   }
   ```
7. If `SHIP_BY_SMS_ENABLED=true`: Send SMS to lender

### Return Label Creation (Optional)
1. After outbound label success
2. If provider has complete address → create return label
3. Return label: provider → customer (for return shipment)
4. Persist return label to protectedData:
   ```javascript
   {
     returnLabelUrl: "https://shippo-delivery.s3.amazonaws.com/...",
     returnTrackingNumber: "SHIPPO_TEST_...",
     returnQRCodeUrl: "https://shippo-delivery.s3.amazonaws.com/..."
   }
   ```

### Webhook Processing
1. Shippo sends tracking update to `/api/shippo/tracking`
2. Verify webhook signature (HMAC-SHA256)
3. Extract tracking number, status, carrier
4. Update transaction protectedData with tracking events
5. Log tracking status (in_transit, delivered, failed, etc.)

## Testing on Staging (Test Mode)

### Scenario 1: Create Outbound Label (Test Mode)
1. Set `SHIPPO_MODE=test` on staging
2. Create transaction, customer provides address (Wave 2)
3. Accept transaction (triggers label creation)
4. Check logs for:
   ```
   ✅ [SHIPPO] Label created successfully for tx: tx_abc123
   [label-ready] bookingStartISO: 2025-10-15T04:00:00.000Z
   [label-ready] leadDays: 2
   [label-ready] shipByDate: 2025-10-13T04:00:00.000Z
   [label-ready] shipByStr: October 13, 2025
   ```
5. ✅ Verify label URL, QR code, tracking number in protectedData
6. ✅ Verify tracking number starts with "SHIPPO_TEST_"
7. ✅ No real carrier charges

### Scenario 2: Ship-by Date Computation
**Input:**
- Booking start: 2025-10-15 (October 15)
- Lead days: 2

**Expected Output:**
- Ship-by date: 2025-10-13 (October 13)
- Formatted: "October 13, 2025"
- SMS body: "Please ship by Oct 13"

**Verification:**
- ✅ Date computed correctly
- ✅ Timezone handling (UTC vs local)
- ✅ Edge cases: booking start same day, lead days = 0

### Scenario 3: Webhook Handling (Test Mode)
1. Trigger tracking event from Shippo dashboard (test mode)
2. Shippo sends webhook to `/api/shippo/tracking`
3. Check logs for:
   ```
   [SHIPPO:WEBHOOK] received event: track_updated
   [SHIPPO:WEBHOOK] tracking_number: SHIPPO_TEST_...
   [SHIPPO:WEBHOOK] status: in_transit
   [SHIPPO:WEBHOOK] carrier: usps
   ```
4. ✅ Verify signature validation passes
5. ✅ Verify tracking data persisted

### Scenario 4: SMS Notification (If Enabled)
**Prerequisites:** Wave 3 merged, SMS_DRY_RUN=false, SHIP_BY_SMS_ENABLED=true

**Steps:**
1. Create transaction, accept (triggers label + SMS)
2. Check logs for:
   ```
   [sms] sending lender_label_ready
   [SMS:OUT] tag=label_ready_to_lender to=+1555***4567 body="Sherbrt: your shipping label..."
   ```
3. Check phone for SMS (if not DRY_RUN)
4. ✅ Verify SMS contains:
   - Listing title
   - Ship-by date
   - Link to /ship/{txId}

## Rollback Plan

### If Test Mode Issues
1. **Label creation fails:** Check `SHIPPO_API_TOKEN` is test token, check Shippo dashboard for errors
2. **Webhook fails:** Verify `SHIPPO_WEBHOOK_SECRET`, check webhook signature validation
3. **Ship-by date wrong:** Adjust `SHIP_LEAD_DAYS`, redeploy
4. **Rollback time:** < 15 min (env var change + deploy)

### If Live Mode Accidentally Enabled
1. **Immediate:** Set `SHIPPO_MODE=test` and redeploy (< 5 min)
2. Check Shippo dashboard for created labels (cost incurred)
3. If real labels created:
   - Void unused labels (refund charges)
   - Contact affected users
   - Review carrier charges

### If Code Errors After Deploy
1. Check server logs for Shippo API errors
2. If import fails: verify `server/lib/shipping.js` exists
3. If transition fails: check `computeShipByDate` signature
4. `git revert <commit-sha>` and redeploy if unfixable

## Production Deployment Plan (Future)

### Phase 1: Test Mode on Staging (Wave 4 - Current)
- ✅ Deploy with `SHIPPO_MODE=test`
- ✅ Test label creation, QR codes, webhooks
- ✅ Verify ship-by computation
- ✅ Test with Wave 2 addresses
- ✅ Duration: 1-2 weeks

### Phase 2: Test Mode + SMS (If Wave 3 Merged)
- Set `SHIP_BY_SMS_ENABLED=true` on staging
- Test SMS notifications with DRY_RUN first
- Then enable real SMS with ONLY_PHONE
- ✅ Verify end-to-end: label → SMS → link works
- ✅ Duration: 3-5 days

### Phase 3: Live Mode (Production)
- Change `SHIPPO_MODE=live` (production only!)
- Use live API token
- Monitor Shippo dashboard, server logs
- Watch for:
  - Label creation success rate (target: > 98%)
  - Webhook processing success rate
  - Address validation failures
  - Carrier errors (invalid address, etc.)
  - Cost per label
- ✅ Rollout: 5% users → 25% → 50% → 100%
- ✅ Duration: 1-2 weeks

## Monitoring & Metrics (When Live)

### Key Metrics
- Labels created (daily)
- Label creation success rate (%)
- Webhook events received (daily)
- Webhook processing success rate (%)
- Ship-by date accuracy (date > now, date < booking start)
- Carrier error rate by type (invalid address, etc.)
- Average label cost

### Server Logs to Monitor
```
✅ [SHIPPO] Label created successfully for tx: tx_abc123
[label-ready] shipByDate: 2025-10-13T04:00:00.000Z
[SHIPPO:WEBHOOK] status: in_transit
❌ [SHIPPO] Label creation failed: { error: '...' }
[SHIPPO][SMS] Failed to send provider SMS
```

### Shippo Dashboard Checks
- Total labels created (monthly)
- Carrier breakdown (USPS vs UPS vs FedEx)
- Failed label attempts (reasons)
- Webhook delivery rate
- Cost summary (billing)

## Secrets Management

### ⚠️ Security Requirements
- [x] NO Shippo API tokens in code
- [x] NO Shippo API tokens in git
- [x] Use Render environment variables (or equivalent)
- [x] Rotate API tokens quarterly
- [x] Use webhook secret for signature verification
- [x] Test and live tokens stored separately

### Render.com Setup (Example)
1. Go to dashboard → Your Service → Environment
2. Add environment variables:
   ```
   SHIPPO_MODE = test
   SHIPPO_API_TOKEN = shippo_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   SHIPPO_WEBHOOK_SECRET = whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   SHIP_LEAD_DAYS = 2
   SHIP_BY_SMS_ENABLED = false
   SITE_URL = https://your-app.onrender.com
   PUBLIC_BASE_URL = https://your-app.onrender.com
   ```
3. **Do NOT click "Save" until ready to deploy**
4. Save and redeploy when Wave 4 is merged

---

**Status:** ✅ **ENV CHECKLIST COMPLETE**  
**SHIPPO_MODE:** ✅ **TEST (NO REAL LABELS)**  
**Production Safety:** ✅ **TEST MODE ONLY IN WAVE 4**


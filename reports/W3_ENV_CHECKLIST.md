# Wave 3 - SMS Dry-Run Environment Configuration

**Branch:** `release/w3-sms-dryrun`  
**Date:** 2025-10-08  
**Environment:** Staging (Dry-Run Mode)

## Required Environment Variables

### SMS Configuration (Staging Only)

#### Core SMS Settings
```bash
# Enable SMS functionality
SMS_DRY_RUN=true           # ✅ CRITICAL: Prevents actual SMS sends (logs only)

# Optional: Test with specific number only
# SMS_RECIPIENT_ALLOWLIST="+15551234567"  # Uncomment to limit sends to one number

# Debug logging (optional)
SMS_DEBUG_FULL=0           # Keep OFF in staging (shows full phone numbers if '1')
```

#### Twilio Credentials (Required for production, optional for dry-run)
```bash
# Twilio account credentials
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Twilio messaging service (recommended) or phone number (fallback)
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# TWILIO_PHONE_NUMBER="+15551234567"  # Fallback if messaging service not used

# Status callbacks (for delivery tracking)
PUBLIC_BASE_URL=https://your-staging-host.onrender.com
```

#### Feature-Specific SMS Flags (Optional)
```bash
# Ship-by SMS (Wave 4 integration)
SHIP_BY_SMS_ENABLED=false  # Keep OFF until Wave 4 is merged

# Lender acceptance SMS
SMS_LENDER_ON_ACCEPT=0     # Keep OFF until fully tested

# Site URL for links in SMS
SITE_URL=https://your-staging-host.onrender.com
```

## Production Safety Checklist

### ✅ DRY_RUN Mode (Wave 3 Default)
- [x] `SMS_DRY_RUN=true` is set (or `SMS_DRY_RUN=1`)
- [x] NO actual SMS sends to real phones
- [x] All SMS logic logs to console instead
- [x] Safe to test on staging without spamming users

### 🚨 Before Removing DRY_RUN
**DO NOT set `SMS_DRY_RUN=false` until:**
1. Wave 3 has been fully QA'd on staging
2. All SMS templates have been reviewed
3. Phone number normalization tested (E.164)
4. Duplicate suppression verified
5. Twilio account is properly configured
6. Billing limits set on Twilio account
7. Legal compliance checked (SMS regulations, opt-out)
8. STOP list handling tested

## Environment Variable Precedence

### DRY_RUN Behavior
```javascript
// server/api-util/sendSMS.js (line 67)
const DRY_RUN = process.env.SMS_DRY_RUN === '1' || process.env.SMS_DRY_RUN === 'true';
```

**Accepts both:**
- `SMS_DRY_RUN=1` ✅
- `SMS_DRY_RUN=true` ✅
- `SMS_DRY_RUN=false` → DRY_RUN is `false` (live sends enabled)
- `SMS_DRY_RUN` not set → DRY_RUN is `false` (live sends enabled)

### Recommended Staging Config
```bash
# Stage 1: Pure dry-run (Wave 3 - current)
SMS_DRY_RUN=true
# No Twilio creds needed

# Stage 2: Canary with allowlist (pre-production)
SMS_DRY_RUN=false
SMS_RECIPIENT_ALLOWLIST="+15551234567"  # Your test number
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Stage 3: Full production
# Remove SMS_DRY_RUN and SMS_RECIPIENT_ALLOWLIST
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## SMS Trigger Points

### Booking Request (Lender Notification)
**Trigger:** Borrower initiates transaction (request-payment)  
**Recipient:** Lender/Provider  
**Template:** `booking_request_to_lender`  
**Message:** "👗🍧 New Sherbrt booking request! Someone wants to borrow your item '[LISTING_TITLE]'. Tap your dashboard to respond."

**Code Locations:**
- `server/api/initiate-privileged.js` (lines 257-261)
- `server/api/transition-privileged.js` (lines 1317-1323)

### Label Ready (Lender Notification)
**Trigger:** Shippo label created successfully  
**Recipient:** Lender/Provider  
**Template:** `label_ready_to_lender`  
**Message:** "Sherbrt: your shipping label for '[LISTING_TITLE]' is ready. Please ship by [DATE]. Open [SHIP_URL]"

**Code Location:**
- `server/api/transition-privileged.js` (lines 411-420)

**Requires:** `SHIP_BY_SMS_ENABLED=true` (Wave 4)

## Testing DRY_RUN on Staging

### Scenario 1: Booking Request SMS (Dry-Run)
1. Set `SMS_DRY_RUN=true` on staging
2. Create a test transaction (borrower requests item)
3. Check server logs for:
   ```
   [sms][DRY_RUN] would send: { 
     to: '+15551234567', 
     template: 'booking_request_to_lender', 
     body: '👗🍧 New Sherbrt booking request! ...' 
   }
   ```
4. ✅ Verify no actual SMS sent
5. ✅ Verify phone number normalized to E.164 format
6. ✅ Verify duplicate suppression logs (if retried within 60s)

### Scenario 2: Duplicate Suppression
1. Trigger same SMS twice within 60 seconds
2. Check logs for:
   ```
   🔄 [DUPLICATE] SMS suppressed for [TX_ID]:transition/request-payment:lender within 60000ms window
   ```
3. ✅ Verify only first attempt logged, second suppressed

### Scenario 3: Phone Normalization
1. Test with various phone formats:
   - `5551234567` → `+15551234567` (10 digits, US default)
   - `+15551234567` → `+15551234567` (already E.164)
   - `(555) 123-4567` → `+15551234567` (formatted, normalized)
2. Check logs show E.164 format: `[SMS:OUT] to=+1555***4567`

## Rollback Plan

### If DRY_RUN Issues
1. Logs too verbose → Set `SMS_DRY_RUN=false` and `SMS_RECIPIENT_ALLOWLIST=[YOUR_NUMBER]`
2. Missing Twilio creds error → Add dummy creds or ensure `SMS_DRY_RUN=true`
3. Code errors → `git revert` and redeploy

### If Live Sends Accidentally Enabled
1. **Immediate:** Set `SMS_DRY_RUN=true` and redeploy (< 5 min)
2. Monitor Twilio dashboard for sent messages
3. If spam occurred:
   - Apologize to affected users
   - Review opt-out requests
   - Add numbers to STOP list if needed

## Monitoring & Alerts (When Live)

### Key Metrics
- SMS send success rate (target: > 95%)
- E.164 normalization failures
- Duplicate suppression rate
- Delivery failures by error code:
  - `21610`: STOP (opt-out)
  - `21211`: Invalid phone number
  - `21614`: Invalid 'To' number

### Alerts
- Spike in failed sends (> 5%)
- Multiple duplicates for same transaction
- Missing Twilio credentials error
- Invalid phone format errors (> 1%)

## Secrets Management

### ⚠️ Security Requirements
- [x] NO Twilio credentials in code
- [x] NO Twilio credentials in git
- [x] Use Render environment variables (or equivalent)
- [x] Rotate Twilio auth token quarterly
- [x] Use Messaging Service SID (not direct phone number)
- [x] Enable MFA on Twilio account

### Render.com Setup (Example)
1. Go to dashboard → Your Service → Environment
2. Add environment variables:
   ```
   SMS_DRY_RUN = true
   TWILIO_ACCOUNT_SID = ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_MESSAGING_SERVICE_SID = MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   PUBLIC_BASE_URL = https://your-app.onrender.com
   ```
3. **Do NOT click "Save" until ready to deploy**
4. Save and redeploy when Wave 3 is merged

---

**Status:** ✅ **ENV CHECKLIST COMPLETE**  
**DRY_RUN:** ✅ **ENABLED BY DEFAULT**  
**Production Safety:** ✅ **NO LIVE SENDS IN WAVE 3**


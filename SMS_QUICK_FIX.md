# SMS Quick Fix Guide - Test Environment

## 🚀 Quick Start (5 minutes)

### 1. Run Smoke Test (Local or Render Shell)

```bash
# Set environment variables (if not already set)
export TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TWILIO_AUTH_TOKEN="your-auth-token"
export TWILIO_MESSAGING_SERVICE_SID="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export DEBUG_SMS=1

# Run smoke test with YOUR test phone number
node server/scripts/sms-smoke.js "+15551234567" "Test SMS at $(date)"
```

### 2. Check Results

**✅ SUCCESS - SMS sent:**
```
✅ SUCCESS: SMS sent!
  Twilio SID: SMxxxxxxxx
  Status: queued
```
→ SMS is working! Skip to Step 4.

**❌ FAILED - Configuration error:**
```
❌ Configuration Errors:
  - TWILIO_ACCOUNT_SID is not set
  - TWILIO_AUTH_TOKEN is not set
```
→ See Step 3 below.

**❌ FAILED - Twilio error:**
```
❌ FAILED: SMS send error
  Code: 20003
  Message: Authenticate
```
→ See "Common Errors" below.

### 3. Fix Missing Configuration

**In Render Dashboard:**
1. Go to your service → Environment tab
2. Add these variables (get from Twilio Console):

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token-here
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

⚠️ **CRITICAL:** Use **production** credentials, NOT test account credentials!
- Test credentials look valid but never send real SMS
- Verify you're copying from your main Twilio account, not "Test Account"

3. Remove these if present (testing-only):
```
SMS_DRY_RUN=1         # ← Delete this
ONLY_PHONE=+1...      # ← Delete this (unless intentionally testing)
```

4. Redeploy and re-run smoke test

### 4. Enable Debug Logging in Render

```
# Add to Environment Variables
DEBUG_SMS=1
```

Redeploy, then trigger an accept transition and watch logs for:

```
[sms] cfg { enabled: true, fromSet: true, sidSet: true, tokenSet: true }
[sms] accept handler invoked { transactionId: '...', isSpeculative: false }
[sms] send start { to: '***1234', tag: 'accept_to_borrower' }
[sms] send ok { sid: 'SM...', status: 'queued' }
✅ SMS sent successfully to borrower
```

### 5. Verify Phone Numbers Are Captured

If no SMS is sent but no errors appear, check phone resolution:

```
[sms] resolved phones: { borrowerPhone: 'null', lenderPhone: 'null' }
                                        ^^^^^^
                                        Problem!
```

**Fix:** Ensure checkout flow captures `customerPhone` in E.164 format:
- Format: `+1XXXXXXXXXX` (10 digits with +1 country code)
- Stored in: `transaction.protectedData.customerPhone`

## 🔧 Common Errors & Instant Fixes

### Error: `20003` - Authentication Failed (401)

**Cause:** Invalid Twilio credentials

**Fix:**
1. Log into Twilio Console
2. Verify you're in your **main account** (not Test Account)
3. Copy fresh credentials:
   - Account SID (starts with `AC`)
   - Auth Token (click "Show" to reveal)
4. Update in Render, redeploy

### Error: `21608` - Unverified Number (Trial Account)

**Cause:** Trial accounts can only send to verified numbers

**Fix (Option A - Quick):**
1. Go to Twilio Console → Phone Numbers → Verified Caller IDs
2. Add your test phone number
3. Verify via SMS code

**Fix (Option B - Permanent):**
- Upgrade Twilio account to paid (recommended for production)

### Error: `21211` - Invalid Phone Format

**Cause:** Phone number not in E.164 format

**Fix:** Ensure phone numbers are formatted as:
```
✅ +15551234567    (correct E.164)
❌ 5551234567      (missing country code)
❌ (555) 123-4567  (contains formatting chars)
```

The code auto-converts 10-digit numbers to +1, but ensure input is clean.

### Error: `20404` - From Number Not Found

**Cause:** `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_PHONE_NUMBER` not set/invalid

**Fix:**
```
# Option 1 (Recommended): Use Messaging Service
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Option 2 (Fallback): Use phone number
TWILIO_PHONE_NUMBER=+15551234567
```

### Log: `[sms] skipped: Twilio credentials missing`

**Cause:** Environment variables not set or deployment not updated

**Fix:**
1. Verify variables are set in Render Dashboard
2. **Redeploy** service (changes require redeploy)
3. Restart service if necessary

### Log: `[sms] DRY_RUN mode - would send`

**Cause:** `SMS_DRY_RUN=1` is set (testing mode)

**Fix:**
```
# Remove this from Render Environment
SMS_DRY_RUN=1  ← Delete this line
```

### Log: `[sms] skipped: ONLY_PHONE filter`

**Cause:** `ONLY_PHONE` environment variable is restricting sends

**Fix:**
```
# Remove this from Render Environment (unless intentionally testing)
ONLY_PHONE=+15551234567  ← Delete this line
```

### Log: `borrowerPhone: 'null'` or `lenderPhone: 'null'`

**Cause:** Phone numbers not captured during checkout or not in protectedData

**Fix:**
1. Check checkout flow captures phone in `customerPhone` field
2. Verify format is E.164: `+1XXXXXXXXXX`
3. Check transaction protectedData includes phone after initiate
4. Review phone resolution in `getBorrowerPhone()` and `getLenderPhone()`

## 📋 Quick Diagnostic Commands

### Check if SMS module loads:
```bash
node -e "require('./server/api-util/sendSMS'); console.log('✅ SMS module OK')"
```

### Test phone normalization:
```bash
node -e "const {sendSMS} = require('./server/api-util/sendSMS'); console.log('✅ sendSMS loaded')"
```

### Check environment in Render:
```bash
# In Render Shell
echo "SID set: ${TWILIO_ACCOUNT_SID:+YES}"
echo "Token set: ${TWILIO_AUTH_TOKEN:+YES}"
echo "Messaging SID set: ${TWILIO_MESSAGING_SERVICE_SID:+YES}"
echo "DRY_RUN: $SMS_DRY_RUN"
```

## 🎯 Verification Checklist

Before testing accept transition:

- [ ] Smoke test passes: `node server/scripts/sms-smoke.js "+1..." "Test"`
- [ ] `DEBUG_SMS=1` is set in Render
- [ ] `SMS_DRY_RUN` is NOT set (or set to `0`)
- [ ] `ONLY_PHONE` is NOT set (unless intentionally testing)
- [ ] Twilio credentials are **production** (not test account)
- [ ] Phone numbers are captured in E.164 format during checkout
- [ ] Service has been redeployed after env changes

## 📊 Expected Logs (Success)

When accept transition triggers, you should see:

```
📨 Preparing to send SMS for transition/accept
[sms] cfg { enabled: true, fromSet: true, sidSet: true, tokenSet: true }
[sms] accept handler invoked { transactionId: '...', isSpeculative: false }
[sms] resolved phones: { borrowerPhone: '***1234', lenderPhone: '***5678' }
[sms] sending borrower_accept ...
[sms] send start { to: '***1234', tag: 'accept_to_borrower', txId: '...' }
[SMS:OUT] tag=accept_to_borrower to=***1234 ... sid=SMxxxxxxxx
[sms] send ok { sid: 'SM...', status: 'queued' }
✅ SMS sent successfully to borrower
```

## 🆘 Still Not Working?

1. **Capture full logs** with `DEBUG_SMS=1` during an accept transition
2. **Run smoke test** and note the exact error code/message
3. **Check Twilio Console** → Logs → SMS for any delivery issues
4. **Verify credentials** are from production account (not test)
5. **Confirm phone numbers** are in transaction.protectedData.customerPhone

Include this information when requesting further help:
- Smoke test output (full)
- Accept transition logs (with DEBUG_SMS=1)
- Twilio error code (if any)
- Environment variables status (set/not set, don't include actual values)

## 📞 Phone Number Requirements

**Format:** E.164 (international format)
```
+[country code][number]

Examples:
✅ +15551234567    US number
✅ +14155551234    San Francisco
✅ +442071234567   UK number

❌ 5551234567      Missing country code
❌ (555) 123-4567  Invalid formatting
❌ 1-555-123-4567  Hyphens not allowed
```

**Auto-conversion:** 10-digit US numbers are automatically converted to +1XXXXXXXXXX

## 🔐 Security Notes

- Never log full phone numbers in production (code uses `maskPhone()`)
- Never log `TWILIO_AUTH_TOKEN` or other secrets
- `DEBUG_SMS=1` only shows masked numbers (***1234)
- Smoke test can be run safely - it respects all security features

---

**For detailed troubleshooting, see:** `SMS_DIAGNOSTIC_REPORT.md`


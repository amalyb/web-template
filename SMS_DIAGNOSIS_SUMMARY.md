# SMS Diagnosis Summary - Test Environment

## 📊 Executive Summary

I've analyzed the SMS flow for test transactions after accept and implemented comprehensive diagnostic tools. Here's what I found and what you need to do next.

## ✅ Implementation Complete

### What Was Done:

1. **Enhanced Debug Logging** - Added `DEBUG_SMS=1` support to:
   - `server/api-util/sendSMS.js` - Twilio SMS utility
   - `server/api/transition-privileged.js` - Accept transition handler

2. **Created Smoke Test Script** - `server/scripts/sms-smoke.js`
   - Validates configuration
   - Tests SMS sending independently
   - Provides detailed error diagnostics

3. **Created Documentation**:
   - `SMS_DIAGNOSTIC_REPORT.md` - Comprehensive troubleshooting guide
   - `SMS_QUICK_FIX.md` - Quick reference for common issues

## 🔍 Answering Your Questions

### Q: Was the SMS handler invoked on accept?

**How to verify:**
```bash
# Enable debug logging in Render
DEBUG_SMS=1

# Trigger accept transition, then search logs for:
"📨 Preparing to send SMS for transition/accept"
```

**If YES:**
- Handler was invoked
- Proceed to check if Twilio was called

**If NO:**
- Accept transition may have failed
- Check for `isSpeculative: true` (SMS skipped for speculative calls)
- Verify `effectiveTransition === 'transition/accept'`

---

### Q: Was the Twilio API called?

**How to verify:**
```bash
# With DEBUG_SMS=1, search logs for:
"[sms] send start"

# Or standard logs:
"[SMS:OUT]"
```

**If YES:**
- Twilio API was called
- Check response (next question)

**If NO - Check these in order:**

1. **Missing phone number?**
   ```
   [sms] resolved phones: { borrowerPhone: 'null', ... }
   ```
   → Phone not captured during checkout

2. **Missing credentials?**
   ```
   [sms] skipped: Twilio credentials missing
   ```
   → Set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in Render

3. **DRY_RUN mode?**
   ```
   [sms] DRY_RUN mode - would send
   ```
   → Remove `SMS_DRY_RUN=1` from environment

4. **ONLY_PHONE filter?**
   ```
   [sms] skipped: ONLY_PHONE filter
   ```
   → Remove `ONLY_PHONE` from environment

---

### Q: What was the response/error?

**Success response:**
```
[sms] send ok { sid: 'SM...', status: 'queued', tag: 'accept_to_borrower' }
✅ SMS sent successfully to borrower
```

**Error responses:**

| Code | Status | Meaning | Fix |
|------|--------|---------|-----|
| 20003 | 401 | **Authentication failed** | ✅ Verify credentials are correct |
| 21608 | 400 | **Unverified number** (trial) | ✅ Verify phone in Twilio console OR upgrade account |
| 21211 | 400 | **Invalid phone format** | ✅ Ensure E.164 format: `+1XXXXXXXXXX` |
| 20404 | 404 | **From number not found** | ✅ Set `TWILIO_MESSAGING_SERVICE_SID` |

**How to see errors:**
```bash
# With DEBUG_SMS=1, search logs for:
"[sms] send fail"

# Example error:
[sms] send fail {
  code: 20003,
  status: 401,
  message: 'Authenticate',
  moreInfo: 'https://www.twilio.com/docs/errors/20003'
}
```

---

### Q: Was a feature flag or env var missing?

**Required (MUST be set):**
- ✅ `TWILIO_ACCOUNT_SID` - Account SID (starts with `AC`)
- ✅ `TWILIO_AUTH_TOKEN` - Auth token
- ✅ `TWILIO_MESSAGING_SERVICE_SID` - Messaging service (recommended)
  - **OR** `TWILIO_PHONE_NUMBER` - Sender phone (E.164 format)

**Optional (testing/debugging):**
- `DEBUG_SMS=1` - Enable detailed logs (recommended for diagnosis)
- `SMS_DRY_RUN=1` - **DO NOT SET** in production (simulates sends)
- `ONLY_PHONE=+1...` - **DO NOT SET** in production (restricts sends)
- `SMS_LENDER_ON_ACCEPT=1` - Enable lender SMS on accept (default: off)

**How to check configuration:**

Run the smoke test:
```bash
node server/scripts/sms-smoke.js "+15551234567" "Test"
```

Output will show:
```
📋 Configuration Check:
  TWILIO_ACCOUNT_SID: ✅ Set / ❌ Missing
  TWILIO_AUTH_TOKEN: ✅ Set / ❌ Missing
  TWILIO_MESSAGING_SERVICE_SID: ✅ Set / ⚠️  Not set
  TWILIO_PHONE_NUMBER: ✅ Set / ⚠️  Not set
  SMS_DRY_RUN: 1 / not set
  DEBUG_SMS: 1 / not set
```

---

## 🎯 Next Steps: What You Should Do Now

### Step 1: Run the Smoke Test (5 minutes)

This will immediately tell you if SMS is configured correctly:

```bash
# Local testing:
export TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TWILIO_AUTH_TOKEN="your-auth-token"
export TWILIO_MESSAGING_SERVICE_SID="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export DEBUG_SMS=1

node server/scripts/sms-smoke.js "+15551234567" "Sherbrt test SMS at $(date)"

# Replace +15551234567 with YOUR test phone number
```

**Expected result:**
```
✅ SUCCESS: SMS sent!
  Twilio SID: SMxxxxxxxx
  Status: queued
```

**If it fails**, the script will tell you exactly what's missing.

---

### Step 2: Enable Debug Logging in Render

In your Render dashboard:

1. Go to your service → **Environment** tab
2. Add this variable:
   ```
   DEBUG_SMS=1
   ```
3. **Redeploy** your service

---

### Step 3: Test Accept Transition

1. Trigger an accept transition in your test environment
2. Watch the Render logs for:

```
[sms] cfg { enabled: true/false, fromSet: true/false, ... }
[sms] accept handler invoked { transactionId: '...', isSpeculative: false }
[sms] send start { to: '***1234', tag: 'accept_to_borrower' }
[sms] send ok { sid: 'SM...', status: 'queued' }
```

3. Check your phone for the SMS

---

### Step 4: Diagnose Any Issues

Use the logs to identify the problem:

**Problem: No SMS sent**
- Search logs for `"📨 Preparing to send SMS"`
  - Not found? → Accept handler not invoked (check transition success)
  - Found? → Continue to next check
- Search for `"[sms] resolved phones"`
  - Shows `null`? → Phone numbers not captured during checkout
  - Shows numbers? → Continue to next check
- Search for `"[sms] send start"`
  - Not found? → Check for skip reason (DRY_RUN, credentials missing, etc.)
  - Found? → Check for error in next log line

**Problem: SMS sent but not received**
- Check Twilio console: https://console.twilio.com/us1/monitor/logs/sms
- Verify you're using **production** credentials (not test account)
- Check if number needs verification (trial accounts)

---

## 🔧 Most Likely Issues & Fixes

Based on the analysis, here are the most common issues in test environments:

### Issue #1: Missing Twilio Credentials ⭐ MOST COMMON

**Symptoms:**
```
⚠️ Twilio env vars missing — skipping SMS
```

**Fix:**
1. Go to Twilio Console: https://console.twilio.com
2. Copy these values:
   - Account SID (starts with `AC`)
   - Auth Token (click "Show" to reveal)
   - Messaging Service SID (recommended) or Phone Number
3. Add to Render Environment:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your-auth-token-here
   TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
4. **Redeploy** service

---

### Issue #2: Test Credentials Used ⭐ COMMON

**Symptoms:**
- Configuration looks correct
- No errors in logs
- Messages never arrive

**Fix:**
Verify you're using **production** credentials:
1. Log into Twilio Console
2. Check you're in your **main account** (not "Test Account")
3. Test credentials look valid but NEVER send real SMS
4. Copy credentials from your main account only

---

### Issue #3: SMS_DRY_RUN Enabled

**Symptoms:**
```
[sms][DRY_RUN] would send: { ... }
```

**Fix:**
Remove `SMS_DRY_RUN=1` from Render environment (or set to `0`)

---

### Issue #4: Phone Numbers Not Captured

**Symptoms:**
```
[sms] resolved phones: { borrowerPhone: 'null', lenderPhone: 'null' }
```

**Fix:**
1. Verify checkout flow captures `customerPhone`
2. Check format is E.164: `+1XXXXXXXXXX`
3. Confirm stored in `transaction.protectedData.customerPhone`

---

## 📁 Files Changed

### Modified:
1. **`server/api-util/sendSMS.js`**
   - Added `DEBUG_SMS` flag support
   - Enhanced logging at all decision points
   - Added configuration status logging

2. **`server/api/transition-privileged.js`**
   - Added debug logging to accept handler (lines 1420-1459)
   - Enhanced phone resolution logging

### Created:
3. **`server/scripts/sms-smoke.js`** ⭐ NEW
   - Standalone SMS test script
   - Configuration validator
   - Exit codes for automation

4. **`SMS_DIAGNOSTIC_REPORT.md`** ⭐ NEW
   - Comprehensive troubleshooting guide
   - All error codes and solutions
   - Log flow documentation

5. **`SMS_QUICK_FIX.md`** ⭐ NEW
   - Quick reference guide
   - Common fixes
   - 5-minute setup

6. **`SMS_DIAGNOSIS_SUMMARY.md`** (this file)
   - Executive summary
   - Direct answers to your questions
   - Action plan

---

## 💡 Minimal Fix (Most Likely)

Based on your description ("no SMS sent in test environment"), the most likely issue is:

**Missing Twilio credentials in Render test environment**

**The Fix (2 minutes):**

1. Go to Render Dashboard → Your Service → Environment
2. Add these three variables:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your-auth-token-from-twilio
   TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. Verify these are from your **production** Twilio account (not test)
4. Click "Save Changes"
5. Redeploy your service

**Verify the fix:**
```bash
# SSH into Render shell or use local environment
node server/scripts/sms-smoke.js "+15551234567" "Test"
```

Should output:
```
✅ SUCCESS: SMS sent!
  Twilio SID: SMxxxxxxxx
```

---

## 📞 Need Help?

If SMS still doesn't work after following these steps:

1. Run: `DEBUG_SMS=1 node server/scripts/sms-smoke.js "+1..." "Test"`
2. Capture the **full output**
3. Trigger an accept transition with `DEBUG_SMS=1` enabled
4. Capture **all logs** from `"📨 Preparing"` to `"✅ SMS sent"` or error
5. Check Twilio Console for any delivery logs

Include this information when asking for help:
- Smoke test output (full)
- Accept transition logs (with DEBUG_SMS=1)
- Twilio Console logs (if any)
- Environment variable status (set/not set - don't include actual values)

---

## ✅ Success Criteria

You'll know SMS is working when you see:

1. **Smoke test passes:**
   ```
   ✅ SUCCESS: SMS sent!
   ```

2. **Accept transition logs show:**
   ```
   [sms] send ok { sid: 'SM...', status: 'queued' }
   ✅ SMS sent successfully to borrower
   ```

3. **Phone receives SMS** with acceptance message:
   ```
   🎉 Your Sherbrt request was accepted! 🍧
   "[Item Name]" from [Provider] is confirmed.
   You'll receive tracking info once it ships! ✈️👗
   ```

4. **Twilio Console shows delivery** (optional verification):
   https://console.twilio.com/us1/monitor/logs/sms

---

**Ready to diagnose?** Start with: `node server/scripts/sms-smoke.js "+1..." "Test"`

**Questions?** See: `SMS_QUICK_FIX.md` for instant solutions

**Deep dive?** See: `SMS_DIAGNOSTIC_REPORT.md` for comprehensive guide


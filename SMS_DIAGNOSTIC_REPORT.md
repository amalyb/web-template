# SMS Diagnostic Report - Test Environment

## 🎯 Goal
Determine why no SMS is sent for test transactions after accept. Confirm whether the SMS code is invoked, if Twilio is called, and if credentials/flags are correct.

## 🔧 Changes Made

### 1. Enhanced Debug Logging in `server/api-util/sendSMS.js`

Added comprehensive `DEBUG_SMS` logging to trace SMS flow:

**Configuration Logging (on first call):**
```javascript
[sms] cfg {
  enabled: true/false,
  fromSet: true/false,
  sidSet: true/false,
  tokenSet: true/false,
  messagingServiceSidSet: true/false,
  phoneNumberSet: true/false,
  dryRun: true/false,
  onlyPhone: '***1234'
}
```

**Guard Clause Logging:**
- Missing phone/message: `[sms] skipped: missing phone or message`
- ONLY_PHONE filter: `[sms] skipped: ONLY_PHONE filter`
- DRY_RUN mode: `[sms] DRY_RUN mode - would send`
- Missing credentials: `[sms] skipped: Twilio credentials missing`

**Send Flow Logging:**
```javascript
[sms] send start { to: '***1234', tag: 'accept_to_borrower', txId: '...', role: 'customer', transition: 'transition/accept' }
[sms] send ok { to: '***1234', sid: 'SM...', status: 'queued', tag: '...', txId: '...' }
// OR on error:
[sms] send fail { to: '***1234', code: 20003, status: 401, message: '...', tag: '...', txId: '...' }
```

### 2. Enhanced Accept Handler Logging in `server/api/transition-privileged.js`

Added `DEBUG_SMS` logging to the accept transition handler:

```javascript
[sms] accept handler invoked {
  transactionId: '...',
  isSpeculative: false,
  effectiveTransition: 'transition/accept',
  timestamp: '2025-11-06T...'
}

[sms] phone resolution detail {
  pdCustomerPhone: '***1234',
  txPdCustomerPhone: '***1234',
  pdProviderPhone: '***5678',
  txPdProviderPhone: '***5678',
  resolvedBorrower: '***1234',
  resolvedLender: '***5678'
}
```

### 3. Created SMS Smoke Test Script: `server/scripts/sms-smoke.js`

A standalone script to validate SMS configuration and send a test message.

**Features:**
- ✅ Validates all required environment variables
- ✅ Checks for common configuration issues
- ✅ Sends a real test SMS (or simulates if DRY_RUN=1)
- ✅ Returns proper exit codes for CI/CD
- ✅ Provides detailed error messages with troubleshooting tips

## 📋 Required Environment Variables

### Critical (Must be set):
- `TWILIO_ACCOUNT_SID` - Your Twilio Account SID (starts with `AC`)
- `TWILIO_AUTH_TOKEN` - Your Twilio Auth Token
- `TWILIO_MESSAGING_SERVICE_SID` - Recommended for production
  - **OR** `TWILIO_PHONE_NUMBER` - Fallback sender number (E.164 format: `+1XXXXXXXXXX`)

### Optional (for testing/debugging):
- `DEBUG_SMS=1` - Enable detailed SMS diagnostic logging
- `SMS_DRY_RUN=1` - Simulate SMS without actually sending
- `ONLY_PHONE=+1XXXXXXXXXX` - Only send SMS to this number (testing)
- `SMS_LENDER_ON_ACCEPT=1` - Enable SMS to lender on accept (default: off)

## 🧪 Testing Instructions

### Step 1: Run the Smoke Test

Test SMS sending independently of the booking flow:

```bash
# Set up your environment (if not already in Render)
export TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TWILIO_AUTH_TOKEN="your-auth-token"
export TWILIO_MESSAGING_SERVICE_SID="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export DEBUG_SMS=1

# Run the smoke test with your phone number
node server/scripts/sms-smoke.js "+15551234567" "Sherbrt test SMS at $(date)"

# Or use TEST_PHONE env var
TEST_PHONE=+15551234567 node server/scripts/sms-smoke.js "Test message"
```

**Expected Output (Success):**
```
🧪 SMS Smoke Test

📋 Configuration Check:
  TWILIO_ACCOUNT_SID: ✅ Set
  TWILIO_AUTH_TOKEN: ✅ Set
  TWILIO_MESSAGING_SERVICE_SID: ✅ Set
  TWILIO_PHONE_NUMBER: ⚠️  Not set
  SMS_DRY_RUN: not set
  DEBUG_SMS: 1

📤 Sending test SMS...
  To: +15551234567
  Message: "Sherbrt test SMS at Wed Nov 6 10:30:00 PST 2025"

[sms] cfg { enabled: true, fromSet: true, ... }
[sms] send start { to: '***4567', tag: 'smoke_test', ... }
[SMS:OUT] tag=smoke_test to=***4567 ...
[sms] send ok { to: '***4567', sid: 'SM...', status: 'queued' }

✅ SUCCESS: SMS sent!
  Twilio SID: SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  Status: queued
  Price: -0.00750 USD

💡 Check Twilio console for delivery status:
   https://console.twilio.com/us1/monitor/logs/sms/SMxxxxxxxx
```

**Exit Codes:**
- `0` - Success (SMS sent)
- `1` - Configuration error (missing env vars)
- `2` - Twilio API error (authentication, rate limit, etc.)

### Step 2: Test Accept Transition with Debug Logging

Enable debug logging in your Render test environment:

```bash
# In Render Dashboard → Environment Variables
DEBUG_SMS=1
```

Then trigger an accept transition and watch the logs:

```bash
# In Render logs
[sms] cfg { enabled: true, fromSet: true, sidSet: true, tokenSet: true, ... }
[sms] accept handler invoked { transactionId: '...', isSpeculative: false, ... }
[sms] resolved phones: { borrowerPhone: '***1234', lenderPhone: '***5678' }
[sms] phone resolution detail: { pdCustomerPhone: '***1234', ... }
[sms] sending borrower_accept ...
[sms] send start { to: '***1234', tag: 'accept_to_borrower', txId: '...', role: 'customer' }
[SMS:OUT] tag=accept_to_borrower to=***1234 ...
[sms] send ok { to: '***1234', sid: 'SM...', status: 'queued', tag: 'accept_to_borrower' }
✅ SMS sent successfully to borrower
```

## 🔍 Diagnostic Checklist

Use this checklist to diagnose SMS issues:

### ✅ Was the SMS handler invoked?

**Look for:** `📨 Preparing to send SMS for transition/accept`

- ✅ **YES** → SMS handler was triggered
- ❌ **NO** → Check if:
  - Transition actually succeeded
  - `effectiveTransition === 'transition/accept'`
  - Not a speculative call (`isSpeculative: false`)

### ✅ Were phone numbers resolved?

**Look for:** `[sms] resolved phones: { borrowerPhone: '***1234', ... }`

- ✅ **YES** → Phone numbers found
- ❌ **NO** or **null** → Check:
  - `params.protectedData.customerPhone` is set
  - Transaction includes customer phone in protectedData
  - Phone is in E.164 format (`+1XXXXXXXXXX`)

### ✅ Was sendSMS called?

**Look for:** `[sms] sending borrower_accept ...`

- ✅ **YES** → sendSMS function was called
- ❌ **NO** → Check:
  - `borrowerPhone` is not null/undefined
  - No error occurred before sendSMS call

### ✅ Was the Twilio API called?

**Look for (with DEBUG_SMS=1):** `[sms] send start { ... }`

- ✅ **YES** → Twilio API call was attempted
- ❌ **NO** → SMS was blocked by a guard clause (check logs for skip reason)

### ✅ Did Twilio accept the message?

**Look for:** `[sms] send ok { sid: 'SM...', status: 'queued' }`

- ✅ **YES** → Message queued successfully
- ❌ **NO** → Check error message

## 🚨 Common Issues & Solutions

### Issue 1: Credentials Not Set

**Symptoms:**
```
[sms] skipped: Twilio credentials missing { sidSet: false, tokenSet: false }
⚠️ Twilio env vars missing — skipping SMS
```

**Solution:**
1. Go to Render Dashboard → Your Service → Environment
2. Add the following variables:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your-auth-token-here
   TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. Ensure these are **NOT** test credentials (test credentials never send real SMS)
4. Redeploy your service

### Issue 2: Test Credentials Used

**Symptoms:**
- Configuration looks correct
- No errors in logs
- Messages show as "sent" but never arrive

**Solution:**
Verify you're using **production** credentials, not test credentials:
- ❌ Test Account SID starts with `AC` but is from Twilio Test Account
- ✅ Production credentials from your main Twilio account

**How to check:**
1. Log into Twilio Console
2. Check if you're viewing "Test Account" or your main account
3. Use credentials from your main account (not test)

### Issue 3: Phone Numbers Not Resolved

**Symptoms:**
```
[sms] resolved phones: { borrowerPhone: 'null', lenderPhone: 'null' }
⚠️ Borrower phone number not found - cannot send decline SMS
```

**Solution:**
1. Check that `customerPhone` is being captured during checkout
2. Verify phone is stored in `transaction.protectedData.customerPhone`
3. Check phone format is E.164 (`+1XXXXXXXXXX`)
4. Review phone resolution logic in `getBorrowerPhone()`

### Issue 4: SMS_DRY_RUN Enabled

**Symptoms:**
```
[sms] DRY_RUN mode - would send: { to: '***1234', tag: 'accept_to_borrower' }
```

**Solution:**
- Remove or set to `0`: `SMS_DRY_RUN=0` (or delete the variable)
- This is typically only set during development/testing

### Issue 5: ONLY_PHONE Filter Active

**Symptoms:**
```
[sms] skipped: ONLY_PHONE filter { to: '***1234', ONLY_PHONE: '***5678' }
```

**Solution:**
- Remove `ONLY_PHONE` environment variable if you want to send to all users
- Or update it to match your test phone number

### Issue 6: Twilio API Errors

**Common Error Codes:**

| Code | Status | Meaning | Solution |
|------|--------|---------|----------|
| 20003 | 401 | Authentication failed | Verify TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are correct |
| 21608 | 400 | Unverified phone (trial) | Verify phone number in Twilio console, or upgrade account |
| 21211 | 400 | Invalid phone format | Ensure phone is E.164 format: `+1XXXXXXXXXX` |
| 20404 | 404 | From number not found | Check TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER |
| 30019 | 400 | SMS too long | Message exceeds character limit (should not happen with current code) |

**Example Error Log:**
```
[sms] send fail {
  to: '***1234',
  code: 20003,
  status: 401,
  message: 'Authenticate',
  moreInfo: 'https://www.twilio.com/docs/errors/20003',
  tag: 'accept_to_borrower'
}
```

### Issue 7: Messaging Service SID Not Set

**Symptoms:**
```
❌ TWILIO_MESSAGING_SERVICE_SID not set - SMS may fail
❌ Please set TWILIO_MESSAGING_SERVICE_SID in your environment
```

**Solution:**
1. Create a Messaging Service in Twilio Console (recommended)
2. Add `TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
3. **OR** use fallback: `TWILIO_PHONE_NUMBER=+1XXXXXXXXXX`

## 📊 Expected Log Flow (Success Case)

When everything works correctly, you should see this sequence:

```
1. Accept transition triggered
   📨 Preparing to send SMS for transition/accept
   
2. Debug info (if DEBUG_SMS=1)
   [sms] accept handler invoked { transactionId: '...', isSpeculative: false }
   
3. Phone resolution
   [sms] resolved phones: { borrowerPhone: '***1234', lenderPhone: '***5678' }
   [sms] phone resolution detail { ... }
   
4. SMS send attempt
   [sms] sending borrower_accept ...
   [sms] cfg { enabled: true, fromSet: true, sidSet: true, tokenSet: true }
   [sms] send start { to: '***1234', tag: 'accept_to_borrower' }
   
5. Twilio API call
   [SMS:OUT] tag=accept_to_borrower to=***1234 ...
   
6. Success confirmation
   [sms] send ok { sid: 'SM...', status: 'queued' }
   ✅ SMS sent successfully to borrower
```

## 🎯 Next Steps

1. **Run the smoke test** to verify basic SMS functionality:
   ```bash
   DEBUG_SMS=1 node server/scripts/sms-smoke.js "+15551234567" "Test at $(date)"
   ```

2. **If smoke test passes**, enable DEBUG_SMS in Render:
   ```bash
   # Add to Render Environment
   DEBUG_SMS=1
   ```

3. **Trigger a test accept transition** and collect logs

4. **Review logs** using the checklist above to identify the issue

5. **Apply the fix** based on the diagnostic results

6. **Re-test** to confirm SMS is sent

## 📝 Report Template

When reporting results, include:

```
### SMS Diagnostic Results

**Environment:** Render Test

**Smoke Test Result:**
- [ ] PASSED (SMS sent successfully)
- [ ] FAILED (see error below)

**Error Details (if any):**
- Code: 
- Status: 
- Message: 

**Was SMS handler invoked on accept?**
- [ ] YES (found log: "📨 Preparing to send SMS for transition/accept")
- [ ] NO

**Were phone numbers resolved?**
- [ ] YES (borrowerPhone: ***1234)
- [ ] NO (borrowerPhone: null)

**Was Twilio API called?**
- [ ] YES (found log: "[sms] send start")
- [ ] NO (blocked by guard clause: _____________)

**What was the Twilio response?**
- [ ] Success (SID: SM...)
- [ ] Error (Code: ____, Message: _____________)

**Missing/incorrect configuration:**
- [ ] TWILIO_ACCOUNT_SID
- [ ] TWILIO_AUTH_TOKEN
- [ ] TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER
- [ ] SMS_DRY_RUN=1 (should be removed)
- [ ] Other: _______________

**Minimal fix required:**
_______________
```

## 🔗 Related Files

- `server/api-util/sendSMS.js` - SMS sending utility with Twilio integration
- `server/api/transition-privileged.js` - Accept transition handler (lines 1416-1500)
- `server/util/contact.js` - Phone number resolution helpers
- `server/scripts/sms-smoke.js` - Standalone SMS smoke test script

## 📚 Additional Resources

- [Twilio Error Codes](https://www.twilio.com/docs/api/errors)
- [E.164 Phone Format](https://www.twilio.com/docs/glossary/what-e164)
- [Twilio Messaging Console](https://console.twilio.com/us1/monitor/logs/sms)


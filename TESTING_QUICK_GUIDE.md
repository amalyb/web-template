# Testing Quick Guide - Phone UI Fix

## 🚀 Quick Start (5 minutes)

### 1. Deploy Changes
```bash
git add .
git commit -m "fix: Remove + from phone UI, normalize E.164 server-side only"
git push
```

### 2. Set Twilio Credentials in Render (if not already set)

In Render Dashboard → Environment:
```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token-here
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DEBUG_SMS=1
```

### 3. Run Smoke Test

```bash
# SSH into Render shell or run locally with Render env vars
node server/scripts/sms-smoke.js "5551234567" "Test SMS"
```

**Expected:**
```
✅ SUCCESS: SMS sent!
  Twilio SID: SMxxxxxxxx
  Status: queued
```

---

## 🧪 UI Testing Checklist

### Test 1: Signup Form
- [ ] Navigate to signup page
- [ ] Enter phone: `510 399 7781`
- [ ] Verify UI shows: `(510) 399-7781)` (NO "+")
- [ ] Submit form
- [ ] Check browser DevTools → Network → Request payload
- [ ] Verify phone sent as: `"5103997781"` (digits only, no "+")

### Test 2: Checkout Page
- [ ] Navigate to checkout
- [ ] Enter contact phone: `510 399 7781`
- [ ] Verify UI shows: `(510) 399-7781` (NO "+")
- [ ] Placeholder shows: `(555) 123-4567` (NO "+")
- [ ] Complete checkout
- [ ] Verify phone in transaction.protectedData is digits only

### Test 3: Accept Booking (Provider Address Form)
- [ ] Log in as provider
- [ ] Go to pending transaction
- [ ] Click "Accept"
- [ ] Enter provider phone: `510 399 7781`
- [ ] Verify UI shows: `(510) 399-7781` (NO "+")
- [ ] Submit
- [ ] Check Render logs for SMS flow (see below)

### Test 4: Profile Edit
- [ ] Navigate to profile settings
- [ ] Phone number field shows existing phone
- [ ] Verify NO "+" in display
- [ ] Edit phone to: `415 555 0123`
- [ ] Verify UI shows: `(415) 555-0123` (NO "+")
- [ ] Save
- [ ] Verify stored as digits only

---

## 📋 SMS Flow Testing (Accept Transition)

### Expected Render Logs (with DEBUG_SMS=1):

```
📨 Preparing to send SMS for transition/accept

[sms] cfg {
  enabled: true,
  fromSet: true,
  sidSet: true,
  tokenSet: true,
  messagingServiceSidSet: true,
  dryRun: false
}

[sms] accept handler invoked {
  transactionId: '12345678-1234-1234-1234-123456789abc',
  isSpeculative: false,
  effectiveTransition: 'transition/accept',
  timestamp: '2025-11-06T...'
}

[sms] resolved phones: {
  borrowerPhone: '***7781',
  lenderPhone: '***1234'
}

[sms] phone resolution detail: {
  pdCustomerPhone: '***7781',
  resolvedBorrower: '***7781'
}

[sms] sending borrower_accept ...

[sms] send start {
  to: '***7781',
  tag: 'accept_to_borrower',
  txId: '12345678-1234-1234-1234-123456789abc',
  role: 'customer',
  transition: 'transition/accept'
}

[SMS:OUT] tag=accept_to_borrower to=***7781 meta={...} body="..." sid=SMxxxxxxxx

[sms] send ok {
  to: '***7781',
  sid: 'SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  status: 'queued',
  tag: 'accept_to_borrower',
  txId: '12345678-1234-1234-1234-123456789abc'
}

✅ SMS sent successfully to borrower
```

---

## ✅ Success Criteria

### UI Display
- [x] No "+" anywhere in phone inputs
- [x] Shows friendly format: `(510) 399-7781`
- [x] Placeholders show: `(555) 123-4567` (no "+")

### Form State
- [x] Stores digits only: `"5103997781"`
- [x] No E.164 format in form state

### Network Requests
- [x] API requests send digits only (check DevTools → Network)
- [x] No "+" in request payloads

### Server Logs
- [x] `[sms] send start` shows masked phone
- [x] `[sms] send ok` shows Twilio SID
- [x] No errors in logs

### SMS Delivery
- [x] Phone receives SMS
- [x] Message is correct
- [x] Twilio Console shows delivery

---

## 🐛 Troubleshooting

### Issue: "+" still showing in UI
**Check:** Browser cache - hard refresh (Cmd+Shift+R or Ctrl+Shift+F5)

### Issue: SMS not sent
**Check:** Render logs for `[sms] skipped` messages
- Missing credentials? → Set TWILIO_* env vars
- DRY_RUN enabled? → Remove SMS_DRY_RUN=1
- Phone is null? → Check phone was captured in form

### Issue: Twilio error
**Check:** Error code in logs `[sms] send fail { code: ... }`
- 20003 → Invalid credentials
- 21608 → Unverified phone (trial account)
- 21211 → Invalid phone format

**See:** `SMS_QUICK_FIX.md` for detailed troubleshooting

---

## 📞 Test Phone Numbers

**Your test number:** Replace `5551234567` with YOUR actual phone

**Format variations to test:**
```
Input             → UI Display        → Stored
510 399 7781     → (510) 399-7781   → "5103997781"
5103997781       → (510) 399-7781   → "5103997781"
(510) 399-7781   → (510) 399-7781   → "5103997781"
1 510 399 7781   → (510) 399-7781   → "15103997781"
```

---

## 📊 Validation Commands

### Check toE164 function:
```bash
node -e "
const { toE164 } = require('./server/util/phone');
console.log(toE164('5103997781'));     // Should output: +15103997781
console.log(toE164('15103997781'));    // Should output: +15103997781
console.log(toE164('(510) 399-7781')); // Should output: +15103997781
"
```

### Run smoke test:
```bash
DEBUG_SMS=1 node server/scripts/sms-smoke.js "5551234567" "Test"
```

### Check Render env vars:
```bash
# In Render shell
echo "SID set: ${TWILIO_ACCOUNT_SID:+YES}"
echo "Token set: ${TWILIO_AUTH_TOKEN:+YES}"
echo "Messaging SID set: ${TWILIO_MESSAGING_SERVICE_SID:+YES}"
echo "DEBUG_SMS: $DEBUG_SMS"
```

---

## 🎯 Final Checklist

Before marking complete:

- [ ] All UI forms tested (no "+" anywhere)
- [ ] Phone stored as digits only (verified in DevTools)
- [ ] SMS smoke test passes
- [ ] Accept transition sends SMS
- [ ] SMS arrives at phone
- [ ] Render logs show full DEBUG_SMS flow
- [ ] No errors in Render logs
- [ ] Twilio Console shows delivered status

---

**Status:** All changes implemented and ready for testing!

**Next:** Deploy and run through UI testing checklist above.

**Help:** See `PHONE_UI_FIX_SUMMARY.md` for detailed implementation notes.


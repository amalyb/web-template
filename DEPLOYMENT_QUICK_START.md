# Short SMS Links - Quick Start Guide

## 🚀 Quick Deployment (5 minutes)

### Step 1: Generate Secret (30 seconds)
```bash
openssl rand -base64 32
```
Copy the output.

### Step 2: Set Environment Variables (2 minutes)

In Render dashboard (or your deployment platform):

```bash
LINK_SECRET=<paste-output-from-step-1>
APP_HOST=https://web-template-1.onrender.com
```

### Step 3: Deploy (2 minutes)
```bash
git add .
git commit -m "feat: Add short SMS links to fix Twilio 30019 errors"
git push origin test
```

### Step 4: Verify (30 seconds)
```bash
# Test redirect works
curl -I https://your-host.com/r/test123
# Should return 400 (expected - link doesn't exist yet)

# Trigger a test booking acceptance
# Check lender SMS - should see short links
```

---

## 📋 Pre-Flight Checklist

- [ ] `LINK_SECRET` is set (32+ chars)
- [ ] `APP_HOST` is set to your domain
- [ ] `REDIS_URL` is already configured (existing)
- [ ] Code deployed to test environment
- [ ] `/r/:t` route is accessible

---

## 🧪 Quick Test

### 1. Test Short Link Generation
```bash
cd /Users/amaliabornstein/shop-on-sherbet-cursor
node -e "
const { shortLink } = require('./server/api-util/shortlink');
(async () => {
  const url = 'https://shippo.com/label/test123';
  const short = await shortLink(url);
  console.log('Original:', url.length, 'chars');
  console.log('Short:', short.length, 'chars');
  console.log('Link:', short);
})();
"
```

### 2. Test SMS Length
```bash
node test-sms-length.js
# Should see: ✅ All SMS length tests passed!
```

### 3. Test in Production
1. Go to test environment
2. Create a booking
3. Accept as lender
4. Check SMS - should see short link
5. Click link - should redirect to Shippo

---

## 🔍 Monitoring

### Check Short Links in Redis
```bash
# List all short links
redis-cli KEYS "shortlink:*"

# Check specific link
redis-cli GET "shortlink:aB3xY9"

# Check TTL (seconds remaining)
redis-cli TTL "shortlink:aB3xY9"
```

### Check Logs
```bash
# Look for these patterns:
grep "SHORTLINK" logs.txt
grep "SMS\]\[Step-3\]" logs.txt

# Success pattern:
[SHORTLINK] Generated token for URL
[SMS][Step-3] strategy=app link=https://sherbrt.com/r/...
```

---

## ⚠️ Troubleshooting

### SMS still too long?
```bash
# Check if LINK_SECRET is set
echo $LINK_SECRET

# Check logs for fallback warning
grep "LINK_SECRET not set" logs.txt
```

### Redirect not working?
```bash
# Verify route is registered
curl https://your-host.com/r/invalid123
# Should return 400 "Invalid link" (means route works)
```

### Redis errors?
```bash
# Check Redis connection
redis-cli ping
# Should return: PONG
```

---

## 📊 Success Indicators

✅ SMS length < 150 chars  
✅ No Twilio 30019 errors  
✅ Short links redirect correctly  
✅ Redis keys created with `shortlink:*` prefix  
✅ Logs show `[SHORTLINK]` messages  

---

## 🔄 Rollback (if needed)

```bash
# Quick fix - use original URLs
# Edit transition-privileged.js line 447:
const shortQr = qrUrl;  # Instead of: await shortLink(qrUrl)

# Or full rollback:
git revert HEAD
git push origin test
```

---

## 📞 Quick Reference

| What | Command |
|------|---------|
| Generate secret | `openssl rand -base64 32` |
| Test locally | `node test-sms-length.js` |
| Check Redis | `redis-cli KEYS "shortlink:*"` |
| View logs | `grep "SHORTLINK" logs.txt` |
| Test redirect | `curl -I https://host/r/test` |

---

## 🎯 Expected Results

**Before**:
```
Sherbrt 🍧: Ship "Item" by Oct 18, 2025. Scan this QR at drop-off: https://shippo-delivery-east.s3.amazonaws.com/qr_codes/1234567890/very-long-path...?Expires=1697500000&Signature=abcd... Open https://sherbrt.com/ship/tx-123
```
Length: 710 chars ❌

**After**:
```
Sherbrt 🍧: Ship "Item" by Oct 18, 2025. Scan QR: https://sherbrt.com/r/aB3xY9
```
Length: 105 chars ✅

---

**Deploy Time**: ~5 minutes  
**Testing Time**: ~2 minutes  
**Total Time to Production**: ~7 minutes

🚀 **Ready to deploy!**


# Apartment Field Fix - Quick Commands

## 🧪 Test Commands

```bash
# Run unit test (basic address building)
node test-apartment-field.js

# Run integration test (complete flow)
node test-apartment-integration.js

# Run both
node test-apartment-field.js && node test-apartment-integration.js
```

**Expected:** ✅ ALL TESTS PASSED

---

## 📦 Git Commands

```bash
# Check what changed
git status
git diff server/api/transition-privileged.js

# Stage all changes
git add -A

# Commit
git commit -m "feat(shipping): Explicitly preserve providerStreet2 for Shippo labels

- Add explicit providerStreet2 handling with providerApt fallback
- Add assert logs to catch value loss during processing
- Add comprehensive integration test suite (all tests pass)
- Add debug logging throughout data flow for troubleshooting
- Fixes missing apartment numbers on UPS shipping labels"

# Push to test branch
git push origin test
```

---

## 🔍 Search Server Logs

```bash
# Find apartment debug logs
grep "APARTMENT DEBUG" /path/to/logs

# Find apartment assert errors
grep "APARTMENT ASSERT" /path/to/logs

# Find Shippo payloads with street2
grep -A 20 "Outbound shipment payload" /path/to/logs | grep street2

# Find confirmation logs
grep "APARTMENT CONFIRMED" /path/to/logs
```

---

## 🐛 Debug Live Issue

### Step 1: Check Browser Console
```
F12 → Console → Filter: APARTMENT
```

Look for:
```
🔍 [APARTMENT DEBUG] Frontend streetAddress2: { value: "..." }
```

### Step 2: Check Server Logs
```bash
# On Render.com
# Go to: Dashboard → Your Service → Logs → Search: APARTMENT

# Or via CLI
render logs -f | grep APARTMENT
```

Look for:
```
✅ [APARTMENT CONFIRMED] street2 successfully made it to addressFrom: ...
```

### Step 3: Get Shippo Payload
```bash
# Search for the full payload
grep -A 50 "Outbound shipment payload" /path/to/logs
```

Look for:
```json
{
  "address_from": {
    "street2": "APT ZZ-TEST"
  }
}
```

---

## 📊 Quick Status Check

```bash
# Check if tests pass
node test-apartment-integration.js && echo "✅ READY TO DEPLOY" || echo "❌ TESTS FAILED"

# Check for linter errors
npm run lint server/api/transition-privileged.js

# Check git status
git status --short
```

---

## 🚀 Deploy Commands

### Deploy to Staging
```bash
git push origin test
# Wait for auto-deploy or trigger manually via Render dashboard
```

### Check Deployment Status
```bash
# On Render.com
# Go to: Dashboard → Your Service → Events

# Or check via browser
curl https://your-staging-url.onrender.com/health
```

### View Live Logs
```bash
# On Render.com
# Go to: Dashboard → Your Service → Logs

# Or via CLI (if set up)
render logs -f --service your-service-name
```

---

## 📖 Documentation Commands

```bash
# View quick reference
cat APARTMENT_QUICK_REF.md

# View implementation summary
cat APARTMENT_IMPLEMENTATION_SUMMARY.md

# View full details
cat APARTMENT_FIX_COMPLETE.md

# View commit message
cat APARTMENT_COMMIT_MESSAGE.md
```

---

## 🎯 One-Liner Commands

```bash
# Test everything
node test-apartment-field.js && node test-apartment-integration.js && echo "✅ ALL TESTS PASSED"

# Commit and push
git add -A && git commit -m "feat(shipping): Preserve providerStreet2 for Shippo labels" && git push origin test

# Check logs for street2
grep -i "street2\|apartment" /path/to/logs | tail -20

# Search all apartment debug logs
grep "🔍 \[APARTMENT" /path/to/logs
```

---

## 🔥 Emergency Commands

### If tests fail:
```bash
# Check what changed
git diff

# Revert specific file
git checkout HEAD -- server/api/transition-privileged.js

# Run tests again
node test-apartment-integration.js
```

### If deployment fails:
```bash
# Check logs
render logs -f | grep ERROR

# Rollback on Render.com
# Dashboard → Your Service → Manual Deploy → Select previous commit
```

### If linter errors:
```bash
# Auto-fix
npm run lint:fix server/api/transition-privileged.js

# Check again
npm run lint
```

---

## 📝 Notes

- All test commands should be run from project root
- Server log paths depend on your hosting setup
- Render.com commands require Render CLI to be installed
- Browser console commands require opening DevTools (F12)

---

## 🎉 Success Checklist

```bash
# 1. Tests pass
✅ node test-apartment-integration.js

# 2. No linter errors
✅ npm run lint

# 3. Changes committed
✅ git log -1

# 4. Pushed to test branch
✅ git branch -a | grep test

# 5. Deployed to staging
✅ Check Render dashboard

# 6. Live test completed
⏳ Run live booking with apartment field filled out

# 7. UPS label shows apartment
⏳ Download and verify label PDF
```

---

**Quick Start:** Run `node test-apartment-integration.js` then `git push origin test`


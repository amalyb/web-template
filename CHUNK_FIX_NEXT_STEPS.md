# Next Steps: Deploying the Chunk MIME Type Fix

## 📋 Summary of Changes

### Files Modified
1. **server/index.js** - Added explicit `/static` route handler with:
   - `fallthrough: false` to prevent 404s from reaching SSR
   - Explicit `Content-Type` headers for `.js`, `.css`, `.json`
   - Long-lived cache headers for static assets
   - No-cache headers for manifest files

2. **package.json** - Added `"smoke:chunks"` script

3. **scripts/smoke-chunk-integrity.js** - New automated test script

### Documentation Created
- `CHUNK_MIME_TYPE_FIX_SUMMARY.md` - Complete technical details
- `CHUNK_FIX_QUICK_TEST.md` - Quick testing guide
- `CHUNK_FIX_COMMIT_MESSAGE.md` - Suggested commit message
- `CHUNK_FIX_NEXT_STEPS.md` - This file

---

## 🚀 Deployment Steps

### 1. Local Testing (REQUIRED before deploying)

```bash
# Build the app
npm run build

# Start production server
node server/index.js
```

In another terminal:
```bash
# Run smoke test
npm run smoke:chunks
```

**Expected output:**
```
✅ ALL CHECKS PASSED
```

**If tests fail:** Review `CHUNK_FIX_QUICK_TEST.md` for troubleshooting.

---

### 2. Commit Changes

```bash
# Review changes
git status
git diff server/index.js

# Stage changes
git add server/index.js
git add package.json
git add scripts/smoke-chunk-integrity.js
git add CHUNK_MIME_TYPE_FIX_SUMMARY.md
git add CHUNK_FIX_QUICK_TEST.md
git add CHUNK_FIX_COMMIT_MESSAGE.md
git add CHUNK_FIX_NEXT_STEPS.md

# Commit (copy message from CHUNK_FIX_COMMIT_MESSAGE.md)
git commit -m "fix(server): prevent code-split chunks from being served as text/html"

# Or use the full message from CHUNK_FIX_COMMIT_MESSAGE.md
```

---

### 3. Deploy to Staging/Preview (if available)

```bash
# Push to staging branch
git push origin staging

# Wait for Render to deploy

# Test staging
BASE_URL=https://your-staging-url.onrender.com npm run smoke:chunks
```

---

### 4. Deploy to Production

```bash
# Push to main branch
git push origin main

# Wait for Render to deploy (usually 5-10 minutes)
```

---

### 5. Verify Production Deployment

```bash
# Test production (replace with your actual URL)
BASE_URL=https://sherbrt.com npm run smoke:chunks
```

**Or manually in browser:**
1. Open https://sherbrt.com/checkout
2. Open DevTools → Network tab → Filter: JS
3. Find `CheckoutPage.*.chunk.js`
4. Verify:
   - Status: 200
   - Type: `javascript`
   - Preview tab shows JavaScript (not HTML)

---

### 6. Monitor for Issues

**Check:**
- [ ] No "MIME type ('text/html') is not executable" errors in Sentry
- [ ] No CSP violations in logs
- [ ] Checkout flow works end-to-end
- [ ] All code-split routes load (authentication, listings, etc.)

**If issues occur:**
1. Check Render logs for errors
2. Run smoke test against production
3. Verify Content-Type headers with curl:
   ```bash
   curl -I https://sherbrt.com/static/js/CheckoutPage.624b464f.chunk.js
   ```

---

## 🎯 Success Criteria

- [x] Code changes applied
- [ ] Local smoke test passes
- [ ] Changes committed to git
- [ ] Deployed to staging (if applicable)
- [ ] Staging smoke test passes
- [ ] Deployed to production
- [ ] Production smoke test passes
- [ ] No MIME type errors in production logs
- [ ] Code-split routes work correctly

---

## 🔧 Optional: Add to CI/CD Pipeline

Consider adding the smoke test to your deployment pipeline:

**In `.github/workflows/deploy.yml` (if using GitHub Actions):**
```yaml
- name: Build
  run: npm run build

- name: Test chunk integrity
  run: npm run smoke:chunks
  env:
    BASE_URL: http://localhost:3000
```

**Or in Render build command:**
```bash
yarn install --frozen-lockfile && yarn build && yarn smoke:chunks
```

---

## 📞 Support

**If you encounter issues:**

1. **Check server logs:**
   ```bash
   # On Render dashboard: Shell tab
   tail -f /var/log/render.log
   ```

2. **Verify the fix is applied:**
   ```bash
   # In Render shell
   grep -A 10 "CRITICAL: Serve /static" server/index.js
   ```

3. **Test specific chunk:**
   ```bash
   curl -I https://sherbrt.com/static/js/CheckoutPage.624b464f.chunk.js
   ```

4. **Review documentation:**
   - `CHUNK_MIME_TYPE_FIX_SUMMARY.md` - Technical details
   - `CHUNK_FIX_QUICK_TEST.md` - Testing guide

---

## 🎉 Expected Results After Deployment

**Before:**
```
❌ Refused to execute script 'CheckoutPage.624b464f.chunk.js' 
   because its MIME type ('text/html') is not executable
```

**After:**
```
✅ CheckoutPage.624b464f.chunk.js loaded successfully
✅ Content-Type: application/javascript; charset=utf-8
✅ No console errors
✅ Checkout page renders correctly
```

---

**Current Status:** ✅ Code ready for deployment

**Next Action:** Run local tests, then deploy to production

Good luck! 🚀



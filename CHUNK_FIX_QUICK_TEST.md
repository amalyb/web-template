# Quick Test Guide: Chunk MIME Type Fix

## 🚀 Quick Start

### 1. Test Locally (After Building)
```bash
# Build the app
npm run build

# Start production server (in one terminal)
node server/index.js

# Run smoke test (in another terminal)
npm run smoke:chunks
```

**Expected Result:**
```
✅ ALL CHECKS PASSED
```

---

## 🧪 Manual Verification

### Test 1: Verify Chunk Serves Correctly
```bash
# Start server
node server/index.js

# In another terminal, fetch a chunk
curl -I http://localhost:3000/static/js/CheckoutPage.624b464f.chunk.js
```

**Expected Headers:**
```
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Cache-Control: public, max-age=31536000, immutable
```

**❌ FAIL if you see:**
```
Content-Type: text/html; charset=utf-8
```

---

### Test 2: Verify 404 Behavior (Critical!)
```bash
curl -I http://localhost:3000/static/js/FakeNonExistent.999.chunk.js
```

**Expected:**
```
HTTP/1.1 404 Not Found
Content-Type: text/html; charset=utf-8
Content-Length: [small number, NOT ~50KB]
```

**❌ FAIL if:**
- Status is 200 (should be 404)
- Content-Length is large (>10KB) indicating full index.html is being served

---

### Test 3: Browser DevTools Check

1. Open http://localhost:3000/checkout in browser
2. Open DevTools → Network tab → JS filter
3. Find `CheckoutPage.*.chunk.js`
4. Check:
   - ✅ Status: 200
   - ✅ Type: `javascript` or `script`
   - ✅ Size: Reasonable (should be >10KB for actual JS)
   
5. Click on the file → Preview tab
   - ✅ Should show minified JavaScript: `(function(){...`
   - ❌ Should NOT show HTML: `<!DOCTYPE html>`

---

## 🎯 Production Testing

### After Deploying to Render

```bash
# Replace with your actual production URL
BASE_URL=https://shop-on-sherbet.onrender.com npm run smoke:chunks
```

**Or manually:**
```bash
# Test a real chunk
curl -I https://shop-on-sherbet.onrender.com/static/js/CheckoutPage.624b464f.chunk.js

# Test 404 behavior
curl -I https://shop-on-sherbet.onrender.com/static/js/FakeNonExistent.999.chunk.js
```

---

## 🔍 Troubleshooting

### Problem: Smoke test fails with "Request timeout" or "ECONNREFUSED"

**Solution:** Make sure the server is running:
```bash
node server/index.js
```

---

### Problem: Chunks return HTML (Content-Type: text/html)

**Check:**
1. Did you restart the server after modifying `server/index.js`?
2. Is the `/static` route handler defined BEFORE the SSR catch-all?
3. Run `git diff server/index.js` to verify changes are applied

---

### Problem: 404 responses return full index.html

**This indicates the fix didn't work!**

**Verify:**
```javascript
// In server/index.js, the /static route should have:
app.use('/static', express.static(path.join(buildDir, 'static'), {
  fallthrough: false,  // ← This is CRITICAL!
  // ...
}));
```

If `fallthrough: false` is missing, 404s will pass through to the SSR handler.

---

### Problem: Browser shows "ERR_CONTENT_DECODING_FAILED" or similar

**Possible Causes:**
1. Gzip/compression middleware issue
2. Cached corrupted response

**Solution:**
1. Hard refresh in browser (Cmd+Shift+R / Ctrl+Shift+R)
2. Clear browser cache
3. Check server logs for errors

---

## ✅ Success Criteria

All of these must pass:

- [ ] `npm run smoke:chunks` exits with code 0 (success)
- [ ] Real chunks return `Content-Type: application/javascript`
- [ ] Real chunks return status 200
- [ ] Fake/missing chunks return status 404
- [ ] 404 responses are small (<5KB), not full index.html
- [ ] `/checkout` page loads without console errors
- [ ] No "MIME type ('text/html') is not executable" errors

---

## 📊 Quick Command Summary

```bash
# Build
npm run build

# Start server
node server/index.js

# Test chunks
npm run smoke:chunks

# Test production
BASE_URL=https://your-site.com npm run smoke:chunks

# Manual curl test
curl -I http://localhost:3000/static/js/CheckoutPage.624b464f.chunk.js
```

---

## 🚨 What Changed?

**Before:** Missing chunks → fell through to SSR → returned index.html as JavaScript → **MIME error**

**After:** Missing chunks → explicit 404 from `/static` handler → never reaches SSR → **proper error**

**File modified:** `server/index.js` (lines ~276-312)

---

**Need help?** Check `CHUNK_MIME_TYPE_FIX_SUMMARY.md` for full details.


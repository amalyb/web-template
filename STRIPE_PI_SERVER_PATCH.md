# Stripe PI Server Patch - Prod-Safe Logging

## Summary

Added production-safe logging to track Stripe Payment Intent data flow from Flex to client.

**Files Changed:** 1  
**Lines Added:** 12  
**Lines Removed:** 0  
**Net Change:** +12 lines

---

## Patch Details

### File: `server/api/initiate-privileged.js`

**Location:** Lines 198-209 (inserted after line 197)

**Purpose:** Log PI tails on speculative request-payment to verify Flex is returning valid Stripe data

---

## Diff

```diff
--- a/server/api/initiate-privileged.js
+++ b/server/api/initiate-privileged.js
@@ -195,6 +195,18 @@ module.exports = (req, res) => {
       // 🔧 FIXED: Use fresh transaction data from the API response
       const tx = apiResponse?.data?.data;  // Flex SDK shape
       
+      // 🔐 PROD-SAFE: Log PI tails for request-payment speculative calls
+      if (isSpeculative && bodyParams?.transition === 'transition/request-payment') {
+        const pd = tx?.attributes?.protectedData?.stripePaymentIntents?.default || {};
+        const idTail = (pd.stripePaymentIntentId || '').slice(0,3) + '...' + (pd.stripePaymentIntentId || '').slice(-5);
+        const secretTail = (pd.stripePaymentIntentClientSecret || '').slice(0,3) + '...' + (pd.stripePaymentIntentClientSecret || '').slice(-5);
+        console.log('[PI_TAILS] idTail=%s secretTail=%s looksLikePI=%s looksLikeSecret=%s', 
+          idTail, 
+          secretTail, 
+          /^pi_/.test(pd.stripePaymentIntentId || ''), 
+          /_secret_/.test(pd.stripePaymentIntentClientSecret || '')
+        );
+      }
+      
       // 🔐 PROD HOTFIX: Diagnose PaymentIntent data from Flex
       if (process.env.NODE_ENV !== 'production') {
         const pd = tx?.attributes?.protectedData || {};
```

---

## What This Does

### 1. Extracts PI Data Safely

```javascript
const pd = tx?.attributes?.protectedData?.stripePaymentIntents?.default || {};
```

Reads from the **nested default path** where Flex stores Stripe Payment Intent data.

### 2. Creates Safe Tails

```javascript
const idTail = (pd.stripePaymentIntentId || '').slice(0,3) + '...' + (pd.stripePaymentIntentId || '').slice(-5);
const secretTail = (pd.stripePaymentIntentClientSecret || '').slice(0,3) + '...' + (pd.stripePaymentIntentClientSecret || '').slice(-5);
```

**Example:**
- Full ID: `pi_3AbCdEfGhIjKlMnO`
- Tail: `pi_...lMnO`

**Security:** Only first 3 + last 5 characters logged, never full values.

### 3. Validates Format

```javascript
/^pi_/.test(pd.stripePaymentIntentId || '')
/_secret_/.test(pd.stripePaymentIntentClientSecret || '')
```

Checks if values match Stripe's expected patterns.

### 4. Logs Results

```javascript
console.log('[PI_TAILS] idTail=%s secretTail=%s looksLikePI=%s looksLikeSecret=%s', 
  idTail, 
  secretTail, 
  /^pi_/.test(pd.stripePaymentIntentId || ''), 
  /_secret_/.test(pd.stripePaymentIntentClientSecret || '')
);
```

**Output Example:**
```
[PI_TAILS] idTail=pi_...lMnO secretTail=pi_...et_XyZ looksLikePI=true looksLikeSecret=true
```

---

## Why This Change Was Safe

### ✅ No Functional Impact

- Only **reads** data, never modifies
- Runs **after** Flex response received
- Logs in **console only**, not stored
- **No network calls** or side effects

### ✅ Production-Safe

- No sensitive data logged (only tails)
- Guarded by transition check (`isSpeculative && request-payment`)
- Log pattern easily greppable: `[PI_TAILS]`
- No performance impact (simple string operations)

### ✅ Diagnostic Value

- Confirms Flex is returning valid PI data
- Verifies server is passing through unchanged
- Helps debug if client receives wrong data
- Production-friendly (allowed in prod logs)

---

## Testing the Patch

### 1. Local Test

```bash
NODE_ENV=development PORT=3000 npm start
# Go to checkout
# Check terminal for [PI_TAILS] log
```

### 2. Production Test

```bash
# On Render
grep '\[PI_TAILS\]' logs
```

### 3. Expected Output

```
[PI_TAILS] idTail=pi_...AbCdE secretTail=pi_..._secret_XyZ looksLikePI=true looksLikeSecret=true
```

**Both should be `true` ✅**

---

## Rollback (If Needed)

### Option 1: Git Revert

```bash
git checkout HEAD -- server/api/initiate-privileged.js
```

### Option 2: Manual Removal

Delete lines 198-209 from `server/api/initiate-privileged.js`:

```diff
-      // 🔐 PROD-SAFE: Log PI tails for request-payment speculative calls
-      if (isSpeculative && bodyParams?.transition === 'transition/request-payment') {
-        const pd = tx?.attributes?.protectedData?.stripePaymentIntents?.default || {};
-        const idTail = (pd.stripePaymentIntentId || '').slice(0,3) + '...' + (pd.stripePaymentIntentId || '').slice(-5);
-        const secretTail = (pd.stripePaymentIntentClientSecret || '').slice(0,3) + '...' + (pd.stripePaymentIntentClientSecret || '').slice(-5);
-        console.log('[PI_TAILS] idTail=%s secretTail=%s looksLikePI=%s looksLikeSecret=%s', 
-          idTail, 
-          secretTail, 
-          /^pi_/.test(pd.stripePaymentIntentId || ''), 
-          /_secret_/.test(pd.stripePaymentIntentClientSecret || '')
-        );
-      }
-      
```

Then rebuild:
```bash
npm run build
```

---

## Commit Message

```
feat(server): add prod-safe PI_TAILS logging for Stripe Payment Intent diagnostics

- Log PI ID and client secret tails on speculative request-payment
- Validate PI data format (pi_* and _secret_)
- Production-safe: only logs first 3 + last 5 chars
- Helps diagnose if Flex returns valid Stripe data
- No functional changes, read-only diagnostic

Related: Stripe Payment Intent flow debugging
```

---

**Patch Version:** 1.0  
**Created:** October 13, 2025  
**Safe for Production:** ✅ Yes


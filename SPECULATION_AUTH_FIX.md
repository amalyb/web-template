# Speculation Auth Guard Fix & Diagnostic Logging

## Problem

The privileged speculation was being blocked by a client-side auth token check that couldn't properly verify the token (because the SDK doesn't expose `authToken` and cookies are HTTP-only).

## Changes Made

### 1. ✅ Fixed Client Auth Guards (2 locations)

**File: `src/containers/CheckoutPage/CheckoutPage.duck.js`**

**Location 1: `speculateTransaction()` thunk (line ~611-613)**
```diff
- // Guard: Check for auth token (belt-and-suspenders)
- if (isPrivilegedTransition && !sdk?.authToken && typeof document !== 'undefined' && !document.cookie?.includes('st=')) {
-   const error = new Error('Cannot speculate privileged transaction - no auth token found');
-   error.status = 401;
-   console.warn('[Sherbrt] Attempted privileged speculation without auth token');
-   return Promise.reject(error);
- }
+ // Info: Client cannot verify auth token directly; let server enforce auth
+ if (isPrivilegedTransition && process.env.NODE_ENV !== 'production') {
+   console.log('[Sherbrt] (info) client cannot verify auth token; proceeding to /api where server enforces auth');
+ }
```

**Location 2: `initiatePrivilegedSpeculativeTransactionIfNeeded()` (line ~830-833)**
```diff
- // Guard: Check for auth token (belt-and-suspenders)
- if (!sdk?.authToken && typeof document !== 'undefined' && !document.cookie?.includes('st=')) {
-   console.warn('[Sherbrt] ⛔ Attempted privileged speculation without auth token');
-   return;
- }
+ // Info: Client cannot verify auth token directly; let server enforce auth
+ if (process.env.NODE_ENV !== 'production') {
+   console.log('[Sherbrt] (info) client cannot verify auth token; proceeding to /api where server enforces auth');
+ }
```

### 2. ✅ Added Diagnostic Logging (dev only)

**File: `src/util/api.js`**

**`initiatePrivileged()` function (line ~137-139)**
```javascript
export const initiatePrivileged = body => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[PROXY_VERIFY] POST →', `${apiBaseUrl()}/api/initiate-privileged`);
  }
  return post('/api/initiate-privileged', body);
};
```

**`transitionPrivileged()` function (line ~152-154)**
```javascript
export const transitionPrivileged = body => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[PROXY_VERIFY] POST →', `${apiBaseUrl()}/api/transition-privileged`);
  }
  return post('/api/transition-privileged', body);
};
```

**File: `server/api/initiate-privileged.js` (line ~39-41)**
```javascript
module.exports = (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[SERVER_PROXY] /api/initiate-privileged hit');
  }
  // ... rest of handler
};
```

**File: `server/api/transition-privileged.js` (line ~649-651)**
```javascript
module.exports = async (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[SERVER_PROXY] /api/transition-privileged hit');
  }
  // ... rest of handler
};
```

## What This Fixes

### Before (Broken)
1. User logs in, gets HTTP-only `st` cookie
2. Checkout page loads, triggers speculation
3. **Client guard checks `sdk?.authToken`** → undefined (SDK doesn't expose it)
4. **Client guard checks `document.cookie`** → can't see HTTP-only cookie
5. **Guard blocks request** → speculation never sent to server
6. No client secret → payment form can't mount

### After (Fixed)
1. User logs in, gets HTTP-only `st` cookie
2. Checkout page loads, triggers speculation
3. **Client checks `currentUser?.id`** → exists (from Redux)
4. **Client logs info message** (dev only) → proceeds to API call
5. **Client POSTs to `/api/initiate-privileged`** → same-origin request with cookies
6. **Server receives request** → SDK uses cookie automatically
7. **Server calls Flex API** → privileged transition succeeds
8. Server returns client secret → payment form mounts

## Expected Console Output (dev mode)

When speculation triggers, you should now see:

```javascript
[Checkout] triggering speculate…
[INITIATE_TX] about to dispatch
[speculate] dispatching { … }
[Sherbrt] (info) client cannot verify auth token; proceeding to /api where server enforces auth
[PROXY_VERIFY] POST → http://localhost:3500/api/initiate-privileged
[SERVER_PROXY] /api/initiate-privileged hit
🚀 initiate-privileged endpoint HIT!
[speculate] success { hasClientSecret: true, clientSecretLength: 75 }
[POST-SPECULATE] { clientSecretPresent: true ✅ }
```

## What Wasn't Changed

✅ **Server auth logic intact** - Server still validates session and enforces auth
✅ **User ID check intact** - Client still blocks if `currentUser?.id` missing
✅ **Production logs minimal** - All diagnostic logs are dev-only
✅ **Security unchanged** - Auth is still enforced at server boundary

## How to Test

### 1. Dev Mode Test
```bash
npm run dev
```

1. Log in as a user
2. Navigate to checkout page
3. Open browser console
4. Look for the sequence:
   - `[PROXY_VERIFY] POST →` (client sending)
   - `[SERVER_PROXY] /api/initiate-privileged hit` (server receiving)
   - `[speculate] success { hasClientSecret: true }` (client getting response)

### 2. Verify Speculation Works
- Should see PaymentIntent form render
- Should NOT see auth error messages
- Should be able to complete checkout

### 3. Verify Auth Still Enforced
- Log out
- Try to access checkout → should redirect or show error
- Server should still reject unauthorized requests

## To Remove Diagnostic Logs Later

Simply delete all blocks wrapped with:
```javascript
if (process.env.NODE_ENV !== 'production') {
  console.log('[PROXY_VERIFY]' ...);
}
```

Or search for `[PROXY_VERIFY]` and `[SERVER_PROXY]` and remove those lines.

## Files Changed

1. ✅ `src/util/api.js` - Added logging to proxy functions
2. ✅ `src/containers/CheckoutPage/CheckoutPage.duck.js` - Fixed 2 auth guards
3. ✅ `server/api/initiate-privileged.js` - Added server-side logging
4. ✅ `server/api/transition-privileged.js` - Added server-side logging

## Next Steps

1. **Run dev server**: `npm run dev`
2. **Test checkout flow**: Log in → add booking → go to checkout
3. **Verify logs**: Should see full proxy chain in console
4. **Verify payment form**: Should render with Stripe Elements
5. **Complete test transaction**: Should work end-to-end


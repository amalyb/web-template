# Quick Test Guide: Checkout 401 & TDZ Fixes

## Quick Verification Checklist

### ✅ 401 Error Fixes

**Test 1: Check Console Logging**
1. Open browser DevTools console
2. Navigate to checkout page
3. Look for these log patterns:
   - `[Checkout] 🚀 initiating once for` - Normal initialization
   - `[Sherbrt] 401 response from /api/...` - If 401 occurs, you'll see this
   - No generic fetch errors without context

**Test 2: Expired Session Scenario**
1. Log in to the app
2. Open browser DevTools > Application > Cookies
3. Delete the authentication cookie (usually named with `st-authtoken` or similar)
4. Try to checkout
5. **Expected:** Console shows `[Sherbrt] 401 response from` with clear endpoint name

**Test 3: Privileged Call Guards**
1. Open browser DevTools console
2. While not logged in, try to access checkout
3. **Expected:** Should see warning about authentication before API call

### ✅ TDZ Error Fix

**Test 1: Normal Navigation**
1. Navigate to a listing page
2. Click "Book Now" or "Request to Book"
3. Fill in booking dates
4. Navigate to checkout
5. **Expected:** 
   - No "Cannot access 'Xe' before initialization" error
   - Component renders normally
   - Speculative transaction initiates

**Test 2: Rapid Navigation**
1. Navigate to checkout
2. Immediately click browser back button
3. Navigate to checkout again
4. Repeat 2-3 times quickly
5. **Expected:** No initialization errors, component handles remounting gracefully

**Test 3: Production Build**
```bash
npm run build
# Test the built version
npm start
```
6. Navigate to checkout in production mode
7. **Expected:** No minified variable errors (like 'Xe')

---

## Console Messages to Look For

### ✅ Good Messages (Expected)
```
[Checkout] 🚀 initiating once for user123|listing456|2025-01-15|2025-01-20
[Checkout] submit disabled gates: { hasSpeculativeTx: false, ... }
[specTx] deduped key: listing123|2025-01-15|... (if duplicate prevented)
```

### ⚠️ Warning Messages (Auth Issues)
```
[Sherbrt] 401 response from /api/initiate-privileged - session may be expired
[Sherbrt] Attempted privileged transition without authentication
[Sherbrt] 401 Unauthorized in initiateOrder - user may need to log in again
```

### ❌ Errors You Should NOT See
```
Cannot access 'Xe' before initialization
ReferenceError: Cannot access '<variable>' before initialization
Uncaught TypeError: Cannot read property 'onInitiatePrivilegedSpeculativeTransaction' of undefined
```

---

## Server Logs to Check

### ✅ Good Messages
```
🚀 initiate-privileged endpoint HIT!
✅ Initiate success: {...}
[initiate] forwarding PD keys: [...]
```

### ⚠️ Auth Issues (Now Properly Logged)
```
ERROR get-trusted-sdk-no-token: User token is missing - user may not be logged in
ERROR token-exchange-unauthorized: User token expired or invalid
ERROR initiate-order-unauthorized: User authentication failed or session expired
```

---

## Quick Smoke Test Script

**Copy-paste this into browser console while on checkout page:**

```javascript
// Quick diagnostic check
console.group('🔍 Checkout Auth Diagnostic');

// Check if user is authenticated
const hasUser = !!window.__REDUX_STATE__?.user?.currentUser?.id;
console.log('✓ User authenticated:', hasUser);

// Check if checkout page state exists
const hasCheckoutState = !!window.__REDUX_STATE__?.CheckoutPage;
console.log('✓ Checkout state exists:', hasCheckoutState);

// Check for speculative transaction
const hasSpecTx = !!window.__REDUX_STATE__?.CheckoutPage?.speculativeTransactionId;
console.log('✓ Speculative transaction:', hasSpecTx);

// Check for errors
const hasInitError = !!window.__REDUX_STATE__?.CheckoutPage?.initiateOrderError;
const hasSpecError = !!window.__REDUX_STATE__?.CheckoutPage?.speculateTransactionError;
console.log('✓ Errors:', { initiate: hasInitError, speculate: hasSpecError });

console.groupEnd();

if (!hasUser) {
  console.warn('⚠️ User not authenticated - privileged calls will be blocked');
}
```

---

## What to Do If Issues Persist

### If 401 errors still occur:
1. Check server logs for `token-exchange-unauthorized` or `get-trusted-sdk-no-token`
2. Verify cookies are being sent with requests (Network tab > Headers > Cookie)
3. Check if `credentials: 'include'` is set in fetch calls
4. Verify `SHARETRIBE_SDK_CLIENT_SECRET` is set in server environment

### If TDZ errors still occur:
1. Check that `onInitiatePrivilegedSpeculativeTransaction` is in the props destructuring at the top
2. Verify there are no duplicate prop extractions
3. Check build output for circular dependencies: `npm run build -- --stats`
4. Clear build cache: `rm -rf node_modules/.cache build`

### General Debugging:
1. Check browser console for all error messages
2. Check Network tab for failed API requests
3. Look for `[Sherbrt]` tagged messages for our custom logs
4. Verify Redux DevTools shows correct state transitions

---

## Success Criteria

✅ **All Fixes Working When:**

1. Console shows clear `[Sherbrt] 401` messages if auth fails (instead of generic errors)
2. Privileged calls are blocked client-side if user not authenticated
3. No "Cannot access before initialization" errors on checkout load
4. Component initializes smoothly without race conditions
5. Server logs show proper auth error messages with context
6. Production build works without TDZ errors

---

## Quick Command Reference

```bash
# Start development server
npm start

# Build for production
npm run build

# Run linter
npm run lint

# Check for TypeScript errors (if applicable)
npm run type-check

# View server logs (if using PM2 or similar)
pm2 logs

# Clear all caches
rm -rf node_modules/.cache build
npm install
```

---

## Files Changed (For Reference)

If you need to review or revert changes:

1. `src/util/api.js` - Frontend API error handling
2. `server/api-util/sdk.js` - Server-side token validation
3. `src/containers/CheckoutPage/CheckoutPage.duck.js` - Redux action auth guards
4. `src/containers/CheckoutPage/CheckoutPageWithPayment.js` - Props extraction fix

---

## Need Help?

If issues persist after these fixes:
1. Capture console logs showing the error
2. Capture Network tab showing the failed request
3. Capture server logs around the time of the error
4. Note the exact user flow that triggers the issue
5. Check if the issue occurs in both dev and production builds


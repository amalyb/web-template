# Checkout Flow: 401 Errors and TDZ Fix Summary

## Overview
This document summarizes the fixes applied to resolve two critical issues in the Checkout flow:
1. **401 Unauthorized errors** from API calls (token/session handling)
2. **"ReferenceError: Cannot access 'Xe' before initialization"** (Temporal Dead Zone issue)

---

## Issue 1: 401 Unauthorized Errors

### Root Causes Identified
1. **Missing Token Validation**: The `getTrustedSdk` function in `server/api-util/sdk.js` was not checking if a user token existed before attempting token exchange
2. **No 401-Specific Error Handling**: Generic error handling didn't provide visibility into authentication failures
3. **No Authentication Guards**: Privileged transitions could be attempted even when user was not authenticated
4. **Silent Failures**: 401 errors were not logged with context about which endpoint failed

### Fixes Applied

#### 1. Enhanced Frontend API Error Handling (`src/util/api.js`)
```javascript
// Added 401-specific logging and error context
if (res.status === 401) {
  console.warn('[Sherbrt] 401 response from', path, '- session may be expired');
}

// Enhanced error object with status and endpoint tracking
e.status = res.status;
e.endpoint = path;
```

**Benefits:**
- Immediate visibility when auth failures occur
- Track which specific endpoint is failing
- Graceful error handling even for non-JSON responses

#### 2. Server-Side Token Validation (`server/api-util/sdk.js`)
```javascript
// Guard: Check if user token exists before token exchange
if (!userToken) {
  const error = new Error('User token is missing - user may not be logged in');
  error.status = 401;
  error.statusText = 'Unauthorized';
  error.data = { message: 'User authentication token is missing' };
  log.error(error, 'get-trusted-sdk-no-token');
  return Promise.reject(error);
}

// Enhanced error handling for token exchange failures
.catch(error => {
  if (error.status === 401) {
    log.error(error, 'token-exchange-unauthorized', {
      message: 'User token expired or invalid',
      hasUserToken: !!userToken,
    });
  }
  throw error;
});
```

**Benefits:**
- Fail fast when token is missing
- Clear error messages for debugging
- Proper logging for monitoring and troubleshooting
- Prevents wasted API calls with invalid tokens

#### 3. Authentication Guards in Redux Thunks (`src/containers/CheckoutPage/CheckoutPage.duck.js`)

**Added Pre-Flight Authentication Checks:**
```javascript
// In initiateOrder and speculateTransaction
const state = getState();
const currentUser = state.user?.currentUser;
if (isPrivilegedTransition && !currentUser?.id) {
  const error = new Error('Cannot initiate privileged transaction - user not authenticated');
  error.status = 401;
  console.warn('[Sherbrt] Attempted privileged transition without authentication');
  return Promise.reject(error);
}
```

**Benefits:**
- Prevent privileged API calls when user is not authenticated
- Immediate client-side validation
- Reduces unnecessary server requests
- Clear warning messages for debugging

**Enhanced Error Handlers:**
```javascript
// Added 401-specific handling in error callbacks
if (e.status === 401) {
  console.error('[Sherbrt] 401 Unauthorized in initiateOrder - user may need to log in again');
  log.error(e, 'initiate-order-unauthorized', {
    endpoint: e.endpoint || 'unknown',
    message: 'User authentication failed or session expired',
  });
}
```

Applied to:
- `initiateOrder` error handler
- `speculateTransaction` error handler  
- `initiatePrivilegedSpeculativeTransactionIfNeeded` catch block

**Benefits:**
- Consistent 401 error logging across all checkout operations
- Clear diagnostic messages with endpoint context
- Easier debugging and monitoring

---

## Issue 2: "Cannot access 'Xe' before initialization" (TDZ Error)

### Root Cause Identified
The error occurred due to improper prop extraction timing in `CheckoutPageWithPayment.js`. The callback `onInitiatePrivilegedSpeculativeTransaction` was being extracted from props **inside** the useEffect dependency scope, creating a potential Temporal Dead Zone (TDZ) issue during component initialization.

### Fix Applied

#### Proper Props Extraction (`src/containers/CheckoutPage/CheckoutPageWithPayment.js`)

**Before:**
```javascript
const {
  scrollingDisabled,
  speculateTransactionError,
  // ... other props
} = props;

// Later, inside useEffect scope:
const onInitiatePrivilegedSpeculativeTransaction = props.onInitiatePrivilegedSpeculativeTransaction;
```

**After:**
```javascript
// Extract all props at the top to avoid any TDZ issues
const {
  scrollingDisabled,
  speculateTransactionError,
  // ... other props
  onInitiatePrivilegedSpeculativeTransaction, // Extract callback here to avoid TDZ
} = props;

// Single initiation effect with ref-based guard
// Note: onInitiatePrivilegedSpeculativeTransaction is already extracted from props above
useEffect(() => {
  // ... use callback safely
}, [sessionKey, orderResult.ok, orderResult.params, orderResult.reason, onInitiatePrivilegedSpeculativeTransaction]);
```

**Benefits:**
- All props destructured at component function scope (top)
- Callback is available before any useEffect runs
- Eliminates TDZ risk during initialization
- Cleaner, more predictable code flow

---

## Testing Recommendations

### For 401 Errors:
1. **Test expired session scenario:**
   - Log in as a user
   - Wait for session to expire or manually clear auth cookies
   - Attempt to checkout
   - Verify: Should see clear 401 warning in console with endpoint name

2. **Test missing authentication:**
   - Try to access checkout page without logging in
   - Verify: Should see authentication guard warning before API call

3. **Monitor logs:**
   - Check browser console for `[Sherbrt] 401 response from` messages
   - Check server logs for `token-exchange-unauthorized` entries

### For TDZ Error:
1. **Test component initialization:**
   - Navigate to checkout page with valid booking data
   - Verify: No "Cannot access before initialization" errors
   - Verify: Component renders and speculative transaction initiates correctly

2. **Test with fast navigation:**
   - Rapidly navigate to/from checkout page
   - Verify: No race conditions or initialization errors

3. **Test in production build:**
   - Build production bundle: `npm run build`
   - Test the production build
   - Verify: Minified code doesn't have variable access errors

---

## Files Modified

### Frontend Files:
1. **`src/util/api.js`**
   - Added 401-specific logging
   - Enhanced error object with status and endpoint tracking
   - Improved JSON parsing error handling

2. **`src/containers/CheckoutPage/CheckoutPageWithPayment.js`**
   - Moved `onInitiatePrivilegedSpeculativeTransaction` extraction to top-level props destructuring
   - Added clarifying comments about TDZ prevention

3. **`src/containers/CheckoutPage/CheckoutPage.duck.js`**
   - Added authentication guards in `initiateOrder`
   - Added authentication guards in `speculateTransaction`
   - Enhanced 401 error handling in all error handlers
   - Added 401 logging in `initiatePrivilegedSpeculativeTransactionIfNeeded`

### Backend Files:
4. **`server/api-util/sdk.js`**
   - Added token existence check before `exchangeToken()`
   - Enhanced error handling for token exchange failures
   - Added comprehensive error logging with context

---

## Key Improvements

### Visibility & Debugging
- ✅ All 401 errors now logged with endpoint context
- ✅ Clear warning messages distinguish auth failures from other errors
- ✅ Server logs include token state information

### Reliability
- ✅ Fail fast when user is not authenticated
- ✅ Prevent unnecessary API calls with invalid tokens
- ✅ Eliminate TDZ risk in component initialization
- ✅ Consistent error handling across all checkout operations

### User Experience
- ✅ Clearer error messages for troubleshooting
- ✅ Faster feedback when session expires
- ✅ No more cryptic "Xe" initialization errors
- ✅ More predictable checkout flow behavior

---

## Next Steps (Optional Enhancements)

### Short Term:
1. Consider adding a retry mechanism for 401 errors with automatic re-authentication
2. Display user-friendly error message in UI when session expires
3. Add telemetry/monitoring for 401 error rates

### Long Term:
1. Implement proactive token refresh before expiration
2. Add session timeout warnings to users
3. Consider implementing refresh token flow for longer sessions
4. Add E2E tests specifically for auth failure scenarios

---

## Maintenance Notes

### When Adding New Privileged Transitions:
1. Always check `currentUser?.id` before calling privileged API
2. Include 401-specific error handling in catch blocks
3. Log with `[Sherbrt]` prefix for easy filtering

### When Adding New Props to Components:
1. Extract all props at the top of the function component
2. Avoid extracting props inside hooks or nested functions
3. Document any props used in useEffect dependencies

### When Debugging 401 Errors:
1. Check browser console for `[Sherbrt] 401 response from` messages
2. Check server logs for `token-exchange-unauthorized` or `get-trusted-sdk-no-token`
3. Verify user is logged in with valid session
4. Check that cookies are being sent with requests (`credentials: 'include'`)

---

## Summary

These fixes provide robust error handling for authentication failures and eliminate the TDZ initialization error. The checkout flow now has:

- **Better visibility** into authentication failures with contextual logging
- **Proactive validation** to prevent invalid API calls
- **Predictable initialization** without TDZ risks
- **Clearer debugging** with structured error messages and endpoint tracking

All changes are backward compatible and require no database migrations or configuration updates.


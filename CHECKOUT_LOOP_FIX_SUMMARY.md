# Complete Booking Page Loop Fix - Summary

## Problem Statement

The Complete Booking page was blocked by two render loops:

**A)** `user.duck` repeatedly calling:
```
GET currentUser.show?include=stripeCustomer.defaultPaymentMethod
```
(initiator: `user.duck.js:379`)

**B)** Checkout posting `initiate-privileged` more than once when (A) fired

## Solution Implemented

### 1. Idempotent Current User Load (`user.duck.js`)

**Added module-level guards:**
- `currentUserInFlight` promise to track in-flight requests
- `lastLoadedAt` timestamp for throttling
- `currentUserFetched` flag in Redux state

**New selectors:**
```javascript
export const selectUserState = state => state.user || {};
export const selectIsFetchingCurrentUser = state => !!selectUserState(state).currentUserShowInProgress;
export const selectHasFetchedCurrentUser = state => !!selectUserState(state).currentUserFetched;
```

**New idempotent thunk: `loadCurrentUserOnce()`**
- Exits early if already fetched
- Awaits in-flight requests instead of duplicating
- Throttles repeated loads within 60 seconds
- Includes dev-mode logging with `[Sherbrt]` prefix

**Reducer updates:**
- Added `currentUserShowInProgress` flag
- Added `currentUserFetched` sticky flag (set to `true` on success)

### 2. Component Updates

**`CheckoutPage.duck.js`:**
- Updated `stripeCustomer()` thunk to use `loadCurrentUserOnce()` instead of `fetchCurrentUser()`

**`CheckoutPage.js`:**
- Imported `selectHasFetchedCurrentUser` selector
- Added `hasFetchedStripeCustomer` guard in useEffect
- Only calls `fetchStripeCustomer()` if not already fetched

### 3. Checkout Initiation Guards (Already in Place)

The `CheckoutPageWithPayment.js` already had proper guards:
- Session key based on `userId|listingId|bookingStart|bookingEnd`
- `initiatedSessionRef` to track which session has been initiated
- Single initiation effect with ref-based guard

### 4. Dev Diagnostics

Added console.debug statements:
- `[Sherbrt] user.duck loadCurrentUserOnce: [status]` - tracks user load lifecycle
- `[Sherbrt] 🚀 Initiating privileged transaction once for [sessionKey]` - tracks initiation
- `[Sherbrt] ✅ initiate-privileged dispatched for session: [sessionKey]` - confirms dispatch

### 5. Smoke Test Script

Created `scripts/smoke-checkout.js` using Puppeteer to verify:
1. ✅ Exactly 1 POST `/api/initiate-privileged`
2. ✅ At most 1 XHR `show?include=stripeCustomer.defaultPaymentMethod`
3. ✅ Presence of Stripe iframe with `elements-inner-card`

**Usage:**
```bash
node scripts/smoke-checkout.js http://localhost:3000/l/listing-slug/listing-id
```

## Files Modified

1. **`src/ducks/user.duck.js`**
   - Added selectors for fetch state
   - Added `loadCurrentUserOnce()` idempotent thunk
   - Updated reducer to track fetch state
   - Added module-level in-flight guards

2. **`src/containers/CheckoutPage/CheckoutPage.duck.js`**
   - Updated import to use `loadCurrentUserOnce`
   - Modified `stripeCustomer()` to use idempotent thunk

3. **`src/containers/CheckoutPage/CheckoutPage.js`**
   - Added `useRef` and `useSelector` imports
   - Imported `selectHasFetchedCurrentUser` selector
   - Added guard to prevent duplicate `fetchStripeCustomer()` calls

4. **`scripts/smoke-checkout.js`** (NEW)
   - Automated smoke test for checkout flow
   - Validates network request counts
   - Checks for Stripe iframe presence

## Build Results

✅ Build completed successfully
- CheckoutPage bundle: **-433 B** (optimized)
- Main bundle: **+423 B** (new idempotent logic)
- No linting errors
- All post-build checks passed

## Next Steps

### Commit and Deploy

```bash
# Stage changes
git add src/ducks/user.duck.js
git add src/containers/CheckoutPage/CheckoutPage.duck.js
git add src/containers/CheckoutPage/CheckoutPage.js
git add scripts/smoke-checkout.js

# Commit with descriptive message
git commit -m "fix(user+checkout): dedupe currentUser show; ensure single initiate; unblock Complete Booking

- Add idempotent loadCurrentUserOnce() thunk with in-flight guards
- Update CheckoutPage to use guarded stripeCustomer fetch
- Add selectors for tracking fetch state
- Add dev diagnostics with [Sherbrt] prefix
- Create smoke test script for validation

Fixes loops that blocked Complete Booking page:
A) Repeated GET currentUser.show?include=stripeCustomer.defaultPaymentMethod
B) Multiple POST /api/initiate-privileged calls

The fix makes user thunk idempotent, ensures components dispatch once,
and maintains single initiation per session key."

# Push to remote
git push origin main
```

### Verification in Browser

After deployment, open DevTools Network tab and:

1. Navigate to a listing
2. Select dates and go to Complete Booking
3. Verify network activity:
   - ✅ Exactly **1** POST to `/api/initiate-privileged`
   - ✅ At most **1** GET to `currentUser.show?include=stripeCustomer.defaultPaymentMethod`
   - ✅ Stable Stripe iframe loads once

### Optional: Run Smoke Test Locally

```bash
# Start dev server
npm run dev

# In another terminal, run smoke test
node scripts/smoke-checkout.js http://localhost:3000/l/your-listing/123
```

## Technical Details

### How It Works

1. **First Load:**
   - Component mounts → calls `fetchStripeCustomer()`
   - Dispatches `loadCurrentUserOnce()`
   - Checks: not fetched, no in-flight request → makes API call
   - Sets `currentUserInFlight` promise
   - On success: sets `currentUserFetched = true`
   - Clears `currentUserInFlight`

2. **Subsequent Calls:**
   - Component tries to call `fetchStripeCustomer()` again
   - Guard in `CheckoutPage.js` sees `hasFetchedStripeCustomer = true` → skip
   - Even if it gets through, `loadCurrentUserOnce()` sees `currentUserFetched = true` → early exit

3. **Concurrent Calls:**
   - If two components try to load simultaneously
   - First creates `currentUserInFlight` promise
   - Second sees promise exists → awaits it instead of duplicating
   - Both get the same result, only one network request

### Benefits

- ✅ **Eliminates render loops** - no more infinite requests
- ✅ **Reduces network traffic** - single request per session
- ✅ **Improves performance** - faster page loads
- ✅ **Better UX** - stable Stripe iframe, no flickering
- ✅ **Debuggable** - dev logs track lifecycle
- ✅ **Testable** - smoke test validates behavior

## Troubleshooting

If loops still occur after deployment:

1. **Check Redux DevTools:**
   - Look for `CURRENT_USER_SHOW_REQUEST` actions
   - Should only fire once per session
   - Check `currentUserFetched` flag in state

2. **Check Network Tab:**
   - Filter by `currentUser.show`
   - Should see max 1 request with `stripeCustomer.defaultPaymentMethod`
   - Check initiator stack trace

3. **Enable Dev Logs:**
   - Ensure `NODE_ENV !== 'production'` locally
   - Look for `[Sherbrt]` prefixed logs in console
   - Track the flow: "fired" → "initiating request" → "success"

4. **Emergency Kill-Switch:**
   - Set `REACT_APP_INITIATE_ON_MOUNT_ENABLED=false` to disable auto-initiation
   - This will require manual user action to initiate checkout

## Related Files

- `src/containers/CheckoutPage/CheckoutPageWithPayment.js` - Session key guards (already in place)
- `src/util/api.js` - API call implementations
- `server/api-util/initiatePrivileged.js` - Server-side initiate endpoint
- `INITIATE_FIX_QUICK_REF.md` - Previous fix documentation


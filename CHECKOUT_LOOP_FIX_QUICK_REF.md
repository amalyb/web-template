# Complete Booking Loop Fix - Quick Reference

## Problem
Two loops blocking Complete Booking page:
- **Loop A:** Repeated `GET currentUser.show?include=stripeCustomer.defaultPaymentMethod`
- **Loop B:** Multiple `POST /api/initiate-privileged` calls

## Solution Summary

### 1. Idempotent User Load (`user.duck.js`)
```javascript
// New thunk - call this instead of fetchCurrentUser for Stripe customer data
export const loadCurrentUserOnce = () => async (dispatch, getState, sdk) => {
  // Guards prevent duplicate calls
  // Auto-includes stripeCustomer.defaultPaymentMethod
}

// New selectors
export const selectHasFetchedCurrentUser = state => !!state.user.currentUserFetched;
```

### 2. Component Guard (`CheckoutPage.js`)
```javascript
const hasFetchedStripeCustomer = useSelector(selectHasFetchedCurrentUser);

useEffect(() => {
  if (isUserAuthorized(currentUser) && !hasFetchedStripeCustomer) {
    fetchStripeCustomer();
  }
}, [hasFetchedStripeCustomer]);
```

### 3. Session Key (Already in place in `CheckoutPageWithPayment.js`)
```javascript
const sessionKey = useMemo(() => 
  listingId && bookingStart && bookingEnd
    ? `checkout:${userId}:${listingId}:${startISO}:${endISO}`
    : null
, [userId, listingId, startISO, endISO]);

// initiatedSessionRef tracks which session initiated
```

## Modified Files
1. `src/ducks/user.duck.js` - Idempotent thunk + selectors
2. `src/containers/CheckoutPage/CheckoutPage.duck.js` - Use loadCurrentUserOnce
3. `src/containers/CheckoutPage/CheckoutPage.js` - Add guard
4. `scripts/smoke-checkout.js` - New smoke test

## Verification

### Dev Logs (look for these)
```
[Sherbrt] user.duck loadCurrentUserOnce: initiating request
[Sherbrt] user.duck loadCurrentUserOnce: success
[Sherbrt] 🚀 Initiating privileged transaction once for checkout:...
[Sherbrt] ✅ initiate-privileged dispatched for session: ...
```

### Network Tab (should see)
- ✅ Exactly **1** POST `/api/initiate-privileged`
- ✅ At most **1** GET `currentUser.show?include=stripeCustomer.defaultPaymentMethod`
- ✅ Stable Stripe iframe

### Smoke Test
```bash
node scripts/smoke-checkout.js http://localhost:3000/l/listing-slug/id
```

## Commit
```bash
git add src/ducks/user.duck.js src/containers/CheckoutPage/CheckoutPage.duck.js src/containers/CheckoutPage/CheckoutPage.js scripts/smoke-checkout.js
git commit -m "fix(user+checkout): dedupe currentUser show; ensure single initiate; unblock Complete Booking"
git push origin main
```

## Emergency Kill-Switch
```bash
REACT_APP_INITIATE_ON_MOUNT_ENABLED=false
```


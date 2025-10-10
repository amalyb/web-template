# Quick Test Guide: TDZ + 401 Fix

## 🚀 Quick Start

### 1. Start Dev Server
```bash
npm start
```

### 2. Open Browser Console
Open Chrome DevTools (F12) → Console tab

### 3. Navigate to Checkout
Go to any listing and click "Book Now" or navigate directly to checkout

### 4. Watch Console Output

## ✅ Success Indicators

You should see this sequence (in order):

```
1. [Checkout] ⛔ Skipping initiate - user not authenticated yet
   { hasCurrentUser: true, hasUserId: false }

2. [Checkout] Auth ready? true
   OrderData: { listingId: "...", bookingDates: {...} }

3. [Sherbrt] ✅ Auth verified for speculative transaction
   { userId: "abc123...", listingId: "xyz456..." }

4. [Checkout] 🚀 initiating once for user|listing|start|end
```

## ❌ Failure Indicators

### TDZ Error (SHOULD NOT APPEAR)
```
❌ ReferenceError: Cannot access 'Xe' before initialization
   at CheckoutPageWithPayment.js:737
```

### 401 Error (SHOULD NOT APPEAR)
```
❌ 401 Unauthorized
❌ [Sherbrt] 401 Unauthorized in initiatePrivilegedSpeculativeTransaction
```

## 📋 Test Checklist

- [ ] No TDZ errors in console
- [ ] No 401 errors in console
- [ ] See "Auth ready? true" message
- [ ] See "✅ Auth verified" message
- [ ] Checkout page loads successfully
- [ ] Order breakdown appears
- [ ] Payment form renders

## 🔍 Detailed Verification

### Check Network Tab

1. Open Network tab in DevTools
2. Filter by "Fetch/XHR"
3. Look for these requests:

✅ **Should succeed (200 OK)**:
```
GET /api/current_user/show?include=stripeCustomer.defaultPaymentMethod
POST /api/transactions/initiate_speculative
```

❌ **Should NOT see (401)**:
```
401 Unauthorized on any request
```

### Check Component Render

1. Open React DevTools
2. Find `<CheckoutPageWithPayment>` component
3. Check props:
   - ✅ `currentUser` should be populated with `id` object
   - ✅ `onInitiatePrivilegedSpeculativeTransaction` should be a function
   - ✅ `pageData` should have `listing` and `orderData`

## 🧪 Edge Cases to Test

### Test 1: Fresh Session
```bash
# Clear browser data
1. Open DevTools → Application
2. Clear storage → Clear site data
3. Refresh page
4. Log in
5. Navigate to checkout
6. Verify: No 401 errors
```

### Test 2: Production Build
```bash
# Build and test production bundle
npm run build
npx serve -s build

# Open http://localhost:3000
# Test checkout flow
# Verify: No TDZ errors in minified code
```

### Test 3: Slow Network
```bash
# Simulate slow network
1. DevTools → Network → Throttling → Slow 3G
2. Navigate to checkout
3. Verify: Auth guard waits for user to load
4. Check: No 401 errors during slow load
```

## 📝 Quick Debug Commands

### Check if user is authenticated:
```javascript
// Run in browser console
console.log('User ID:', window.store?.getState()?.user?.currentUser?.id?.uuid)
```

### Check checkout state:
```javascript
// Run in browser console
console.log('Checkout State:', window.store?.getState()?.CheckoutPage)
```

### Force re-initiation (for testing):
```javascript
// Run in browser console
// This will bypass the session guard - use only for testing
document.querySelector('[data-testid="checkout-form"]')?.click()
```

## 🎯 Expected Timeline

| Step | Time | Action |
|------|------|--------|
| 1 | 0-100ms | Component mounts, extracts props |
| 2 | 0-200ms | useEffect runs, checks auth |
| 3 | 100-500ms | User loads (if not already cached) |
| 4 | 200-600ms | Auth verified, initiation proceeds |
| 5 | 500-1000ms | Speculative transaction returns |
| 6 | 1000ms+ | Order breakdown renders |

## ⚠️ Common Issues & Solutions

### Issue: Still seeing "user not authenticated"
**Solution**: 
1. Check if user is logged in: `localStorage.getItem('sharetribe-flex-sdk-token')`
2. If null, log in first
3. Refresh checkout page

### Issue: useEffect not re-running
**Solution**:
1. Check `currentUser` is in dependency array
2. Verify `currentUser` object is updating (not same reference)

### Issue: TDZ error still appearing
**Solution**:
1. Clear node_modules and reinstall: `rm -rf node_modules && npm install`
2. Clear build cache: `rm -rf build`
3. Restart dev server

## 🎉 Success Criteria

**Fix is working if ALL of these are true:**
- ✅ No TDZ errors in console
- ✅ No 401 errors in console
- ✅ Auth verification logs appear
- ✅ Checkout page loads successfully
- ✅ Order breakdown renders correctly
- ✅ Can complete booking without errors

---

**Quick Test Status**: 🟡 Pending Manual Verification

Run these tests and update status:
- [ ] Dev environment test
- [ ] Production build test
- [ ] Fresh session test
- [ ] Slow network test

**Last Updated**: 2025-10-10


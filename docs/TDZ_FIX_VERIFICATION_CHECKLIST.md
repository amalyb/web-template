# TDZ & 401 Fix Verification Checklist

## Quick Start

The dev build is currently running in the background. Access it at:
```
http://localhost:3000
```

## Pre-Verification Status

✅ **Code Changes Complete**
- 8 const arrow functions converted to function declarations
- Auth guards enhanced with dual checks (user + token)
- No linter errors

✅ **Circular Dependency Check Complete**
- No direct circular dependencies in CheckoutPage modules
- 231 circular deps found (mostly through components/index.js barrel exports - standard pattern)

## Verification Steps

### 1. Development Build Verification

**Start dev server** (if not already running):
```bash
npm run start
```

**Browser Console Checks**:
- [ ] Open browser at http://localhost:3000
- [ ] Navigate to a listing page
- [ ] Click "Book Now" or similar to go to checkout
- [ ] Open browser DevTools Console (F12)
- [ ] **Expected**: No TDZ errors
- [ ] **Expected**: Auth guard logs appear:
  ```
  [Checkout] ⛔ Skipping initiate - user not authenticated yet
  ```
  OR (if logged in):
  ```
  [Checkout] ✅ Auth verified, proceeding with initiate
  [Checkout] 🚀 initiating once for [sessionKey]
  ```

**Network Tab Checks**:
- [ ] Open browser DevTools Network tab
- [ ] Filter for "privileged" or "speculative"
- [ ] **Expected**: No 401 errors if logged in
- [ ] **Expected**: No privileged API calls if logged out

### 2. Production Build Verification

**Build for production**:
```bash
npm run build
```

**Serve production build**:
```bash
npx serve -s build -l 3001
```

**Browser Checks** (at http://localhost:3001):
- [ ] Navigate to checkout page
- [ ] **Expected**: No "Cannot access '...' before initialization" errors
- [ ] **Expected**: Page renders correctly
- [ ] **Expected**: No console errors related to undefined functions

### 3. Authentication Flow Verification

**Test A: Logged Out State**
- [ ] Clear all cookies and localStorage (DevTools > Application > Clear storage)
- [ ] Navigate to checkout page
- [ ] **Expected**: Page loads without 401 errors
- [ ] **Expected**: Console shows: `[Checkout] ⛔ Skipping initiate - user not authenticated yet`
- [ ] **Expected**: Network tab shows NO privileged API calls

**Test B: Login Flow**
- [ ] Log in to the application
- [ ] Navigate to checkout page
- [ ] **Expected**: Console shows: `[Checkout] ✅ Auth verified, proceeding with initiate`
- [ ] **Expected**: Network tab shows 200/201 for privileged speculation API call
- [ ] **Expected**: Price breakdown displays correctly

**Test C: Token Expiry Simulation**
- [ ] Log in and navigate to checkout (verify it works)
- [ ] Open DevTools > Application > Local Storage
- [ ] Delete the `authToken` key
- [ ] Reload the page
- [ ] **Expected**: Console shows: `[Checkout] ⛔ Skipping initiate - no auth token in storage`
- [ ] **Expected**: No 401 errors in Network tab

### 4. Real-World Checkout Flow

**Complete Booking Test**:
- [ ] Log in to the application
- [ ] Search for a listing
- [ ] Select booking dates
- [ ] Click "Request to book" or similar
- [ ] **Expected**: Checkout page loads without errors
- [ ] **Expected**: Price breakdown appears
- [ ] **Expected**: Stripe payment form loads
- [ ] **Expected**: Can enter payment details
- [ ] (Optional) Complete the booking
- [ ] **Expected**: Redirects to order details page

### 5. Error Scenario Verification

**Test Invalid Params**:
- [ ] Navigate to checkout without selecting dates
- [ ] **Expected**: Console shows: `[Checkout] ⛔ Skipping initiate - invalid params: missing-bookingDates`
- [ ] **Expected**: Page shows friendly error message (not crash)

**Test Missing Listing**:
- [ ] Navigate to checkout with invalid listing ID in URL
- [ ] **Expected**: Page shows "Listing not found" error
- [ ] **Expected**: No JavaScript crashes

## Common Issues & Solutions

### Issue: "Cannot access '...' before initialization" Still Appears

**Solution**:
1. Verify all const arrow functions were converted (check diff)
2. Clear browser cache and hard reload (Ctrl+Shift+R)
3. Restart dev server
4. Check for circular dependencies in new code

### Issue: 401 Errors in Network Tab

**Solution**:
1. Verify user is logged in (check localStorage for authToken)
2. Check console for auth guard logs
3. Verify currentUser is populated in Redux state (Redux DevTools)
4. Check if token is expired (decode JWT and check `exp` field)

### Issue: Price Breakdown Not Showing

**Solution**:
1. Check console for "[Checkout] ⛔ Skipping initiate..." messages
2. Verify booking dates are set (check sessionStorage)
3. Check Network tab for successful speculation API call
4. Verify speculativeTransaction in Redux state

### Issue: Dev Build Won't Start

**Solution**:
```bash
# Kill any existing node processes
pkill -f "react-scripts"

# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Restart dev server
npm run start
```

## Success Criteria

Your fix is successful if ALL of the following are true:

✅ **No TDZ Errors**
- Dev build console: Clean
- Production build console: Clean
- No "Cannot access" or "before initialization" errors

✅ **No 401 Errors When Logged In**
- Network tab shows 200/201 for privileged calls
- Console shows: `[Checkout] ✅ Auth verified`
- Price breakdown displays

✅ **Graceful Handling When Logged Out**
- No 401 errors in Network tab
- Console shows: `[Checkout] ⛔ Skipping initiate - user not authenticated yet`
- Page doesn't crash

✅ **Complete Booking Flow Works**
- Can navigate through entire checkout
- Can enter payment details
- Can complete transaction

## Debugging Commands

**Check if dev server is running**:
```bash
lsof -i :3000
```

**View full error stack in dev build**:
```bash
# In browser console
localStorage.setItem('DEBUG', '*')
# Then reload page
```

**Check Redux state**:
```javascript
// In browser console (if Redux DevTools not installed)
window.store.getState()
```

**Manual auth check**:
```javascript
// In browser console
console.log('Auth Token:', localStorage.getItem('authToken'));
console.log('Current User:', window.store?.getState()?.user?.currentUser);
```

## Reporting Issues

If verification fails, please report:

1. **Browser & Version**: (e.g., Chrome 118)
2. **Build Type**: Dev or Production
3. **Error Message**: Full text from console
4. **Network Tab**: Screenshot of 401 error (if any)
5. **Console Logs**: Copy all `[Checkout]` prefixed logs
6. **Redux State**: Screenshot or JSON of CheckoutPage state

## Next Steps After Verification

Once verification is complete:

1. [ ] Commit changes with descriptive message
2. [ ] Update CHANGELOG.md
3. [ ] Create PR with link to this verification checklist
4. [ ] Deploy to staging for QA testing
5. [ ] Monitor production error logs for TDZ/401 patterns

---

**Implementation Date**: October 10, 2025
**Status**: Ready for Verification
**Documentation**: See TDZ_AND_401_FIX_IMPLEMENTATION_REPORT.md


# OrderData Persistence - Test Checklist

## Quick Test Guide

### Prerequisites
- Dev server running: `npm run dev`
- Browser console open (F12)
- Test listing with available booking dates

### Test 1: Normal Booking Flow
**Expected:** OrderData persists through normal navigation

1. Navigate to a listing page
2. Select booking dates in the OrderPanel
3. Click "Request to Book"
4. **Check Console:** Look for `✅ Persisted orderData to sessionStorage: sherbrt.checkout.orderData.v1`
5. Verify checkout page loads with dates pre-filled
6. **Check Console:** Should NOT see hydration message (data came from location.state)

✅ **Pass Criteria:** Checkout page shows correct dates and price breakdown

---

### Test 2: Full Page Reload on Checkout
**Expected:** OrderData survives browser refresh

1. Complete Test 1 to reach checkout page
2. Press F5 (or Cmd+R) to refresh the page
3. **Check Console:** Look for `✅ Hydrated orderData from sessionStorage: sherbrt.checkout.orderData.v1`
4. Verify checkout page still shows:
   - Correct booking dates
   - Correct listing information
   - Correct price breakdown

✅ **Pass Criteria:** All data intact after refresh

---

### Test 3: Direct Checkout URL Access
**Expected:** OrderData loads from sessionStorage

1. Complete Test 1 to reach checkout page
2. Copy the checkout URL from address bar
3. Open a new tab
4. Paste and navigate to the checkout URL
5. **Check Console:** Look for `✅ Hydrated orderData from sessionStorage: sherbrt.checkout.orderData.v1`
6. Verify checkout page loads correctly

✅ **Pass Criteria:** Checkout page works with direct URL access

---

### Test 4: Browser Back/Forward Navigation
**Expected:** OrderData persists through navigation history

1. Complete Test 1 to reach checkout page
2. Click browser back button → Returns to listing page
3. Click browser forward button → Returns to checkout page
4. **Check Console:** Verify orderData is present
5. Verify checkout page data is intact

✅ **Pass Criteria:** Data persists through history navigation

---

### Test 5: SessionStorage Inspection
**Expected:** Data is properly serialized with SDK types

1. Complete Test 1 to reach checkout page
2. Open Browser DevTools → Application → Storage → Session Storage
3. Find key: `sherbrt.checkout.orderData.v1`
4. Click to view the value
5. Verify it contains:
   - `orderData` with `bookingDates`
   - `listing` with proper structure
   - Dates serialized with `_serializedType: 'SerializableDate'`
   - Money values properly preserved

✅ **Pass Criteria:** SessionStorage contains valid serialized data

---

### Test 6: Speculative Transaction Initiation
**Expected:** Transaction initiates when orderData is present

1. Complete Test 1 or Test 2 to reach checkout page with data
2. **Check Console:** Look for `[INITIATE_TX] calling privileged speculation`
3. Verify you see the order breakdown (line items, total price)
4. Check network tab for `/api/initiate-privileged` or similar API call

✅ **Pass Criteria:** Speculative transaction initiated successfully

---

### Test 7: Missing OrderData Graceful Handling
**Expected:** Checkout shows error when orderData is truly missing

1. Clear sessionStorage in DevTools (Application → Storage → Clear)
2. Navigate directly to checkout URL (without orderData)
3. **Check Console:** Should see `[Checkout] Missing booking dates in orderParams`
4. Verify checkout page shows appropriate error message

✅ **Pass Criteria:** Graceful error handling when data is missing

---

## Console Log Patterns

### Successful Persistence (ListingPage)
```
✅ Persisted orderData to sessionStorage: sherbrt.checkout.orderData.v1
```

### Successful Hydration (CheckoutPage)
```
✅ Hydrated orderData from sessionStorage: sherbrt.checkout.orderData.v1
🚨 orderData in CheckoutPage.js: { bookingDates: {...}, ... }
```

### Speculative Transaction Triggered
```
[Sherbrt] ✅ Auth verified for speculative transaction { userId: '...', listingId: '...' }
[INITIATE_TX] calling privileged speculation { sessionKey: '...', orderParams: {...} }
```

### Expected Warnings (These are OK)
```
[Checkout] ⛔ Skipping initiate - user not authenticated yet
[Checkout] ⛔ Skipping initiate - no auth token found
```
*These appear briefly before auth completes*

---

## Troubleshooting

### Problem: No persistence log on booking
**Solution:** Check that dates were selected and "Request to Book" was clicked

### Problem: No hydration on refresh
**Solution:** 
1. Verify persistence happened first
2. Check sessionStorage in DevTools
3. Verify key is `sherbrt.checkout.orderData.v1`

### Problem: Speculative transaction doesn't initiate
**Solution:**
1. Verify user is logged in
2. Check auth token exists (localStorage or cookies)
3. Verify orderData has valid booking dates
4. Check console for gate status: `[INIT_GATES]`

### Problem: Checkout shows "incomplete booking data" error
**Solution:**
1. Clear sessionStorage
2. Start fresh from listing page
3. Ensure dates are selected before booking

---

## Development Commands

```bash
# Start dev server
npm run dev

# Check for linter errors
npm run lint

# Build for production
npm run build

# View sessionStorage in console
sessionStorage.getItem('sherbrt.checkout.orderData.v1')

# Clear sessionStorage (reset test)
sessionStorage.clear()
```

---

## Success Indicators

✅ All 7 tests pass  
✅ No console errors  
✅ Checkout works after refresh  
✅ Speculative transaction initiates  
✅ Price breakdown displays correctly  

---

**Last Updated:** October 10, 2025



# Quick Test Guide - Transaction Initiation Fixes

## 🎯 What We Fixed

1. **Proper Gate Checking**: Waits for auth token + user + valid params + process before initiating
2. **Retry-Friendly Guard**: Allows retry after auth appears, even if sessionKey was used
3. **Fallback Safety**: Falls back to non-privileged speculation if privileged fails
4. **Clear Logging**: Loud, structured logs at every decision point

## 🧪 Quick Test Scenarios

### Test 1: Normal Authenticated User (Happy Path)

**Steps:**
1. Make sure you're logged in
2. Navigate to a listing page
3. Click "Book" with dates selected
4. Open browser console
5. Watch for logs

**Expected Logs:**
```
[INIT_GATES] { hasToken: true, hasUser: true, orderOk: true, hasTxId: false, hasProcess: true, sessionKey: "..." }
[INITIATE_TX] calling privileged speculation { sessionKey: "...", orderParams: {...} }
[Checkout] 🚀 initiating once for session_...
[INITIATE_TX] success { id: "..." }
[TX_STATE] { hasTxId: true, txId: "abc123...", speculativeInProgress: false }
```

**Expected UI:**
- Stripe form should appear immediately
- Order breakdown should show pricing
- Submit button should become enabled (after form validation)

---

### Test 2: Not Logged In → Login (Retry Test)

**Steps:**
1. **Log out** (or open incognito)
2. Navigate to listing → click "Book" → Go to checkout
3. Open console and watch for `[INIT_GATES]`
4. You should see `hasToken: false, hasUser: false`
5. **Now log in** (in same tab or different tab)
6. Watch console

**Expected Logs - Before Login:**
```
[INIT_GATES] { hasToken: false, hasUser: false, orderOk: true, hasTxId: false, hasProcess: true }
[Checkout] ⛔ Skipping initiate - user not authenticated yet
```

**Expected Logs - After Login:**
```
[INIT_GATES] { hasToken: true, hasUser: true, orderOk: true, hasTxId: false, hasProcess: true }
[INITIATE_TX] calling privileged speculation { ... }
[INITIATE_TX] success { id: "..." }
[TX_STATE] { hasTxId: true, txId: "...", ... }
```

**Expected UI:**
- After login, forms should mount
- Should NOT need to refresh page
- Submit button should become enabled

---

### Test 3: Slow Network (Process Loads Late)

**Steps:**
1. Open Chrome DevTools → Network tab
2. Throttle to "Slow 3G"
3. Navigate to listing → Book
4. Watch console for gate checks

**Expected:**
```
[INIT_GATES] { ..., hasProcess: false }
[Checkout] ⛔ Skipping initiate - txProcess not ready yet
```

Then after process definition loads:
```
[INIT_GATES] { ..., hasProcess: true, hasTxId: false }
[INITIATE_TX] calling privileged speculation
```

---

### Test 4: Fallback Path (Privileged Fails)

**Note:** This is harder to test without backend changes. You could:
- Mock the privileged endpoint to return 500
- Or test in staging if privileged endpoint is unstable

**Expected Logs:**
```
[specTx] error Error: 500...
[INITIATE_TX] privileged failed, falling back to public speculation
[INITIATE_TX] fallback succeeded, txId: "..."
```

**Expected UI:**
- Page should still mount
- Forms should appear
- User can proceed (though final payment might need different path)

---

## 🔍 Key Logs to Watch

### Always Check These:

1. **[INIT_GATES]** - Shows why initiation is/isn't happening
2. **[INITIATE_TX]** - Shows when actually calling API
3. **[TX_STATE]** - Shows if txId landed in Redux correctly

### Debug Decision Tree:

```
[INIT_GATES] all true, hasTxId: false
    ↓
[INITIATE_TX] calling privileged speculation
    ↓
Success? → [INITIATE_TX] success { id: "..." }
    ↓
[TX_STATE] { hasTxId: true, txId: "..." }
    ↓
Forms mount, submit button enables
```

**If stuck at any step:**

| Stuck at | Check |
|----------|-------|
| `hasToken: false` | Check localStorage/sessionStorage for `st-auth` |
| `hasUser: false` | Check if currentUser loaded in Redux |
| `orderOk: false` | Check console for "invalid params" reason |
| `hasProcess: false` | Check if transaction process definition loaded |
| `hasTxId: false` after call | Check `[TX_STATE]` - if txId still undefined, it's a Redux issue |

---

## 🚨 Common Issues & Fixes

### Issue: Logs show all gates pass but no `[INITIATE_TX] calling...`

**Possible Causes:**
- Guard ref (`initiatedSessionRef`) still blocking
- Check if `lastSessionKeyRef` matches current `sessionKey`

**Fix:**
- Refresh page (should reset refs)
- Or wait for sessionKey to change

---

### Issue: `[TX_STATE]` shows `hasTxId: false` but `[INITIATE_TX] success` logged

**Possible Causes:**
- Redux reducer not updating `speculativeTransactionId`
- Selector not reading correct state path

**Fix:**
- Check `CheckoutPage.duck.js` line 144 (should set `speculativeTransactionId`)
- Check `CheckoutPage.js` line 244 (should map to props)

---

### Issue: Forms never mount even though txId exists

**Possible Causes:**
- `txProcess` is null
- `showStripeForm` condition not met

**Check:**
```
const showStripeForm = hasSpeculativeTx && !!txProcess;
```
- Verify `txProcess` is not null in logs

---

## 🎬 Minimal Repro for Bugs

If you encounter issues, provide:

1. **Console logs** (especially `[INIT_GATES]`, `[INITIATE_TX]`, `[TX_STATE]`)
2. **User state** (logged in? guest?)
3. **Network tab** (did API call happen? response?)
4. **Redux DevTools** (if available - check `CheckoutPage.speculativeTransactionId`)

---

## ✅ Success Criteria

You should see:

1. **Gate checks pass** when conditions met
2. **Initiation happens** once all gates pass
3. **Success logged** with txId
4. **Forms mount** after txId exists
5. **No re-initiation** after success (guard works)
6. **Retry works** after auth appears (guard doesn't block)

---

**Created:** October 10, 2025
**Related:** `INITIATE_TX_FIXES_COMPLETE.md`




# Transaction Initiation - Quick Reference Card

## 🎯 5-Second Summary
✅ All 5 gates must pass → Initiation happens → Forms mount → User can checkout

---

## 🚪 The 5 Gates

```
1. hasToken        ← Auth token in localStorage/cookie
2. currentUser?.id ← User object loaded
3. orderResult.ok  ← Order params valid
4. !hasTxId        ← Not already initiated
5. txProcess       ← Process definition loaded
```

**All must be true to initiate!**

---

## 📝 Key Log Messages

### ✅ Success Pattern:
```
[INIT_GATES] { hasToken: true, hasUser: true, orderOk: true, hasTxId: false, hasProcess: true }
[INITIATE_TX] calling privileged speculation
[INITIATE_TX] success { id: "..." }
[TX_STATE] { hasTxId: true, txId: "..." }
```

### ⏳ Waiting Pattern:
```
[INIT_GATES] { hasToken: false, ... }
[Checkout] ⛔ Skipping initiate - no auth token found
```

### 🔄 Retry Pattern:
```
[INIT_GATES] { hasToken: false } → User logs in → hasToken: true
[INITIATE_TX] calling privileged speculation
[INITIATE_TX] success
```

### 🛡️ Fallback Pattern:
```
[specTx] error
[INITIATE_TX] privileged failed, falling back to public speculation
[INITIATE_TX] fallback succeeded, txId: "..."
```

---

## 🔍 Quick Debug

| Problem | Check | Fix |
|---------|-------|-----|
| No [INITIATE_TX] log | [INIT_GATES] which gate fails? | Wait for that gate to pass |
| [INITIATE_TX] but no txId | [TX_STATE] shows txId? | Redux/selector issue |
| Forms not mounting | showStripeForm value? | Need hasTxId && txProcess |
| Effect not re-running | Console shows deps change? | Check useEffect deps array |

---

## 🎬 Test in 30 Seconds

```bash
# 1. Open checkout page (logged in)
# 2. Open console
# 3. Should see:

[INIT_GATES] { hasToken: true, hasUser: true, orderOk: true, hasTxId: false, hasProcess: true }
[INITIATE_TX] calling privileged speculation
[INITIATE_TX] success { id: "abc123..." }
[TX_STATE] { hasTxId: true, txId: "abc123..." }

# 4. Forms should appear
# 5. Submit button should become enabled (after validation)
```

---

## 🔧 Modified Files

1. `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
   - Lines 816-924: New initiation effect with all gates
   - Lines 926-937: Enhanced logging

2. `src/containers/CheckoutPage/CheckoutPage.duck.js`
   - Lines 749-806: Added fallback to non-privileged

---

## 🚨 Emergency Rollback

If issues arise, revert these 2 files:
```bash
git checkout HEAD -- src/containers/CheckoutPage/CheckoutPageWithPayment.js
git checkout HEAD -- src/containers/CheckoutPage/CheckoutPage.duck.js
```

---

## 📚 Full Documentation

- **Implementation Details:** `INITIATE_TX_FIXES_COMPLETE.md`
- **Test Scenarios:** `INITIATE_TX_QUICK_TEST.md`
- **Flow Diagrams:** `INITIATE_TX_FLOW_DIAGRAM.md`
- **Executive Summary:** `TRANSACTION_INITIATION_UPGRADE_SUMMARY.md`

---

**Last Updated:** October 10, 2025  
**Status:** ✅ Ready for Testing




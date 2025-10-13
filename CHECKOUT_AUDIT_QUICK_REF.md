# Checkout Branch Audit — Quick Reference

## 🚨 Critical Findings Summary

### Branch: `main` vs `test` (35 files changed)

---

## ⚠️ TOP RISK: ProtectedData Schema Breaking Change

**Commit:** `7a00f187f` (Sep 11, 2025)  
**Impact:** HIGH — Blocks checkout if `customerStreet` or `customerZip` missing

### What Changed:
```javascript
// NEW: Hard validation gate in CheckoutPageWithPayment.js
if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
  throw new Error('Please fill in the required address fields...');
}

// NEW: Server blocks accept in transition-privileged.js
if (!hasCustomerShipAddress(finalProtectedData)) {
  return res.status(400).json({ error: 'Missing shipping address' });
}
```

### Why Risky:
1. **Breaks existing flows** — Old transactions without these fields will fail
2. **Double validation** — Blocks both checkout (client) and accept (server)
3. **No migration path** — Doesn't backfill missing data from old txs

---

## 🔍 Other High-Risk Changes

### 1. ProtectedData Merge Strategy (3 commits changed this)
- **Commits:** `3a7037974`, `b753c24c7`, `868fbff8d`
- **Risk:** Race conditions in PD merge; blank values may overwrite valid data
- **Files:** `server/api/initiate-privileged.js`, `server/api/transition-privileged.js`

### 2. Redux State Prop Rename
- **File:** `src/containers/CheckoutPage/CheckoutPage.js`
- **Change:** `speculatedTransaction` → `speculativeTransaction`
- **Risk:** Components using old prop name will break

### 3. Speculation Loop Guard
- **File:** `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
- **Change:** Added `prevKeyRef` to prevent duplicate speculate calls
- **Risk:** ListingId normalization may cause key mismatches → infinite loops

---

## 📋 Top 5 Risky Commits (by keyword density)

| Rank | SHA | Hits | Date | Subject |
|------|-----|------|------|---------|
| 1 | `7a00f187f` | 39 | Sep 11 | enforce shippable borrower address end-to-end |
| 2 | `3a7037974` | 37 | Sep 10 | validate merged protectedData; persist borrower shipping |
| 3 | `b753c24c7` | 33 | Sep 10 | prevent blank customer fields from overwriting PD |
| 4 | `868fbff8d` | 29 | Sep 10 | persist customer shipping fields at request-payment |
| 5 | `d9977cf56` | 24 | Sep 11 | restore accept notifications with phone fallbacks |

---

## 🛠️ Quick Fix Options

### Option A: Soften Validation (Safest)
```diff
# CheckoutPageWithPayment.js (line ~500)
- if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
-   throw new Error(...);
- }
+ if (!mergedPD.customerStreet?.trim() || !mergedPD.customerZip?.trim()) {
+   console.warn('[checkout] Missing shipping fields - proceeding anyway');
+ }

# server/api/transition-privileged.js (line ~1168)
- if (!hasCustomerShipAddress(finalProtectedData)) {
-   return res.status(400).json({ error: ... });
- }
+ if (!hasCustomerShipAddress(finalProtectedData)) {
+   console.warn('[accept] Missing address - proceeding without Shippo label');
+   // Skip label creation but allow transition
+ }
```

### Option B: Revert Risky Commits
```bash
git revert 7a00f187f  # Remove address enforcement
git revert 868fbff8d  # Revert PD persistence changes
git revert 3a7037974  # Revert PD merge logic
```

### Option C: Add Migration (Most Work)
1. Add server endpoint to backfill `customerStreet/customerZip` from billing data
2. Run migration on all in-flight transactions
3. Then apply validation

---

## ✅ Pre-Merge Testing Checklist

**Must Test Before Merging `test` → `main`:**

- [ ] Checkout with full address → success
- [ ] Checkout with minimal fields → success (backward compat)
- [ ] Old transaction (pre-customerStreet) → can still accept
- [ ] Speculative transaction doesn't loop (check network tab)
- [ ] ProtectedData visible in: duck logs → initiate logs → accept logs
- [ ] Shippo label creates with new address structure
- [ ] Redux shows `speculativeTransaction` not `speculatedTransaction`
- [ ] No prod console errors

---

## 📁 Files Requiring Deep Review

| Priority | File | Why |
|----------|------|-----|
| 🔴 | `server/api/initiate-privileged.js` | PD forwarding logic changed |
| 🔴 | `server/api/transition-privileged.js` | Accept validation blocks txs |
| 🔴 | `CheckoutPageWithPayment.js` | Client validation gate added |
| 🔴 | `StripePaymentForm.js` | PD mapping from nested form |
| 🟡 | `CheckoutPage.duck.js` | ListingId normalization |
| 🟡 | `CheckoutPage.js` | Prop rename (breaking) |

---

## 🎯 Recommended Action Plan

1. **Stage `test` branch** in isolated environment
2. **Run E2E tests** with real Stripe (test mode)
3. **Test edge cases:**
   - Missing address fields
   - Old transactions without customerStreet
   - Rapid form changes (speculation loop)
4. **If issues found:** Apply "Quick Fix Option A" above
5. **Only then:** Merge to `main`

---

## 📞 Escalation

**Code Owner:** Amalia Bornstein  
**Review Required From:** 
- Backend team (server API changes)
- Frontend team (Redux state changes)
- QA team (E2E checkout validation)

---

**Quick Ref Generated:** October 13, 2025  
**Full Report:** See `CHECKOUT_BRANCH_AUDIT_REPORT.md`


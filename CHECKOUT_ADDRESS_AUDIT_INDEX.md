# Checkout Address Fields Audit - Document Index

**Quick Links**:
- 🎯 [Executive Summary](#executive-summary) ← Start here
- 🔧 [Action Checklist](#action-checklist) ← Implementation guide
- 📊 [Flow Comparison](#flow-comparison) ← Visual timeline
- 📁 [Technical Analysis](#technical-analysis) ← Deep dive

---

## Executive Summary

**File**: `CHECKOUT_ADDRESS_AUDIT_SUMMARY.md`  
**Length**: ~300 lines  
**Read Time**: 5 minutes

### What's Inside
- One-liner root cause
- Impact assessment
- Risk analysis
- Expected outcomes
- Quick-reference tables

### When to Read
- **First**: Get high-level overview
- **For stakeholders**: Non-technical summary
- **For QA**: Verification strategy

---

## Action Checklist

**File**: `CHECKOUT_ADDRESS_FIX_CHECKLIST.md`  
**Length**: ~420 lines  
**Read Time**: 10 minutes

### What's Inside
- 4 concrete edits with exact line numbers
- Before/after code blocks
- Verification steps
- Expected console logs
- Troubleshooting guide

### When to Read
- **For implementation**: Step-by-step guide
- **For testing**: Expected behavior
- **For debugging**: Console log patterns

### Quick Action Summary

| Edit | File | Lines | Time | Priority |
|------|------|-------|------|----------|
| **A** | CheckoutPageWithPayment.js | ~1350 | 5 min | 🔴 Critical |
| **B** | CheckoutPageWithPayment.js | ~1020 | 2 min | 🔴 Critical |
| **C** | CheckoutPageWithPayment.js | ~560 | 3 min | 🟡 High |
| **D** | CheckoutPageWithPayment.js | ~900 | 10 min | 🔴 Critical |

**Total**: 20 minutes editing + 10 minutes testing = **30 minutes**

---

## Flow Comparison

**File**: `CHECKOUT_ADDRESS_FLOW_COMPARISON.md`  
**Length**: ~350 lines  
**Read Time**: 8 minutes

### What's Inside
- Timeline diagrams (T0→T5)
- Side-by-side flow comparison
- Code path analysis
- Dependency array deep-dive
- Gate logic breakdown

### When to Read
- **To understand timing issue**: See exact sequence difference
- **For code review**: Visual reference
- **For training**: Teach others about the bug

### Key Visual: Timeline Comparison

```
origin/test:  PageLoad → FormRender → UserTypes → Speculate → Success ✅
origin/main:  PageLoad → Speculate → FormRender → UserTypes → Blocked ❌
              └─────────┘          └─────────────────────────┘
              Too early!                Too late!
```

---

## Technical Analysis

**File**: `CHECKOUT_ADDRESS_WIRING_AUDIT.md`  
**Length**: ~462 lines  
**Read Time**: 20 minutes

### What's Inside
- File-by-file unified diffs
- High-signal hunks with ±6 lines context
- Impact notes for each change
- Root cause deep-dive
- Server vs client analysis

### When to Read
- **For code review**: See exact diffs
- **For architecture**: Understand data flow
- **For documentation**: Reference implementation

### Files Analyzed

1. ✅ `CheckoutPageWithPayment.js` (main container)
2. ✅ `CheckoutPage.duck.js` (Redux actions/reducers)
3. ✅ `StripePaymentForm.js` (form component)
4. ✅ `EstimatedCustomerBreakdownMaybe.js` (breakdown component)
5. ✅ `ListingPage.shared.js` (order handoff)
6. ✅ `server/api/initiate-privileged.js` (server proxy)
7. ✅ `server/api/transaction-line-items.js` (server endpoint)

---

## Reading Guide by Role

### 👨‍💻 Developer Implementing the Fix

**Order**:
1. Read **CHECKOUT_ADDRESS_AUDIT_SUMMARY.md** (5 min) → Understand the problem
2. Read **CHECKOUT_ADDRESS_FIX_CHECKLIST.md** (10 min) → Get exact edits
3. Apply Edit A, B, C, D (20 min)
4. Test using verification steps (10 min)
5. Reference **CHECKOUT_ADDRESS_WIRING_AUDIT.md** if questions arise

**Total Time**: ~45 minutes

---

### 👨‍🔬 QA Testing the Fix

**Order**:
1. Read **CHECKOUT_ADDRESS_AUDIT_SUMMARY.md** → Expected Outcomes section
2. Read **CHECKOUT_ADDRESS_FIX_CHECKLIST.md** → Verification Checklist section
3. Run test scenarios
4. Compare console logs to expected patterns
5. Verify transaction entities have all 7 fields

**Test Checklist**:
- [ ] Clear storage before test
- [ ] Navigate to checkout (observe console)
- [ ] Verify form renders immediately (no spinner)
- [ ] Fill address fields (observe console)
- [ ] Verify 2 speculation calls (empty → filled)
- [ ] Submit and verify success
- [ ] Check transaction.protectedData has all fields

---

### 📊 Product Manager / Stakeholder

**Order**:
1. Read **CHECKOUT_ADDRESS_AUDIT_SUMMARY.md** (5 min) → Full context
2. Review "Impact" and "Expected Outcomes" sections
3. Decide on deployment timeline

**Key Metrics**:
- **Current**: 0% of transactions have customer address
- **After Fix**: 100% of transactions have customer address
- **Risk**: Low (reverting to proven test logic)
- **Time to Fix**: 45 minutes implementation + testing

---

### 🏗️ Architect / Tech Lead

**Order**:
1. Read **CHECKOUT_ADDRESS_FLOW_COMPARISON.md** (8 min) → Visual understanding
2. Read **CHECKOUT_ADDRESS_WIRING_AUDIT.md** (20 min) → Deep technical dive
3. Review **CHECKOUT_ADDRESS_FIX_CHECKLIST.md** → Validate approach
4. Sign off on implementation

**Architecture Review Points**:
- Is speculation timing correct? (should fire after form data available)
- Are dependencies properly declared? (useEffect deps)
- Is the guard logic robust? (prevents loops but allows updates)
- Is validation appropriate? (hard vs soft)

---

## Quick Search

Need to find something specific? Use these search terms:

### By Topic

| Topic | Search Term | Document |
|-------|-------------|----------|
| **Root cause** | "speculation fires before" | AUDIT_SUMMARY |
| **Form mounting** | "showStripeForm" | FIX_CHECKLIST |
| **Dependencies** | "formValues" | FLOW_COMPARISON |
| **Validation** | "hard throw" | FIX_CHECKLIST |
| **Console logs** | "[PRE-SPECULATE]" | FIX_CHECKLIST |
| **Server merge** | "protectedData merge" | WIRING_AUDIT |
| **One-shot guard** | "initiatedSessionRef" | FLOW_COMPARISON |

### By Code Location

| File | Line Range | Document |
|------|-----------|----------|
| CheckoutPageWithPayment.js | 1350-1365 | FIX_CHECKLIST (Edit A) |
| CheckoutPageWithPayment.js | 1020 | FIX_CHECKLIST (Edit B) |
| CheckoutPageWithPayment.js | 560-570 | FIX_CHECKLIST (Edit C) |
| CheckoutPageWithPayment.js | 900-920 | FIX_CHECKLIST (Edit D) |
| initiate-privileged.js | 189-210 | WIRING_AUDIT |
| transaction-line-items.js | 40-55 | WIRING_AUDIT |

---

## Document Relationships

```
AUDIT_SUMMARY (Executive Overview)
    ├─→ FLOW_COMPARISON (Visual Explanation)
    │   └─→ "Why does test work but main break?"
    │
    ├─→ FIX_CHECKLIST (Action Plan)
    │   └─→ "How do I fix it?"
    │
    └─→ WIRING_AUDIT (Deep Dive)
        └─→ "What exactly changed in the code?"
```

**Suggested Reading Order**:
1. AUDIT_SUMMARY (overview)
2. FLOW_COMPARISON (understand timing)
3. FIX_CHECKLIST (implement fixes)
4. WIRING_AUDIT (reference if needed)

---

## Key Files Modified

All fixes target a single file:

```
src/containers/CheckoutPage/CheckoutPageWithPayment.js
```

### Specific Changes

| Edit | Target | Change Type | Lines |
|------|--------|------------|-------|
| A | JSX render logic | Remove gate | ~15 |
| B | useEffect deps | Add dependency | 1 |
| C | Validation logic | Throw error | ~8 |
| D | Guard logic | Update condition | ~10 |

**Total**: ~34 lines in 1 file

**No server changes required** — server-side merge is already correct on main.

---

## Validation

After applying fixes, verify these console patterns:

### ✅ Expected (After Fix)

```bash
[INIT_GATES] hasUser:true orderOk:true hasTxId:false hasProcess:true
[Checkout] 🚀 initiating once for session:user-123_listing-456_2025-01-15_2025-01-20
[PRE-SPECULATE] protectedData keys: []
[SPECULATE_SUCCESS] txId: tx_abc123

# User fills form...

[Checkout] Form values changed: { customerStreet: '123 Main', customerZip: '12345' }
[PRE-SPECULATE] protectedData keys: ['customerName','customerStreet','customerCity','customerState','customerZip','customerEmail','customerPhone']
[SPECULATE_SUCCESS] txId: tx_abc123

[checkout→request-payment] protectedData keys: ['customerName','customerStreet',...]
[checkout→request-payment] customerStreet: 123 Main St
[checkout→request-payment] customerZip: 12345
```

### ❌ Current (Before Fix)

```bash
[INIT_GATES] hasUser:true orderOk:true hasTxId:false hasProcess:true
[Checkout] 🚀 initiating once for session:user-123_listing-456_2025-01-15_2025-01-20
[PRE-SPECULATE] protectedData keys: ['customerPhone']  ← Only phone from profile!
[SPECULATE_SUCCESS] txId: tx_abc123

# User fills form... (no re-speculation)

[checkout→request-payment] protectedData keys: ['customerName','customerStreet',...]  ← Too late!
[checkout→request-payment] customerStreet: 123 Main St
[checkout→request-payment] customerZip: 12345
```

**Key Difference**: After fix, you should see **TWO** `[PRE-SPECULATE]` logs (empty → filled), not just one.

---

## Support & Questions

### Common Questions

**Q: Why not just copy origin/test?**  
A: Test has other experimental changes. These 4 edits are the minimal diff to fix the address issue.

**Q: Will this cause extra API calls?**  
A: Yes, +1 call per checkout (2 instead of 1). Acceptable for data integrity.

**Q: What if speculation loops?**  
A: Guard includes form state hash → max 2 calls (empty + filled).

**Q: Can I rollback easily?**  
A: Yes, single file revert in 5 minutes.

**Q: Do I need to test on staging first?**  
A: Recommended but not required (low risk, proven test logic).

---

## Checklist Summary

### Pre-Implementation
- [ ] Read AUDIT_SUMMARY.md (5 min)
- [ ] Read FIX_CHECKLIST.md (10 min)
- [ ] Understand Edit A, B, C, D
- [ ] Review expected console logs

### Implementation
- [ ] Apply Edit A (remove showStripeForm gate)
- [ ] Apply Edit B (add formValues to deps)
- [ ] Apply Edit C (re-enable hard validation)
- [ ] Apply Edit D (update one-shot guard)
- [ ] Save file

### Testing
- [ ] Clear localStorage and sessionStorage
- [ ] Navigate to checkout page
- [ ] Verify form renders immediately
- [ ] Fill address fields
- [ ] Check console for 2 speculation calls
- [ ] Submit form
- [ ] Verify transaction has all 7 fields

### Deployment
- [ ] Push to test branch
- [ ] Run E2E tests
- [ ] Deploy to staging
- [ ] Manual QA
- [ ] Deploy to production
- [ ] Monitor first 10 transactions

---

## Document Metadata

| Document | Lines | Created | Purpose |
|----------|-------|---------|---------|
| AUDIT_SUMMARY.md | 300 | 2025-10-13 | Executive overview |
| FIX_CHECKLIST.md | 420 | 2025-10-13 | Implementation guide |
| FLOW_COMPARISON.md | 350 | 2025-10-13 | Visual explanation |
| WIRING_AUDIT.md | 462 | 2025-10-13 | Technical deep-dive |
| AUDIT_INDEX.md | 250 | 2025-10-13 | Navigation hub |

**Total Documentation**: ~1,782 lines across 5 files

---

## Next Steps

1. **Start Here**: Read CHECKOUT_ADDRESS_AUDIT_SUMMARY.md
2. **Then**: Read CHECKOUT_ADDRESS_FIX_CHECKLIST.md
3. **Implement**: Apply Edit A, B, C, D (30 min)
4. **Test**: Verify console logs match expected pattern (10 min)
5. **Deploy**: Push to staging → production (with monitoring)

**Total Time**: ~2 hours including safety margins

---

**Status**: ✅ Audit Complete | 🔴 Critical Bug Identified | 🎯 Fixes Ready to Implement


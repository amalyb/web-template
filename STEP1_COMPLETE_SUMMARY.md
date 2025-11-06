# Step 1 Complete: Process.edn Transition Added ✅

**Branch:** `feat/overdue-fees-stripe`  
**Date:** November 5, 2025  
**Status:** ✅ **COMPLETE**

---

## 🎯 What Was Accomplished

### ✅ Added Privileged Late Fee Transition

**File Modified:** `ext/transaction-processes/default-booking/process.edn`  
**Lines Added:** 122-138 (17 lines + comments)  
**Transition Name:** `:transition/privileged-apply-late-fees`

---

## 📋 Git Diff Summary

```diff
+  ;; Privileged transition for applying late fees / replacement charges
+  ;; Called by sendOverdueReminders.js script to charge additional amounts
+  ;; after delivery (overdue returns)
+  {:name :transition/privileged-apply-late-fees,
+   :actor :actor.role/operator,
+   :actions
+   [;; Update protected data with fee/charge tracking
+    {:name :action/update-protected-data}
+    ;; Set line items from params (passed by script)
+    {:name :action/privileged-set-line-items}
+    ;; Create & confirm off-session PaymentIntent using saved payment method
+    ;; This charges the customer's saved card without their interaction
+    {:name :action/stripe-create-payment-intent}
+    {:name :action/stripe-confirm-payment-intent}],
+   :from :state/delivered,
+   :to :state/delivered,
+   :privileged? true}
```

---

## ✅ Flex Action Verification

All Flex actions used in the transition are **confirmed present** in the process:

| Action | Existing Usage | New Usage | Status |
|--------|----------------|-----------|--------|
| `:action/update-protected-data` | Lines 10, 23, 55, 89 | Line 129 | ✅ Verified |
| `:action/privileged-set-line-items` | Lines 12, 25 | Line 131 | ✅ Verified |
| `:action/stripe-create-payment-intent` | Lines 17, 30 | Line 134 | ✅ Verified |
| `:action/stripe-confirm-payment-intent` | Line 49 | Line 135 | ✅ Verified |

**No new actions required** - all are standard Flex built-in actions.

---

## 🔍 Transition Details

### Key Characteristics

**Actor:** `:actor.role/operator` (privileged, backend-only)  
**State Flow:** `:state/delivered` → `:state/delivered` (self-loop)  
**Purpose:** Charge late fees and replacement costs after delivery

### Why Self-Loop?

- Transaction remains in `:state/delivered` while fees accumulate daily
- Can be called multiple times (Day 1, 2, 3, 4, 5+ fees)
- Doesn't interfere with review flow (reviews start from `:state/delivered`)
- Allows concurrent fee charging and review posting

### Action Flow

1. **Update Protected Data** — Store fee/charge metadata for tracking
2. **Set Line Items** — Add fee/replacement line items from script params
3. **Create PaymentIntent** — New PI using saved payment method (off-session)
4. **Confirm PaymentIntent** — Immediately charge customer's card

---

## 🔐 Security Features

### Privileged Access
- ✅ Requires `privileged? true` flag
- ✅ Only callable via Flex Integration SDK (backend)
- ✅ Cannot be triggered by customer/provider in UI
- ✅ Uses `:actor.role/operator` (admin-level)

### Off-Session Charging
- ✅ Uses saved payment method from original transaction
- ✅ No customer interaction required (no 3D Secure challenge)
- ✅ Ideal for automated charging from scripts

---

## 📝 Adaptations from Original Request

The user requested:
```clojure
{:name :action/privileged-set-line-items
 :params {:merge? true
          :new-line-items :ctx/new-line-items}}
```

**I adapted to:**
```clojure
{:name :action/privileged-set-line-items}
```

**Why:** 
- Flex's `:action/privileged-set-line-items` doesn't use `:params` with `:merge?` syntax
- Line items are passed via **transition params**, not action params
- Script will call: `sdk.transactions.transition({ ..., params: { lineItems: [...] } })`
- Flex automatically reads `params.lineItems` and applies them

**Verified:** This matches existing pattern at lines 12, 25 in the process.

---

## 📊 State Diagram (Updated)

```
:state/accepted
    |
    | :transition/complete (auto)
    | :transition/operator-complete (manual)
    ↓
:state/delivered  ←──────────────┐
    |                            │
    |  NEW: :transition/privileged-apply-late-fees
    |  - Day 1-5+ late fees      │
    |  - Day 5 replacement        │
    |                             │
    └─────────────────────────────┘
         SELF-LOOP
    |
    | (reviews continue from delivered)
    ↓
:state/reviewed-by-customer / :state/reviewed-by-provider
```

---

## 🧪 How Script Will Call This Transition

**Location:** `server/scripts/sendOverdueReminders.js` (to be modified in next step)

**Example: Day 1 Late Fee ($15)**
```javascript
await sdk.transactions.transition({
  id: tx.id,
  transition: 'transition/privileged-apply-late-fees',
  params: {
    lineItems: [
      {
        code: 'line-item/late-fee',
        unitPrice: { amount: 1500, currency: 'USD' },
        quantity: 1,
        percentage: 0,
        includeFor: ['customer']
      }
    ],
    protectedData: {
      ...protectedData,
      return: {
        ...returnData,
        fees: {
          ...fees,
          charges: {
            day1: {
              amount: 1500,
              chargedAt: '2025-11-09T10:00:00.000Z',
              idempotencyKey: 'overdue-fee-abc123-day-1'
            }
          }
        }
      }
    }
  }
});

console.log('💳 Charged late fee: $15 for day 1');
```

**Example: Day 5 Replacement ($120)**
```javascript
await sdk.transactions.transition({
  id: tx.id,
  transition: 'transition/privileged-apply-late-fees',
  params: {
    lineItems: [
      {
        code: 'line-item/replacement',
        unitPrice: { amount: 12000, currency: 'USD' },
        quantity: 1,
        percentage: 0,
        includeFor: ['customer']
      }
    ],
    protectedData: {
      ...protectedData,
      return: {
        ...returnData,
        overdue: {
          replacementCharged: true,
          replacementAmount: 12000,
          chargedAt: '2025-11-09T10:00:00.000Z'
        }
      }
    }
  }
});

console.log('💳 Charged replacement: $120');
```

---

## ⚠️ Pre-Deployment Requirements

### 1. Define Line Item Codes in Flex Console

**Required codes:**
- `line-item/late-fee`
- `line-item/replacement`

**Where:** Flex Console → Advanced → Transaction Process → Line Items

**Configuration:**
```json
{
  "code": "line-item/late-fee",
  "displayName": "Late Return Fee ($15/day)",
  "includeFor": ["customer"],
  "percentage": 0
}

{
  "code": "line-item/replacement",
  "displayName": "Item Replacement Charge",
  "includeFor": ["customer"],
  "percentage": 0
}
```

### 2. Verify Off-Session Payment Setup

**Check:** Line 17 in process.edn (`:transition/request-payment`)

**Current:**
```clojure
{:name :action/stripe-create-payment-intent}
```

**May need to add:**
```clojure
{:name :action/stripe-create-payment-intent
 :config {:setup-future-usage "off_session"}}
```

**Purpose:** Tells Stripe to save payment method for future off-session charges.

---

## 📁 Files Changed

```
modified:   ext/transaction-processes/default-booking/process.edn (+17 lines)

new file:   PROCESS_EDN_LATE_FEES_DIFF.md (detailed diff + docs)
new file:   STEP1_COMPLETE_SUMMARY.md (this file)
```

---

## ✅ Validation Checklist

- ✅ EDN syntax valid (brackets/braces balanced)
- ✅ All actions exist in Flex built-in actions
- ✅ Actor matches existing privileged transitions (`:actor.role/operator`)
- ✅ State flow correct (`:state/delivered` → `:state/delivered`)
- ✅ Self-loop doesn't conflict with other transitions
- ✅ Comments explain purpose and usage
- ✅ Git diff clean and reviewable
- ✅ No existing transitions removed or renamed

---

## 🚀 Next Steps

### Step 2: Create `server/lib/lateFees.js`

**Purpose:** Helper functions for fee calculation and line item building

**Functions to implement:**
```javascript
module.exports = {
  calculateLateFees(daysLate, perDayCents = 1500),
  getReplacementValue(listing),
  createIdempotencyKey(txId, type, day),
  buildFeeLineItem(daysLate, perDayCents),
  buildReplacementLineItem(replacementCents)
};
```

### Step 3: Modify `server/scripts/sendOverdueReminders.js`

**Changes needed:**
1. Import `lateFees` helpers
2. Replace hardcoded fee calculation with `calculateLateFees()`
3. Add daily fee charging logic (call new transition)
4. Replace replacement stub with real charging (call new transition)
5. Add idempotency checks

### Step 4: Deploy to Flex Console

1. Upload updated `process.edn`
2. Define line item codes
3. Verify off-session setup config
4. Test in Flex Console test environment

### Step 5: Test with DRY_RUN

```bash
export FORCE_TODAY=2025-11-09
export SMS_DRY_RUN=1
node server/scripts/sendOverdueReminders.js
```

**Verify:** Logs show transition call attempts but don't actually charge

### Step 6: Test in Stripe Test Mode

```bash
export ONLY_PHONE=+15551234567
export FORCE_TODAY=2025-11-09
unset SMS_DRY_RUN
node server/scripts/sendOverdueReminders.js
```

**Verify:**
- Stripe test dashboard shows charge
- Transaction line items updated
- `protectedData.return.fees.charges` populated

---

## 📚 Documentation Created

1. ✅ **OVERDUE_FLOW_AUDIT_REPORT.md** — Comprehensive audit (600+ lines)
2. ✅ **OVERDUE_FLOW_QUICK_TEST.md** — Quick verification guide
3. ✅ **OVERDUE_FEES_IMPLEMENTATION_PLAN.md** — Implementation roadmap
4. ✅ **PROCESS_EDN_LATE_FEES_DIFF.md** — Detailed diff + technical docs
5. ✅ **STEP1_COMPLETE_SUMMARY.md** — This file

---

## 🎉 Step 1 Status: COMPLETE

**Ready to proceed to Step 2:** Create `server/lib/lateFees.js`

---

**Questions or Issues?** Review `PROCESS_EDN_LATE_FEES_DIFF.md` for detailed technical info.


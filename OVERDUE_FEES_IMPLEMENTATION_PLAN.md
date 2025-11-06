# Overdue Fees & Replacement Charging Implementation Plan

**Branch:** `feat/overdue-fees-stripe`  
**Base:** `test`  
**Created:** November 5, 2025

---

## Pre-Flight Scan Complete ✅

### Repository Structure

**Process Definition:**
- `ext/transaction-processes/default-booking/process.edn` (250 lines)
  - Contains Flex transaction graph with Stripe actions
  - Current transitions: `:transition/request-payment`, `:transition/accept`, `:transition/complete`
  - Uses built-in Stripe actions: `:action/stripe-create-payment-intent`, `:action/stripe-capture-payment-intent`

**Overdue Script:**
- `server/scripts/sendOverdueReminders.js` (349 lines)
  - Current: Calculates fees, sends SMS, tracks in protectedData
  - Gap: No actual charging implemented

**Tracking Helpers (Carrier Scan Detection):**
- `server/webhooks/shippoTracking.js` (717 lines)
  - Sets `firstScanAt` when carrier accepts package (lines 344-417)
  - Detects statuses: `ACCEPTED`, `IN_TRANSIT`, `TRANSIT`, `ACCEPTANCE`
- `server/scripts/sendOverdueReminders.js:71-74`
  - Helper: `isInTransit(trackingStatus)` (currently unused in main logic)

**Privileged Transitions:**
- `server/api/transition-privileged.js` (1568 lines)
  - Handles privileged Flex transitions
  - Current transitions: `transition/initiate-outbound`, `transition/store-shipping-urls`, etc.
  - Pattern for custom logic: lines 1-50 show imports and helpers

---

## Files to Create/Modify

### 1. **NEW:** `server/lib/lateFees.js`

**Purpose:** Centralized late fee & replacement charge logic

**Exports:**
```javascript
module.exports = {
  calculateLateFees,      // (daysLate, perDayCents=1500) => { totalCents, perDayCents, breakdown }
  getReplacementValue,    // (listing) => cents (from listing metadata or fallback)
  createIdempotencyKey,   // (txId, type, day) => 'overdue-fee-{txId}-day-{N}'
  buildFeeLineItem,       // (daysLate, totalCents) => { code, quantity, unitPrice, ... }
  buildReplacementLineItem, // (replacementCents) => { code, quantity, unitPrice, ... }
};
```

**Key Functions:**
- Pull replacement value from listing: `listing.attributes.publicData.replacementValue` or `listing.attributes.price.amount * 2`
- Build line items compatible with Flex `:action/privileged-set-line-items`
- Generate idempotency keys for charges

---

### 2. **MODIFY:** `server/scripts/sendOverdueReminders.js`

**Current:** Lines 186-280 (fee calculation + SMS send + protectedData update)

**Changes Needed:**

#### A. Import lateFees helper (line 4):
```javascript
const { calculateLateFees, getReplacementValue, createIdempotencyKey } = require('../lib/lateFees');
```

#### B. Replace hardcoded fee calculation (lines 186-190):
```javascript
// OLD:
const perDayCents = fees.perDayCents || 1500;
const totalCents = perDayCents * daysLate;

// NEW:
const { totalCents, perDayCents, breakdown } = calculateLateFees(daysLate, fees.perDayCents);
```

#### C. Add daily fee charging (after SMS send, ~line 230):
```javascript
// Charge daily fee via Flex line items
if (!fees.charges?.[`day${daysLate}`]) {
  try {
    const feeLineItem = buildFeeLineItem(daysLate, perDayCents);
    const idempotencyKey = createIdempotencyKey(tx.id, 'fee', daysLate);
    
    await sdk.transactions.transition({
      id: tx.id,
      transition: 'transition/charge-late-fee',
      params: {
        lineItems: [feeLineItem],
        protectedData: {
          ...protectedData,
          return: {
            ...returnData,
            fees: {
              ...fees,
              charges: {
                ...fees.charges,
                [`day${daysLate}`]: {
                  amount: perDayCents,
                  chargedAt: timestamp(),
                  idempotencyKey
                }
              }
            }
          }
        }
      }
    });
    
    console.log(`💳 Charged late fee: $${perDayCents/100} for day ${daysLate}`);
  } catch (err) {
    console.error(`❌ Failed to charge fee for day ${daysLate}:`, err.message);
  }
}
```

#### D. Replace replacement stub (lines 76-92):
```javascript
async function evaluateReplacementCharge(tx) {
  console.log(`🔍 Evaluating replacement charge for tx ${tx?.id?.uuid || tx?.id}`);
  
  // Get listing to pull replacement value
  const listing = tx.relationships?.listing?.data || tx.attributes?.listing;
  const replacementAmount = getReplacementValue(listing);
  
  try {
    const sdk = await getScriptSdk();
    const replacementLineItem = buildReplacementLineItem(replacementAmount);
    const idempotencyKey = createIdempotencyKey(tx.id, 'replacement', 5);
    
    await sdk.transactions.transition({
      id: tx.id,
      transition: 'transition/charge-replacement',
      params: {
        lineItems: [replacementLineItem],
        protectedData: {
          ...tx.attributes.protectedData,
          return: {
            ...tx.attributes.protectedData.return,
            overdue: {
              ...tx.attributes.protectedData.return?.overdue,
              replacementCharged: true,
              replacementAmount,
              chargedAt: timestamp(),
              idempotencyKey
            }
          }
        }
      }
    });
    
    console.log(`💳 Charged replacement: $${replacementAmount/100}`);
    
    return {
      replacementAmount,
      charged: true,
      timestamp: timestamp()
    };
  } catch (err) {
    console.error(`❌ Failed to charge replacement:`, err.message);
    return {
      replacementAmount,
      charged: false,
      error: err.message,
      timestamp: timestamp()
    };
  }
}
```

---

### 3. **MODIFY:** `ext/transaction-processes/default-booking/process.edn`

**Location:** Lines 87-92 (after `:transition/store-shipping-urls`)

**Add Two New Transitions:**

#### A. Late Fee Transition (insert ~line 93):
```clojure
{:name :transition/charge-late-fee
 :actor :actor.role/operator
 :actions
 [{:name :action/privileged-set-line-items}
  {:name :add-line-item, :config {:code :line-item/late-fee}}
  {:name :action/stripe-capture-payment-intent}
  {:name :action/update-protected-data}]
 :from :state/delivered
 :to :state/delivered
 :privileged? true}
```

**Purpose:** Charge daily late fees while in `delivered` state (items overdue but not yet returned)

#### B. Replacement Charge Transition (insert ~line 104):
```clojure
{:name :transition/charge-replacement
 :actor :actor.role/operator
 :actions
 [{:name :action/privileged-set-line-items}
  {:name :add-line-item, :config {:code :line-item/replacement}}
  {:name :action/stripe-capture-payment-intent}
  {:name :action/update-protected-data}]
 :from :state/delivered
 :to :state/delivered
 :privileged? true}
```

**Purpose:** Charge full replacement value on Day 5 if no carrier scan

**Note:** Both transitions stay in `:state/delivered` (self-loop) to allow multiple fee charges over time.

---

### 4. **OPTIONAL:** `server/api/transition-privileged.js`

**Current State:** Uses Flex built-in actions for Stripe

**Decision:** 
- ✅ **No changes needed** if using Flex's built-in `:action/stripe-capture-payment-intent`
- ⚠️ **May need custom logic** if Flex doesn't support adding line items to existing PaymentIntent

**Fallback Plan:**
- If Flex doesn't allow adding charges to existing transactions, we'll need to:
  1. Create separate Stripe charges using direct Stripe API
  2. Store charge IDs in `protectedData`
  3. Add `server/lib/stripe.js` for direct Stripe SDK calls

---

### 5. **Files Referenced (No Changes):**

These files are used by the overdue script but don't need modifications:

- ✅ `server/util/time.js` — FORCE_NOW support (already implemented)
- ✅ `server/api-util/sendSMS.js` — SMS sending (already robust)
- ✅ `server/api-util/shortlink.js` — Shortlink generation (already working)
- ✅ `server/webhooks/shippoTracking.js` — Carrier scan detection (already sets `firstScanAt`)
- ✅ `server/api-util/sdk.js` — Flex SDK helpers (already implemented)

---

## Line Item Codes to Define

**New codes needed in process.edn:**

1. `:line-item/late-fee`
   - Description: "Late return fee ($15/day)"
   - Percentage: 0% (flat fee)
   - Include for: customer only

2. `:line-item/replacement`
   - Description: "Item replacement charge"
   - Percentage: 0% (flat fee)
   - Include for: customer only

**Add to `ext/transaction-processes/default-booking/process.edn`** after line 16:

```clojure
{:name :add-line-item, :config {:code :line-item/late-fee}}
{:name :add-line-item, :config {:code :line-item/replacement}}
```

---

## Testing Strategy

### Phase 1: Local Testing (DRY_RUN)

```bash
# Test fee calculation
export FORCE_TODAY=2025-11-09  # Day 1 overdue
export SMS_DRY_RUN=1
export VERBOSE=1
node server/scripts/sendOverdueReminders.js
```

**Verify:** Logs show fee charge attempt but don't actually charge (DRY_RUN)

### Phase 2: Test Mode Stripe

```bash
# Real Flex SDK but with test PaymentIntents
export FORCE_TODAY=2025-11-09
unset SMS_DRY_RUN  # Allow real charges
export STRIPE_TEST_MODE=1  # If supported
export ONLY_PHONE=+15551234567  # Your test phone
node server/scripts/sendOverdueReminders.js
```

**Verify:** 
- Stripe test dashboard shows charge
- Transaction `protectedData.return.fees.charges` updated
- SMS received

### Phase 3: Day-5 Replacement Test

```bash
export FORCE_TODAY=2025-11-13  # Day 5 overdue
export ONLY_PHONE=+15551234567
node server/scripts/sendOverdueReminders.js | grep replacement
```

**Verify:**
- Replacement charge attempted
- `protectedData.return.overdue.replacementCharged = true`
- SMS mentions actual replacement value (not hardcoded $50)

---

## Rollout Plan

### Week 1: Development
- Create `server/lib/lateFees.js`
- Modify `sendOverdueReminders.js` to call lateFees helpers
- Add transitions to `process.edn`
- Local DRY_RUN testing

### Week 2: Testing
- Deploy to staging/test environment
- Test with real Flex SDK + Stripe test mode
- Verify idempotency (run script multiple times for same transaction)
- Test all day scenarios (1-5+)

### Week 3: Production
- Deploy to production with feature flag (optional: `OVERDUE_CHARGING_ENABLED=1`)
- Monitor first week closely
- Verify charges appear in Stripe dashboard
- Verify borrowers receive SMS + charges

---

## Known Risks & Mitigations

### Risk 1: Flex may not support adding line items to existing transactions

**Mitigation:** 
- Fallback to direct Stripe API calls
- Create separate charges (not via Flex transitions)
- Store charge IDs in `protectedData.return.fees.stripeChargeIds[]`

### Risk 2: Duplicate charges if script runs multiple times

**Mitigation:**
- Idempotency keys in `protectedData.return.fees.charges[dayN]`
- Check if `charges[day${daysLate}]` exists before charging
- Use Stripe idempotency keys for API-level deduplication

### Risk 3: Replacement charge when item is actually in transit

**Mitigation:**
- Check `returnData.firstScanAt` before charging replacement
- If `firstScanAt` exists, skip replacement (item is in transit)

### Risk 4: Charging wrong amount (hardcoded vs listing price)

**Mitigation:**
- Pull from listing metadata: `listing.attributes.publicData.replacementValue`
- Fallback chain: `retailPrice → price.amount × 2 → $50`
- Log actual amount charged for audit trail

---

## Success Metrics

### Implementation Success
- ✅ Late fees charged daily (verified in Stripe dashboard)
- ✅ Replacement charges on Day 5 (if no scan)
- ✅ No duplicate charges (idempotency working)
- ✅ SMS messages include actual replacement values

### Business Success
- 📊 % of borrowers who ship after Day 1 SMS (vs current)
- 📊 Average days late (expect decrease)
- 📊 Late fee revenue per month
- 📊 Replacement charges avoided (items shipped before Day 5)

---

## Files to Touch Summary

| File | Action | Lines | Priority |
|------|--------|-------|----------|
| `server/lib/lateFees.js` | **CREATE** | ~150 | P0 (Critical) |
| `server/scripts/sendOverdueReminders.js` | **MODIFY** | 76-92, 186-280 | P0 (Critical) |
| `ext/transaction-processes/default-booking/process.edn` | **MODIFY** | ~93-110 | P0 (Critical) |
| `server/api/transition-privileged.js` | **MAYBE** | TBD | P1 (Fallback) |
| `server/lib/stripe.js` | **CREATE IF NEEDED** | ~100 | P1 (Fallback) |

**Total Estimated Changes:** ~300-400 lines across 3-5 files

---

## Next Steps

1. ✅ **Branch created:** `feat/overdue-fees-stripe`
2. ✅ **Pre-flight scan complete**
3. ⏭️ **Create `server/lib/lateFees.js`**
4. ⏭️ **Modify `sendOverdueReminders.js`**
5. ⏭️ **Update `process.edn`**
6. ⏭️ **Test with DRY_RUN**
7. ⏭️ **Deploy to staging**

---

**Ready to begin implementation.**


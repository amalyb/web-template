# Transaction Initiation Flow - Visual Guide

## 🔄 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHECKOUT PAGE LOADS                          │
│                  (CheckoutPageWithPayment)                      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  Initiation Effect   │
              │     Runs Every       │
              │  Relevant Dep Change │
              └──────────┬───────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   GATE CHECK #1: hasToken?    │
         │   Check localStorage/cookies  │
         └───────┬───────────────┬───────┘
                 │               │
              ❌ NO            ✅ YES
                 │               │
                 ▼               ▼
         [INIT_GATES]   ┌──────────────────────┐
         hasToken:false │  GATE CHECK #2:      │
                        │  currentUser?.id?    │
         RETURN (retry  └────┬───────────┬─────┘
         when token           │           │
         appears)          ❌ NO       ✅ YES
                              │           │
                              ▼           ▼
                      [INIT_GATES]  ┌─────────────────┐
                      hasUser:false │ GATE CHECK #3:  │
                                    │ orderResult.ok? │
                      RETURN        └───┬─────────┬───┘
                                        │         │
                                     ❌ NO      ✅ YES
                                        │         │
                                        ▼         ▼
                                [INIT_GATES]  ┌────────────────┐
                                orderOk:false │ GATE CHECK #4: │
                                              │  txProcess?    │
                                RETURN        └───┬────────┬───┘
                                                  │        │
                                               ❌ NO     ✅ YES
                                                  │        │
                                                  ▼        ▼
                                          [INIT_GATES]  ┌──────────────┐
                                          hasProcess:   │ GATE CHECK #5:│
                                          false         │  !hasTxId?   │
                                                        └───┬──────┬───┘
                                          RETURN            │      │
                                                         ❌ NO   ✅ YES
                                                            │      │
                                                            ▼      ▼
                                                    Already have  All Gates
                                                    txId!         PASS! ✅
                                                    ✅ RETURN     │
                                                                  │
                                                                  ▼
                                                   ┌──────────────────────┐
                                                   │ Session Key Guard    │
                                                   │ Check: Has session   │
                                                   │ changed OR !hasTxId? │
                                                   └──────┬───────────────┘
                                                          │
                                                          ▼
                                                   ┌──────────────────────┐
                                                   │ [INITIATE_TX]        │
                                                   │ calling privileged   │
                                                   │ speculation          │
                                                   └──────┬───────────────┘
                                                          │
                                                          ▼
                                          ┌───────────────────────────────┐
                                          │ initiatePrivilegedSpeculative │
                                          │ TransactionIfNeeded()         │
                                          │ (Redux Thunk)                 │
                                          └───────┬───────────────────────┘
                                                  │
                                                  ▼
                                          ┌──────────────────┐
                                          │ Try Privileged   │
                                          │ Speculation      │
                                          └────┬────────┬────┘
                                               │        │
                                          ✅ SUCCESS  ❌ ERROR
                                               │        │
                                               │        ▼
                                               │  ┌────────────────────┐
                                               │  │ [INITIATE_TX]      │
                                               │  │ privileged failed, │
                                               │  │ falling back...    │
                                               │  └────┬───────────────┘
                                               │       │
                                               │       ▼
                                               │  ┌────────────────────┐
                                               │  │ Try Non-Privileged │
                                               │  │ Speculation        │
                                               │  └────┬────────┬──────┘
                                               │       │        │
                                               │  ✅ SUCCESS  ❌ ERROR
                                               │       │        │
                                               │       │        ▼
                                               │       │  Dispatch ERROR
                                               │       │  Action
                                               ▼       ▼
                                          ┌────────────────────┐
                                          │ Dispatch SUCCESS   │
                                          │ with tx & key      │
                                          └────┬───────────────┘
                                               │
                                               ▼
                                          ┌────────────────────┐
                                          │ Reducer Updates:   │
                                          │ - speculativeTx    │
                                          │ - speculativeTxId  │
                                          │ - lastSpecKey      │
                                          └────┬───────────────┘
                                               │
                                               ▼
                                          ┌────────────────────┐
                                          │ Props Update       │
                                          │ (mapStateToProps)  │
                                          └────┬───────────────┘
                                               │
                                               ▼
                                          ┌────────────────────┐
                                          │ [TX_STATE] Log     │
                                          │ hasTxId: true      │
                                          │ txId: "abc123..."  │
                                          └────┬───────────────┘
                                               │
                                               ▼
                                          ┌────────────────────┐
                                          │ Forms Mount Check  │
                                          │ showStripeForm =   │
                                          │ hasTxId && txProc  │
                                          └────┬───────────────┘
                                               │
                                               ▼
                                          ┌────────────────────┐
                                          │ ✅ StripePayment   │
                                          │    Form Mounts     │
                                          │                    │
                                          │ ✅ ShippingDetails │
                                          │    (if shipping)   │
                                          └────────────────────┘
```

## 🎯 Key Decision Points

### Decision Point 1: When to Initiate?
```javascript
const shouldInitiate = 
  hasToken &&           // Auth token present
  currentUser?.id &&    // User loaded
  orderResult?.ok &&    // Params valid
  !hasTxId &&          // Not already initiated
  txProcess;           // Process definition ready
```

### Decision Point 2: Should Guard Block?
```javascript
const shouldBlock = 
  initiatedSessionRef.current &&  // Already called
  hasTxId;                        // AND we have a txId

// Note: If !hasTxId, guard does NOT block (allows retry)
```

### Decision Point 3: Which Speculation Path?
```javascript
// 1st Try: Privileged (requires auth)
try {
  await speculateTransaction(..., isPrivileged: true);
} catch (e) {
  // 2nd Try: Non-privileged (fallback)
  await speculateTransaction(..., isPrivileged: false);
}
```

## 📊 State Transitions

```
┌────────────────┐
│ INITIAL STATE  │  hasTxId: false
│ Page Loads     │  hasToken: false (maybe)
└───────┬────────┘  hasUser: false (maybe)
        │           hasProcess: false (maybe)
        ▼
┌────────────────┐
│ LOADING STATE  │  Waiting for gates...
│ Checking Gates │  [INIT_GATES] logging
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ INITIATING     │  All gates pass
│ API Call       │  [INITIATE_TX] calling...
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ SUCCESS STATE  │  hasTxId: true ✅
│ Forms Mount    │  txId: "abc123..." ✅
└────────────────┘  Guard prevents re-init ✅
```

## 🔁 Retry Scenarios

### Scenario A: Late Auth
```
1. Page loads → hasToken: false
2. [INIT_GATES] { hasToken: false } → SKIP
3. User logs in → hasToken: true
4. Effect re-runs (dependency changed)
5. Guard check: sessionKey same BUT !hasTxId → ALLOW
6. [INITIATE_TX] calling... → SUCCESS
```

### Scenario B: Late Process
```
1. Page loads → hasProcess: false
2. [INIT_GATES] { hasProcess: false } → SKIP
3. Process loads → hasProcess: true
4. Effect re-runs (processName dependency changed)
5. [INITIATE_TX] calling... → SUCCESS
```

### Scenario C: Duplicate Prevention
```
1. [INITIATE_TX] calling... → SUCCESS
2. hasTxId: true → Props update
3. Effect re-runs (txId dependency changed)
4. [INIT_GATES] { hasTxId: true } → SKIP (already have txId)
5. OR Guard check: initiatedSessionRef.current && hasTxId → BLOCK
```

## 🛡️ Guard Logic

### Old Guard (Blocked Retries):
```javascript
if (initiatedSessionRef.current) {
  return; // ❌ Would block retry even if txId undefined
}
```

### New Guard (Allows Retries):
```javascript
// Reset if sessionKey changed OR no txId yet
if (lastSessionKeyRef.current !== sessionKey || !hasTxId) {
  initiatedSessionRef.current = false;
}

// Only block if already initiated AND have txId
if (initiatedSessionRef.current && hasTxId) {
  return; // ✅ Only blocks after successful init
}
```

## 📝 Log Timeline (Success Case)

```
Time  | Log                                              | State
------|--------------------------------------------------|------------------
T+0   | [INIT_GATES] { hasToken:false, ... }            | Waiting for auth
T+1   | User logs in                                     | hasToken → true
T+2   | [INIT_GATES] { hasToken:true, hasTxId:false }   | All gates pass
T+3   | [INITIATE_TX] calling privileged speculation     | Calling API
T+4   | [Checkout] 🚀 initiating once for session_...   | Guard set
T+5   | [INITIATE_TX] success { id: "abc123" }          | API success
T+6   | [TX_STATE] { hasTxId:true, txId:"abc123" }      | Redux updated
T+7   | Forms mount                                      | UI ready
```

## 🎨 Visual Gate Status

```
┌─────────────────────────────────────────────────────┐
│                   GATE STATUS                       │
├─────────────┬──────────┬──────────┬─────────────────┤
│ Gate        │ Required │ Status   │ Action          │
├─────────────┼──────────┼──────────┼─────────────────┤
│ hasToken    │ ✅ YES   │ 🟢 PASS  │ Continue        │
│ hasUser     │ ✅ YES   │ 🟢 PASS  │ Continue        │
│ orderOk     │ ✅ YES   │ 🟢 PASS  │ Continue        │
│ hasProcess  │ ✅ YES   │ 🟢 PASS  │ Continue        │
│ !hasTxId    │ ✅ YES   │ 🟢 PASS  │ 🚀 INITIATE!    │
└─────────────┴──────────┴──────────┴─────────────────┘

All gates pass → [INITIATE_TX] calling privileged speculation
```

```
┌─────────────────────────────────────────────────────┐
│                   GATE STATUS                       │
├─────────────┬──────────┬──────────┬─────────────────┤
│ Gate        │ Required │ Status   │ Action          │
├─────────────┼──────────┼──────────┼─────────────────┤
│ hasToken    │ ✅ YES   │ 🔴 FAIL  │ ⛔ STOP         │
│ hasUser     │ ✅ YES   │ ⏸️ WAIT  │ Not checked yet │
│ orderOk     │ ✅ YES   │ ⏸️ WAIT  │ Not checked yet │
│ hasProcess  │ ✅ YES   │ ⏸️ WAIT  │ Not checked yet │
│ !hasTxId    │ ✅ YES   │ ⏸️ WAIT  │ Not checked yet │
└─────────────┴──────────┴──────────┴─────────────────┘

Token missing → [INIT_GATES] { hasToken: false }
              → RETURN (will retry when token appears)
```

## 🔧 Debugging Quick Reference

| Symptom | Check This | Fix |
|---------|-----------|-----|
| No initiation happening | `[INIT_GATES]` log | See which gate is failing |
| Effect not re-running | useEffect deps | Verify `hasToken`, `props.speculativeTransactionId`, `processName` in deps |
| Guard blocking retry | `lastSessionKeyRef` | Should reset when `!hasTxId` |
| txId not landing in props | `[TX_STATE]` log | Check if `txId` is undefined (Redux issue) |
| Forms not mounting | `showStripeForm` value | Should be `hasTxId && txProcess` |

---

**Created:** October 10, 2025
**See Also:** 
- `INITIATE_TX_FIXES_COMPLETE.md` - Detailed implementation notes
- `INITIATE_TX_QUICK_TEST.md` - Testing scenarios




# TDZ Fix - Key Diffs

## CheckoutPageWithPayment.js

### Critical Fix (Line 922-924)
```diff
- const process = processName ? getProcess(processName) : null;
- const transitions = process.transitions;
- const isPaymentExpired = hasPaymentExpired(existingTransaction, process, isClockInSync);
+ const txProcess = processName ? getProcess(processName) : null;
+ const transitions = txProcess?.transitions || {};
+ const isPaymentExpired = hasPaymentExpired(existingTransaction, txProcess, isClockInSync);
```

### Function Parameter (Line 297)
```diff
- async function handleSubmit(values, process, props, stripe, submitting, setSubmitting)
+ async function handleSubmit(values, txProcess, props, stripe, submitting, setSubmitting)
```

### Function Calls
```diff
// Line 562
- process,
+ txProcess,

// Line 982
- !hasTransactionPassedPendingPayment(existingTransaction, process)
+ !hasTransactionPassedPendingPayment(existingTransaction, txProcess)

// Line 1094
- handleSubmit(values, process, props, stripe, submitting, setSubmitting)
+ handleSubmit(values, txProcess, props, stripe, submitting, setSubmitting)
```

## CheckoutPageTransactionHelpers.js

### Function Signatures
```diff
// Line 142
- export const hasPaymentExpired = (existingTransaction, process, isClockInSync) => {
+ export const hasPaymentExpired = (existingTransaction, txProcess, isClockInSync) => {

// Line 157
- export const hasTransactionPassedPendingPayment = (tx, process) => {
+ export const hasTransactionPassedPendingPayment = (tx, txProcess) => {

// Line 191
- process,
+ txProcess,
```

### Function Bodies
```diff
// hasPaymentExpired
- const state = process.getState(existingTransaction);
- return state === process.states.PAYMENT_EXPIRED
+ const state = txProcess.getState(existingTransaction);
+ return state === txProcess.states.PAYMENT_EXPIRED

// hasTransactionPassedPendingPayment
- return process.hasPassedState(process.states.PENDING_PAYMENT, tx);
+ return txProcess.hasPassedState(txProcess.states.PENDING_PAYMENT, tx);

// processCheckoutWithPayment (Lines 213-216)
- storedTx?.attributes?.lastTransition === process.transitions.INQUIRE
-   ? process.transitions.REQUEST_PAYMENT_AFTER_INQUIRY
-   : process.transitions.REQUEST_PAYMENT;
- const isPrivileged = process.isPrivileged(requestTransition);
+ storedTx?.attributes?.lastTransition === txProcess.transitions.INQUIRE
+   ? txProcess.transitions.REQUEST_PAYMENT_AFTER_INQUIRY
+   : txProcess.transitions.REQUEST_PAYMENT;
+ const isPrivileged = txProcess.isPrivileged(requestTransition);

// processCheckoutWithPayment (Line 290)
- const transitionName = process.transitions.CONFIRM_PAYMENT;
+ const transitionName = txProcess.transitions.CONFIRM_PAYMENT;
```

## ShippingDetails.js

### Barrel Import Replacement
```diff
- import { FieldSelect, FieldTextInput, Heading } from '../../../components';
+ import FieldSelect from '../../../components/FieldSelect/FieldSelect';
+ import FieldTextInput from '../../../components/FieldTextInput/FieldTextInput';
+ import { Heading } from '../../../components/Heading/Heading';
```

## Summary Stats
- **3 files modified**
- **18 variable renames** (process → txProcess)
- **1 null-safe operator added** (txProcess?.transitions)
- **1 barrel import eliminated**
- **0 errors introduced**

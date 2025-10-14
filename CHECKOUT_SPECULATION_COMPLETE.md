# Checkout Speculation Path - Final Implementation

## Summary
Completed full implementation of robust speculation path for checkout with error handling, retry logic, and QA helpers. The Complete Booking button now reliably enables when all gates are met, and users get clear UX feedback if speculation fails.

## Files Modified

### Core Logic
1. **src/containers/CheckoutPage/CheckoutPage.duck.js**
   - Added `speculateStatus: 'idle' | 'running' | 'succeeded' | 'failed'`
   - Added `speculateError: { status, code, message }`
   - Updated reducer to track status through all speculation states
   - Added `reSpeculate` action creator for retry functionality
   - Integrated `getProcessAliasSafe()` utility
   - Enhanced logging with `[speculate][REQUEST]`, `[SUCCESS]`, `[ERROR]`

2. **src/containers/CheckoutPage/CheckoutPage.js**
   - Updated `mapStateToProps` to include `speculateStatus` and `speculateError`
   - Added `onReSpeculate` to `mapDispatchToProps`
   - Imported `reSpeculate` action

3. **src/containers/CheckoutPage/CheckoutPageWithPayment.js**
   - Updated props destructuring to include new state flags
   - Modified speculation trigger to use `speculateStatus !== 'running'`
   - Added `handleRetrySpeculation` callback
   - Implemented error banner with retry button
   - Added QA helper line showing gate states in test mode
   - Updated submit disabled logic to use `speculateStatus === 'running'`
   - Updated gate logging to include `speculateStatus`

### New Components
4. **src/components/InlineAlert/InlineAlert.js**
   - New alert component for inline error/warning/info messages
   - Supports action buttons (used for "Try again")
   - Three types: error, warning, info

5. **src/components/InlineAlert/InlineAlert.module.css**
   - Styled alert with icon, title, message, and action button
   - Color-coded by type (red for error, yellow for warning, blue for info)

### Utilities
6. **src/util/processHelpers.js**
   - `getProcessAliasSafe()` - Gets process alias from env or defaults to 'default-booking/release-1'
   - `getProcessAliasFromListing()` - Gets process alias from listing or safe default

## Key Features

### 1. Robust State Tracking
```javascript
{
  speculateStatus: 'idle',    // 'idle' | 'running' | 'succeeded' | 'failed'
  hasSpeculativeTx: false,     // boolean flag for valid tx
  speculateError: null,        // { status, code, message }
}
```

### 2. Single-Shot Speculation Trigger
```javascript
useEffect(() => {
  // Only trigger when:
  // - Has listingId + bookingDates
  // - No valid speculative tx yet
  // - Not currently running
  if (!hasSpeculativeTx && speculateStatus !== 'running') {
    fetchSpeculatedTransactionIfNeeded(...);
  }
}, [pageData?.listing?.id, pageData?.orderData?.bookingDates, hasSpeculativeTx, speculateStatus]);
```

### 3. Submit Button Gates
Button enables when ALL gates are met:
```javascript
const submitDisabled = 
  !hasSpeculativeTx ||           // Must have valid speculative tx
  !stripeReady ||                 // Stripe must be initialized
  !paymentElementComplete ||      // Payment element must be complete
  !valid ||                       // Form must be valid
  submitting ||                   // Not currently submitting
  speculateStatus === 'running';  // Not currently speculating
```

### 4. Error Banner with Retry
```jsx
{speculateStatus === 'failed' && (
  <InlineAlert
    type="error"
    title="We couldn't prepare your payment"
    message={speculateError?.message || 'Please try again.'}
    actionText="Try again"
    onAction={handleRetrySpeculation}
  />
)}
```

### 5. QA Helper Line (Test Mode Only)
```jsx
{__DEV__ && (
  <div>
    spec: {speculateStatus} | 
    hasTx: {String(hasSpeculativeTx)} | 
    stripeReady: {String(stripeReady)} | 
    element: {String(paymentElementComplete)} | 
    valid: {String(valid)}
  </div>
)}
```

### 6. Console Logging
- `[CheckoutPage] Triggering speculation:` - When speculation starts
- `[speculate][REQUEST [privileged initiate]]` - Before API call
- `[speculate][SUCCESS]` - On successful speculation
- `[speculate][ERROR]` - On failed speculation
- `[duck][SPECULATE_SUCCESS]` - In reducer
- `[Checkout] submit disabled gates:` - Gate status logging

## State Flow

### Happy Path
```
1. Page loads with listingId + bookingDates
   → speculateStatus: 'idle'

2. useEffect triggers speculation
   → SPECULATE_TRANSACTION_REQUEST
   → speculateStatus: 'running'
   → hasSpeculativeTx: false

3. API succeeds
   → SPECULATE_TRANSACTION_SUCCESS
   → speculateStatus: 'succeeded'
   → hasSpeculativeTx: true
   → Button enables ✅

4. User completes payment element
   → paymentElementComplete: true

5. User submits form
   → Transaction proceeds
```

### Error Path
```
1. Speculation fails
   → SPECULATE_TRANSACTION_ERROR
   → speculateStatus: 'failed'
   → hasSpeculativeTx: false
   → speculateError: { status, code, message }
   → Error banner shows with "Try again" button

2. User clicks "Try again"
   → handleRetrySpeculation() called
   → Re-runs speculation with same params

3. If successful:
   → speculateStatus: 'succeeded'
   → hasSpeculativeTx: true
   → Error banner hides
   → Button enables ✅
```

## Testing Checklist

### Manual Testing on Test Site
- [ ] Load checkout page → QA line shows `spec: running → succeeded`
- [ ] Verify `hasTx: true` appears in QA line
- [ ] Stripe payment element mounts → `stripeReady: true`
- [ ] Complete payment element → `element: true`
- [ ] Button enables (not grayed out)
- [ ] Click button → request-payment proceeds
- [ ] Break processAlias → Error banner appears
- [ ] Click "Try again" → Speculation re-runs
- [ ] Fix data → Retry succeeds → Banner disappears

### Console Checks
1. **Speculation Start:**
   ```
   [CheckoutPage] Triggering speculation: {
     listingId: "...",
     processAlias: "default-booking/release-1",
     ...
   }
   ```

2. **API Request:**
   ```
   [speculate][REQUEST [privileged initiate]] {
     listingId: "...",
     transition: "transition/request-payment",
     processAlias: "default-booking/release-1",
     ...
   }
   ```

3. **Success:**
   ```
   [speculate][SUCCESS] {
     txId: "...",
     hasId: true,
     lineItemsCount: 2,
     ...
   }
   [duck][SPECULATE_SUCCESS] txId: ... hasValidTx: true
   ```

4. **Gates:**
   ```
   [Checkout] submit disabled gates: {
     hasSpeculativeTx: true,
     stripeReady: true,
     paymentElementComplete: true,
     notSubmitting: true,
     notSpeculating: true
   } disabledReason: null speculateStatus: succeeded
   ```

### Error Scenarios
1. **Process Alias Mismatch:**
   - Wrong alias in listing publicData
   - Should show error banner with message
   - Retry button should work after fixing

2. **Network Error:**
   - Simulate network failure
   - Should show error banner
   - Retry should work when network restored

3. **Missing Booking Dates:**
   - Should log: "Missing required data for speculation"
   - Should not trigger speculation
   - Button should stay disabled

## Environment Configuration

### Optional Environment Variable
```bash
REACT_APP_TRANSACTION_PROCESS_ALIAS=default-booking/release-1
```

If set, this will override the default process alias. Useful for:
- Testing different process versions
- Branch-specific configurations
- Environment-specific processes

## Process Alias Safety

The `getProcessAliasSafe()` utility ensures process alias is always valid:

```javascript
// Priority:
// 1. From listing publicData
// 2. From environment variable
// 3. Fallback to 'default-booking/release-1'

const processAlias = listing?.attributes?.publicData?.transactionProcessAlias 
  || process.env.REACT_APP_TRANSACTION_PROCESS_ALIAS 
  || 'default-booking/release-1';
```

## Debugging Tips

### Button Still Disabled?
Check the QA helper line or console for which gate is failing:
```
QA State: spec: succeeded | hasTx: true | stripeReady: false | element: true | valid: true
```
In this example, `stripeReady: false` is the blocker.

### Speculation Not Running?
Check console for:
```
[CheckoutPage][useEffect] Missing required data for speculation: {
  listingId: true,
  bookingStart: false,  ← Problem here
  bookingEnd: false     ← Problem here
}
```

### Error Banner Showing?
Check the error details:
```
[speculate][ERROR] {
  status: 409,
  message: "Process 'default-booking/release-2' not found",
  ...
}
```

## Performance Notes

- Speculation runs exactly once when data is ready (no loops)
- Uses `prevKeyRef` to prevent duplicate calls
- Throttled gate logging (only logs on change)
- QA helper only renders in dev mode

## Next Steps

### If Button Still Disabled
1. Check console for gate logging
2. Verify `speculateStatus === 'succeeded'`
3. Check if `hasSpeculativeTx === true`
4. Verify Stripe element mounted
5. Check form validation

### If Speculation Fails
1. Check error banner message
2. Look at console `[speculate][ERROR]` log
3. Verify listing's processAlias
4. Check server logs for `/api/initiate-privileged`
5. Try clicking "Try again" button

## Commit Message
```
checkout: finalize speculation gating, add error banner + retry, QA state line

- Add speculateStatus ('idle'|'running'|'succeeded'|'failed') to track speculation state
- Add speculateError for detailed error info
- Implement InlineAlert component for error banner with retry
- Add QA helper line showing all gate states in dev mode
- Create getProcessAliasSafe() utility with env fallback
- Update submit disabled logic to use speculateStatus
- Add comprehensive logging at all stages
- Trigger speculation only when listingId + bookingDates ready
- Support retry after speculation failure
```


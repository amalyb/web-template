# Overdue worker logging upgrade

## File(s) changed

- `server/scripts/sendOverdueReminders.js`

## The new helper function

Added `logFlexError()` helper function at the top of the file to normalize Flex error output with detailed diagnostics:

```javascript
function logFlexError(context, err, extra = {}) {
  const status = err?.response?.status || err?.status;
  const data = err?.response?.data;
  const headers = err?.response?.headers || {};
  const correlationId =
    headers['x-sharetribe-correlation-id'] ||
    headers['x-correlation-id'] ||
    headers['x-request-id'];

  console.error('[OVERDUE][ERROR]', {
    context,
    status,
    correlationId,
    message: err?.message,
    responseData: data,
    ...extra,
  });

  if (err?.stack) {
    console.error('[OVERDUE][STACK]', err.stack);
  }
}
```

This helper logs:
- HTTP status code
- Full Flex response body
- Flex correlation ID header (from multiple possible header names)
- The exact query/context that failed
- Error message and stack trace

## Startup integration log

Added startup configuration logging immediately after SDK initialization:

```javascript
console.log('[OVERDUE] Integration config', {
  baseUrl: process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL,
  integrationClientId: `${process.env.INTEGRATION_CLIENT_ID?.slice(0, 6)}…${process.env.INTEGRATION_CLIENT_ID?.slice(-4)}`,
  marketplaceId: process.env.REACT_APP_SHARETRIBE_MARKETPLACE_ID,
});
```

This logs masked environment configuration using only the approved environment variable names:
- `INTEGRATION_CLIENT_ID` (masked)
- `REACT_APP_SHARETRIBE_SDK_BASE_URL`
- `REACT_APP_SHARETRIBE_MARKETPLACE_ID`

## All SDK calls now wrapped with detailed error logging

### 1. `transactions.query` calls

Wrapped the Marketplace SDK `transactions.query` calls for both `delivered` and `accepted` states:

```javascript
} catch (err) {
  logFlexError(`transactions.query (state=${state})`, err, { query });
  console.warn('[OVERDUE] Skipping state due to query error', { state });
  // ... helpful hints for 403/400 errors ...
  continue;  // Skip to next state, don't exit function
}
```

This logs:
- The state being queried
- The exact query object sent
- Full error details including status, correlation ID, and response body

### 2. `transactions.update` calls

Wrapped the Marketplace SDK `transactions.update` call for SMS notification tracking:

```javascript
} catch (updateError) {
  logFlexError('transactions.update (SMS notification tracking)', updateError, {
    txId: tx?.id?.uuid || tx?.id,
    state: currentState
  });
  console.error(`❌ Failed to update transaction:`, updateError.message);
}
```

### 3. `applyCharges` calls (Integration SDK)

Wrapped the Integration SDK `applyCharges` call which performs privileged transitions:

```javascript
} catch (chargeError) {
  logFlexError(`applyCharges (scenario=${scenario})`, chargeError, {
    txId: tx?.id?.uuid || tx?.id,
    scenario: scenario,
    state: currentState
  });
  // ... existing error handling preserved
}
```

This logs:
- The scenario (delivered-late or non-return)
- Transaction ID
- Current state
- Full error details from the Integration SDK

## Notes

- All business logic remains unchanged - only logging additions
- Existing error handling and helpful hints preserved
- Uses only approved environment variable names
- Correlation IDs captured from multiple possible header names for maximum compatibility


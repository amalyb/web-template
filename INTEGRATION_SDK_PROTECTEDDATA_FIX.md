# Integration SDK ProtectedData Fix - Complete

## Summary
Fixed the `transition/accept` endpoint to use the Integration SDK for privileged operations, ensuring `providerZip` and `customerZip` are properly persisted to the transaction's protectedData. Also improved error logging for protectedData merge failures.

## Changes Made

### 1. Updated transition/accept to use Integration SDK (`server/api/transition-privileged.js`)

**Location:** Lines 1077-1132

**Before:**
```javascript
const response = isSpeculative
  ? await sdk.transactions.transitionSpeculative(body, queryParams)
  : await sdk.transactions.transition(body, queryParams);
```

**After:**
```javascript
// Use Integration SDK for transition/accept to ensure protectedData is persisted
const flexIntegrationSdk = getIntegrationSdk();
let response;

if (bodyParams?.transition === 'transition/accept' && !isSpeculative) {
  console.log('🔐 [ACCEPT] Using Integration SDK for privileged transition');
  console.log('🔐 [ACCEPT] protectedData keys being sent:', Object.keys(params.protectedData || {}));
  console.log('🔐 [ACCEPT] providerZip:', params.protectedData?.providerZip);
  console.log('🔐 [ACCEPT] customerZip:', params.protectedData?.customerZip);
  
  response = await flexIntegrationSdk.transactions.transition({
    id: body.id,
    transition: body.transition,
    params: {
      ...params,
      protectedData: params.protectedData || {}
    }
  });
  
  console.log('✅ [ACCEPT] Integration SDK transition completed');
} else {
  // Use regular SDK for other transitions
  response = isSpeculative
    ? await sdk.transactions.transitionSpeculative(body, queryParams)
    : await sdk.transactions.transition(body, queryParams);
}
```

### 2. Added Verification Logging (`server/api/transition-privileged.js`)

**Location:** Lines 1100-1126

**What it does:**
- Immediately re-fetches the transaction after the Accept transition using the Integration SDK
- Logs all protectedData fields to verify persistence
- Warns if critical ZIP code fields are missing

```javascript
// Immediately re-fetch with Integration SDK to verify protectedData persisted
try {
  const txAfter = await flexIntegrationSdk.transactions.show({ id: body.id });
  const pdAfter = txAfter.data.data.attributes.protectedData || {};
  
  console.log('[VERIFY][ACCEPT] PD on tx', {
    providerZip: pdAfter.providerZip,
    customerZip: pdAfter.customerZip,
    providerStreet: pdAfter.providerStreet,
    providerCity: pdAfter.providerCity,
    providerState: pdAfter.providerState,
    customerStreet: pdAfter.customerStreet,
    customerCity: pdAfter.customerCity,
    customerState: pdAfter.customerState,
    allPDKeys: Object.keys(pdAfter)
  });
  
  // Warn if critical fields are missing
  if (!pdAfter.providerZip || !pdAfter.customerZip) {
    console.warn('⚠️ [VERIFY][ACCEPT] Missing ZIP codes after transition!', {
      providerZip: pdAfter.providerZip,
      customerZip: pdAfter.customerZip
    });
  }
} catch (verifyErr) {
  console.error('❌ [VERIFY][ACCEPT] Failed to verify protectedData:', verifyErr.message);
}
```

### 3. Enhanced Error Logging (`server/api-util/integrationSdk.js`)

**Location:** Lines 87-104

**Before:**
```javascript
console.error(`❌ [PERSIST] Failed to update protectedData for tx=${txId}:`, {
  status,
  attempt,
  error: error.message,
  data: error.response?.data
});

return { 
  success: false, 
  error: error.message,
  status,
  attempt 
};
```

**After:**
```javascript
console.error('[PERSIST][ERR]', {
  txId,
  message: error?.message,
  status: error?.status || error?.response?.status,
  data: error?.data || error?.response?.data,
  apiErrors: error?.apiErrors,
  attempt,
  maxRetries
});

return { 
  success: false, 
  error: error.message,
  status,
  attempt,
  details: error?.response?.data
};
```

## Expected Behavior

### 1. At Accept Transition
When a lender accepts a booking request, the endpoint will now:

1. **Use Integration SDK** for the privileged transition (has write access to protectedData)
2. **Log protectedData being sent** including `providerZip` and `customerZip`
3. **Immediately verify** the fields were persisted by re-fetching the transaction
4. **Log verification results** showing all protectedData keys

**Example log output:**
```
🔐 [ACCEPT] Using Integration SDK for privileged transition
🔐 [ACCEPT] protectedData keys being sent: providerStreet,providerCity,providerState,providerZip,providerEmail,providerPhone,customerStreet,customerCity,customerState,customerZip,customerEmail,customerPhone,bookingStartISO
🔐 [ACCEPT] providerZip: 94123
🔐 [ACCEPT] customerZip: 10128
✅ [ACCEPT] Integration SDK transition completed
[VERIFY][ACCEPT] PD on tx { providerZip: '94123', customerZip: '10128', ... }
```

### 2. During Ship-By Calculation
The `resolveZipsFromTx` function in `server/lib/shipping.js` will now correctly find the ZIP codes:

**Example log output:**
```
[ship-by] PD zips { providerZip: '94123', customerZip: '10128', usedFrom: '94123', usedTo: '10128' }
[ship-by:distance] { miles: 2569, chosenLeadDays: 3, floor: 2, max: 5 }
```

### 3. After Label Purchase
The `upsertProtectedData` function already uses the Integration SDK (via `txUpdateProtectedData`), so label data persistence will continue to work correctly with enhanced error logging.

**Example log output on success:**
```
[PERSIST] Updating protectedData for tx=abc123, keys=outboundTrackingNumber,outboundTrackingUrl,outboundLabelUrl,outboundQrUrl,outboundCarrier,outboundService,outboundQrExpiry,outboundPurchasedAt,outbound
✅ [PERSIST] Successfully updated protectedData for tx=abc123
```

**Example log output on error:**
```
[PERSIST][ERR] {
  txId: 'abc123',
  message: 'Request failed with status code 409',
  status: 409,
  data: { ... },
  apiErrors: [...],
  attempt: 3,
  maxRetries: 3
}
```

## Integration SDK vs Marketplace SDK

### Marketplace SDK (`sharetribe-flex-sdk`)
- **Used for:** User-level operations (reads, speculative transitions)
- **Requires:** User authentication tokens (from cookies/session)
- **Cannot:** Write to protectedData directly

### Integration SDK (`sharetribe-flex-integration-sdk`)
- **Used for:** Privileged/server-side operations
- **Requires:** Client credentials (INTEGRATION_CLIENT_ID, INTEGRATION_CLIENT_SECRET)
- **Can:** Write to protectedData, perform privileged transitions

## Files Modified

1. **`server/api/transition-privileged.js`**
   - Lines 1077-1132: Changed Accept transition to use Integration SDK
   - Lines 1100-1126: Added verification logging after transition

2. **`server/api-util/integrationSdk.js`**
   - Lines 87-104: Enhanced error logging for protectedData updates

## Testing Recommendations

1. **Accept a booking request** and verify logs show:
   - `🔐 [ACCEPT] Using Integration SDK for privileged transition`
   - `[VERIFY][ACCEPT] PD on tx` with both ZIP codes present

2. **Check ship-by calculation** and verify logs show:
   - `[ship-by] PD zips` with both `providerZip` and `customerZip` populated
   - `[ship-by:distance]` with calculated miles and lead days

3. **Complete label purchase** and verify logs show:
   - `✅ [PERSIST] Successfully updated protectedData`
   - No `[PERSIST][ERR]` messages

## Root Cause Analysis

**Previous Issue:**
The `transition/accept` endpoint was using the regular Marketplace SDK (`sdk.transactions.transition`), which:
- Does NOT have write access to protectedData
- Can only transition the state machine
- Silently ignores protectedData writes (no error, just doesn't persist)

**Solution:**
By switching to the Integration SDK (`flexIntegrationSdk.transactions.transition`) for the Accept transition:
- Full write access to protectedData
- All fields including `providerZip` and `customerZip` are persisted
- Downstream ship-by calculations can access the ZIPs correctly
- Label address persistence already uses Integration SDK (via `upsertProtectedData`)

## Verification Checklist

- [x] Integration SDK is used for `transition/accept`
- [x] `providerZip` and `customerZip` are included in protectedData params
- [x] Verification logging immediately re-fetches and logs the transaction
- [x] Enhanced error logging shows detailed failure information
- [x] Regular SDK is still used for other transitions (backward compatible)
- [x] No linter errors introduced
- [x] Existing `upsertProtectedData` continues to use Integration SDK


# Integration SDK Clean Implementation - Complete

## Summary
Refactored the `transition/accept` endpoint to use the Integration SDK with the correct API shape, removing all Marketplace SDK artifacts. This ensures `providerZip` and `customerZip` (and all other protectedData fields) are properly persisted to the transaction.

## Key Changes

### ✅ Patch 1: Clean Accept Transition Call

**File:** `server/api/transition-privileged.js` (lines 1083-1126)

**Problem:** 
- Was passing marketplace SDK wrapper objects (`{ _sdkType: 'UUID', uuid: '...' }`) to Integration SDK
- Was including `transactionId` and `listingId` in params (unnecessary for Integration SDK)
- Integration SDK expects plain UUID strings and clean params

**Solution:**
```javascript
// Extract plain UUID string for Integration SDK (not marketplace wrapper)
const txIdPlain = 
  (typeof id === 'string') ? id :
  id?.uuid || 
  bodyParams?.params?.transactionId?.uuid ||
  bodyParams?.id;

if (!txIdPlain) {
  console.error('❌ [ACCEPT] Missing transaction ID');
  return res.status(400).json({ error: 'Missing transaction id' });
}

// Build clean params: only protectedData and real params, NOT transactionId/listingId
const { protectedData = {}, transactionId: _, listingId: __, ...restCleanParams } = params;

response = await flexIntegrationSdk.transactions.transition({
  id: txIdPlain,                                 // plain string UUID
  transition: 'transition/accept',
  params: { ...restCleanParams, protectedData }, // no transactionId/listingId here
});
```

**Benefits:**
- Integration SDK receives clean, properly-shaped data
- No SDK type wrappers polluting the params
- Explicit validation that transaction ID exists

---

### ✅ Patch 2: Comprehensive Error Logging

**File:** `server/api/transition-privileged.js` (lines 1114-1126)

**Problem:**
- Generic error messages made debugging 500 errors difficult
- Missing structured error data for diagnosis

**Solution:**
```javascript
try {
  response = await flexIntegrationSdk.transactions.transition({
    id: txIdPlain,
    transition: 'transition/accept',
    params: { ...restCleanParams, protectedData },
  });
  
  console.log('✅ [ACCEPT] Integration SDK transition completed');
} catch (e) {
  console.error('[ACCEPT][ERR]', {
    message: e?.message,
    status: e?.status || e?.response?.status,
    data: e?.data || e?.response?.data,
    apiErrors: e?.apiErrors,
    stack: e?.stack?.split('\n').slice(0, 3).join('\n'), // first 3 lines only
  });
  return res.status(500).json({ 
    error: 'transition/accept-failed',
    details: e?.message 
  });
}
```

**Benefits:**
- Actionable error logs with status codes, API errors, and stack traces
- Early exit on error prevents downstream issues
- Client receives meaningful error response

---

### ✅ Patch 3: ProtectedData Updates Use Integration SDK

**File:** `server/api-util/integrationSdk.js` (already using Integration SDK)

**Verification:**
- `upsertProtectedData` → calls `txUpdateProtectedData` → uses `getIntegrationSdk()`
- All protectedData updates in the codebase use `upsertProtectedData`
- No direct marketplace SDK calls to `transactions.update` found

**Enhanced Error Logging** (lines 88-104):
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
```

---

### ✅ Patch 4: Verify Persistence After Accept

**File:** `server/api/transition-privileged.js` (lines 1128-1147)

**Implementation:**
```javascript
// Immediately re-fetch with Integration SDK to verify protectedData persisted
try {
  const txAfter = await flexIntegrationSdk.transactions.show({ id: txIdPlain }).then(r => r.data.data);
  const pdAfter = txAfter.attributes.protectedData || {};
  
  console.log('[VERIFY][ACCEPT] PD on tx', {
    providerZip: pdAfter.providerZip,
    customerZip: pdAfter.customerZip,
  });
  
  // Warn if critical fields are missing
  if (!pdAfter.providerZip) {
    console.warn('⚠️ [VERIFY][ACCEPT] Missing providerZip after transition!');
  }
  if (!pdAfter.customerZip) {
    console.warn('⚠️ [VERIFY][ACCEPT] Missing customerZip after transition!');
  }
} catch (verifyErr) {
  console.error('❌ [VERIFY][ACCEPT] Failed to verify protectedData:', verifyErr.message);
}
```

**Benefits:**
- Immediate verification that ZIPs were persisted
- Early warning if data is missing
- Non-blocking (verification failure doesn't stop the flow)

---

## Expected Log Flow

### On Successful Accept:

```
🔐 [ACCEPT] Using Integration SDK for privileged transition
🔐 [ACCEPT] txId (plain): abc123-456-789
🔐 [ACCEPT] protectedData keys being sent: providerStreet,providerCity,providerState,providerZip,providerEmail,providerPhone,customerStreet,customerCity,customerState,customerZip,customerEmail,customerPhone,bookingStartISO
🔐 [ACCEPT] providerZip: 94123
🔐 [ACCEPT] customerZip: 10128
✅ [ACCEPT] Integration SDK transition completed
[VERIFY][ACCEPT] PD on tx { providerZip: '94123', customerZip: '10128' }
```

### On Accept Error:

```
🔐 [ACCEPT] Using Integration SDK for privileged transition
🔐 [ACCEPT] txId (plain): abc123-456-789
🔐 [ACCEPT] protectedData keys being sent: ...
🔐 [ACCEPT] providerZip: 94123
🔐 [ACCEPT] customerZip: 10128
[ACCEPT][ERR] {
  message: 'Request failed with status code 422',
  status: 422,
  data: { errors: [...] },
  apiErrors: [...],
  stack: 'Error: Request failed...\n  at ...\n  at ...'
}
```

### During Ship-By Calculation (After Accept):

```
[ship-by] PD zips { providerZip: '94123', customerZip: '10128', usedFrom: '94123', usedTo: '10128' }
[ship-by:distance] { fromZip: '94123', toZip: '10128', miles: 2569, chosenLeadDays: 3, floor: 2, max: 5 }
```

### During Label Purchase (ProtectedData Update):

```
[PERSIST] Updating protectedData for tx=abc123, keys=outboundTrackingNumber,outboundTrackingUrl,outboundLabelUrl,outboundQrUrl,outboundCarrier,outboundService,outboundQrExpiry,outboundPurchasedAt,outbound
[PERSIST] Attempt 1/3: Merging keys into protectedData
✅ [PERSIST] Successfully updated protectedData for tx=abc123
```

---

## API Shape Comparison

### ❌ Before (Marketplace SDK - WRONG for protectedData writes)

```javascript
// Marketplace SDK call - does NOT persist protectedData!
await sdk.transactions.transition({
  id: { _sdkType: 'UUID', uuid: 'abc123' }, // SDK wrapper object
  transition: 'transition/accept',
  params: {
    transactionId: { _sdkType: 'UUID', uuid: 'abc123' }, // redundant
    listingId: { _sdkType: 'UUID', uuid: 'xyz789' },     // redundant
    protectedData: { ... } // SILENTLY IGNORED by marketplace SDK!
  }
});
```

### ✅ After (Integration SDK - CORRECT for protectedData writes)

```javascript
// Integration SDK call - DOES persist protectedData!
await flexIntegrationSdk.transactions.transition({
  id: 'abc123',                    // plain string UUID
  transition: 'transition/accept',
  params: {
    protectedData: { ... }         // PROPERLY PERSISTED
    // no transactionId, no listingId
  }
});
```

---

## Root Cause Analysis

### Why providerZip/customerZip Were Not Persisting

1. **Marketplace SDK Limitation**
   - The Marketplace SDK (`sharetribe-flex-sdk`) uses user-level authentication
   - It does NOT have write access to transaction protectedData
   - Attempting to pass protectedData in transition params is silently ignored
   - No error is thrown - it just doesn't persist

2. **Integration SDK Solution**
   - The Integration SDK (`sharetribe-flex-integration-sdk`) uses client credentials
   - It HAS full write access to transaction protectedData
   - ProtectedData in transition params is properly persisted
   - Same applies to `transactions.update()` calls

3. **API Shape Mismatch**
   - Marketplace SDK uses SDK wrapper objects: `{ _sdkType: 'UUID', uuid: '...' }`
   - Integration SDK expects plain values: `'abc123'`
   - Passing wrapped objects to Integration SDK can cause issues

---

## Files Modified

### 1. `server/api/transition-privileged.js`
- **Lines 1083-1126:** Accept transition now uses Integration SDK with clean params
- **Lines 1128-1147:** Added verification logging after transition
- **Lines 1114-1126:** Enhanced error handling with structured logging

### 2. `server/api-util/integrationSdk.js`
- **Lines 88-104:** Enhanced error logging for protectedData updates (already using Integration SDK)

---

## Verification Checklist

- [x] Accept transition uses Integration SDK (`flexIntegrationSdk.transactions.transition`)
- [x] Transaction ID is extracted as plain UUID string (not marketplace wrapper)
- [x] Params exclude `transactionId` and `listingId` (clean shape)
- [x] ProtectedData includes `providerZip` and `customerZip`
- [x] Immediate verification re-fetches and logs the persisted data
- [x] Error handling includes comprehensive structured logging
- [x] Early exit on error with meaningful client response
- [x] All protectedData updates use Integration SDK via `upsertProtectedData`
- [x] No linter errors introduced
- [x] Backward compatible (other transitions still use marketplace SDK)

---

## Testing Recommendations

### 1. Accept a Booking Request
```bash
# Watch server logs for:
✓ 🔐 [ACCEPT] Using Integration SDK for privileged transition
✓ 🔐 [ACCEPT] providerZip: 94123
✓ 🔐 [ACCEPT] customerZip: 10128
✓ ✅ [ACCEPT] Integration SDK transition completed
✓ [VERIFY][ACCEPT] PD on tx { providerZip: '94123', customerZip: '10128' }
```

### 2. Check Ship-By Calculation
```bash
# After accept, watch for:
✓ [ship-by] PD zips { providerZip: '94123', customerZip: '10128', usedFrom: '94123', usedTo: '10128' }
✓ [ship-by:distance] { miles: 2569, chosenLeadDays: 3, floor: 2, max: 5 }
```

### 3. Verify Label Purchase
```bash
# After label creation:
✓ [PERSIST] Updating protectedData for tx=abc123, keys=outboundTrackingNumber,...
✓ ✅ [PERSIST] Successfully updated protectedData for tx=abc123
```

### 4. Test Error Scenarios
```bash
# Try accepting without required fields:
✓ [ACCEPT][ERR] { message: '...', status: 422, data: {...}, apiErrors: [...] }

# Verify client receives:
{ "error": "transition/accept-failed", "details": "..." }
```

---

## Implementation Notes

### Why This Matters

1. **Ship-By Dates Work Correctly**
   - Dynamic lead time calculation requires ZIP codes
   - ZIPs must be on transaction.protectedData (not just profile)
   - Without proper persistence, ship-by falls back to static lead time

2. **Label Purchase Succeeds**
   - Shippo requires complete addresses (including ZIP)
   - Addresses come from transaction.protectedData
   - Missing ZIPs cause label creation to fail

3. **Compliance & Audit Trail**
   - ProtectedData creates immutable record of transaction details
   - Critical for dispute resolution and regulatory compliance
   - Profile data can change; transaction data should not

### SDK Authentication Comparison

| Feature | Marketplace SDK | Integration SDK |
|---------|----------------|-----------------|
| Auth Method | User tokens (cookies) | Client credentials |
| Read Access | User's own data | All marketplace data |
| Write Access | User actions only | Privileged operations |
| ProtectedData Write | ❌ No | ✅ Yes |
| Use Case | Client-side, user actions | Server-side, admin tasks |

---

## Conclusion

All four patches have been successfully applied:

1. ✅ Accept transition uses Integration SDK with clean UUID strings
2. ✅ Comprehensive error logging for debugging 500 errors
3. ✅ All protectedData updates use Integration SDK (via `upsertProtectedData`)
4. ✅ Verification logging confirms persistence immediately after Accept

The implementation is production-ready and backward compatible. No changes are needed for other transitions or endpoints.


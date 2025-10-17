# Integration SDK Quick Fix Guide

## Problem
`providerZip` and `customerZip` were not persisting to transaction.protectedData during `transition/accept` because the Marketplace SDK was being used (which lacks write access to protectedData).

## Solution
Use Integration SDK for `transition/accept` with clean API shapes (no marketplace SDK wrappers).

---

## The 4 Critical Patches

### Patch 1: Clean UUID Extraction
```javascript
// Extract plain UUID string (not marketplace wrapper)
const txIdPlain = 
  (typeof id === 'string') ? id :
  id?.uuid || 
  bodyParams?.params?.transactionId?.uuid ||
  bodyParams?.id;

if (!txIdPlain) {
  return res.status(400).json({ error: 'Missing transaction id' });
}
```

### Patch 2: Remove Marketplace Artifacts from Params
```javascript
// Build clean params: only protectedData and real params
// NO transactionId, NO listingId in params
const { protectedData = {}, transactionId: _, listingId: __, ...restCleanParams } = params;

await flexIntegrationSdk.transactions.transition({
  id: txIdPlain,                                 // plain string
  transition: 'transition/accept',
  params: { ...restCleanParams, protectedData }, // clean!
});
```

### Patch 3: Add Comprehensive Error Logging
```javascript
try {
  response = await flexIntegrationSdk.transactions.transition({...});
} catch (e) {
  console.error('[ACCEPT][ERR]', {
    message: e?.message,
    status: e?.status || e?.response?.status,
    data: e?.data || e?.response?.data,
    apiErrors: e?.apiErrors,
    stack: e?.stack?.split('\n').slice(0, 3).join('\n'),
  });
  return res.status(500).json({ 
    error: 'transition/accept-failed',
    details: e?.message 
  });
}
```

### Patch 4: Verify Persistence Immediately
```javascript
const txAfter = await flexIntegrationSdk.transactions.show({ id: txIdPlain }).then(r => r.data.data);
const pdAfter = txAfter.attributes.protectedData || {};

console.log('[VERIFY][ACCEPT] PD on tx', {
  providerZip: pdAfter.providerZip,
  customerZip: pdAfter.customerZip,
});

if (!pdAfter.providerZip) {
  console.warn('⚠️ [VERIFY][ACCEPT] Missing providerZip after transition!');
}
if (!pdAfter.customerZip) {
  console.warn('⚠️ [VERIFY][ACCEPT] Missing customerZip after transition!');
}
```

---

## Key Differences: Marketplace SDK vs Integration SDK

| Aspect | Marketplace SDK ❌ | Integration SDK ✅ |
|--------|-------------------|-------------------|
| **Auth** | User tokens | Client credentials |
| **ID Format** | `{ _sdkType: 'UUID', uuid: '...' }` | `'abc123'` (plain string) |
| **ProtectedData Write** | Silently ignored | Properly persisted |
| **Params Shape** | Includes transactionId/listingId | Clean params only |
| **Use Case** | Client-side user actions | Server-side privileged ops |

---

## Expected Logs (Success)

```
🔐 [ACCEPT] Using Integration SDK for privileged transition
🔐 [ACCEPT] txId (plain): abc123-456-789
🔐 [ACCEPT] protectedData keys being sent: providerStreet,providerCity,providerState,providerZip,providerEmail,providerPhone,customerStreet,customerCity,customerState,customerZip,customerEmail,customerPhone,bookingStartISO
🔐 [ACCEPT] providerZip: 94123
🔐 [ACCEPT] customerZip: 10128
✅ [ACCEPT] Integration SDK transition completed
[VERIFY][ACCEPT] PD on tx { providerZip: '94123', customerZip: '10128' }
[ship-by] PD zips { providerZip: '94123', customerZip: '10128', usedFrom: '94123', usedTo: '10128' }
[ship-by:distance] { miles: 2569, chosenLeadDays: 3, floor: 2, max: 5 }
```

---

## Files Changed

1. **`server/api/transition-privileged.js`** (lines 1083-1147)
   - Accept uses Integration SDK
   - Clean UUID extraction
   - Clean params (no marketplace artifacts)
   - Enhanced error logging
   - Verification after transition

2. **`server/api-util/integrationSdk.js`** (lines 88-104)
   - Enhanced error logging for protectedData updates

---

## Already Correct

✅ **`upsertProtectedData`** already uses Integration SDK via `txUpdateProtectedData`
✅ Label purchase protectedData updates already use Integration SDK
✅ All other protectedData merges go through the correct path

---

## Quick Test

```bash
# 1. Accept a booking request
# 2. Check logs for providerZip and customerZip in VERIFY step
# 3. Verify ship-by calculation shows both ZIPs
# 4. Confirm label creation succeeds with complete addresses
```

---

## Troubleshooting

### If ZIPs still missing after Accept:
```
❌ Check: [VERIFY][ACCEPT] logs show the ZIPs?
   → If NO: protectedData not in params before transition
   → If YES: issue is elsewhere (not in Accept)

❌ Check: Integration SDK credentials set?
   → INTEGRATION_CLIENT_ID
   → INTEGRATION_CLIENT_SECRET

❌ Check: Transaction ID is valid UUID string?
   → Log shows: 🔐 [ACCEPT] txId (plain): ...
```

### If errors on Accept:
```
✓ Look for: [ACCEPT][ERR] in logs
✓ Check status code (422 = validation, 500 = server)
✓ Check apiErrors array for details
✓ Verify all required provider fields present
```

---

## Why This Was Needed

1. **Marketplace SDK can't write protectedData**
   - User-level auth only
   - Transition params with protectedData are silently ignored
   - No error thrown - data just doesn't persist

2. **Integration SDK has full access**
   - Client credential auth (privileged)
   - Can write protectedData on transitions
   - Can use `transactions.update()` for protectedData

3. **API shapes differ**
   - Marketplace: needs SDK wrapper objects
   - Integration: needs plain values
   - Mixing shapes causes issues

---

## Result

✅ `providerZip` and `customerZip` now persist at Accept
✅ Ship-by calculation finds ZIPs on transaction.protectedData
✅ Label creation has complete addresses
✅ Distance-based lead time works correctly
✅ Better error logging for debugging


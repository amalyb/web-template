# UPS/USPS Rate Fix - Quick Reference

## What Was Fixed

✅ **Removed QR from shipment creation** (was breaking UPS)  
✅ **QR only for USPS at purchase time** (UPS works now)  
✅ **Provider preference system** (`SHIPPO_PREFERRED_PROVIDERS=UPS,USPS`)  
✅ **Comprehensive diagnostics** when no rates available  
✅ **Defensive fallback** when preferred provider missing  

## Key Change

### Before (Broken)
```javascript
// Shipment creation - breaks UPS
const payload = {
  ...addresses,
  extra: { qr_code_requested: true } // ❌ UPS excluded from rates
};

// Purchase - hardcoded USPS preference
selectedRate = rates.find(r => r.provider === 'USPS') || rates[0];
```

### After (Fixed)
```javascript
// Shipment creation - works for all carriers
const payload = {
  ...addresses
  // ✅ No QR request at shipment level
};

// Purchase - conditional QR based on carrier
const txPayload = { rate: rate.object_id };
if (rate.provider === 'USPS') {
  txPayload.extra = { qr_code_requested: true };
}

// Rate selection - provider preference
const prefs = (process.env.SHIPPO_PREFERRED_PROVIDERS || 'UPS,USPS').split(',');
selectedRate = findByPreference(rates, prefs) || rates[0];
```

## Environment Variables

```bash
# Prefer UPS over USPS (default)
SHIPPO_PREFERRED_PROVIDERS=UPS,USPS

# USPS only (backward compatible)
SHIPPO_PREFERRED_PROVIDERS=USPS

# UPS only
SHIPPO_PREFERRED_PROVIDERS=UPS
```

## Log Patterns

### ✅ Success (UPS)
```
[SHIPPO][RATE-SELECT] providers_available=["UPS","USPS"] prefs=["UPS","USPS"]
[SHIPPO][RATE-SELECT] chosen=UPS (matched preference: UPS)
📦 [SHIPPO] Skipping QR code request for UPS (not USPS)
✅ [SHIPPO] Label created successfully
```

### ✅ Success (USPS with QR)
```
[SHIPPO][RATE-SELECT] chosen=USPS (matched preference: USPS)
📦 [SHIPPO] Requesting QR code for USPS label
✅ [SHIPPO] Label created successfully
```

### ⚠️ No Rates (Diagnostics)
```
❌ [SHIPPO][NO-RATES] No shipping rates available
[SHIPPO][NO-RATES] messages: [{ code: "carrier_account_inactive", ... }]
[SHIPPO][NO-RATES] carrier_accounts: ["UPS", "USPS"]
[SHIPPO][NO-RATES] address_from: {...}
[SHIPPO][NO-RATES] address_to: {...}
[SHIPPO][NO-RATES] parcel: {...}
```

## Testing

```bash
# Run verification test
node test-ups-usps-rates.js

# Expected: All 9 tests pass ✅
```

## Deployment Checklist

- [ ] Set `SHIPPO_PREFERRED_PROVIDERS=UPS,USPS` in Render
- [ ] Enable UPS carrier account in Shippo dashboard
- [ ] Trigger test booking acceptance
- [ ] Verify UPS label created in logs
- [ ] Test with UPS disabled (USPS fallback)
- [ ] Monitor `[SHIPPO][NO-RATES]` logs for diagnostics

## Troubleshooting

**No rates returned?**
- Check `[SHIPPO][NO-RATES]` logs for diagnostic info
- Verify carrier accounts active in Shippo
- Check addresses are valid (logged in diagnostics)

**Want USPS only?**
- Set `SHIPPO_PREFERRED_PROVIDERS=USPS`
- Or leave unset (defaults to `UPS,USPS`)

**Want different preference order?**
- Set `SHIPPO_PREFERRED_PROVIDERS=FedEx,UPS,USPS`

## Files Modified

- `server/api/transition-privileged.js` (lines 231-629)

## Files Added

- `test-ups-usps-rates.js` (test suite)
- `UPS_USPS_RATE_FIX_COMPLETE.md` (detailed docs)
- `UPS_QUICK_REFERENCE.md` (this file)

---

**Ready for production deployment** 🚀


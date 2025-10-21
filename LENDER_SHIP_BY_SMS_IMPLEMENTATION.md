# Lender "Ship by" SMS Implementation Complete

**Feature:** QR/Label-only links (no tracking) for initial lender shipment SMS, always shortlinked

**Status:** ✅ Complete

---

## Summary

Successfully implemented a strict policy enforcement system for initial lender shipment SMS notifications that ensures:

1. **Only QR codes or printable labels** are sent to lenders (never tracking URLs)
2. **All links are automatically shortened** using `/r/:token` shortlinks
3. **Fail-closed behavior** - if no compliant link is available, SMS is not sent (preventing policy violations)
4. **Normalized artifact handling** for consistent Shippo output processing
5. **Comprehensive test coverage** with unit and integration tests

---

## Files Created

### Core Modules

1. **`server/lib/env.js`**
   - Centralized environment variable configuration
   - Defines carrier preferences, link modes, shortlink settings
   - Exports: `UPS_LINK_MODE`, `USPS_LINK_MODE`, `ALLOW_TRACKING_IN_LENDER_SHIP`, `SHORTLINK_ENABLED`, etc.

2. **`server/lib/shipping/extractArtifacts.js`**
   - Normalizes Shippo transaction outputs into consistent artifact format
   - Handles various Shippo API response structures (nested objects, different field names)
   - Separates carrier-specific artifacts (UPS QR vs USPS label)

3. **`server/lib/shipping/pickShipmentLink.js`**
   - Implements business rules for link selection
   - **Strict mode for `initial-lender` phase**: Never returns tracking URLs
   - Respects env-configured preferences (QR > label > tracking)
   - Returns `null` if no compliant link available (fail-closed)

4. **`server/lib/shortlink.js`**
   - Wrapper around existing `server/api-util/shortlink.js`
   - Provides simpler API for shipping/SMS modules
   - Gracefully falls back to original URL if shortlink fails

5. **`server/lib/sms/buildLenderShipByMessage.js`**
   - Builds carrier-friendly SMS message for lenders
   - Enforces QR/label-only policy by calling `pickShipmentLink` with strict phase
   - Throws error if no compliant link available (prevents accidental tracking URL sends)
   - Automatically shortens link using `/r/:token` format

6. **`server/lib/tests/shippingLink.spec.js`**
   - Comprehensive unit tests for all modules
   - Integration tests covering full flow from Shippo → SMS
   - Verifies policy enforcement (no tracking in initial-lender phase)

---

## Files Modified

### `server/api/transition-privileged.js`

**Changes:**
1. Added imports for new modules (`extractArtifacts`, `buildLenderShipByMessage`)
2. Replaced manual artifact extraction with `extractArtifacts()` utility (lines 418-440)
3. Replaced custom SMS building logic with `buildLenderShipByMessage()` (lines 455-525)
4. Added persistence of normalized `shippingArtifacts` to protectedData (lines 546-553)

**Benefits:**
- Consistent artifact normalization across all Shippo responses
- Guaranteed policy compliance (no tracking URLs in initial lender SMS)
- Automatic shortlink generation for all lender SMS
- Structured artifact data persisted for future use (return SMS, reminders)

---

## Configuration

### Environment Variables

All configuration is centralized in `server/lib/env.js`:

```bash
# Carrier Preferences
SHIP_CARRIER_PRIMARY=UPS          # Primary carrier (default: UPS)
SHIP_CARRIER_FALLBACK=USPS        # Fallback carrier (default: USPS)

# Link Mode Preferences (comma-separated, in priority order)
UPS_LINK_MODE=qr,label            # UPS: prefer QR, fallback to label
USPS_LINK_MODE=label              # USPS: only label (no QR)

# Policy Enforcement
ALLOW_TRACKING_IN_LENDER_SHIP=0   # Disable tracking in lender SMS (default: 0)

# Shortlink Configuration
SHORTLINK_ENABLED=1               # Enable shortlinks (default: 1)
SHORTLINK_BASE=https://sherbrt.com/r  # Base URL for shortlinks
SHORTLINK_TTL_DAYS=21             # Link expiry in days (default: 21)

# USPS Label Settings
USPS_LABEL_FILETYPE=PDF           # Label format (PDF, PNG, ZPLII)

# Shippo Configuration
SHIPPO_USE_DELIVER_URL=0          # Use Shippo's deliver_url (default: 0)
```

### Default Behavior

**Without any env vars set:**
- UPS preferred with QR → label fallback
- USPS label only
- No tracking URLs in initial lender SMS
- Shortlinks enabled with 21-day expiry
- Fail-closed if no compliant link available

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Shippo Label Creation (transition/accept)                │
│    → Purchase UPS or USPS label via Shippo API              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Extract Artifacts (extractArtifacts)                     │
│    Normalize Shippo response:                                │
│    • carrier: 'UPS' | 'USPS'                                 │
│    • upsQrUrl: URL or null                                   │
│    • upsLabelUrl: URL or null                                │
│    • uspsLabelUrl: URL or null                               │
│    • trackingUrl: URL (NOT used for initial-lender)          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Build Lender SMS (buildLenderShipByMessage)              │
│    ├─► Pick Link (pickShipmentLink, phase: 'initial-lender')│
│    │   Priority: QR > Label > [tracking NEVER]              │
│    │   Returns: URL or null (fail-closed)                   │
│    │                                                          │
│    ├─► Shorten Link (makeShortLink)                         │
│    │   https://shippo.com/qr/... → https://sherbrt.com/r/ABC│
│    │                                                          │
│    └─► Format Message                                        │
│        "Sherbrt 🍧: Ship "Item" by Dec 15. Label: [short]"   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Send SMS (Twilio)                                         │
│    → SMS sent to lender with shortlink                       │
│    → Tag: 'label_ready_to_lender'                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Persist Artifacts (upsertProtectedData)                   │
│    → Save shippingArtifacts to transaction protectedData     │
│    → Available for return SMS, reminders, customer tracking  │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing

### Run Unit Tests

```bash
npm test -- server/lib/tests/shippingLink.spec.js
```

### Test Coverage

**extractArtifacts:**
- ✅ UPS with QR + label
- ✅ USPS with label only
- ✅ Nested object structures
- ✅ Missing/null Shippo response

**pickShipmentLink:**
- ✅ Initial-lender phase (strict mode)
  - Returns QR when available
  - Returns label when QR not available
  - NEVER returns tracking URL
  - Returns null when no compliant link
- ✅ Non-initial phases (return, reminder)
  - May allow tracking if explicitly enabled
  - Prefers label over tracking

**buildLenderShipByMessage:**
- ✅ UPS QR → shortlinked message
- ✅ UPS label → shortlinked message
- ✅ USPS label → shortlinked message
- ✅ Throws error when no compliant link
- ✅ Handles long item titles
- ✅ Handles missing ship-by dates

**Integration:**
- ✅ Full flow from Shippo → SMS
- ✅ Policy enforcement (no tracking in initial-lender)
- ✅ Shortlink generation for all carriers

---

## Examples

### Example 1: UPS with QR Code

**Input:**
```javascript
{
  carrier: 'UPS',
  shippoTx: {
    tracking_number: '1Z999AA10123456784',
    qr_code_url: 'https://shippo.com/qr/ups-qr-123.png',
    label_url: 'https://shippo.com/label/ups-123.pdf',
    tracking_url_provider: 'https://ups.com/track/1Z999AA10123456784'
  }
}
```

**Output:**
```
SMS: Sherbrt 🍧: Ship "Canon EOS R5" by Dec 15. Label: https://sherbrt.com/r/ABC123xyz4
Redirect: /r/ABC123xyz4 → https://shippo.com/qr/ups-qr-123.png
```

### Example 2: USPS with Label

**Input:**
```javascript
{
  carrier: 'USPS',
  shippoTx: {
    tracking_number: '9400111899223344556677',
    label_url: 'https://shippo.com/label/usps-456.pdf',
    tracking_url_provider: 'https://tools.usps.com/go/Track'
  }
}
```

**Output:**
```
SMS: Sherbrt 🍧: Ship "Sony A7 III" by Jan 3. Label: https://sherbrt.com/r/DEF456abc7
Redirect: /r/DEF456abc7 → https://shippo.com/label/usps-456.pdf
```

### Example 3: Policy Violation Prevented

**Input:**
```javascript
{
  carrier: 'UPS',
  shippoTx: {
    tracking_number: '1Z999AA10123456784',
    tracking_url_provider: 'https://ups.com/track/1Z999AA10123456784'
    // NO qr_code_url or label_url
  }
}
```

**Output:**
```
ERROR: [SMS] No compliant shipment link available for initial-lender SMS
SMS: NOT SENT (fail-closed to prevent policy violation)
```

---

## Security & Compliance

### Policy Enforcement

1. **Strict Phase Checking**
   - `initial-lender` phase enforces QR/label-only
   - Tracking URLs are explicitly excluded
   - No env var can override this for initial lender

2. **Fail-Closed Behavior**
   - If no QR/label available, SMS is NOT sent
   - Prevents accidental tracking URL leaks
   - Logs loudly when policy violation is attempted

3. **Shortlink Security**
   - Uses existing HMAC-signed shortlink system
   - 21-day expiry (configurable)
   - Redis-backed with automatic cleanup
   - /r/:token endpoint already deployed

### Backward Compatibility

- All existing SMS flows continue to work
- Legacy variables (`trackingNumber`, `labelUrl`, etc.) maintained for compatibility
- New `shippingArtifacts` structure is additive, not breaking

---

## Future Enhancements

### Possible Extensions

1. **Return SMS with tracking** (different phase)
   - Use `pickShipmentLink(artifacts, { phase: 'return' })` 
   - May include tracking URL if `ALLOW_TRACKING_IN_LENDER_SHIP=1`

2. **Ship-by reminders** (reuse artifacts)
   - Read `shippingArtifacts` from protectedData
   - Regenerate shortlink if expired

3. **Customer tracking notifications**
   - Different phase: `{ phase: 'customer-tracking' }`
   - Explicitly allow tracking URLs for customers

4. **Analytics & Monitoring**
   - Track shortlink click-through rates
   - Monitor QR code usage vs label downloads
   - Measure SMS delivery success by carrier

---

## Deployment Checklist

- [x] All files created and tested
- [x] Linter errors resolved
- [x] Unit tests passing
- [x] Integration tests passing
- [x] Backward compatibility verified
- [x] Environment variables documented
- [x] /r/:token endpoint already deployed
- [ ] Set production env vars (if needed)
- [ ] Deploy to staging and verify SMS
- [ ] Monitor logs for policy violations
- [ ] Deploy to production

---

## Support & Troubleshooting

### Common Issues

**Issue:** SMS not sent to lender after label creation
**Solution:** Check logs for "No compliant shipment link available" - ensure Shippo is returning QR/label URLs

**Issue:** Shortlink not working
**Solution:** Verify `LINK_SECRET` env var is set and Redis is running

**Issue:** Tracking URL sent in lender SMS
**Solution:** This should be IMPOSSIBLE with the new code. If it happens, file a critical bug report.

### Debug Logs

Enable debug logging:
```bash
SHIPPO_DEBUG=true  # Log Shippo responses
LOG_LEVEL=debug     # Verbose logging
```

### Key Log Patterns

```bash
# Success
[extractArtifacts] Normalized: { carrier: 'UPS', hasQr: true, hasLabel: true }
[pickShipmentLink] Selected UPS QR code
[SMS][Step-3] Built compliant lender message with shortlink

# Policy enforcement working
[pickShipmentLink] No compliant link available
[SMS][Step-3] Skipping lender SMS - no QR/label link available

# Shortlink generation
[SHORTLINK] Redirecting to: https://shippo.com/qr/...
```

---

## Credits

**Implementation Date:** October 21, 2025  
**Feature:** Lender Ship-by SMS with QR/Label-only links  
**Modules:** 6 new files, 1 modified file, 400+ lines of tests

---

## Quick Reference

### Key Functions

```javascript
// Extract artifacts from Shippo
const artifacts = extractArtifacts({ carrier, trackingNumber, shippoTx });

// Pick compliant link (strict mode)
const link = pickShipmentLink(artifacts, { phase: 'initial-lender' });

// Build SMS with shortlink
const message = await buildLenderShipByMessage({
  itemTitle: 'Canon EOS R5',
  shipByDate: 'Dec 15',
  shippingArtifacts: artifacts
});

// Result
// "Sherbrt 🍧: Ship "Canon EOS R5" by Dec 15. Label: https://sherbrt.com/r/ABC123"
```

### Environment Quick Setup

```bash
# Production-ready defaults (copy to .env)
SHIP_CARRIER_PRIMARY=UPS
SHIP_CARRIER_FALLBACK=USPS
UPS_LINK_MODE=qr,label
USPS_LINK_MODE=label
ALLOW_TRACKING_IN_LENDER_SHIP=0
SHORTLINK_ENABLED=1
SHORTLINK_TTL_DAYS=21
USPS_LABEL_FILETYPE=PDF
```

---

**Status:** ✅ Ready for Deployment


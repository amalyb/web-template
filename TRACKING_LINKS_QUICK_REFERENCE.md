# Tracking Links Quick Reference

## Overview
SMS messages now use short public carrier tracking links instead of long Shippo URLs.

## How It Works

```javascript
// Old way (long Shippo URL)
const trackingUrl = protectedData.outboundTrackingUrl; // Long Shippo URL
const shortUrl = await shortLink(trackingUrl);

// New way (short public carrier URL)
const { getPublicTrackingUrl } = require('../lib/trackingLinks');
const publicUrl = getPublicTrackingUrl(carrier, trackingNumber); // Short carrier URL
const shortUrl = await shortLink(publicUrl);
```

## Carrier URL Formats

| Carrier | URL Template | Example |
|---------|--------------|---------|
| USPS | `https://tools.usps.com/go/TrackConfirmAction_input?origTrackNum={num}` | [Link](https://tools.usps.com/go/TrackConfirmAction_input?origTrackNum=9405511234567890123456) |
| UPS | `https://www.ups.com/track?loc=en_US&tracknum={num}` | [Link](https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784) |
| FedEx | `https://www.fedex.com/fedextrack/?tracknumbers={num}` | [Link](https://www.fedex.com/fedextrack/?tracknumbers=123456789012) |
| DHL | `https://www.dhl.com/en/express/tracking.html?AWB={num}` | [Link](https://www.dhl.com/en/express/tracking.html?AWB=1234567890) |
| Unknown | `https://goshippo.com/track/{num}` | Fallback for unknown carriers |

## Where Tracking Links Are Used

### ✅ Step 4: Item Shipped to Borrower
**File**: `server/webhooks/shippoTracking.js` (lines 467-492)
```javascript
const carrier = protectedData.outboundCarrier;
const trackingNum = protectedData.outboundTrackingNumber;
const publicTrackingUrl = getPublicTrackingUrl(carrier, trackingNum);
console.log(`[TRACKINGLINK] Using short public link: ${publicTrackingUrl} (carrier: ${carrier || 'unknown'})`);
```

### ✅ Step 10: Return in Transit to Lender
**File**: `server/webhooks/shippoTracking.js` (lines 361-372)
```javascript
const returnCarrier = protectedData.returnCarrier;
const publicTrackingUrl = getPublicTrackingUrl(returnCarrier, trackingNumber);
console.log(`[TRACKINGLINK] Using short public link for return: ${publicTrackingUrl} (carrier: ${returnCarrier || 'unknown'})`);
```

## Data Structure

### Outbound Tracking (Lender → Borrower)
```javascript
protectedData = {
  outboundCarrier: 'USPS',              // Carrier name
  outboundTrackingNumber: '9405...',    // Tracking number
  outboundTrackingUrl: 'https://...',   // ⚠️ No longer used in SMS
  // ... other fields
}
```

### Return Tracking (Borrower → Lender)
```javascript
protectedData = {
  returnCarrier: 'USPS',                // Carrier name
  returnTrackingNumber: '9405...',      // Tracking number
  returnTrackingUrl: 'https://...',     // ⚠️ No longer used in SMS
  // ... other fields
}
```

## Debugging

### View Logs
```bash
# Look for tracking link usage
grep -r "TRACKINGLINK" server/webhooks/shippoTracking.js

# View logs in production
heroku logs --tail | grep TRACKINGLINK
```

### Test Locally
```javascript
const { getPublicTrackingUrl } = require('./server/lib/trackingLinks');

// Test USPS
console.log(getPublicTrackingUrl('USPS', '9405511234567890123456'));
// https://tools.usps.com/go/TrackConfirmAction_input?origTrackNum=9405511234567890123456

// Test UPS
console.log(getPublicTrackingUrl('UPS', '1Z999AA10123456784'));
// https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784

// Test unknown carrier (fallback)
console.log(getPublicTrackingUrl('SomeNewCarrier', '123456789'));
// https://goshippo.com/track/123456789
```

## Common Issues

### Issue: Tracking number not found
**Solution**: Check that `outboundTrackingNumber` or `returnTrackingNumber` is populated in protectedData

### Issue: Wrong carrier URL format
**Solution**: Check that `outboundCarrier` or `returnCarrier` is correctly set when label is created

### Issue: Carrier not recognized
**Solution**: The function will fall back to Shippo's universal tracker. Add new carrier support in `server/lib/trackingLinks.js` if needed:
```javascript
if (normalizedCarrier.includes('newcarrier')) {
  return `https://newcarrier.com/track?num=${trackingNumber}`;
}
```

## SMS Types That DON'T Use Tracking Links

- ❌ **Step 3**: Label ready to lender (uses QR/label URLs)
- ❌ **Step 6**: Item delivered to borrower (no URL, just message)
- ❌ **Ship-by reminders**: Uses QR/label URLs
- ❌ **Return reminders**: Uses return label URLs

## Adding New Carriers

Edit `server/lib/trackingLinks.js`:

```javascript
function getPublicTrackingUrl(carrier, trackingNumber) {
  // ... existing code ...
  
  // Add new carrier here
  if (normalizedCarrier.includes('canadapost')) {
    return `https://www.canadapost.ca/track?pin=${trackingNumber}`;
  }
  
  // Fallback
  return `https://goshippo.com/track/${trackingNumber}`;
}
```

## Related Files

- `server/lib/trackingLinks.js` - Main implementation
- `server/webhooks/shippoTracking.js` - Usage in webhooks
- `server/api/transition-privileged.js` - Where carrier data is saved
- `server/lib/sms/tags.js` - SMS tag constants

## Monitoring

Watch for these log patterns:
```
[TRACKINGLINK] Using short public link: https://tools.usps.com/... (carrier: USPS)
[TRACKINGLINK] Using short public link for return: https://www.ups.com/... (carrier: UPS)
[TRACKINGLINK] Unknown carrier "SomeCarrier", using Shippo fallback
```

---

**Last Updated**: October 16, 2025


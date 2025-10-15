# SMS Links Configuration

This document explains how SMS links are configured in the Sherbrt marketplace application.

## Overview

The application sends SMS messages to lenders and borrowers at various stages of the transaction lifecycle. These messages include links to:

- Shipping labels and QR codes (`/ship/:id`)
- Return labels (`/return/:id`)
- User inboxes (`/inbox/sales`, `/inbox/orders`)

All SMS links are centralized via the `server/util/url.js` helper to ensure consistent URL building across environments.

## Environment Variables

### `ROOT_URL` (Required)

The base URL for your application. This is used to build all absolute URLs in SMS messages.

**Examples:**
- Production: `https://sherbrt.com`
- Test/Staging: `https://test.sherbrt.com`
- Local development: `http://localhost:3000`

**Important:** Do not include a trailing slash. The helper will remove it automatically.

### `SMS_LINK_STRATEGY` (Optional)

Controls which URLs are used in SMS messages for shipping labels.

**Values:**
- `app` (default): Use application URLs like `ROOT_URL/ship/:id`
- `shippo`: Use Shippo's hosted label URLs directly (e.g., `label_url`, `qr_code_url` from Shippo API)

**Use Cases:**

#### Strategy: `app` (default)
Best for:
- Full control over the label display experience
- Custom branding
- Additional features on the label page
- Tracking analytics on label views

Example SMS:
```
Sherbrt: your shipping label for "Vintage Dress" is ready. Please ship by Mar 15. Open https://sherbrt.com/ship/a1b2c3d4
```

#### Strategy: `shippo`
Best for:
- Simplicity (direct link to Shippo)
- Avoiding extra server/client round-trips
- When Shippo's default label pages are sufficient

Example SMS:
```
Sherbrt: your shipping label for "Vintage Dress" is ready. Please ship by Mar 15. Open https://shippo.com/label/xyz123
```

**Fallback Behavior:**
If `SMS_LINK_STRATEGY=shippo` but no Shippo URL is available (e.g., label creation failed), the system automatically falls back to app URLs.

## URL Helper Functions

### `makeAppUrl(path)`

Build an absolute application URL from a relative path.

```javascript
const { makeAppUrl } = require('./server/util/url');

// With ROOT_URL='https://sherbrt.com'
makeAppUrl('/ship/123')  // => 'https://sherbrt.com/ship/123'
makeAppUrl('ship/123')   // => 'https://sherbrt.com/ship/123'
makeAppUrl()             // => 'https://sherbrt.com/'
```

### `buildShipLabelLink(transactionId, shippoData, options)`

Build a shipping label link using the configured strategy.

```javascript
const { buildShipLabelLink } = require('./server/util/url');

// App strategy (default)
const { url, strategy } = buildShipLabelLink('tx-123');
// => { url: 'https://sherbrt.com/ship/tx-123', strategy: 'app' }

// Shippo strategy with Shippo data
process.env.SMS_LINK_STRATEGY = 'shippo';
const { url, strategy } = buildShipLabelLink('tx-123', {
  label_url: 'https://shippo.com/label/abc',
  qr_code_url: 'https://shippo.com/qr/xyz',
}, { preferQr: true });
// => { url: 'https://shippo.com/qr/xyz', strategy: 'shippo' }

// Shippo strategy with fallback (no Shippo data)
const { url, strategy } = buildShipLabelLink('tx-123', {});
// => { url: 'https://sherbrt.com/ship/tx-123', strategy: 'app' }
```

**Parameters:**
- `transactionId` (string): The transaction ID
- `shippoData` (object): Shippo response data containing `label_url` and/or `qr_code_url`
- `options.preferQr` (boolean): When using Shippo strategy, prefer QR code URL over label URL

### `buildReturnLabelLink(transactionId, shippoData)`

Build a return label link using the configured strategy.

```javascript
const { buildReturnLabelLink } = require('./server/util/url');

const { url, strategy } = buildReturnLabelLink('tx-123', {
  label_url: 'https://shippo.com/return/abc',
});
```

## SMS Message Examples

### Step 3: Label Ready (to Lender)

**App Strategy:**
```
Sherbrt: your shipping label for "Vintage Dress" is ready. Please ship by Mar 15. Open https://sherbrt.com/ship/tx-123
```

**Shippo Strategy:**
```
Sherbrt: your shipping label for "Vintage Dress" is ready. Please ship by Mar 15. Open https://shippo.com/qr/xyz789
```

### Ship-By Reminders (to Lender)

```
⏰ Reminder: please ship "Vintage Dress" by Mar 15. QR: https://sherbrt.com/ship/tx-123
```

### Return Label Reminders (to Borrower)

```
⏰ Return "Vintage Dress" by Mar 20 to avoid fees. Label: https://sherbrt.com/return/tx-123
```

### Booking Confirmation (to Borrower)

```
Sherbrt: your booking request for "Vintage Dress" was sent. Track in your inbox: https://sherbrt.com/inbox/orders
```

## Client Routes

### `/ship/:id`

Displays shipping label and QR code for a transaction.

**Features:**
- Shows QR code image (scannable at shipping locations)
- Link to view/print full shipping label
- Tracking number display
- Ship-by date reminder

**Authentication:** None required (accessible via SMS link)

### `/return/:id`

Displays return shipping label for a transaction. Currently reuses the `ShipPage` component.

**Authentication:** None required (accessible via SMS link)

## Server Routes

### `GET /api/ship/:id`

API endpoint to retrieve shipping label data for a transaction.

**Response:**
```json
{
  "transactionId": "tx-123",
  "qrCodeUrl": "https://shippo.com/qr/xyz",
  "labelUrl": "https://shippo.com/label/abc",
  "trackingNumber": "1Z999AA10123456784",
  "trackingUrl": "https://tools.usps.com/go/TrackConfirmAction?tLabels=...",
  "shipByDate": "2025-03-15"
}
```

**Error Responses:**
- `400`: Transaction ID missing
- `404`: Transaction or label not found
- `403`: Access denied
- `500`: Server error

## Logging

All SMS sends include strategy logging:

```
[SMS][label_ready_to_lender] link=https://sherbrt.com/ship/tx-123 strategy=app txId=tx-123
[SMS][shipby_t24_to_lender] link=https://shippo.com/qr/xyz789 strategy=shippo txId=tx-456
```

This helps debug link issues and track which strategy is being used in production.

## Testing

### Unit Tests

Run URL helper tests:
```bash
npm test server/util/url.test.js
```

### Integration Testing

1. **Set environment variables:**
   ```bash
   export ROOT_URL=https://test.sherbrt.com
   export SMS_LINK_STRATEGY=app  # or 'shippo'
   ```

2. **Test app strategy:**
   - Create a booking and complete it to label-ready stage
   - Check SMS log for `strategy=app`
   - Verify link format: `https://test.sherbrt.com/ship/:id`
   - Visit the link in a browser
   - Confirm ShipPage loads and displays label data

3. **Test Shippo strategy:**
   - Set `SMS_LINK_STRATEGY=shippo`
   - Create a booking and complete it to label-ready stage
   - Check SMS log for `strategy=shippo`
   - Verify link points to Shippo domain
   - Confirm link opens Shippo's label page

4. **Test fallback:**
   - Set `SMS_LINK_STRATEGY=shippo`
   - Simulate missing Shippo URLs in protectedData
   - Verify logs show fallback: `[URL] SMS_LINK_STRATEGY=shippo but no Shippo URL available, falling back to app URL`
   - Confirm app URL is used instead

## Migration Guide

### From Hard-Coded URLs

If you're migrating from hard-coded URLs (e.g., `https://sherbrt.com/...`):

1. **Update imports:**
   ```javascript
   const { makeAppUrl, buildShipLabelLink } = require('../util/url');
   ```

2. **Replace hard-coded URLs:**
   ```javascript
   // Before
   const shipUrl = `https://sherbrt.com/ship/${txId}`;
   
   // After
   const { url: shipUrl, strategy } = buildShipLabelLink(txId, shippoData);
   ```

3. **Add strategy logging:**
   ```javascript
   console.log(`[SMS][tag] link=${url} strategy=${strategy} txId=${txId}`);
   ```

4. **Set `ROOT_URL`:**
   Ensure `ROOT_URL` is set in your environment variables for all environments.

## Troubleshooting

### Links show relative paths in SMS

**Problem:** SMS contains `/ship/123` instead of `https://sherbrt.com/ship/123`

**Solution:** Ensure `ROOT_URL` is set in your environment variables.

### Links point to wrong domain

**Problem:** Test environment sends links to `sherbrt.com` instead of `test.sherbrt.com`

**Solution:** Check that `ROOT_URL` is correctly set for the test environment. It should not have hard-coded fallbacks in the code.

### 404 on /ship/:id in test environment

**Problem:** Clicking SMS link results in 404 error

**Solutions:**
1. Ensure client-side routing includes the ShipPage route
2. Verify the route is in `src/routing/routeConfiguration.js`
3. Check that the server allows SPA routes to be served (SSR handles this automatically)

### Shippo links not being used

**Problem:** `SMS_LINK_STRATEGY=shippo` but app links are used

**Possible causes:**
1. Shippo data not available in transaction protectedData
2. Label creation failed
3. Check logs for fallback warning: `SMS_LINK_STRATEGY=shippo but no Shippo URL available`

**Solution:** Ensure Shippo label creation is successful and URLs are saved to protectedData.

## Future Enhancements

Potential improvements to consider:

1. **Link Shortening:** Integrate with a URL shortener (e.g., Bitly) to reduce SMS character count
2. **Link Tracking:** Add analytics to track link clicks from SMS
3. **Authenticated Links:** Add temporary tokens to links for security
4. **Expiring Links:** Make QR/label links expire after a certain time
5. **Multi-language Support:** Internationalize SMS messages and link paths

## Related Files

- `server/util/url.js` - URL helper functions
- `server/util/url.test.js` - Unit tests
- `server/api/transition-privileged.js` - Label creation & Step 3 SMS
- `server/scripts/sendShipByReminders.js` - Ship-by reminder SMS
- `server/scripts/sendReturnReminders.js` - Return reminder SMS
- `server/scripts/sendOverdueReminders.js` - Overdue reminder SMS
- `server/api/initiate-privileged.js` - Booking request SMS
- `server/api/ship.js` - Ship page API endpoint
- `src/containers/ShipPage/ShipPage.js` - Ship page React component
- `src/routing/routeConfiguration.js` - Client-side routes

## Support

For questions or issues related to SMS links:

1. Check the logs for `[SMS]` and `[URL]` prefixes
2. Verify environment variables are set correctly
3. Review this documentation
4. Contact the development team

---

**Last Updated:** October 2025
**Version:** 1.0


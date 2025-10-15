# SMS Links Implementation - Quick Start

This PR implements centralized SMS link management with ROOT_URL support and Shippo direct-link fallback.

## What Changed

### 1. Centralized URL Helper (`server/util/url.js`)
- All SMS links now use `ROOT_URL` environment variable
- New helper functions: `makeAppUrl()`, `buildShipLabelLink()`, `buildReturnLabelLink()`
- Automatic fallback if `ROOT_URL` not set

### 2. SMS Link Strategy (`SMS_LINK_STRATEGY`)
New environment variable to control link behavior:
- `app` (default): Links to `/ship/:id` on your domain
- `shippo`: Links directly to Shippo's hosted labels (with automatic fallback to app)

### 3. Updated SMS Templates
All SMS messages now use the helper:
- ✅ Label ready (Step 3) - `server/api/transition-privileged.js`
- ✅ Ship-by reminders - `server/scripts/sendShipByReminders.js`
- ✅ Return reminders - `server/scripts/sendReturnReminders.js`
- ✅ Overdue reminders - `server/scripts/sendOverdueReminders.js`
- ✅ Booking confirmations - `server/api/initiate-privileged.js`

### 4. New `/ship/:id` Route
- Client route: `src/containers/ShipPage/`
- API endpoint: `server/api/ship.js`
- Server-side rendering support
- No authentication required (accessible via SMS)

## Required Environment Variables

```bash
# Required: Base URL for the application
ROOT_URL=https://sherbrt.com

# Optional: SMS link strategy (default: 'app')
SMS_LINK_STRATEGY=app  # or 'shippo'
```

## Testing

### Test Plan 1: App Strategy (default)

1. **Set environment:**
   ```bash
   export ROOT_URL=https://test.sherbrt.com
   export SMS_LINK_STRATEGY=app
   ```

2. **Create a booking and advance to label-ready**

3. **Verify SMS sent to lender:**
   - Check logs for: `[SMS][label_ready_to_lender] link=https://test.sherbrt.com/ship/tx-... strategy=app`
   - SMS message should contain: `https://test.sherbrt.com/ship/...`

4. **Click the link:**
   - Should load the ShipPage component
   - Should display QR code and label link
   - No 404 errors

### Test Plan 2: Shippo Strategy

1. **Set environment:**
   ```bash
   export ROOT_URL=https://test.sherbrt.com
   export SMS_LINK_STRATEGY=shippo
   ```

2. **Create a booking and advance to label-ready**

3. **Verify SMS sent to lender:**
   - Check logs for: `[SMS][label_ready_to_lender] link=https://shippo.com/... strategy=shippo`
   - SMS message should contain Shippo URL

4. **Click the link:**
   - Should go directly to Shippo's hosted label page

### Test Plan 3: Fallback Behavior

1. **Set Shippo strategy but simulate missing Shippo URL:**
   ```bash
   export SMS_LINK_STRATEGY=shippo
   ```

2. **Create booking without Shippo data in protectedData**

3. **Verify fallback:**
   - Check logs for: `[URL] SMS_LINK_STRATEGY=shippo but no Shippo URL available, falling back to app URL`
   - SMS should use app URL: `https://test.sherbrt.com/ship/...`

## Files Changed

### New Files
- `server/util/url.js` - URL helper functions
- `server/util/url.test.js` - Unit tests
- `server/api/ship.js` - Ship page API endpoint
- `src/containers/ShipPage/ShipPage.js` - Ship page component
- `src/containers/ShipPage/ShipPage.module.css` - Styles
- `src/containers/ShipPage/ShipPage.duck.js` - State management (placeholder)
- `docs/sms-links.md` - Full documentation

### Modified Files
- `server/api/transition-privileged.js` - Updated Step 3 SMS
- `server/scripts/sendShipByReminders.js` - Updated reminder SMS
- `server/scripts/sendReturnReminders.js` - Updated return SMS
- `server/scripts/sendOverdueReminders.js` - Updated overdue SMS
- `server/api/initiate-privileged.js` - Updated booking SMS
- `server/apiRouter.js` - Added `/api/ship/:id` route
- `src/routing/routeConfiguration.js` - Added `/ship/:id` and `/return/:id` routes
- `src/translations/en.json` - Added ShipPage translations

## Deployment Checklist

- [ ] Set `ROOT_URL` in production environment (e.g., `https://sherbrt.com`)
- [ ] Set `ROOT_URL` in staging environment (e.g., `https://test.sherbrt.com`)
- [ ] Set `SMS_LINK_STRATEGY` (optional, defaults to `app`)
- [ ] Test SMS sends after deployment
- [ ] Verify `/ship/:id` route works in all environments
- [ ] Check logs for strategy confirmation

## Rollback Plan

If issues occur:

1. **Environment-only rollback:**
   - Set `ROOT_URL` to production domain
   - Links will work but may not respect environment boundaries

2. **Code rollback:**
   - Revert this PR
   - Old hard-coded URLs will be restored
   - No data migration needed

## Logging

All SMS sends now include detailed logging:

```
[SMS][label_ready_to_lender] link=https://test.sherbrt.com/ship/tx-123 strategy=app txId=tx-123
[SMS][shipby_t24_to_lender] link=https://shippo.com/qr/xyz strategy=shippo txId=tx-456
```

Look for these logs to debug link issues.

## Documentation

Full documentation available in `docs/sms-links.md`:
- Detailed API reference
- Environment variable configuration
- Troubleshooting guide
- Future enhancements

## Support

Questions? Check:
1. `docs/sms-links.md` for full documentation
2. Logs for `[SMS]` and `[URL]` prefixes
3. Environment variables are set correctly

---

**PR Name:** `sms-links-root-url-and-shippo-fallback`
**Status:** ✅ Ready for review
**Testing:** ✅ Unit tests included
**Documentation:** ✅ Complete


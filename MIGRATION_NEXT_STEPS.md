# Migration Next Steps - Quick Guide

**Current Status:** ✅ Migration Complete on branch `release/shippo-v2-migration`

## Current Branch Status

```bash
# You are currently on: release/shippo-v2-migration
# This branch contains all migrated Shippo v2 logic from test
```

## Quick Actions

### 1. Review Changes (Recommended)

```bash
# See all changed files
git diff --stat main..release/shippo-v2-migration

# See specific file changes
git diff main..release/shippo-v2-migration -- server/api/transition-privileged.js
git diff main..release/shippo-v2-migration -- server/webhooks/shippoTracking.js
git diff main..release/shippo-v2-migration -- server/lib/shipping.js
```

### 2. Test Locally

```bash
# Install dependencies (if needed)
npm install

# Set required environment variables
export SHIP_LEAD_MODE=distance
export SHOP_LAT=your_latitude
export SHOP_LNG=your_longitude

# Start server
npm run dev
```

### 3. Deploy to Staging (Recommended)

```bash
# Push migration branch to remote
git push origin release/shippo-v2-migration

# Deploy to staging environment
# (use your normal staging deployment process)
```

**Staging Tests:**
- [ ] Create test order
- [ ] Accept order (verify UPS label creation)
- [ ] If UPS fails, verify USPS fallback
- [ ] Check ship-by date is calculated correctly
- [ ] Verify webhook receives tracking updates
- [ ] Confirm Step-4 SMS sends with short link

### 4. Merge to Main

Once testing passes:

```bash
# Switch to main
git checkout main

# Merge the migration branch
git merge release/shippo-v2-migration

# Push to remote
git push origin main
```

### 5. Deploy to Production

```bash
# Ensure all environment variables are set in production:
# - REACT_APP_SHIPPO_API_KEY
# - SHIP_LEAD_MODE=distance (or "fixed")
# - SHOP_LAT and SHOP_LNG (if using distance mode)
# - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
# - SHORT_LINK_DOMAIN

# Deploy to production
# (use your normal production deployment process)
```

## Verification Checklist

After deployment, verify:

- [ ] **UPS Rates**: Test order acceptance creates UPS label
- [ ] **USPS Fallback**: Verify fallback works if UPS fails (can test by temporarily breaking UPS API key)
- [ ] **Ship-by Dates**: Check calculated dates match expected lead times
- [ ] **Webhooks**: Verify Shippo sends tracking updates
- [ ] **SMS Notifications**: Confirm Step-4 SMS arrives with tracking link
- [ ] **Short Links**: Click tracking link to verify redirect works
- [ ] **Idempotency**: Verify duplicate webhook events don't send duplicate SMS
- [ ] **UI**: Access ShipPage at `/ship` (if exposed to operators)

## Files Changed Summary

### Phase A - Utilities (5 files)
- `server/lib/trackingLinks.js` (already in sync)
- `server/lib/statusMap.js` (modified)
- `server/lib/txData.js` (modified)
- `server/api-util/shortlink.js` (modified)
- `server/api-util/integrationSdk.js` (modified)
- `server/lib/geo.js` (NEW)

### Phase B - Core Logic (3 files)
- `server/lib/shipping.js` (enhanced)
- `server/api/transition-privileged.js` (major refactor)
- `server/webhooks/shippoTracking.js` (major refactor)

### Phase C - UI (4 files)
- `server/api/ship.js` (NEW)
- `src/containers/ShipPage/ShipPage.js` (NEW)
- `src/containers/ShipPage/ShipPage.duck.js` (NEW)
- `src/containers/ShipPage/ShipPage.module.css` (NEW)

## Rollback Instructions

If issues occur after merge:

```bash
# Find the merge commit
git log --oneline -5

# Revert the merge (safer option)
git revert -m 1 <merge-commit-sha>
git push origin main

# OR hard reset (use with caution)
git reset --hard <commit-before-merge>
git push --force origin main  # ONLY if no other changes were made
```

## Environment Variables Reference

```bash
# Shippo
REACT_APP_SHIPPO_API_KEY=live_xxxx...

# Shipping Mode
SHIP_LEAD_MODE=distance  # or "fixed"

# Geo Calculation (for distance mode)
SHOP_LAT=37.7749
SHOP_LNG=-122.4194

# SMS (Twilio)
TWILIO_ACCOUNT_SID=ACxxxx...
TWILIO_AUTH_TOKEN=xxxx...
TWILIO_PHONE_NUMBER=+1234567890

# Short Links
SHORT_LINK_DOMAIN=yourdomain.com
```

## Troubleshooting

### Issue: UPS rates not working
- Check `REACT_APP_SHIPPO_API_KEY` is set correctly
- Verify Shippo account has UPS enabled
- Check server logs for API errors

### Issue: USPS fallback not triggering
- Verify UPS is actually failing (check logs)
- Ensure USPS is enabled in Shippo account
- Check `server/api/transition-privileged.js` fallback logic

### Issue: Ship-by dates incorrect
- Verify `SHIP_LEAD_MODE=distance` is set
- Check `SHOP_LAT` and `SHOP_LNG` are correct
- Review `server/lib/geo.js` calculation logic

### Issue: SMS not sending
- Check Twilio credentials
- Verify webhook is receiving events from Shippo
- Check `server/webhooks/shippoTracking.js` logs
- Ensure Step-4 transition is occurring

### Issue: Short links not working
- Verify `SHORT_LINK_DOMAIN` is set
- Check DNS is configured correctly
- Test redirect endpoint: `/r/:token`

## Support Documentation

- `SHIPPO_V2_MIGRATION_COMPLETE.md` - Full migration report
- `SHIPPO_FILES_IN_TEST_REPORT.md` - Complete file inventory
- `UPS_QUICK_REFERENCE.md` - UPS integration docs
- `SHORT_TRACKING_LINKS_IMPLEMENTATION.md` - Short link system
- `SMS_SYSTEM_DOCUMENTATION.md` - SMS integration

---

**Current Branch:** `release/shippo-v2-migration`  
**Status:** ✅ Ready for testing and merge  
**Next Action:** Deploy to staging and test


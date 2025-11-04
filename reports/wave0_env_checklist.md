# Wave-0 Environment Variables Checklist

**Instructions:** Fill values from Render → Environment. Do not paste secrets; mark 'set/empty/unknown'.

## Critical Production Variables

### Payment & API Mode Flags
- [ ] `STRIPE_MODE` - Expected: `LIVE` on production
  - Current: _[FILL FROM RENDER]_
  - Notes: Must be LIVE for real transactions

### SMS/Messaging Configuration  
- [ ] `SMS_DRY_RUN` - Expected: `false` on production (unless intentionally disabled)
  - Current: _[FILL FROM RENDER]_
  - Notes: If true, SMS will not actually send

### Shipping Integration
- [ ] `SHIPPO_MODE` - Expected: `LIVE` (or may not be set yet if feature pending)
  - Current: _[FILL FROM RENDER]_
  - Notes: Document if shipping is enabled

### Feature Toggles
- [ ] `ADDR_ENABLED` - Document current intended production value
  - Current: _[FILL FROM RENDER]_
  - Notes: Address validation feature flag

## Build-Time Variables (React)
**Note:** These are baked into the build at compile time. Check build logs or .env files.

- [ ] `REACT_APP_SHARETRIBE_SDK_CLIENT_ID`
  - Status: _[set/empty]_
  
- [ ] `REACT_APP_STRIPE_PUBLISHABLE_KEY`
  - Status: _[set/empty]_
  - Notes: Should be LIVE key for production

- [ ] `REACT_APP_MAPBOX_ACCESS_TOKEN`
  - Status: _[set/empty]_

- [ ] `REACT_APP_SENTRY_DSN`
  - Status: _[set/empty]_
  - Notes: Error tracking

- [ ] `REACT_APP_GOOGLE_ANALYTICS_ID` / `REACT_APP_GA_MEASUREMENT_ID`
  - Status: _[set/empty]_

## Additional Runtime Variables

- [ ] `NODE_ENV` - Expected: `production`
  - Current: _[FILL FROM RENDER]_

- [ ] `PORT` - Server port
  - Current: _[FILL FROM RENDER]_

- [ ] `REACT_APP_SHARETRIBE_SDK_BASE_URL`
  - Status: _[set/empty]_
  - Notes: Should point to production Flex API

- [ ] `REACT_APP_MARKETPLACE_ROOT_URL`
  - Current: _[FILL FROM RENDER]_
  - Expected: `https://sherbrt.com` or similar

## Redis Configuration (if applicable)
- [ ] `REDIS_URL` or equivalent
  - Status: _[set/empty]_

## Session & Security
- [ ] `SESSION_SECRET` or similar
  - Status: _[set/empty]_
  - Notes: Should be a strong random value

## Verification Notes

Date checked: _______________
Checked by: _______________
Baseline SHA: edd0774

### Action Items
- [ ] Verify all LIVE/production mode flags are correctly set
- [ ] Confirm build-time variables match production requirements
- [ ] Validate that no test/development credentials are in use

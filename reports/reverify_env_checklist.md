# Wave-0 Reverification - Environment Variables Checklist

**Instructions:** Fill values from Render → Environment to verify no drift has occurred. Do not paste secrets; mark 'set/empty/changed'.

**Reverification Date:** October 8, 2025  
**Baseline SHA:** edd0774  
**Purpose:** Confirm environment variables match Wave-0 baseline before Wave-1 deployment  

## Critical Production Variables

### Payment & API Mode Flags
| Variable | Expected | Baseline Status | Current Value | Status |
|----------|----------|-----------------|---------------|--------|
| `STRIPE_MODE` | `LIVE` | _[Wave-0: set]_ | _[FILL FROM RENDER]_ | ⬜ Unchanged / ⚠️ Changed |

### SMS/Messaging Configuration  
| Variable | Expected | Baseline Status | Current Value | Status |
|----------|----------|-----------------|---------------|--------|
| `SMS_DRY_RUN` | `false` | _[Wave-0: set]_ | _[FILL FROM RENDER]_ | ⬜ Unchanged / ⚠️ Changed |

### Shipping Integration
| Variable | Expected | Baseline Status | Current Value | Status |
|----------|----------|-----------------|---------------|--------|
| `SHIPPO_MODE` | `LIVE` or unset | _[Wave-0: status]_ | _[FILL FROM RENDER]_ | ⬜ Unchanged / ⚠️ Changed |

### Feature Toggles
| Variable | Expected | Baseline Status | Current Value | Status |
|----------|----------|-----------------|---------------|--------|
| `ADDR_ENABLED` | _[documented]_ | _[Wave-0: status]_ | _[FILL FROM RENDER]_ | ⬜ Unchanged / ⚠️ Changed |

## Build-Time Variables (React)
**Note:** These are baked into the build at compile time. Check build logs or .env files.

| Variable | Baseline Status | Current Status | Notes |
|----------|-----------------|----------------|-------|
| `REACT_APP_SHARETRIBE_SDK_CLIENT_ID` | _[set/empty]_ | _[FILL]_ | |
| `REACT_APP_STRIPE_PUBLISHABLE_KEY` | _[set/empty]_ | _[FILL]_ | Should be LIVE key |
| `REACT_APP_MAPBOX_ACCESS_TOKEN` | _[set/empty]_ | _[FILL]_ | |
| `REACT_APP_SENTRY_DSN` | _[set/empty]_ | _[FILL]_ | Error tracking |
| `REACT_APP_GOOGLE_ANALYTICS_ID` / `GA_MEASUREMENT_ID` | _[set/empty]_ | _[FILL]_ | |

## Additional Runtime Variables

| Variable | Expected | Baseline Status | Current Value | Status |
|----------|----------|-----------------|---------------|--------|
| `NODE_ENV` | `production` | _[Wave-0: set]_ | _[FILL]_ | ⬜ Unchanged / ⚠️ Changed |
| `PORT` | _[server port]_ | _[Wave-0: set]_ | _[FILL]_ | ⬜ Unchanged / ⚠️ Changed |
| `REACT_APP_SHARETRIBE_SDK_BASE_URL` | Flex API | _[Wave-0: set]_ | _[FILL]_ | ⬜ Unchanged / ⚠️ Changed |
| `REACT_APP_MARKETPLACE_ROOT_URL` | `https://sherbrt.com` | _[Wave-0: set]_ | _[FILL]_ | ⬜ Unchanged / ⚠️ Changed |

## Redis Configuration (if applicable)
| Variable | Baseline Status | Current Status | Notes |
|----------|-----------------|----------------|-------|
| `REDIS_URL` | _[set/empty]_ | _[FILL]_ | |

## Session & Security
| Variable | Baseline Status | Current Status | Notes |
|----------|-----------------|----------------|-------|
| `SESSION_SECRET` | _[set/empty]_ | _[FILL]_ | Should be strong random value |

## Verification Instructions

1. Log into Render dashboard
2. Navigate to Environment variables section
3. For each variable listed above:
   - Check if it exists and has a value (mark as 'set' or 'empty')
   - Compare with baseline status from Wave-0
   - Mark as ✅ Unchanged or ⚠️ Changed
4. Document any discrepancies in the notes section

## Action Items
- [ ] Verify all LIVE/production mode flags match baseline
- [ ] Confirm no test/development credentials introduced
- [ ] Document any intentional changes since Wave-0
- [ ] Flag any unexpected drift for review before Wave-1

## Notes & Findings

_[Document any environment drift, intentional changes, or anomalies discovered during reverification]_

---

**Completion Status:** ⬜ Not Started / 🔄 In Progress / ✅ Completed  
**Reviewed By:** _______________  
**Approval for Wave-1:** ⬜ Approved / ⚠️ Hold / ❌ Blocked  


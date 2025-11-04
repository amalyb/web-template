# Delta Inventory Report
**Generated:** 2025-10-08 10:40:44

## Executive Summary

This report analyzes the delta between `main` (production baseline) and `test` (staging/integration) branches to identify what work remains to be deployed.

### Key Metrics

- **Main HEAD:** `edd07741`
- **Test HEAD:** `b9241716`
- **Merge Base:** `a2d9e427`
- **Commits in test (not in main):** 125
- **Commits in main (not in test):** 7582
- **Total files changed:** 135

### File Changes by Type

| Change Type | Count |
|------------|-------|
| Added | 64 |
| Modified | 68 |
| Deleted | 3 |

### Deployment Status

| Status | Count | Description |
|--------|-------|-------------|
| `deleted` | 3 | Removed from test branch |
| `deployed_to_main` | 64 | Already in production (identical content) |
| `diverged_conflict_risk` | 23 | Modified in both branches (merge conflicts likely) |
| `only_in_test` | 45 | New work pending deployment |

### Feature Branches Already Merged to Main

The following feature branches have already landed work into `main`:

- bring/wave3-sms-shippo (#35)
- wave4-gates-shippo-sms-lead-days (#36)
- infra/env-validation (#37)
- chore/add-ioredis (#22)
- chore/add-reminder-scripts (#25)
- feat/cache (redis) (#24)
- Various CSP and favicon PRs (#8-#11, #28-#30)

## Feature Bundle Analysis

### 1. SMS & Twilio Integration

**Impact:** Server-side SMS notification system using Twilio for transaction lifecycle events (acceptance, shipping reminders, overdue notices)

**Affected Areas:** server/api, server/api-util

**Dependencies:** ENV:TWILIO_ACCOUNT_SID, ENV:TWILIO_AUTH_TOKEN, ENV:TWILIO_PHONE_NUMBER, ENV:SMS_ENABLED

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "SMS & Twilio Integration" (4 files)

**Files (4):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `server/api-util/phone.js` | A | `deployed_to_main` |  |
| `server/api-util/sendSMS.js` | M | `deployed_to_main` |  |
| `server/api/twilio/sms-status.js` | A | `deployed_to_main` |  |
| `server/api-util/sendSMS 2.js.zip` | A | `only_in_test` |  |

### 2. Shippo Shipping & QR Labels

**Impact:** Shipping label generation via Shippo API with QR code tracking links for borrowers and lenders

**Affected Areas:** server/api, server/webhooks, server/lib

**Dependencies:** ENV:SHIPPO_API_KEY, ENV:SHIPPO_ENABLED, ENV:QR_ENABLED

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "Shippo Shipping & QR Labels" (5 files)

**Files (5):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `server/api/qr.js` | A | `deployed_to_main` |  |
| `server/lib/shipping.js` | A | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `server/webhooks/shippoTracking.js` | A | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `server/test-shippo-webhook-enhancement.js` | A | `only_in_test` |  |
| `server/webhooks/shippoTracking.js.zip` | A | `only_in_test` |  |

### 3. Core Transaction Flow

**Impact:** Server-side transaction initiation, privileged transitions, and line item calculations for bookings

**Affected Areas:** server/api

**Dependencies:** Flex Integration API, Stripe

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "Core Transaction Flow" (7 files)

**Files (7):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `server/api/initiate-privileged.js` | M | `deployed_to_main` |  |
| `server/api/transaction-line-items.js` | M | `only_in_test` |  |
| `server/api/transition-privileged 6.js.zip` | A | `only_in_test` |  |
| `server/api/transition-privileged 7.js.zip` | A | `only_in_test` |  |
| `server/api/transition-privileged-fixed.js` | A | `only_in_test` |  |
| `server/api/transition-privileged.js.backup` | A | `only_in_test` |  |
| `server/api/transition-privileged.js` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |

### 4. Server Infrastructure (SSR, CSP, Redis)

**Impact:** Server-side rendering improvements, Content Security Policy hardening, Redis caching infrastructure

**Affected Areas:** server, server/middleware

**Dependencies:** ENV:REDIS_ENABLED, CSP Headers, Helmet

**Status:** `diverged_conflict_risk`

**Recommended Action:** Manual merge required - resolve conflicts, create PR with test changes

**Files (6):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `server/apiRouter.js` | M | `deployed_to_main` |  |
| `server/apiServer.js` | M | `deployed_to_main` |  |
| `server/csp.js` | M | `deployed_to_main` |  |
| `server/redis.js` | A | `deployed_to_main` |  |
| `server/renderer.js` | M | `deployed_to_main` |  |
| `server/index.js` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |

### 5. Server Utilities

**Impact:** Shared server utilities for SDK integration, line items, metrics, and idempotency

**Affected Areas:** server/api-util

**Dependencies:** Flex SDK

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "Server Utilities" (6 files)

**Files (6):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `server/api-util/idempotency.js` | A | `deployed_to_main` |  |
| `server/api-util/integrationSdk.js` | A | `deployed_to_main` |  |
| `server/api-util/lineItems.js` | M | `deployed_to_main` |  |
| `server/api-util/metrics.js` | A | `deployed_to_main` |  |
| `server/api-util/sdk.js` | M | `deployed_to_main` |  |
| `server/api-util/integrationSdk.js.zip` | A | `only_in_test` |  |

### 6. Server Automation Scripts

**Impact:** Automated reminder scripts for overdue returns, ship-by dates, and return deadlines

**Affected Areas:** server/scripts

**Dependencies:** ENV:DRY_RUN, Cron/Scheduler

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "Server Automation Scripts" (5 files)

**Files (5):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `server/scripts/debugTransactionPhones.js` | A | `deployed_to_main` |  |
| `server/scripts/sendOverdueReminders.js` | A | `deployed_to_main` |  |
| `server/scripts/sendReturnReminders.js` | M | `deployed_to_main` |  |
| `server/scripts/sendShipByReminders.js` | A | `deployed_to_main` |  |
| `server/scripts/sendReturnReminders 2.js.zip` | A | `only_in_test` |  |

### 7. Checkout Address Forms

**Impact:** Enhanced checkout flow with separate billing and shipping address forms for borrowers

**Affected Areas:** src/containers/CheckoutPage, src/components/AddressForm

**Dependencies:** ENV:REACT_APP_CHECKOUT_ADDR_ENABLED, Stripe, Google Maps

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "Checkout Address Forms" (9 files)

**Files (9):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `src/components/AddressForm/AddressForm.js` | A | `deployed_to_main` |  |
| `src/components/AddressForm/AddressForm.module.css` | A | `deployed_to_main` |  |
| `src/util/addressHelpers.js` | A | `deployed_to_main` |  |
| `src/util/geoData.js` | A | `deployed_to_main` |  |
| `src/containers/CheckoutPage/CheckoutPage.duck.js` | M | `only_in_test` |  |
| `src/containers/CheckoutPage/CheckoutPage.js` | M | `only_in_test` |  |
| `...eckoutPage/StripePaymentForm/StripePaymentForm.module.css` | M | `only_in_test` |  |
| `src/containers/CheckoutPage/CheckoutPageWithPayment.js` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `...iners/CheckoutPage/StripePaymentForm/StripePaymentForm.js` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |

### 8. Availability Calendar Fixes

**Impact:** Calendar rendering fixes for proper date alignment, timezone handling, and availability display

**Affected Areas:** src/containers/EditListingPage

**Dependencies:** moment-timezone

**Status:** `diverged_conflict_risk`

**Recommended Action:** Manual merge required - resolve conflicts, create PR with test changes

**Files (4):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `...omponents/OrderPanel/BookingDatesForm/BookingDatesForm.js` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `...tListingAvailabilityPanel/EditListingAvailabilityPanel.js` | M | `deployed_to_main` |  |
| `...stingAvailabilityPanel/MonthlyCalendar/MonthlyCalendar.js` | M | `deployed_to_main` |  |
| `...ilabilityPanel/MonthlyCalendar/MonthlyCalendar.module.css` | M | `deployed_to_main` |  |

### 9. Pricing & Breakdown Display

**Impact:** Price variants, discount calculations (50% for 10+ nights), and order breakdown UI

**Affected Areas:** src/components/OrderBreakdown, src/containers/EditListingPage

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "Pricing & Breakdown Display" (6 files)

**Files (6):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `src/components/OrderBreakdown/LineItemDiscountMaybe.js` | M | `only_in_test` |  |
| `src/components/OrderPanel/EstimatedCustomerBreakdownMaybe.js` | M | `only_in_test` |  |
| `...ingWizard/EditListingPricingPanel/BookingPriceVariants.js` | M | `only_in_test` |  |
| `src/components/OrderPanel/OrderPanel.js` | M | `deployed_to_main` |  |
| `...gWizard/EditListingPricingPanel/EditListingPricingForm.js` | M | `deployed_to_main` |  |
| `...Wizard/EditListingPricingPanel/EditListingPricingPanel.js` | M | `deployed_to_main` |  |

### 10. Client Core UI Components

**Impact:** General UI improvements across listing, search, transaction, and editing pages

**Affected Areas:** src/containers, src/components

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "Client Core UI Components" (22 files)

**Files (22):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `src/components/FieldSelect/FieldSelect.module.css` | M | `only_in_test` |  |
| `src/components/index.js` | M | `only_in_test` |  |
| `src/containers/TransactionPage/TransactionPage.duck.js` | M | `only_in_test` |  |
| `src/containers/TransactionPage/TransactionPage.js` | M | `only_in_test` |  |
| `...ners/TransactionPage/TransactionPanel/TransactionPanel.js` | M | `only_in_test` |  |
| `src/components/ListingCard/ListingCard.js` | M | `deployed_to_main` |  |
| `src/components/ListingCard/ListingCard.module.css` | M | `deployed_to_main` |  |
| `src/containers/EditListingPage/EditListingPage.duck.js` | M | `deployed_to_main` |  |
| `src/containers/EditListingPage/EditListingPage.js` | M | `deployed_to_main` |  |
| `...zard/EditListingDeliveryPanel/EditListingDeliveryPanel.js` | M | `deployed_to_main` |  |
| *...and 12 more files* | | | |

### 11. Client Utilities

**Impact:** Shared client utilities for environment flags, dates, API calls, and config helpers

**Affected Areas:** src/util

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "Client Utilities" (9 files)

**Files (9):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `src/util/api.js` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `src/util/envFlags.js` | A | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `src/util/googleMaps.js` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `src/util/configHelpers.js` | M | `deployed_to_main` |  |
| `src/util/data.js` | M | `deployed_to_main` |  |
| `src/util/generators.js` | M | `deployed_to_main` |  |
| `src/util/dates.js` | M | `only_in_test` |  |
| `src/util/id.js` | A | `only_in_test` |  |
| `src/util/types.js` | M | `only_in_test` |  |

### 12. Config, Build & Infrastructure

**Impact:** Package management (npm migration), favicon updates, build configuration, CI/CD (Render)

**Affected Areas:** root, public, ext

**Dependencies:** npm, Render, Flex transaction processes

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "Config, Build & Infrastructure" (12 files)

**Files (12):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `.gitignore` | M | `only_in_test` |  |
| `ext/transaction-processes/default-booking/process.edn` | M | `deployed_to_main` |  |
| `public/favicon.ico` | A | `deployed_to_main` |  |
| `render.yaml` | M | `deployed_to_main` |  |
| `package-lock.json` | A | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `package.json` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `public/index.html` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `public/site.webmanifest` | A | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `public/static/icons/android-chrome-192x192.png` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| `public/static/icons/android-chrome-512x512.png` | M | `diverged_conflict_risk` | Diverged - needs merge conflict resolution |
| *...and 2 more files* | | | |

### 13. Documentation & Debug Files

**Impact:** Internal documentation, bug fix summaries, test scripts, and implementation guides (non-production)

**Affected Areas:** root

**Status:** `only_in_test`

**Recommended Action:** Create PR: test → main for "Documentation & Debug Files" (31 files)

**Files (31):**

| File | Change | Status | Risk |
|------|--------|--------|------|
| `AVAILABILITY_BUG_FIX.md` | A | `deployed_to_main` |  |
| `AVAILABILITY_BUG_FIX_COMPLETE.md` | A | `deployed_to_main` |  |
| `AVAILABILITY_START_DATE_FIX.md` | A | `deployed_to_main` |  |
| `AVAILABILITY_START_DATE_FIX_COMPLETE.md` | A | `deployed_to_main` |  |
| `BOOKING_CALENDAR_FIX.md` | A | `deployed_to_main` |  |
| `CALENDAR_DATE_BUG_FIX.md` | A | `deployed_to_main` |  |
| `FLEX_TRANSITION_FIX.md` | A | `deployed_to_main` |  |
| `QR_DEBUG_IMPLEMENTATION.md` | A | `deployed_to_main` |  |
| `test-calendar-comprehensive.js` | A | `deployed_to_main` |  |
| `test-calendar-fix.js` | A | `deployed_to_main` |  |
| *...and 21 more files* | | | |

## Proposed Deployment Plan

### Priority 1: Low-Risk Deployments

- [ ] **SMS & Twilio Integration** - Create PR from test → main
  - Files: 4
  - Dependencies: ENV:TWILIO_ACCOUNT_SID, ENV:TWILIO_AUTH_TOKEN, ENV:TWILIO_PHONE_NUMBER, ENV:SMS_ENABLED

- [ ] **Shippo Shipping & QR Labels** - Create PR from test → main
  - Files: 5
  - Dependencies: ENV:SHIPPO_API_KEY, ENV:SHIPPO_ENABLED, ENV:QR_ENABLED

- [ ] **Core Transaction Flow** - Create PR from test → main
  - Files: 7
  - Dependencies: Flex Integration API, Stripe

- [ ] **Server Utilities** - Create PR from test → main
  - Files: 6
  - Dependencies: Flex SDK

- [ ] **Server Automation Scripts** - Create PR from test → main
  - Files: 5
  - Dependencies: ENV:DRY_RUN, Cron/Scheduler

- [ ] **Checkout Address Forms** - Create PR from test → main
  - Files: 9
  - Dependencies: ENV:REACT_APP_CHECKOUT_ADDR_ENABLED, Stripe, Google Maps

- [ ] **Pricing & Breakdown Display** - Create PR from test → main
  - Files: 6
  - Dependencies: None

- [ ] **Client Core UI Components** - Create PR from test → main
  - Files: 22
  - Dependencies: None

- [ ] **Client Utilities** - Create PR from test → main
  - Files: 9
  - Dependencies: None

- [ ] **Config, Build & Infrastructure** - Create PR from test → main
  - Files: 12
  - Dependencies: npm, Render, Flex transaction processes

- [ ] **Documentation & Debug Files** - Create PR from test → main
  - Files: 31
  - Dependencies: None

### Priority 2: Conflict Resolution Required

- [ ] **Server Infrastructure (SSR, CSP, Redis)** - Manual merge and conflict resolution
  - Files: 6
  - Action: Review diverged files, resolve conflicts, create PR

- [ ] **Availability Calendar Fixes** - Manual merge and conflict resolution
  - Files: 4
  - Action: Review diverged files, resolve conflicts, create PR

### Priority 3: Verification

## Pre-Merge Checklist

Before deploying any feature bundle:

- [ ] Run `npm run build` locally
- [ ] Check for type errors (if using TypeScript)
- [ ] Run unit tests
- [ ] Verify `.env` variables are documented
- [ ] Check CSP headers don't block new resources
- [ ] Test Stripe integration in test mode
- [ ] Verify Twilio/Shippo test toggles work
- [ ] Review server endpoint security (auth, validation)
- [ ] Check for secrets or credentials in code
- [ ] Smoke test critical user flows

## Diverged Files (Conflict Risk)

These files have been modified in both `main` and `test` since they diverged:

| File | Test Commit | Main Commit |
|------|-------------|-------------|
| `CONTRIBUTING.md` | `1857cf95` | `63656ed0` |
| `package-lock.json` | `68614772` | `da9121f6` |
| `package.json` | `e93fb8e9` | `aa974f08` |
| `public/index.html` | `9be9832f` | `fce95a32` |
| `public/site.webmanifest` | `2c8a62bf` | `eb582158` |
| `public/static/icons/android-chrome-192x192.png` | `b965c700` | `e03c05a1` |
| `public/static/icons/android-chrome-512x512.png` | `b965c700` | `e03c05a1` |
| `public/static/icons/apple-touch-icon.png` | `b965c700` | `e03c05a1` |
| `scripts/audit-urls.js` | `f8b7ac8c` | `63656ed0` |
| `server/api/transition-privileged.js` | `141333fc` | `feb169c1` |
| `server/index.js` | `e6ebefcb` | `e484820e` |
| `server/lib/shipping.js` | `141333fc` | `feb169c1` |
| `server/webhooks/shippoTracking.js` | `19ad203d` | `feb169c1` |
| `src/app.js` | `2e422b8d` | `c5b279ca` |
| `src/components/OrderPanel/BookingDatesForm/BookingDatesForm.js` | `68614772` | `c2eb4525` |
| `src/containers/CheckoutPage/CheckoutPageWithPayment.js` | `7a00f187` | `edd07741` |
| `src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js` | `7a00f187` | `cfe002d5` |
| `src/containers/ListingPage/ListingPage.duck.js` | `68614772` | `c2eb4525` |
| `src/index.js` | `75eb40ba` | `e484820e` |
| `src/translations/en.json` | `51ee2bc2` | `300122ba` |
| `src/util/api.js` | `2e422b8d` | `c5b279ca` |
| `src/util/envFlags.js` | `2e422b8d` | `edd07741` |
| `src/util/googleMaps.js` | `2e422b8d` | `c5b279ca` |

## Files Only in Test (Pending Deployment)

These files exist only in the `test` branch and are candidates for deployment:

| File | Category | Last Commit |
|------|----------|-------------|
| `.gitignore` | config-build-infra | `fd335ed6` |
| `SHIPPO_ENV_SETUP.md` | docs-debug | `c0687608` |
| `SMS_FIX_IMPLEMENTATION_SUMMARY.md` | docs-debug | `b310d91f` |
| `SMS_INVESTIGATION_GUIDE.md` | docs-debug | `b310d91f` |
| `SMS_RECIPIENT_INVESTIGATION_SUMMARY.md` | docs-debug | `b310d91f` |
| `SMS_SYSTEM_DOCUMENTATION.md` | docs-debug | `f72007f9` |
| `server/api-util/integrationSdk.js.zip` | server-utils | `63580c49` |
| `server/api-util/sendSMS 2.js.zip` | server-sms-twilio | `63580c49` |
| `server/api/transaction-line-items.js` | server-core-transactions | `68614772` |
| `server/api/transition-privileged 6.js.zip` | server-core-transactions | `b310d91f` |
| `server/api/transition-privileged 7.js.zip` | server-core-transactions | `63580c49` |
| `server/api/transition-privileged-fixed.js` | server-core-transactions | `b310d91f` |
| `server/api/transition-privileged.js.backup` | server-core-transactions | `b310d91f` |
| `server/scripts/sendReturnReminders 2.js.zip` | server-scripts | `b310d91f` |
| `server/test-shippo-webhook-enhancement.js` | server-shippo-qr | `c0687608` |
| `server/webhooks/shippoTracking.js.zip` | server-shippo-qr | `63580c49` |
| `src/components/FieldSelect/FieldSelect.module.css` | client-ui-core | `51ee2bc2` |
| `src/components/OrderBreakdown/LineItemDiscountMaybe.js` | client-pricing-breakdown | `8f11b6e7` |
| `src/components/OrderPanel/EstimatedCustomerBreakdownMaybe.js` | client-pricing-breakdown | `68614772` |
| `src/components/index.js` | client-ui-core | `51ee2bc2` |
| `src/containers/CheckoutPage/CheckoutPage.duck.js` | client-checkout-address | `03e315bd` |
| `src/containers/CheckoutPage/CheckoutPage.js` | client-checkout-address | `ac2f39be` |
| `...eckoutPage/StripePaymentForm/StripePaymentForm.module.css` | client-checkout-address | `03e315bd` |
| `...ingWizard/EditListingPricingPanel/BookingPriceVariants.js` | client-pricing-breakdown | `8f11b6e7` |
| `src/containers/TransactionPage/TransactionPage.duck.js` | client-ui-core | `2920bf8c` |
| `src/containers/TransactionPage/TransactionPage.js` | client-ui-core | `3a703797` |
| `...ners/TransactionPage/TransactionPanel/TransactionPanel.js` | client-ui-core | `7d792f96` |
| `src/util/dates.js` | client-utils | `58f5911b` |
| `src/util/id.js` | client-utils | `68614772` |
| `src/util/types.js` | client-utils | `8f11b6e7` |
| *...and 15 more files* | | |

## Open Questions & Manual Review Items

- What is the actual production Render commit SHA? (Assumed: main HEAD)
- Are there open PRs for test branch features?
- What is the deployment timeline/priority for pending features?

## Appendix: Git Commands Used

```bash
git fetch --all --prune
git merge-base main test
git log --cherry-pick --right-only main...test
git diff --name-status --find-renames main...test
git log -1 <branch> -- <file> (for each file)
```

---

*Report generated on 2025-10-08 at 10:40:44*
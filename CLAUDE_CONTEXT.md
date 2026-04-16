# Sherbrt (sherbrt.com) — Project Context

> This file gives Claude (or any AI assistant) full project context at the
> start of a session. Read this first before doing any work on the codebase.

## What is Sherbrt?

Sherbrt is a peer-to-peer lending marketplace where people can borrow and lend
physical items (clothing, equipment, etc.). Built on top of the Sharetribe Flex
platform with heavy customizations for shipping, SMS notifications, late fees,
and a custom checkout flow.

Live site: https://www.sherbrt.com

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Platform | Sharetribe Flex (marketplace SaaS) |
| Frontend | React 18, Redux, React Router 5, React Final Form |
| Backend | Node.js (>=20.10), Express |
| Payments | Stripe (PaymentIntent flow) |
| Shipping | Shippo SDK v2 |
| SMS | Twilio (Messaging Service) |
| Cache/State | Redis (ioredis), in-memory fallback for local dev |
| Short Links | Custom HMAC-signed Redis-backed system (`/r/{id}{hmac}`) |
| Maps | Mapbox GL |
| Deployment | Render (web service + cron workers) |
| CI | CircleCI |
| Node | 20.10.0 |

## Repo Structure

```
shop-on-sherbet-cursor/
├── server/                    # Node.js backend
│   ├── api/                   # Express route handlers
│   ├── api-util/              # Shared utilities (sendSMS, shortlink, lenderEarnings)
│   ├── lib/                   # Core business logic (lateFees, shipping, businessDays)
│   ├── scripts/               # Cron worker scripts (SMS reminders, overdue fees)
│   ├── util/                  # SDK setup (getFlexSdk), URL helpers
│   ├── apiRouter.js           # Route definitions
│   ├── apiServer.js           # Express server setup
│   ├── index.js               # Entry point
│   ├── redis.js               # Redis client (lazy connect, in-memory fallback)
│   └── env.js                 # .env loading (mirrors create-react-app)
├── src/                       # React frontend
│   ├── transactions/          # Transaction process definitions (state machines)
│   ├── components/            # Shared UI components
│   ├── containers/            # Page-level components
│   └── ...
├── ext/transaction-processes/ # Sharetribe transaction process YAML
├── public/                    # Static assets
├── render.yaml                # Render deployment config
├── package.json               # Scripts, dependencies
└── .env.example               # Environment variable template
```

## Transaction Process (State Machine)

This is the core of the app. Every borrow request follows this flow:

```
INITIAL
  ├── transition/inquire ──────────────► INQUIRY
  │                                        │
  │                                        ├── transition/request-payment-after-inquiry
  │                                        ▼
  └── transition/request-payment ──────► PENDING_PAYMENT
                                           │
                                           ├── transition/expire-payment ──► PAYMENT_EXPIRED
                                           │
                                           ├── transition/confirm-payment (auto, Stripe)
                                           ▼
                                         PREAUTHORIZED
                                           │
                                           ├── transition/decline ─────────► DECLINED
                                           ├── transition/operator-decline ► DECLINED
                                           ├── transition/expire ──────────► EXPIRED
                                           ├── transition/accept ──────────► ACCEPTED
                                           ├── transition/operator-accept ─► ACCEPTED
                                           ▼
                                         ACCEPTED
                                           │
                                           ├── transition/cancel ──────────────────► CANCELED
                                           ├── transition/auto-cancel-unshipped ───► CANCELED
                                           ├── transition/complete-return ─────────► DELIVERED
                                           ├── transition/complete-replacement ────► DELIVERED
                                           ▼
                                         DELIVERED
                                           │
                                           ├── review transitions ─────────► REVIEWED
                                           ▼
                                         REVIEWED (terminal)
```

**Key detail:** `transition/request-payment` creates a Stripe PaymentIntent and
moves to `pending-payment`. Stripe then auto-fires `transition/confirm-payment`
(usually within seconds) moving to `preauthorized`. The lender sees the request
and can accept or decline from `preauthorized` state.

**File:** `src/transactions/transactionProcessBooking.js`

**Sharetribe process.edn (server-side state machine):** `ext/transaction-processes/default-booking/process.edn`. **Deployed via `flex-cli process push` + alias update** — the committed file does nothing until it's pushed AND the `default-booking/release-1` alias is repointed at the new version in Sharetribe Console.

Live alias state (as of April 15, 2026): `default-booking/release-1` → **version 4**. Critical gotcha: v2 was pushed on Dec 9, 2025 but the alias was never flipped, so prod ran on v1 (stock Sharetribe) for four months. This is why the Dec 12, 2025 transaction auto-paid-out the lender despite no shipment — v1's auto-complete fired regardless. v3 (April 14, 2026) added the Dec 9 custom complete-return/complete-replacement operator-fired payouts AND `transition/auto-cancel-unshipped`. v4 (April 15, 2026) adds the two privileged late-fee transitions (`transition/privileged-apply-late-fees` from `:state/delivered` and `transition/privileged-apply-late-fees-non-return` from `:state/accepted`) needed for the 9.0 PR-2 charging pipeline. **Always verify the live alias version before debugging payout/cancel/charge behavior.**

**Payout flow (v3 active):** `transition/complete-return` and `transition/complete-replacement` are now `:actor.role/operator` transitions (no `:at` time trigger). They only fire when server code explicitly calls them:
- `server/webhooks/shippoTracking.js` fires `complete-return` when the return label gets a "delivered" tracking scan
- `server/scripts/sendOverdueReminders.js` fires `complete-replacement` for non-returns past the overdue window

## Cron Workers (Render)

All workers run as Render cron jobs. Each has `--dry-run`, `--verbose`, and
`--limit` flags for testing.

| Worker | Script | Schedule | What it does |
|--------|--------|----------|-------------|
| Lender Request Reminders | `sendLenderRequestReminders.js` | Every 15 min (cron) | 60-min nudge SMS if lender hasn't accepted/declined. Uses 60–80 min age window + Redis idempotency. |
| Lender Shipping Reminders | `sendShippingReminders.js` | Every hour on the hour (cron, `0 * * * *`) | 24hr "ship by tomorrow", end-of-day "not scanned", 48hr auto-cancel alerts to lender. 24h reminder anchored to `outbound.acceptedAt` time-of-day (not UTC midnight). |
| return-reminders | `sendReturnReminders.js --daemon` | Long-running worker, internal 15-min loop | T-1, T, T+1 reminders for borrower return shipments. |
| Overdue / Late-Fee Reminders & Charges | `sendOverdueReminders.js` | Daily 9 AM UTC (moving to **17:00 UTC** in PR-3a — ~10 AM PT) | Late fee notifications + automatic $15/day charge. |
| Auto-Cancel Unshipped | `sendAutoCancelUnshipped.js --once` | Every hour on the hour (cron, `0 * * * *`) | Cancels accepted bookings still unscanned at end of D (11:59pm lender-local, D+1 for Monday-start). Full refund (rental+commission+shipping) via `transition/auto-cancel-unshipped`, voids outbound+return Shippo labels, 3.2 SMS to borrower + 3.2b SMS to lender. Idempotent via `protectedData.autoCancel.sent` + state-machine guard. **Starts with `AUTO_CANCEL_DRY_RUN=1`** — flip to `0` only after a week of clean dry-run logs. |

`web-template` and `web-template-1` services on Render are unused scaffold placeholders — safe to delete.

**Idempotency pattern (Redis-backed, used by lender request + lender shipping reminders):**

Why Redis: the Integration SDK (used by crons) does NOT expose `sdk.transactions.update`, so any attempt to write `protectedData` flags silently fails → same SMS re-sent every cron tick. Redis is used elsewhere in the codebase (shortlinks, tracking) for exactly this purpose.

Keys per transaction (per phase, where applicable):
- `lenderReminder:{txId}:{sent|inFlight}` — 60-min lender nudge
- `shippingReminder:{txId}:{24h|eod|cancel}:{sent|inFlight}` — 3-phase shipping flow

TTLs: `:sent` = 7 days (comfortably outlasts any reminder window). `:inFlight` = 10 min (auto-clears on process crash so next cron tick can retry; by the time it expires, tx has aged past any still-eligible window so no double-text).

Flow: check `:sent` → check `:inFlight` → SET `:inFlight` → send SMS → SET `:sent` + DEL `:inFlight` (on success) OR DEL `:inFlight` (on failure, retry next tick).

**Required env vars on every cron/worker that sends SMS:**
- `LINK_SECRET` — **must be identical** across web service + all workers (HMAC signs shortlink IDs; mismatch = unresolvable links)
- `REDIS_URL` + `REDIS_ENABLED=true` — must point to the same Redis instance as the web service
- `INTEGRATION_CLIENT_ID` + `INTEGRATION_CLIENT_SECRET` — Integration SDK credentials
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER`
- `PUBLIC_BASE_URL` / `SITE_URL`
- `SMS_ENABLED=true`, `SMS_DRY_RUN=false` for production

## SMS System

**File:** `server/api-util/sendSMS.js`

- Twilio Messaging Service (not a single from-number)
- E.164 phone format required; auto-converts 10-digit US numbers
- In-memory duplicate prevention (60-sec window per txId:transition:role)
- In-memory STOP list (resets on restart)
- Dry-run mode: `SMS_DRY_RUN=1` or `--dry-run` flag
- Phone filtering: `ONLY_PHONE=+15551234567` for testing

## Short Link System

**File:** `server/api-util/shortlink.js`

All SMS links go through the shortener to avoid Twilio 30019 carrier filtering:
- Format: `https://www.sherbrt.com/r/{6-char-base62-id}{4-char-hmac}`
- Redis-backed with configurable TTL
- HMAC-SHA256 verification prevents URL tampering
- Env: `LINK_SECRET`, `SHORTLINK_BASE`, `SHORTLINK_TTL_DAYS`

## Sharetribe SDK

**File:** `server/util/getFlexSdk.js`

Two SDK modes, used together in most scripts:
1. **Trusted Marketplace SDK** — `REACT_APP_SHARETRIBE_SDK_CLIENT_ID` + `SHARETRIBE_SDK_CLIENT_SECRET` (via `exchangeToken()`). **Preferred for QUERYING transactions** because it returns resource references in `included` as a `Map` keyed `${type}/${id}` and supports richer sparse-field projections. See `getScriptSdk()` pattern in `sendShipByReminders.js` + `sendAutoCancelUnshipped.js`.
2. **Integration SDK** — `INTEGRATION_CLIENT_ID` + `INTEGRATION_CLIENT_SECRET` (admin-level). **Required for calling operator-actor transitions** (`sdk.transactions.transition()`). Does NOT expose `sdk.transactions.update` — writes to `protectedData` must go through `upsertProtectedData()` in `server/lib/txData.js` or via Redis-backed idempotency keys.

Most daemons mix both: trusted SDK for the accepted-tx query, Integration SDK for the privileged transition call.

Base URL: `https://flex-api.sharetribe.com`

## API Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/initiate-privileged` | POST | Start a transaction (privileged, backend-only) |
| `/transition-privileged` | POST | Advance a transaction state |
| `/transaction-line-items` | POST | Calculate booking fees/taxes |
| `/webhooks/*` | POST | Shippo tracking webhooks |
| `/twilio/sms-status` | POST | Twilio delivery receipts |
| `/qr/*` | GET | QR code redirect system |
| `/ensure-phone-number` | POST | Save phone to user protectedData |
| `/auth/google`, `/auth/facebook` | GET | OAuth flows (Passport.js) |

## Key Business Logic

**Late Fees** (`server/lib/lateFees.js`):
- $15/day, max 5 charges = $75 cap (policy confirmed April 15, 2026)
- Charge for day N-1 on day N's cron (24h scan-lag rule — see PR-3 scope doc)
- Day 1 = SMS only, no charge. Days 2-6 cron = SMS + $15 charge for prior day
- Day 6 = replacement warning SMS + 5th/final $15 charge (for day 5). Day 7+ = hard stop
- USPS scan stops all charging immediately (no lump-sum catch-up)
- Excludes Sundays and USPS holidays
- Idempotent per business day (Flex protectedData `lastLateFeeDayCharged`)
- SMS dedupe via Redis (`overdueNotified:{txId}:{daysLate}:{sent|inFlight}`) — pending PR-3a
- No automatic replacement (manual operator action only, `AUTO_REPLACEMENT_ENABLED=false`)

**Shipping** (`server/lib/shipping.js`):
- Shippo label creation + tracking via webhooks
- ZIP code resolution from labels or protectedData
- Lead day calculation (2 days static default)
- Ship-by date adjusts Sunday → Saturday automatically
- Haversine distance calculation for cost estimation

**Business Days** (`server/lib/businessDays.js`):
- Pacific time (America/Los_Angeles) for all calculations
- Excludes Sundays and USPS holidays (2025–2028 calendar, expires `2028-12-25`; 90-day pre-expiry warning)

## Deployment (Render)

**Config:** `render.yaml`

| Service | Type | Start Command |
|---------|------|--------------|
| shop-on-sherbet | Web | `node server/index.js` |
| shipby-reminders | Worker | `node server/scripts/sendShipByReminders.js --daemon` |
| return-reminders | Worker | `node server/scripts/sendReturnReminders.js --daemon` |
| overdue-reminders | Worker | `node server/scripts/sendOverdueReminders.js --daemon` |

Build: `yarn install --frozen-lockfile && yarn build`
Health check: `/healthz`

**Note:** `lender-request-reminders` and `shipping-reminders` are also configured
as Render cron jobs (every 15 min) but may be set up directly in the Render
dashboard rather than in `render.yaml`.

## Key Environment Variables

See `.env.example` for the full list. Critical ones:

| Variable | Purpose |
|----------|---------|
| `REACT_APP_SHARETRIBE_SDK_CLIENT_ID` | Marketplace SDK client ID |
| `SHARETRIBE_SDK_CLIENT_SECRET` | Marketplace SDK secret |
| `INTEGRATION_CLIENT_ID` | Integration SDK (for cron scripts) |
| `INTEGRATION_CLIENT_SECRET` | Integration SDK secret |
| `REACT_APP_STRIPE_PUBLISHABLE_KEY` | Stripe public key |
| `SHIPPO_API_TOKEN` | Shippo shipping API |
| `TWILIO_ACCOUNT_SID` | Twilio SMS |
| `TWILIO_AUTH_TOKEN` | Twilio SMS |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio SMS |
| `REDIS_URL` | Redis connection |
| `LINK_SECRET` | Shortlink HMAC secret |
| `REACT_APP_MARKETPLACE_ROOT_URL` | Public URL |

## Checkout Flow (Known Fix)

**Issue:** Form context errors from nested Final Form providers in checkout.

**Solution:** Single FinalForm provider at `CheckoutPageWithPayment.js` level.
`StripePaymentForm.js` was converted from form owner to context consumer.

Key fields: `email`, `phone` (E.164 normalized), `billingAddress.*`,
`shippingAddress.*`, `shippingSameAsBilling` toggle.

Address mapping: `line1` → `customerStreet`, `postalCode` → `customerZip`.

**Files:** `CheckoutPageWithPayment.js`, `StripePaymentForm.js`
**Full details:** `CHECKOUT_FORM_CONTEXT_FIX.md`

## Recent Fixes & Gotchas

### 9.0 PR-2 — privileged late-fee transitions live + policy-skip symmetry (April 15, 2026)

**Shipped commit:** `a1d808579` on main. Process pushed as v4; alias `default-booking/release-1` flipped from v3 to v4 via `flex-cli process update-alias`.

**Process changes (`ext/transaction-processes/default-booking/process.edn`):**
- Added `transition/privileged-apply-late-fees` — `:from :state/delivered :to :state/delivered`, scoped to Scenario A (borrower shipped, scan arrived after due date).
- Added `transition/privileged-apply-late-fees-non-return` — `:from :state/accepted :to :state/accepted`, scoped to Scenario B (no scan, borrower never shipped).
- Both use a single `stripe-create-payment-intent` action with `:config {:use-customer-default-payment-method? true}` — this is the off-session shape (auto-confirms against the saved payment method, no separate confirm action, no customer interaction). Earlier draft had a separate `stripe-confirm-payment-intent` action which is the on-session shape and would have failed under Integration-SDK invocation — caught by CC review before push.
- Both actor `:actor.role/operator`, both `:privileged? true`.

**Code changes (`server/lib/lateFees.js`):**
- `MIN_PROCESS_VERSION_FOR_LATE_FEES` bumped from 3 → 4 to match the new live version.
- Scenario B branch narrowed from `(accepted || delivered) && !hasScan` to `accepted && !hasScan`. The `delivered && !hasScan` case now gets its own explicit policy-skip branch returning `{ charged: false, reason: 'delivered-without-scan' }` at WARN log level. Policy: once a tx reaches `:state/delivered`, the item is considered returned; late fees stop regardless of scan data. Covers missed webhooks, operator moves, and future non-scan return paths (e.g. hand-courier delivery).
- Added explicit `accepted && hasScan` policy-skip returning `{ charged: false, reason: 'borrower-shipped-in-transit' }`. Normal multi-day transit window — borrower shipped, carrier scanned, but `complete-return` hasn't fired yet. Log includes raw ISO `firstScanAt` (not just YMD) so future staleness investigations can grep for scans older than N days.
- Removed vestigial `'ctx/new-line-items': newLineItems` key from the `sdk.transactions.transition()` params — only `lineItems` is consumed by `:action/privileged-set-line-items`.

**SMS copy/gate changes (`server/scripts/sendOverdueReminders.js`):**
- Symmetric narrowing of SMS Scenario B gate: now `accepted && !hasScan` only. Pre-PR-2 code included `delivered` here too, which meant a tx in the `delivered-without-scan` skip state on the charging side was still getting day-1 through day-6 SMS ("ship today to avoid replacement charges") telling the borrower to do something the system has decided is done. Fixed.
- Added two explicit policy-skip branches mirroring `lateFees.js`: `delivered && !hasScan` → WARN-level `[OVERDUE] SKIP tx=... reason=delivered-without-scan`, and `accepted && hasScan` → INFO-level `[OVERDUE] SKIP tx=... reason=borrower-shipped-in-transit firstScanAt=...`. Both `continue` without SMS or shouldProcess. Remaining `else` branch is now genuinely "unexpected state" (e.g. `preauthorized`, `cancelled`).
- Removed dead `isDeliveredWithoutScan` local and its two unreachable log-branches.
- Added TODO comment flagging that `transition/privileged-set-overdue-notified{,-delivered}` (called ~line 703 to persist `lastNotifiedDay` to Flex) don't exist in any process.edn variant — every SMS send silently fails this transition, dedupe falls back to in-memory `runNotificationGuard`, and a cron restart mid-run can re-send the same day's SMS. Queued for PR-3.

**Test regression update (`server/scripts/scenarioTests/deliveredWithoutScan.js`):**
- Docstring rewritten to describe the post-PR-2 policy.
- Assertion changed from `lateResult.scenario === 'non-return'` to `lateResult.charged === false && lateResult.reason === 'delivered-without-scan'`.
- Day-5 replacement block left as unreachable guard with a comment explaining why (if policy ever changes to resume charging in this state, the invariant re-activates automatically rather than silently dropped).

**SMS ↔ code alignment verified for Scenario B (never returned):** Day 1 "$15/day charging" SMS + $15 charge, Days 2-4 escalating SMS + $15/day, Day 5 hedged "may be charged replacement" + $15 daily continues (auto-replacement intentionally off via `AUTO_REPLACEMENT_ENABLED=false`), Day 6 committed "replacement will be charged" + $15 daily (manual replacement action by operator), Day 7+ hard stop (no SMS, no charge). Scenario A (returned late) gets charged but no SMS — correct, no reason to chase a returned item.

**Flag status unchanged:** `OVERDUE_FEES_CHARGING_ENABLED` still defaults `false`. No charges will land in Stripe until the flag is flipped in Render (PR-5). PR-2 is purely "the charging path now has real transitions behind it and the skip-reasons are symmetric between cron and lib."

**PR-3 backlog (queued during PR-2 review, now fully scoped in `docs/9.0_pr3_operational_cleanup.md`):**
All items below have been resolved in the PR-3 scope doc (committed `70399793a`). See the "Remaining pending work" section for current status.
- ✅ SMS dedupe: migrated to Redis (`overdueNotified:*` keys) — chose Redis over adding transitions to process.edn (matches shipping/lender pattern, avoids v5 push).
- ✅ Scenario A charging fix: eliminated lump-sum entirely. Unified daily $15 model, `hasScan` stops charging. Dead Scenario A branch to be deleted.
- ✅ Day-6 email alert: fire-and-forget with `.catch()` (hard requirement), `DRY_RUN` respected.
- ✅ Daily digest email: in-cron collection with `charged` / `day6_hard_stop` / `skipped_*` buckets.
- ✅ Comment cleanup: PR-3c sub-PR.
- ✅ Additional items from CC reviews: `daysLate <= 1` scan-lag-grace guard, `'daily-overdue'` scenario value, vestigial transition documented, lenderRequest quiet-hours = Pattern B (delay to 8 AM), day 6 copy softened to "may be charged", `withinSendWindow()` testability via `FORCE_NOW`/`getNow()`.

**Deploy steps performed (for reference on future transition pushes):**
1. `flex-cli process push --process default-booking --path ext/transaction-processes/default-booking -m sherbrt` → `Version 4 successfully saved`
2. `flex-cli process list --process default-booking -m sherbrt` → confirmed v4 created, alias still on v3
3. `flex-cli process update-alias --alias release-1 --process default-booking --version 4 -m sherbrt` → alias moved
4. Re-ran `flex-cli process list` → v4 now shows `default-booking/release-1`
5. `git push origin main` → `b1cf60b8d..a1d808579`
6. Verified in Sharetribe Console → Build → Advanced → Transaction processes → default-booking → v4 marked `release-1`

### Steps 7/8/10/11 — Return-flow SMS copy refresh + 9.0/9.1 late-fee scoping (April 15, 2026)

Three shipped commits and two new scope docs. All work on return-side reminders and the late-fee charging pipeline.

**Steps 7/8/10/11 — SMS copy (commit `87d671812`)** — `server/scripts/sendReturnReminders.js` + `server/webhooks/shippoTracking.js`:
- Interpolated `${itemTitle}` into T-1, TODAY (borrower), first-scan (lender), and delivered (lender) messages. Title resolved from `included` Map via `listing.attributes.title` with `'your item'` fallback.
- Collapsed the return-label lookup to the two canonical fields everywhere: `const returnLabelUrl = pd.returnQrUrl || pd.returnLabelUrl;` — any other shape (nested `.url`, `returnQR`, etc.) is dead code now.
- **NEW Step 11**: delivered-to-lender SMS on return shipment delivery. Added a branch in `shippoTracking.js` after the `isFirstScan` block, before the `!isReturnTracking` guard. Idempotent via `protectedData.return.deliveredNotificationSentAt`. Copy: `📦 Sherbrt 🍧: "${listingTitle}" is back home! Thanks for sharing your style! 🫶🏽 Just in case: bestie@sherbrt.com 💌`. Tag `SMS_TAGS.RETURN_DELIVERED_TO_LENDER`.

**Doc split — `docs/9.0_late_fee_charging.md` + `docs/9.1_overdue_copy_refactor.md` (commit `1d44bcec4`)** — replaces earlier combined `9.x_overdue_scope.md`:
- 9.0 is P0 (revenue-critical): the privileged `transition/privileged-apply-late-fees` and `transition/privileged-apply-late-fees-non-return` referenced by `server/lib/lateFees.js:218,234` **do not exist** in the live `default-booking/process.edn` — they're only in `default-booking_backup_before_pull/process.edn`. Every overdue cron tick throws `unknown-transition` at the SDK layer; borrowers see `$15/day is being charged` SMS but `chargeHistory` in `protectedData.return` is empty across all prod txs. Zero fees have ever landed in Stripe via this path.
- 9.0 ships as 5 atomic PRs with explicit ordering: **flag + gates first (PR-1)**, transitions second (PR-2), staging dry-run (PR-3), structured logging (PR-4), then flip `OVERDUE_FEES_CHARGING_ENABLED=true` in Render (PR-5). Transitions-first was the original plan and would have big-banged every overdue tx at the next cron tick; reordered after CC review.
- 9.1 is the Day 1–6 copy refactor into a new `server/scripts/messages/overdueMessages.js` module (pure function per day + `buildOverdueMessage(daysLate, ctx)` helper). Day 1–6 copy rewritten with `${itemTitle}`, `${shortUrl}`, consistent Sherbrt preamble, and `bestie@sherbrt.com` help line on Days 1/4/5/6. **Hard prereq on 9.0** because Day 1 copy asserts `$15/day late fee now applies` — can't ship that claim until fees actually land in Stripe.

**PR-1 — defensive gates in `server/lib/lateFees.js` (commit `b1cf60b8d`)**:
- Added four top-of-file constants: `LATE_FEE_CENTS` (with `LATE_FEE_CENTS_OVERRIDE` env hook for $0.50 staging dry-run), `OVERDUE_FEES_CHARGING_ENABLED` (defaults `false`), `MIN_PROCESS_VERSION_FOR_LATE_FEES = 3`, `MAX_CHARGEABLE_DAYS = 6`.
- Gate 1 (processVersion floor): returns `{ charged: false, reason: 'processVersion-too-old' }` for anything < v3.
- Gate 2 (day-6 cap): returns `{ charged: false, reason: 'exceeded-max-chargeable-days' }` past Day 6 — defense-in-depth alongside the cron's own Day 7+ hard-stop.
- Gate 3 (feature flag): short-circuits **immediately before** `sdkInstance.transactions.transition(...)` with `{ charged: false, reason: 'feature-flag-disabled', wouldCharge: [...] }`. Crucially, this short-circuits before the SDK call, so the missing-transition error is never triggered — next cron pass logs clean `feature-flag-disabled` with the `wouldCharge` line items instead of `unknown-transition`.
- Safe to deploy anytime because the flag is off by default; transitions can still be missing and nothing breaks.

**Gotchas captured in scope docs:**
- `shortLink()` stores in Redis with a 21-day TTL (`SHORTLINK_TTL_DAYS`, `server/lib/env.js:83`) and mints a new token every cron pass, so the short link itself never expires inside the 6-day overdue window. The real expiration risk is the **underlying Shippo URL** the short link wraps — USPS QR return codes (`pd.returnQrUrl`) ~180 days, Shippo PDF labels (`pd.returnLabelUrl`) ~30 days. Optional HEAD-check mitigation deferred.
- There is no Slack webhook integration in this codebase. PR-4's structured logging is stdout JSON parsed by Render's log drain; any Slack/email alerting is a separate follow-up.
- `AUTO_REPLACEMENT_ENABLED` stays `false`. Day 7+ hard-stopped in both the cron and `applyCharges()`.

**Remaining pending work (not yet shipped):**
- PR-2 ✅ shipped April 15, 2026 (commit `a1d808579`, process v4 live). See the "9.0 PR-2" section above for full details.
- PR-3 scope doc v2 written + CC v2 feedback folded in (`docs/9.0_pr3_operational_cleanup.md`, committed `70399793a` April 15 2026). Major policy changes from v1: no lump-sum Scenario A (unified daily $15 charging), 5 charges / $75 cap (was 6 / $90), 24h scan-lag rule (charge for day N-1 on day N's cron), 17:00 UTC cron time (from 09:00 UTC / 1 AM PT), quiet-hours gate (8 AM – 11 PM PT) across all four SMS daemons. Three sub-PRs:
  - **PR-3a** (blocks flag flip): Redis migration for `overdueNotified:*` keys (replaces dead `set-overdue-notified` transitions with `SET NX EX` pattern), unified daily charging with `hasScan` stop-check, explicit `daysLate <= 1` scan-lag-grace guard, count-based cap (`chargeHistory.filter().length >= 5`), `'daily-overdue'` scenario value for new chargeHistory entries (backward-compat: cap filter uses `code === 'late-fee'` not scenario), cron time to 17:00 UTC, `diagnose-overdue.js` Redis migration. Vestigial `transition/privileged-apply-late-fees` from `:state/delivered` documented in code comment (not removed from process.edn). Dead Scenario A branch in lateFees.js:246-260 to be deleted entirely.
  - **PR-3b**: Day-6 fire-and-forget email (`.catch()` wrapper — hard acceptance requirement on ALL un-awaited `sendTransactionalEmail()` calls, `DRY_RUN` respected), daily digest with buckets (`charged` / `day6_hard_stop` / `skipped_*`), `withinSendWindow()` quiet-hours helper in `server/util/time.js` (must respect `FORCE_NOW`/`getNow()` for testability), applied to all four SMS daemons (Pattern A wide-window auto-defer for return/shipping/shipby, Pattern B expanded-upper-bound delay-to-8AM for lenderRequest's narrow 60-80 min window — nudge still fires, just late).
  - **PR-3c**: Comment cleanup in `lateFees.js` to describe unified model.
  - **CC v2 review feedback fully incorporated** (6 items accepted + 2 policy decisions made). Doc committed and on disk. **Next step: share updated doc with CC for final sign-off, then begin PR-3a implementation.**
- PR-4: staging dry-run with `OVERDUE_FEES_CHARGING_ENABLED=true` + `LATE_FEE_CENTS_OVERRIDE=50`, verify $0.50 payment intent captures in Stripe and `chargeHistory` advances.
- PR-5: wrap `applyCharges()` calls in `sendOverdueReminders.js` with structured JSON logging (`overdue.charge` / `overdue.charge.error`).
- PR-6: flip `OVERDUE_FEES_CHARGING_ENABLED=true` in Render console after PR-3a lands in prod ≥24h.
- 9.1 copy refactor (blocked on 9.0 completing). Day-1 copy softened to "may apply" (scan-lag rule means we can't confirm lateness on day 1). Days 4-5 tightened ("$15/day late fee continues"). Day-6 softened to "may be charged" (not "will be charged" — matches days 4-5 framing, legally safer since replacement is operator-discretionary). Message-map JS updated to match. See `docs/9.1_overdue_copy_refactor.md` (committed `70399793a`).

### Step 3.2 — Auto-Cancel Unshipped Bookings (April 14, 2026)

**Goal:** Auto-cancel accepted bookings that the lender never ships, with a full refund to the borrower and label recovery. Prevents the "lender accepted, item never sent, borrower still charged" scenario.

**Policy (locked in before implementation):**
- Deadline: 11:59:59pm **lender-local** on booking start date (D)
- Monday-start grace: if D is a Monday, deadline shifts to end of Tuesday (D+1) — covers the common "accepted Sunday, couldn't drop off before Monday pickup" case
- Scan detection: cancel only fires if NO outbound carrier scan exists. Three scan signals checked (`hasOutboundScan` helper): `protectedData.shippingNotification.firstScan.sent`, `protectedData.outbound.firstScanAt`, and `protectedData.lastTrackingStatus.status` in `{TRANSIT, IN_TRANSIT, ACCEPTED, OUT_FOR_DELIVERY, DELIVERED}`
- Refund: full — rental + commission + shipping line items (via `:action/calculate-full-refund` + `:action/stripe-refund-payment` in the transition)
- Labels: both outbound and return Shippo labels voided via `POST https://api.goshippo.com/refunds/` (best-effort, non-blocking on failure)
- SMS: 3.2 to borrower, 3.2b to lender (positional `sendSMS(phone, msg, {role, tag, ...})` signature)
- Cadence: hourly (`0 * * * *` cron)
- Idempotency: `protectedData.autoCancel.sent` flag + state-machine guard (`transition/auto-cancel-unshipped` only fires `from :state/accepted`, so even if flag-write fails after a successful transition, the next tick's `state: 'accepted'` query excludes the cancelled tx)
- Lender timezone: resolved via `listing.attributes.availabilityPlan.timezone`. Fallback: `America/Los_Angeles`. **Do not add `'fields.listing'` sparse-field restriction to the query — `availabilityPlan` is not on Sharetribe's sparse-fields whitelist and gets silently dropped, which makes every lender fall back to PT.**

**Files added:**
- `server/scripts/sendAutoCancelUnshipped.js` — cron daemon (supports `--once` for cron and `--daemon` for setInterval). Uses trusted SDK for query, Integration SDK for transition.
- `server/lib/shippo.js` — `voidShippoLabel(shippoTransactionId)` calls `POST /refunds/` with `ShippoToken` auth, body `{transaction, async: false}`. Uses `SHIPPO_API_TOKEN` (same as label creation).

**Files modified:**
- `ext/transaction-processes/default-booking/process.edn` — added `transition/auto-cancel-unshipped` (operator-actor, from `:state/accepted` to `:state/cancelled`, actions: `calculate-full-refund` → `stripe-refund-payment` → `cancel-booking`)
- `server/lib/txData.js` — added `hasOutboundScan(tx)` and `getOutboundFirstScanAt(tx)` helpers
- `server/webhooks/shippoTracking.js` — added canonical `protectedData.outbound.firstScanAt = timestamp()` write alongside existing `shippingNotification.firstScan.sent` write (both land in the first-scan branch). New callers should read via `hasOutboundScan()`; do not read `outbound.firstScanAt` directly unless you also check the other two signals.
- `server/scripts/sendShipByReminders.js` — replaced latent-bug `if (outbound.firstScanAt)` check (the field was never being written) with `if (hasOutboundScan(tx))`. The old check was always false, which is why the "skip if scanned" gate had been silently broken.
- `render.yaml` — added `auto-cancel-unshipped` worker entry (note: `render.yaml` is not actually synced by Render on this project; the cron was created manually in the Render UI as a **Cron Job**, not a Background Worker. `render.yaml` is documentation only.)

**Deployment steps performed:**
1. `flex-cli process push --process=default-booking --path=ext/transaction-processes/default-booking -m sherbrt` → created v3
2. `flex-cli process update-alias --process=default-booking --alias=release-1 --version=3 -m sherbrt` → v3 is now live
3. Committed + pushed code to main (`f17d91b18`)
4. Created Render Cron Job "Auto-Cancel Unshipped" with `AUTO_CANCEL_DRY_RUN=1`, command `node server/scripts/sendAutoCancelUnshipped.js --once`, schedule `0 * * * *`
5. Dry-run verification: **still in progress** — first run failed with 400 on `exchangeToken()` due to env-var copy issue; fix in progress

**Gotchas learned during this work:**
- `sendSMS` is positional: `sendSMS(to, message, { role, tag, transactionId, transition, meta })`. Passing an object as the first arg silently returns `{skipped: true, reason: 'missing_phone_or_message'}` — no error, no log. **Any future SMS caller needs this exact signature.**
- With the trusted SDK, `tx.booking` does NOT exist. The booking resource is in `included` (Map-shape for trusted SDK, Array-shape for Integration SDK). Use `findIncluded()` helper (in `sendAutoCancelUnshipped.js`) to resolve booking, listing, provider, customer from their relationship refs. The helper handles both shapes.
- Sparse fields: `'fields.listing'` rejects anything not on Sharetribe's whitelist. `availabilityPlan` is NOT on the list. If you need availability data, omit the `fields.listing` line entirely.
- `:privileged? true` is NOT needed on operator-actor transitions (existing `transition/cancel` works without it; our `auto-cancel-unshipped` matches that pattern).
- Review process: this feature went through 3 Claude Code review passes before deploy. Each pass caught real bugs that would have caused silent no-ops or incorrect-timezone behavior in prod. Keep the review prompts in `drafts-3.2-auto-cancel/` (gitignored) for reference on future features.

### Day-booking date display shifted by 1 day on checkout + inbox (April 14, 2026)

**Bug:** Listing page showed booking as "Thu Apr 16 – Sun Apr 19". Checkout page (and inbox row) showed same booking as "Wed Apr 15 – Sat Apr 18" — both dates shifted back 1 day. Reproduced regardless of whether lender + borrower were in the same timezone.

**Root cause:** Sharetribe normalizes `LINE_ITEM_DAY` / `LINE_ITEM_NIGHT` bookings to **UTC-midnight** boundaries (e.g. `2026-04-16T00:00:00.000Z`) regardless of the listing's timezone. Rendering those timestamps in the listing's local timezone (e.g. `America/Los_Angeles`) interprets midnight UTC as 5pm PDT the previous day → off-by-one. The listing page "worked" only because it rendered an *estimated* booking built from raw form Date objects (browser-local midnight = 07:00 UTC for Pacific users), which happens to display correctly in either UTC or the listing tz.

**Fix:** For day/night bookings, force `displayTimeZone = 'Etc/UTC'` inside `LineItemBookingPeriod` — used for both the `BookingPeriod` render and the `subtractTime` inclusive-end adjustment. Sunday-end check switched to `getUTCDay()` for day-based bookings. Same override applied in `InboxPage.js` `bookingData()` + `TimeRange`. Hour bookings keep the listing timezone (they genuinely need local time context).

**Files:** `src/components/OrderBreakdown/LineItemBookingPeriod.js`, `src/containers/InboxPage/InboxPage.js`.

### Sunday end-date return banner (April 14, 2026)

Added a banner that appears in the checkout `OrderBreakdown` when the booking end date falls on a Sunday, telling borrowers carriers don't run Sundays and they won't be charged a late fee as long as they ship Monday.

**Copy:** "Sunday end date: Carriers don't run - ship Monday to avoid a late fee."

**Implementation:**
- Banner rendered inside `LineItemBookingPeriod` gated on `isSundayEndDate && showSundayEndDateNotice`.
- `OrderBreakdown` accepts `showSundayEndDateNotice` prop (defaults `true`) and forwards it.
- `EstimatedCustomerBreakdownMaybe` passes `showSundayEndDateNotice={false}` so the listing-page estimated breakdown does NOT show the banner — it's checkout-only by design (listing page is a browsing context; shipping logistics belong at the commitment moment).
- `BookingDatesForm` had an inline version under the date picker; also removed so it no longer duplicates on the listing page.

**Files:** `LineItemBookingPeriod.js`, `OrderBreakdown.js`, `EstimatedCustomerBreakdownMaybe.js`, `BookingDatesForm.js` (+ `.module.css` for styling).

### Sunday 24h shipping reminder — shift reminder fire to Saturday (April 14, 2026)

**Bug:** The 24h pre-shipBy reminder fired on a Sunday when `shipBy` landed on Monday, even though carriers don't pick up Sundays.

**Fix (Option A — shift the reminder, not shipBy):** Anchor `reminderAt = shipBy - 24h` explicitly. If `reminderAt.getUTCDay() === 0`, subtract another 24h so it fires Saturday. `shipBy` itself is unchanged. In-window check is `nowMs >= reminderAt && nowMs < shipBy`.

Also fixed in the same file:
- **SMS copy:** dropped the ambiguous word "tomorrow" — now `Please ship your item by ${shipByStr}` (a specific date, no relative-time confusion when the reminder fires 48h early due to the Sunday shift).
- **Cancel phase:** moved `markInFlight` + SET `:sent` inside try/catch, matching the 24h/eod phase pattern (prevents stuck `:inFlight` keys if the SMS send throws).

**File:** `server/scripts/sendShippingReminders.js`.

### USPS holidays extended through 2028 (April 14, 2026)

`server/lib/businessDays.js` `USPS_HOLIDAYS` set extended with 22 new entries covering observed 2027 and 2028 federal holidays (weekend holidays shifted to Friday/Monday per USPS policy). Added `USPS_HOLIDAYS_EXPIRES_AT = '2028-12-25'` constant and a 90-day-before-expiry `console.warn` so future maintainers get a heads-up before the calendar runs out. All dates verified via a Node script round-tripping through `isNonChargeableDate`.

**File:** `server/lib/businessDays.js`.

### Shipping Reminders — Redis idempotency + acceptedAt time-of-day anchor (April 14, 2026)

Two bugs in `sendShippingReminders.js` fixed together:

**Bug 1: silent duplicate sends.** All three phases (24h / end-of-day / auto-cancel) called `sdk.transactions.update()` to set `protectedData.shippingReminders.*` flags. Integration SDK doesn't expose `transactions.update` — the write threw, was caught & logged, the SMS had already gone out, so every hourly cron tick in the eligibility window re-sent the same reminder.

**Bug 2: reminders fired at midnight UTC.** Old code did `shipBy.setUTCHours(0, 0, 0, 0)` then checked `hoursUntilShipBy <= 24`, so the 24h SMS fired at whatever tick first hit midnight UTC on the day before shipBy. That lands at ~8pm EDT / 5pm PDT — late/weird hours.

**Bug 3 (also fixed): dead end-of-day window.** `isEndOfShipByDay` returned true only between 23:50–23:59 UTC — a 10-min window that the hourly on-the-hour cron never hit.

**Fixes:**
- Replaced all `sdk.transactions.update` calls with Redis `shippingReminder:{txId}:{phase}:{sent|inFlight}` keys (same pattern as lender request reminders).
- Anchored `shipBy` to `outbound.acceptedAt`'s UTC hour/minute instead of zeroing to midnight. Reminder now fires at the same time-of-day the lender engaged, one day before shipBy. Fallback: 15:00 UTC (11am EDT / 8am PDT) if `acceptedAt` missing.
- Widened end-of-day window to `now.getUTCHours() >= 22` (22:00 UTC onward = 6pm EDT / 3pm PDT). At least two hourly ticks fall inside; Redis `:eod:sent` ensures single-send.

**Commits:** `976228457` (Redis + acceptedAt), `db57ed1cc` (end-of-day widen) on main.

### Lender Request Reminder — Redis idempotency migration (April 14, 2026)

Same `sdk.transactions.update` bug as shipping reminders — writes to `protectedData.lenderRequestReminder` silently failed on Integration SDK. Migrated to Redis-backed idempotency (`lenderReminder:{txId}:{sent|inFlight}`). Same flag-before-send contract, now durable across cron ticks.

Also fixed in the same deploy: `lenderEarnings.js` now handles `goog.math.Long` amount objects (`{low_, high_}`) returned by the Integration SDK's transit layer, in addition to plain numbers and Money instances.

**Commits:** `63a9a192e`, `177731103`, `f348bd2b3` on main.

### Lender Request Reminder — confirm-payment state mismatch (April 2026)

**Bug:** The 60-min lender nudge script queried for transactions with
`lastTransition = request-payment` and checked `state === 'preauthorized'`.
But Stripe auto-fires `confirm-payment` within seconds, so by 60 min the
`lastTransition` is `confirm-payment` (not `request-payment`). Query returned
0 results every time.

**Fix:** Added `transition/confirm-payment` to the API query and the eligible
transitions set. State check now accepts both `pending-payment` and
`preauthorized`.

**Commit:** `6e27ccdc3` on main.

### Ship-by date Sunday adjustment

Ship-by dates falling on Sunday are automatically adjusted to Saturday.
This is handled by the `ship-by:adjust` logic with `reason: 'sunday_to_saturday'`.

## Data Structures (protectedData)

Transaction protectedData stores shipping, SMS, and late fee state:

- `customerName`, `customerPhone`, `customerEmail`
- `customerStreet`, `customerCity`, `customerState`, `customerZip`
- `shippingLabel`, `returnLabel` — Shippo label objects
- `trackingNumber`, `returnTrackingNumber`
- `outbound.acceptedAt` — ISO timestamp set on `transition/accept`. Anchors shipping reminder time-of-day.
- `outbound.firstScanAt` — ISO timestamp of first outbound carrier scan (written by `shippoTracking.js` webhook; use `hasOutboundScan()` helper to read).
- `outbound.labelUrl` / `outbound.shipByDate` / `outboundTrackingNumber` — Shippo outbound shipment data
- `returnLabel`, `returnTrackingNumber`, `returnLabelUrl` — Shippo return shipment data
- `lateFee` — Late fee tracking per day
- `autoCancel.sent` / `autoCancel.sentAt` / `autoCancel.reason` — Set by `sendAutoCancelUnshipped.js` after firing `transition/auto-cancel-unshipped`. Idempotency marker (state-machine is the primary guard; this flag is belt-and-suspenders).
- `shippingNotification.firstScan.sent` — Legacy scan-detection flag. Read via `hasOutboundScan()` along with `outbound.firstScanAt` and `lastTrackingStatus.status`.
- `lastTrackingStatus.status` — Latest Shippo tracking status string. `TRANSIT`/`IN_TRANSIT`/`ACCEPTED`/`OUT_FOR_DELIVERY`/`DELIVERED` all count as "package in motion" for `hasOutboundScan()`.

**Not in protectedData anymore** (moved to Redis as of April 14, 2026):
- Lender request reminder flags → `lenderReminder:{txId}:{sent|inFlight}`
- Shipping reminder flags → `shippingReminder:{txId}:{24h|eod|cancel}:{sent|inFlight}`

## Testing

```bash
# Dry-run any worker (no real SMS, no protectedData writes)
npm run test:lender-request-reminders    # or --dry-run --verbose on any script
npm run test:shipping-reminders

# Server tests
npm run test-server

# Frontend
npm run test
```

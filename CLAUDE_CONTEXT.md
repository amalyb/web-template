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

Live alias state (as of April 23, 2026): `default-booking/release-1` → **version 5**. Critical gotcha: v2 was pushed on Dec 9, 2025 but the alias was never flipped, so prod ran on v1 (stock Sharetribe) for four months. This is why the Dec 12, 2025 transaction auto-paid-out the lender despite no shipment — v1's auto-complete fired regardless. v3 (April 14, 2026) added the Dec 9 custom complete-return/complete-replacement operator-fired payouts AND `transition/auto-cancel-unshipped`. v4 (April 15, 2026) added the two privileged late-fee transitions (`transition/privileged-apply-late-fees` from `:state/delivered` and `transition/privileged-apply-late-fees-non-return` from `:state/accepted`) needed for the 9.0 PR-2 charging pipeline. v5 (April 23, 2026) tightens `:transition/expire` from `P6D` to `PT24H` so lenders have 24 hours (not 6 days) to accept or decline a booking request before it auto-expires with full borrower refund. **Always verify the live alias version before debugging payout/cancel/charge behavior.**

**Payout flow (v3 active):** `transition/complete-return` and `transition/complete-replacement` are now `:actor.role/operator` transitions (no `:at` time trigger). They only fire when server code explicitly calls them:
- `server/webhooks/shippoTracking.js` fires `complete-return` when the return label gets a "delivered" tracking scan
- `server/scripts/sendOverdueReminders.js` fires `complete-replacement` for non-returns past the overdue window

## Cron Workers (Render)

All workers run as Render cron jobs. Each has `--dry-run`, `--verbose`, and
`--limit` flags for testing.

| Worker | Script | Schedule | What it does |
|--------|--------|----------|-------------|
| Lender Request Reminders | `sendLenderRequestReminders.js` | Every 15 min (cron) | 2-phase escalation SMS if lender hasn't accepted/declined within the v5 24h expire window (10.0 PR-4, April 23 2026): 60m gentle nudge (respects 8am–11pm PT quiet-hours), 22h final warning (bypasses quiet-hours — a 2am text beats a silent miss). Per-phase Redis dedupe keys `lenderReminder:{txId}:{60m\|22h}:sent`. Includes MISSED_FINAL watchdog that queries recently-expired txs (30-min lookback) and logs `[MISSED_FINAL] tx=X` + `[MISSED_FINAL_SUMMARY] count=N` per run; steady-state count should be 0. `MAX_AGE_MS` = 24h. |
| Lender Shipping Reminders | `sendShippingReminders.js` | Every hour on the hour (cron, `0 * * * *`) | 24hr "ship by tomorrow", end-of-day "not scanned", 48hr auto-cancel alerts to lender. 24h reminder anchored to `outbound.acceptedAt` time-of-day (not UTC midnight). Reads `protectedData.outbound.shipByDate` persisted at label-purchase time (10.0 PR-3) — no longer recomputes with its own `SHIP_LEAD_DAYS` env var. |
| return-reminders | `sendReturnReminders.js --daemon` | Long-running worker, internal 15-min loop | T-1, T, T+1 reminders for borrower return shipments. |
| Overdue / Late-Fee Reminders & Charges | `sendOverdueReminders.js` | Daily **17:00 UTC** (~10 AM PT) — Render cron schedule aligned April 21 2026 | Late fee notifications + automatic $15/day charge. Exits cleanly post-9.2.1 (PR #54). |
| Auto-Cancel Unshipped | `sendAutoCancelUnshipped.js --once` | Every hour on the hour (cron, `0 * * * *`) | Cancels accepted bookings still unscanned at end of D (11:59pm lender-local, D+1 for Monday-start) **PLUS 12-hour scan-lag grace buffer** (10.0 PR-5, April 23 2026) to avoid premature cancels when a carrier hasn't yet propagated the scan. Effective cancel window: 36h post-bookingStart for non-Monday bookings, 60h for Monday-start. Full refund (rental+commission+shipping) via `transition/auto-cancel-unshipped`, voids outbound+return Shippo labels, 3.2 SMS to borrower + 3.2b SMS to lender. Idempotent via `protectedData.autoCancel.sent` + state-machine guard. **Version gate accepts `processVersion >= 3`** (10.0 PR-4 fix — previously was `=== 3` exactly, which would have silently disabled auto-cancel for every v5 transaction). **Starts with `AUTO_CANCEL_DRY_RUN=1`** — flip to `0` only after a week of clean dry-run logs. |

`web-template` and `web-template-1` services on Render are unused scaffold placeholders — safe to delete.

**Idempotency pattern (Redis-backed, used by lender request + lender shipping reminders):**

Why Redis: the Integration SDK (used by crons) does NOT expose `sdk.transactions.update`, so any attempt to write `protectedData` flags silently fails → same SMS re-sent every cron tick. Redis is used elsewhere in the codebase (shortlinks, tracking) for exactly this purpose.

Keys per transaction (per phase, where applicable):
- `lenderReminder:{txId}:{60m|22h}:{sent|inFlight}` — 2-phase lender request escalation (10.0 PR-4)
- `lenderReminder:{txId}:missedFinal:logged` — 1h dedupe for MISSED_FINAL watchdog log (10.0 PR-4)
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

**Shipping** (`server/lib/shipping.js`) — Shippo-anchored architecture as of 10.0 (April 23, 2026):
- Shippo label creation + tracking via webhooks
- ZIP code resolution from labels or protectedData
- **Ship-by date derived from Shippo's selected rate `estimated_days` + `SAFETY_BUFFER_DAYS` (default 1), business-day-subtracted from bookingStart** — NOT from a static `SHIP_LEAD_DAYS` env var. `computeShipByDate` prefers the persisted `protectedData.outbound.shipByDate` first; recomputes only on Shippo outage or pre-10.0 transactions. `SHIP_LEAD_DAYS` env var is retained as a fallback floor, not the primary path.
- Business-day subtraction uses Pacific Time, skips Sundays and USPS holidays, KEEPS Saturdays (scope decision #8).
- Ship-by date adjusts Sunday → Saturday (legacy safety net; business-day subtraction already skips Sundays).
- **Rate-lock at borrower checkout:** `estimateOneWay` returns full rate metadata including `rateObjectId` + `estimatedDays` + `amountCents`; `initiate-privileged.js` persists to `protectedData.outbound.lockedRate` + `protectedData.return.lockedRate` at preauth. At lender accept, `transition-privileged.js` purchases the EXACT locked `rateObjectId` — no feasibility re-check, no fallback re-selection. Borrower preauth cost = actual label cost, always. Eliminates the silent Sherbrt-absorbed delta for short-lead cross-country bookings (CC Option 6 recommendation from 10.0 review).
- **Preferred services (`config/shipping.js`, expanded 10.0 PR-1 to 6 entries):** USPS Priority Mail, USPS Ground Advantage, USPS Priority Mail Express, UPS Ground, UPS 2nd Day Air, UPS Next Day Air Saver. `nameOf` helper strips trademark symbols (® U+00AE, ™ U+2122) from Shippo's returned service names so the filter matches regardless of Shippo-side drift — Shippo returns e.g. `"UPS 2nd Day Air®"` while config is `"UPS 2nd Day Air"` without ®.
- **Outbound rate selection (`pickCheapestAllowedRate`, 10.0 PR-1 refactor):** takes `daysUntilBookingStart` directly (not `shipByDate`), filters to `preferredServices` FIRST, then prefers UPS Ground if feasible, else cheapest feasible preferred, else cheapest of preferred (last resort). Reads `SAFETY_BUFFER_DAYS` from `SHIP_SAFETY_BUFFER` env.
- **Return rate selection (`pickCheapestPreferredRate`, new 10.0 PR-1):** always cheapest preferred service, no deadline filter, no dependency on outbound shipByDate. Previously shared `pickCheapestAllowedRate` with outbound and incorrectly reused outbound's past shipByDate as its deadline — always hit the "absolute cheapest" last-resort branch by accident.
- Haversine distance calculation for cost estimation (legacy `SHIP_LEAD_MODE=distance` mode still supported but unused).

**Business Days** (`server/lib/businessDays.js`):
- Pacific time (America/Los_Angeles) for all calculations
- Excludes Sundays and USPS holidays (2025–2028 calendar, expires `2028-12-25`; 90-day pre-expiry warning)

## Deployment (Render)

**Config:** `render.yaml`

| Service | Type | Start Command |
|---------|------|--------------|
| shop-on-sherbet | Web | `node server/index.js` |
| return-reminders | Worker | `node server/scripts/sendReturnReminders.js --daemon` |
| overdue-reminders | Worker | `node server/scripts/sendOverdueReminders.js --daemon` |
| auto-cancel-unshipped | Cron `0 * * * *` | `node server/scripts/sendAutoCancelUnshipped.js --once` |
| lender-request-reminders | Cron `*/15 * * * *` | `node server/scripts/sendLenderRequestReminders.js --once` |
| shipping-reminders | Cron `0 * * * *` | `node server/scripts/sendShippingReminders.js --once` |

Build: `yarn install --frozen-lockfile && yarn build`
Health check: `/healthz`

**Important: `render.yaml` is documentation-only for the three Cron Jobs above.**
The file is NOT auto-synced to Render in this project — `auto-cancel-unshipped`,
`lender-request-reminders`, and `shipping-reminders` were all created manually
as Cron Jobs in the Render UI. The `render.yaml` blocks are kept in sync as
intended-config documentation; **live config edits must happen in the Render
dashboard**, not by editing `render.yaml`. The three Worker services
(`return-reminders`, `overdue-reminders`, and the web service `shop-on-sherbet`)
ARE managed via `render.yaml`.

**Legacy:** `sendShipByReminders.js` lives in the repo but is intentionally
NOT deployed — its functionality was superseded by `sendShippingReminders.js`.
Safe to delete in a future cleanup PR.

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
| `SHIP_SAFETY_BUFFER` | Buffer days added to Shippo's `estimated_days` when computing ship-by. Default `1`. Only used when deriving shipByDate from a Shippo rate (10.0 PR-2). |
| `SHIP_LEAD_DAYS` | Fallback lead-days value when no Shippo rate is available (outage, manual cron invocation, pre-10.0 tx). Default `2`. Before 10.0 this was the primary path; now demoted to fallback only. |

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

### April 28, 2026 — Comms wiring audit + 3.2/3.2b copy refresh + render.yaml drift cleanup + workbook v12 + Scenario 1 testing started

**Status at end of session:** Mid-Scenario 1 (IDEAL) live testing. All 9.2 + 9.2.1 + 10.0 work confirmed deployed and live in production. Workbook is at v12 (saved locally, NOT yet uploaded to Drive). 5 commits pushed to main today.

**Session goal:** Verify everything scoped in CLAUDE_CONTEXT was actually deployed; align Log-tab copy with shipped code; close `render.yaml` drift; resume QA testing on the v12 plan.

**Comprehensive deployment audit (verified live in `main` + Render dashboard):**
- All 9.2 pre-QA fixes (B1, B2, B3, H1, H2, H3) shipped in PR #53 (`bb51f1f`).
- 9.2.1 overdue-cron clean exit shipped in PR #54 (`9b764e1`).
- All 10.0 PRs shipped: PR-5 (#55, scan-lag grace) → `46c80638e`, PR-1/2/3 bundle (#56) → `ea1bc3bf8`, PR-4 (#57, 24h expire + watchdog + version-gate blocker fix) → `d922669d2`.
- Sharetribe alias `default-booking/release-1` → version 5, confirmed via Console screenshot. Transactions count = 0 on v5 (next request will be the first).
- Render env vars verified: `SENDGRID_API_KEY` + `EMAIL_FROM_ADDRESS` set on overdue + auto-cancel crons. SMS-only crons (`lender-request-reminders`, `shipping-reminders`) correctly do NOT have SendGrid keys.
- `AUTO_CANCEL_DRY_RUN=0` flipped to live mode — intentional, only operator/test transactions exist in prod.
- 64 historical v1 transactions still in `:state/accepted` show in auto-cancel cron logs as `not on default-booking v3+, skipping`. Operational debt; harmless. Version-gate working correctly (10.0 PR-4 fix `>= 3` not `=== 3` is doing its job).

**Code commits (5, all on `main` and deployed):**
- `5fc6712bf` — 3.2-SMS borrower + 3.2b-SMS lender copy refresh in `sendAutoCancelUnshipped.js`. Switched 3.2b URL from per-listing `shortLink` to static `https://sherbrt.com/listings` (ManageListingsPage). Lender earnings amount now uses `calculateLenderPayoutTotal` + `formatMoneyServerSide` from `api-util/lenderEarnings` — same source of truth as 1-SMS / 1a-SMS / 1b-SMS so the four lender-side messages can never drift on the figure shown.
- `ccfc9dd0e` — 4-SMS outbound-shipped copy aligned to workbook in `webhooks/shippoTracking.js` lines 1226 (production webhook) + 1471 (test/diagnostic path). New copy: `🚚 Sherbrt 🍧: "[item]" is on its way! Tracking info: [link].`
- `7813c380f` — Added `lender-request-reminders` cron block to `render.yaml` (documentation-only — service was already live in Render UI). Updated CLAUDE_CONTEXT note.
- `78ae68858` — `render.yaml` drift cleanup: removed legacy `shipby-reminders` worker block (script not deployed, superseded by `sendShippingReminders.js`); added `shipping-reminders` cron block (3.1 + 3.1b SMS); rebuilt the deployment-config note. CLAUDE_CONTEXT deployment table now matches Render dashboard 1:1 (1 web + 2 workers + 3 cron jobs = 6 active services).
- `43655e552` — Switched user-facing `cancelled` → `canceled` (American spelling) in 3.2 + 3.2b SMS copy + the matching internal log line. Sharetribe API state-string checks (`state === 'cancelled'`) intentionally retained — must match upstream API.

**Workbook v12** (saved locally at `/Users/amaliabornstein/shop-on-sherbet-cursor/sherbrt_transaction_comms_v12.xlsx`):
- **Log tab:** new row 1b-SMS (22h final warning to lender, bypasses quiet-hours, tag `lender_request_reminder_22h`); 1-SMS / 1a-SMS copy refreshed to match shipped code (`You have 24hrs to accept`, `Just tap before it expires`); 3-SMS / 3.1 / 3.1b notes refreshed for Shippo-anchored ship-by; 3.2 / 3.2b copy + timing rewritten (anchored to bookingStart + 12h scan-lag, NOT shipByDate; ManageListingsPage URL; earnings via shared helper; American spelling); deprecated 5-SMS row deleted; 4-SMS copy aligned with deployed code; 6-SMS copy aligned with deployed code.
- **Legend tab:** Ship-by-logic row rewritten for Shippo-anchored model; new entries for Lender accept window (24h, 2-phase escalation, quiet-hours rules) + Auto-cancel scan-lag grace (12h buffer + Monday-shift math).
- **Test Scenarios tab:** dropped Pre-Test Blockers + Post-Deploy Findings sections (all work shipped); rebuilt all 6 scenarios in Log-aligned column format with separate "Expected to FIRE" + "Must NOT fire" sub-tables; Scenario 2 now expects 1b-SMS at 22h; Scenario 4 reflects `AUTO_CANCEL_DRY_RUN=0` + scan-lag-grace observable.
- **PR-4 Instructions tab** renamed to `Late-Fee Charging Dry-Run` (content unchanged).

**Listing-specific calendar quirk surfaced during Scenario 1 setup (NOT a code bug):**
- One specific listing blocks all May 2026 dates when start = Apr 30 selected.
- Confirmed by code trace: `BookingDatesForm.js:168` `getBookableRange` correctly clamps end-date picker to the time slot's `end` attribute. The listing's Sharetribe time slot covering Apr 30 ends on May 1 (exclusive) → all May correctly blocked.
- Lender confirmed availability is open in Console UI, but symptom persists. Likely cause: stale time-slots cache or stale `protectedData` on the listing from a one-off script in the past. Did NOT investigate further.
- **Workaround:** use a different listing for IDEAL testing. Class of issue is listing-specific data, not global code.

**Open / pending items for next session:**
1. **Sharetribe Console → Content → Email templates → review `booking-expired-request`** for stale "6 days" / "within a week" language before testing Scenario 2 (the borrower receives this email when the v5 24h auto-expire fires). The in-repo template is generic ("didn't respond on time, so your request expired") — but Sharetribe Console can have a marketplace-specific override that may be stale.
2. **Future cleanup PR:** delete legacy `sendShipByReminders.js` + its `.persist.test.js` test file (functionality fully superseded by `sendShippingReminders.js`; service no longer deployed; flagged in `render.yaml` comments).
3. **Workbook v12 → Drive:** local copy still needs uploading.
4. **Continue Scenario 1 → 2 → 3 → 4 → 5 → 6** in the v12 Test Scenarios tab order. All comms verified wired and deployed. No blockers.

**Where we left off:** Scenario 1 (IDEAL) is in flight. The test transaction will be the first booking on Sharetribe v5 (alias just shows 0 transactions). Borrower side encountered the listing-specific calendar quirk above — switched to a different listing to continue.

### 10.0 — Shippo-Anchored Ship-By + 24h Lender Expire + Acceptance Hardening (April 23, 2026)

**Status:** ✅ Shipped end-to-end same day as the env-drift incident (below) that triggered it. All 5 atomic PRs merged, process.edn v5 alias flipped live, deploy verified.

**What shipped:** A comprehensive rewrite of the shipping + lender-acceptance architecture that replaces static env-var-driven ship-by computation with Shippo-anchored derivation, adds rate-lock between checkout and accept to eliminate silent revenue leaks, tightens the lender acceptance window from 6 days to 24 hours with 2-phase SMS escalation + a MISSED_FINAL watchdog, adds a 12-hour scan-lag grace to auto-cancel, and fixes a version-gate blocker that would have silently disabled auto-cancel marketplace-wide on the v5 alias flip.

**PRs merged (in deploy order):**
- PR-5 (#55): `server/scripts/sendAutoCancelUnshipped.js` — 12h scan-lag grace buffer. Prevents premature cancels when a carrier hasn't yet propagated the scan (USPS often 4-12h behind physical drop). `SKIP reason=scan-lag-grace hoursPastDeadline=X.X` log event structurally parallel to overdue's `daysLate <= 1` guard at `lateFees.js:294`. Compounds intentionally with the existing Monday-start grace: 60h post-bookingStart cancel window for Mon-start, 36h for other weekdays.
- Bundle PR (#56): 3 atomic commits (`5a4a0230a` + `e67702b37` + `6ff722b3c`) + 1 follow-up (`dbf6f83fd`) — expanded `preferredServices` to 6 entries (added USPS Priority Mail Express, UPS 2nd Day Air, UPS Next Day Air Saver), fixed the `estimateOneWay` name-builder bug (was reading undefined `r.service` under modern Shippo SDK shape — filter matched nothing, fallback silently picked cheapest-of-all-rates), refactored `pickCheapestAllowedRate` to actually filter by `preferredServices` and take `daysUntilBookingStart` directly, added `pickCheapestPreferredRate` for return labels (always-cheapest, no deadline), implemented Shippo-anchored `computeShipByDate` (persisted-first, `transitDays + SAFETY_BUFFER_DAYS` business-day-subtracted, PT-based), added rate-lock at checkout (`outbound.lockedRate` + `return.lockedRate`), implemented CC Option 6 at accept (always-use-locked-rate, no feasibility re-check, no fallback re-selection — eliminates the delta class entirely), added trademark-symbol stripping to `nameOf` (® U+00AE, ™ U+2122) after a live Shippo probe found `"UPS 2nd Day Air®"` and `"UPS Next Day Air Saver®"` in the real response.
- PR-4: `process.edn` v5 (`:transition/expire` `P6D` → `PT24H`), `sendAutoCancelUnshipped.js:143` `processVersion !== 3` → `< 3` blocker fix, `sendLenderRequestReminders.js` 2-phase escalation (60m respects quiet-hours, 22h bypasses), MISSED_FINAL watchdog with 1h Redis dedupe preventing 2x count inflation across consecutive 15-min cron ticks within the 30-min lookback, `initiate-privileged.js` 1-SMS copy update (`"Tap to review & accept"` → `"You have 24hrs to accept"` + comma splice after title per operator-approved template).

**Deploy sequence executed:**
1. Merged PR-5, auto-deployed via Render
2. Merged Bundle PR, auto-deployed
3. Merged PR-4, auto-deployed
4. `flex-cli process push --process default-booking -m sherbrt` → `Version 5 successfully saved`
5. `flex-cli process list` → confirmed v5 exists, alias still v4
6. `flex-cli process update-alias --alias release-1 --process default-booking --version 5 -m sherbrt`
7. `flex-cli process list` → alias now v5 ✓

**Scope doc:** `docs/10.0_shippo_anchored_shipby.md` — full architecture + policy decisions (14 locked) + atomic PR breakdown. v3.1 was the final version shipped after 3 CC pre-implementation review rounds (round 1 caught 2 blockers including the processVersion gate issue, round 2 caught 3 pseudocode bugs including a TypeError on every computeShipByDate call, round 3 signed off ✅ READY TO IMPLEMENT).

**Tests added:** ~78 new assertions across 11 new test files (PR-5: 5, Bundle PR-1: 21, Bundle PR-2: 21, Bundle follow-up ® fix: 8, PR-4: 22 including 2 for the MISSED_FINAL dedupe). Full server sweep: 198 total, 186 pass, 12 pre-existing failures in `shipping-estimates.test.js` / `shippingLink.spec.js` unchanged (pre-date this work, confirmed unrelated via git stash comparison).

**New architectural guarantees post-10.0:**
- Borrower checkout cost = actual label cost, always. No silent deltas absorbed by Sherbrt. Zero cost-mismatch class.
- Ship-by date persisted once at label purchase, read by all downstream consumers. No more env-var drift between web service and crons (which caused the April 23 3.1b miss).
- Short-lead cross-country bookings correctly land on expedited services (UPS 2nd Day Air, UPS Next Day Air Saver) instead of silently picking cheapest-of-all with a transit time that wouldn't arrive before booking start.
- Return shipping decoupled from outbound's deadline; always picks cheapest preferred service.
- Lenders have 24h (not 6 days) to respond. Two SMS escalations (60m gentle, 22h final warning with quiet-hours bypass). MISSED_FINAL watchdog measures any silent misses.
- Auto-cancel has 12h scan-lag grace so a lender who dropped the package at 11:50pm PT doesn't get prematurely cancelled when USPS doesn't scan until 6am next morning.
- Auto-cancel version gate uses `>= 3` instead of `=== 3`, so v5 and future process.edn bumps don't silently disable the feature.

**Pre-merge operator checks completed during rollout:**
- Shippo service-name format probe (LA→NYC test rate-fetch) confirmed 4/6 preferredServices strings match exactly and 2/6 needed the `®` fix (applied via follow-up commit `dbf6f83fd` with `.replace(/[®™]/g, '')` in the `nameOf` helper).
- Shippo Dashboard → Carriers confirmed UPS + USPS active with required services.

**Pending post-merge items to revisit** (not blocking, tracked here for next session):
1. Review Sharetribe Console → Content → Email templates → `booking-expired-request` for stale "6 days" / "within a week" language. Update to "24 hours" or make generic. Pre-merge operator checklist item from the scope doc; not yet verified.
2. Mid-window reminder SMS for long-lead bookings (between accept and 24h-before-ship) — add to `sherbrt_transaction_comms_v11.xlsx` future comms tab in a dedicated follow-up session with operator.
3. Critical-path monitoring/alerting session — build operator email/SMS notifications for Shippo outages, cron failure states, Render service health. Separate from 10.0 scope.
4. Listing-search validation — prevent showing listings to borrowers when the zip-pair + booking-start combination is infeasible even with expedited service. Deferred from 10.0.
5. Re-compute `outbound.shipByDate` on zip change post-accept — deferred edge case from 10.0.

**Data structure additions:** `outbound.lockedRate` and `return.lockedRate` (both `{rateObjectId, estimatedDays, amountCents, provider, servicelevel}`). `outbound.shipByDate` is now the authoritative read path for all consumers — the shared `computeShipByDate` in `lib/shipping.js` prefers this value and logs `[ship-by:persisted]` when used; falls back to compute-from-rate (logs `[ship-by:computed] mode=shippo-anchored`) or compute-from-fallback (logs `[ship-by:computed] mode=static-fallback`) only when persisted value is absent.

**Env var additions:** `SHIP_SAFETY_BUFFER` (default `1`). `SHIP_LEAD_DAYS` retained as fallback floor only.

### SHIP_LEAD_DAYS env drift on Lender Shipping Reminders cron — root cause for missing 3.1b SMS (April 23, 2026)

**Symptom surfaced during Scenario 1 QA:** Lender Monica D accepted a booking at 8:26 PM PT on Apr 21 for an Apr 23 start. The 3-SMS correctly fired at accept with "Ship by Apr 22." The 3.1b end-of-day unshipped reminder (expected Apr 22 3-5 PM PT window) never fired, even though the lender didn't ship. Cron summary showed `EndOfDay=0, Processed=65` across all hourly ticks.

**Root cause (concrete):** `SHIP_LEAD_DAYS=1` set on `shop-on-sherbet` web service, but NOT set on the `Lender Shipping Reminders` cron — the cron fell back to the code default of `2` in `server/lib/shipping.js:24`. Web service computed ship-by = Apr 23 − 1 = **Apr 22** (what the 3-SMS told the lender). Cron independently recomputed ship-by = Apr 23 − 2 = **Apr 21**. At each Apr 22 cron tick, `isShipByDay` at `sendShippingReminders.js:463` compared cron's Apr 21 against today's Apr 22 → false → skipped the EOD branch. The `[ship-by:static] { chosenLeadDays: 2 }` log line (printed 65x per run, once per accepted tx) is the literal smoking gun.

**Mechanism — `computeShipByDate` never reads persisted values:** Even though `transition-privileged.js:976` already persists `outbound.shipByDate` to protectedData at label purchase, the function at `shipping.js:149-211` always recomputes from scratch using whatever `SHIP_LEAD_DAYS` each service has. Services drift silently.

**Fix class:** Same category as the April 21 Overdue cron F1/F2/F4 config drift — Render env vars and cron schedules are PER-SERVICE, and `render.yaml` is documentation-only on this project.

**Immediate mitigation:** Skipped the config-only `SHIP_LEAD_DAYS=1` patch on the cron in favor of the structural fix — Shippo-anchored shipByDate persisted at label purchase, read by all consumers via `computeShipByDate` in the shared lib (no more per-cron recomputation with per-cron env vars).

**Structural fix: ✅ SHIPPED same day.** See the "10.0 — Shippo-Anchored Ship-By + 24h Lender Expire + Acceptance Hardening (April 23, 2026)" entry above for full shipped-state details. All 5 atomic PRs merged, process.edn v5 alias live, `protectedData.outbound.shipByDate` is now authoritative source-of-truth read first by every downstream consumer. The env-drift class of bug cannot recur via this code path — `computeShipByDate` reads the persisted value and only falls back to a fresh compute when the persisted value is absent (Shippo outage or pre-10.0 tx). Per-service `SHIP_LEAD_DAYS` drift is demoted from "breaks SMS flow" to "last-resort fallback that only matters during Shippo outages."

**All current prod transactions at time of rollout were operator/QA tests** (amalia running as both borrower and lender across listings). Safe to roll out the Shippo-anchored rewrite without impacting real marketplace activity.

### Overdue cron Render config drift — post-9.2 validation (April 21, 2026)

Three Render dashboard config issues surfaced while validating the 9.2 PR on the **Overdue / Late-Fee Reminders & Charges** cron. All were config-only (no code change, no deploy).

**F1 — SendGrid key missing on cron service.** `SENDGRID_API_KEY` was set on the main `shop-on-sherbet` web service but never propagated to the overdue cron. `emailClient.js` init logged `hasKey: false` → day-6 ops alert (9.6-Email) and daily digest (9.7-Email) had NEVER fired in production despite being marked "Verified" in the Log tab. **Fix:** copied `SENDGRID_API_KEY` from web-service env vars to cron env vars via Render → Environment tab. No deploy needed.

**F2 — Schedule drift.** PR-3a updated the code's run-time assumption to 17:00 UTC but didn't touch the Render cron schedule, which stayed at 09:00 UTC. The cron ran, just 8 hours earlier than `withinSendWindow()` and the quiet-hours gate assumed. **Fix:** changed Render cron schedule to `0 17 * * *` (17:00 UTC = 10 AM PT).

**F4 — `EMAIL_FROM_ADDRESS` missing on cron service.** `emailClient.js:37` gates on `SENDGRID_API_KEY && EMAIL_FROM_ADDRESS` — both must be set. Only the API key was added in F1, so emails were still being silently skipped. **Fix:** added `EMAIL_FROM_ADDRESS='Sherbrt <notifications@sherbrt.com>'` (same value as web service). Post-fix cron runs show `from: 'Sherbrt <notifications@sherbrt.com>'`.

**Lesson:** Render env vars and cron schedules are PER-SERVICE. When a code change updates an assumed schedule or introduces a new env-var dependency, the corresponding Render dashboard config must be updated on every worker/cron that runs that code, not just the main web service. Easy to miss since `render.yaml` is documentation-only on this project.

**Overdue pipeline is fully operational as of April 21 post-9.2.1** — SendGrid key present, from-address set, clean process exit, correct schedule. Trigger-runs complete with "Successful run" status; emails will land at `amalyb@gmail.com` (the `OPS_ALERT_EMAIL` default) once real overdue data exists. **Log tab "Verified" status on 9.6-Email + 9.7-Email was technically incorrect before today and should be re-verified through Scenario 5 of the live QA plan.**

### 9.2.1 — overdue cron clean exit (April 21, 2026)

**Shipped commit:** `9b764e1` (PR #54), squash-merged on top of `bb51f1f`.

**File:** `server/scripts/sendOverdueReminders.js:936-938` (the no-flag `else` branch of the `require.main === module` block).

**Current behavior before fix:** Script called `sendOverdueReminders()` without `await` and without an explicit `process.exit()`. Async work completed correctly (candidates processed, SMS fired when applicable, summary printed), but ioredis + Sharetribe SDK keep-alive connections held the event loop open. Render's cron timeout force-killed the process minutes later. Every daily run was marked "Failed" in Render's event feed despite work completing. Symptom: daily "cronjob failed" Render notification emails to the operator; false-failure signal that would have masked real failures during Scenario 5.

**Fix:** Wrapped the call in `.then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); })`, matching the entry-point pattern used by `sendAutoCancelUnshipped.js --once`.

**Verification:** Post-deploy trigger-run completes in <60 seconds with "Successful run" in Render's event feed. stdout ends with `✅ Overdue reminders script complete, exiting.` — no more `[redis] connect / [redis] ready` reconnect loops between the summary block and the cron timeout.

**Out of scope (not touched):** `--daemon` branch (intentional long-running with internal `setInterval`), `--test` branch, function body of `sendOverdueReminders()`. The other crons (`sendAutoCancelUnshipped --once`, `sendShippingReminders`, `sendLenderRequestReminders`) already exit cleanly; no pattern sweep needed.

### 9.2 pre-QA fixes — eliminate silent-failure paths (April 21, 2026)

**Shipped commit:** `bb51f1f` (PR #53) — squash-merge containing 7 atomic commits (B1 / B2 / B3 / H1 / H2 / H3 + a test-relocation housekeeping commit for `npm run test-server` glob compatibility).

Pre-QA code review on April 21 identified 3 BLOCKERS + 2 HIGH + 1 follow-on silent-failure bug in the transaction-comms pipeline. All fixed in one PR before the live-data QA plan (see `sherbrt_transaction_comms_v10.xlsx` → "Test Scenarios" tab) could run Scenarios 4 and 5.

**B1 — `OVERDUE_FEES_CHARGING_ENABLED` undefined (`sendOverdueReminders.js:590`):** The identifier was used inside the `overdue.charge.skip` JSON-log event but never imported or declared in the file (only `applyCharges` was destructured from `lateFees.js`; the const is not exported). Every skip-path log emit threw `ReferenceError`, caught as `overdue.charge.error`, bumped `chargesFailed++`. Pre-fix dry-run logs showed every skipped tx as a charge failure, defeating PR-4 analysis. **Fix:** read from `process.env.OVERDUE_FEES_CHARGING_ENABLED === 'true'`, mirroring the pattern at line 213.

**B2 — Orphan `transition/store-shipping-urls` (`shippoTracking.js:1346,1353`, `resendDeliverySms.js:128`):** This transition does NOT exist in any version of `process.edn`. Calls 400'd with `unknown-transition`, caught-and-logged ("Failed to update transaction protectedData"), no `protectedData` ever landed. Cascade: (1) `outbound.firstScanAt` never set → `hasOutboundScan()` returned `false` for every shipped tx → `sendAutoCancelUnshipped` would have cancelled shipped bookings once `AUTO_CANCEL_DRY_RUN=0`, issuing refunds to borrowers holding items and leaving lenders out of pocket; (2) `shippingNotification.delivered.sent` never set → webhook retries re-sent the delivery SMS (6-SMS); (3) `sendShippingReminders.isOutboundScanned()` returned `false` → 24h/EOD ship-by reminders still fired for shipped items. **This is the single biggest reason `AUTO_CANCEL_DRY_RUN=1` has stayed on so long — the "would-cancel" dry-run logs have been full of false positives for every shipped booking, making it impossible to judge readiness to flip.** **Fix:** replaced all three call sites with `upsertProtectedData(txId, {...}, {source: 'webhook'})`. Deep-merge shape mirrors existing working calls at `shippoTracking.js:901` (return first-scan) and `:1102` (return delivered).

**B3 — 48h double-cancel path (`sendShippingReminders.js:237-241`):** `transition/cancel` block overlapped with `sendAutoCancelUnshipped`. Two cancel paths. The 48h legacy path sent NO SMS to the borrower — borrower got silently refunded. Because of B2, `isOutboundScanned()` always returned `false`, so even lenders who DID ship hit the 48h cancel if they were slow to scan. Any recent silent-refund-no-SMS prod behavior traces to this. **Fix:** deleted the 48h block + `cancelTransaction` helper entirely. `sendAutoCancelUnshipped.js` is now the sole cancel authority. Module-level comment added to prevent re-introduction: "Cancel policy for unshipped bookings lives in `sendAutoCancelUnshipped.js`. This script only sends ship-by reminders (24h, EOD); it does NOT cancel."

**H1 — Quiet-hours gate below Redis lock (`sendReturnReminders.js:621-642`):** `acquireRedisLock(perTxLockKey, 60*60*24)` ran at :621 BEFORE `if (!withinSendWindow()) continue` at :639. A quiet-hours tick (e.g. 7:45 AM PT) claimed the 24h lock, then saw it was too early and skipped. Subsequent ticks that day hit "lock held" and also skipped — the borrower lost their T-1/TODAY reminder entirely. The Pattern A claim in PR-3b ("15-min poll retries naturally in the send window") was silently broken. **Fix:** moved `withinSendWindow(getNow())` above `acquireRedisLock`, with `continue` log tag `[RETURN] SKIP quiet-hours tx=...` for observability.

**H2 — Third instance of `sdk.transactions.update` silent-fail (`sendReturnReminders.js:189`):** Same pattern as the April `sendLenderRequestReminders` and `sendShippingReminders` fixes. Integration SDK doesn't expose `txApi.update` / `updateMetadata` / `updateProtectedData` for transactions — writes threw, caught at :678/:702/:739, logged as "Failed to mark...as sent." Per-day Redis lock covered single-send-per-day, but `tMinus1SentAt`, `todayReminderSentAt`, `tomorrowReminderSentAt`, `returnSms.dueTodayLastSentLocalDate` never persisted + noisy error logs on every cron tick. **Fix:** replaced the `updateTransactionProtectedData` helper with `upsertProtectedData(txId, {returnSms:{...}}, {source:'return-reminders'})`. Helper deleted.

**H3 — Fourth instance (`sendShipByReminders.js:257`):** Same pattern, surfaced during the H2 fix. Added as a same-PR follow-on. **Post-fix sweep:** `grep -rE "sdk\.transactions\.update\s*\(" server/` returns zero active call sites. The pattern class is now fully retired across `server/**`.

**Deviation from original fix plan:** B2 required extending `ALLOWED_PROTECTED_DATA_KEYS` in `server/api-util/integrationSdk.js` to include `shippingNotification`, `lastTrackingStatus`, and `returnSms`. Without this, `upsertProtectedData` would silently drop those keys — the exact silent-failure symptom the fix resolves. `outbound` and `return` were already on the whitelist. **Lesson:** when introducing a new `protectedData` key path via `upsertProtectedData`, always verify the top-level key is on the allow-list first.

**Tests added:** 16 new regression-test assertions across 5 files: B1 (3), B2 (3 — first-scan persistence, webhook-retry idempotency, delivered persistence), H1 (3 — quiet-hours structural + lock-state), H2 (5 — 3 structural + 2 persistence), H3 (3 persistence). All pass. Pre-existing failures in `shipping-estimates.test.js` + frontend (12 total) unchanged from main baseline.

**Orphan-transition sweep clean:** `grep -r "transition/" server/ --include="*.js"` cross-referenced against `process.edn` v4 — every referenced transition exists in the live process, or is marked as a vestigial TODO with an explanatory comment. The `transition/privileged-set-overdue-notified{,-delivered}` TODO flagged in PR-2 was resolved during the PR-3a Redis migration (calls removed); no longer an orphan.

**Residual risk captured at review time (cosmetic only):** `server/test-flex-transition.js` still references `transition/store-shipping-urls`. It's a diagnostic probe script whose whole job is to check whether transitions exist — after B2 it will correctly report "no." Will retire in a future cleanup PR.

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
- Added TODO comment flagging that `transition/privileged-set-overdue-notified{,-delivered}` (called ~line 703 to persist `lastNotifiedDay` to Flex) don't exist in any process.edn variant — every SMS send silently fails this transition, dedupe falls back to in-memory `runNotificationGuard`, and a cron restart mid-run can re-send the same day's SMS. **Resolved in PR-3a Redis migration — the calls were removed when `overdueNotified:*` Redis dedupe replaced the protectedData-based flag. No longer an orphan.**

**Test regression update (`server/scripts/scenarioTests/deliveredWithoutScan.js`):**
- Docstring rewritten to describe the post-PR-2 policy.
- Assertion changed from `lateResult.scenario === 'non-return'` to `lateResult.charged === false && lateResult.reason === 'delivered-without-scan'`.
- Day-5 replacement block left as unreachable guard with a comment explaining why (if policy ever changes to resume charging in this state, the invariant re-activates automatically rather than silently dropped).

**SMS ↔ code alignment verified for Scenario B (never returned):** Day 1 "$15/day charging" SMS + $15 charge, Days 2-4 escalating SMS + $15/day, Day 5 hedged "may be charged replacement" + $15 daily continues (auto-replacement intentionally off via `AUTO_REPLACEMENT_ENABLED=false`), Day 6 committed "replacement will be charged" + $15 daily (manual replacement action by operator), Day 7+ hard stop (no SMS, no charge). Scenario A (returned late) gets charged but no SMS — correct, no reason to chase a returned item.

**Flag status unchanged:** `OVERDUE_FEES_CHARGING_ENABLED` still defaults `false`. No charges will land in Stripe until the flag is flipped in Render (PR-6). PR-2 is purely "the charging path now has real transitions behind it and the skip-reasons are symmetric between cron and lib."

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
- 9.0 ships as 6 atomic PRs with explicit ordering: **flag + gates first (PR-1)**, transitions second (PR-2), operational cleanup (PR-3a/b/c), staging dry-run (PR-4), structured logging (PR-5), then flip `OVERDUE_FEES_CHARGING_ENABLED=true` in Render (PR-6). Transitions-first was the original plan and would have big-banged every overdue tx at the next cron tick; reordered after CC review.
- 9.1 is the Day 1–6 copy refactor into a new `server/scripts/messages/overdueMessages.js` module (pure function per day + `buildOverdueMessage(daysLate, ctx)` helper). Day 1–6 copy rewritten with `${itemTitle}`, `${shortUrl}`, consistent Sherbrt preamble, and `bestie@sherbrt.com` help line on Days 1/4/5/6. **Hard prereq on 9.0** because Day 1 copy asserts `$15/day late fee now applies` — can't ship that claim until fees actually land in Stripe.

**PR-1 — defensive gates in `server/lib/lateFees.js` (commit `b1cf60b8d`)**:
- Added four top-of-file constants: `LATE_FEE_CENTS` (with `LATE_FEE_CENTS_OVERRIDE` env hook for $0.50 staging dry-run), `OVERDUE_FEES_CHARGING_ENABLED` (defaults `false`), `MIN_PROCESS_VERSION_FOR_LATE_FEES = 3`, `MAX_CHARGEABLE_DAYS = 6`.
- Gate 1 (processVersion floor): returns `{ charged: false, reason: 'processVersion-too-old' }` for anything < v3.
- Gate 2 (day-6 cap): returns `{ charged: false, reason: 'exceeded-max-chargeable-days' }` past Day 6 — defense-in-depth alongside the cron's own Day 7+ hard-stop.
- Gate 3 (feature flag): short-circuits **immediately before** `sdkInstance.transactions.transition(...)` with `{ charged: false, reason: 'feature-flag-disabled', wouldCharge: [...] }`. Crucially, this short-circuits before the SDK call, so the missing-transition error is never triggered — next cron pass logs clean `feature-flag-disabled` with the `wouldCharge` line items instead of `unknown-transition`.
- Safe to deploy anytime because the flag is off by default; transitions can still be missing and nothing breaks.

**Gotchas captured in scope docs:**
- `shortLink()` stores in Redis with a 21-day TTL (`SHORTLINK_TTL_DAYS`, `server/lib/env.js:83`) and mints a new token every cron pass, so the short link itself never expires inside the 6-day overdue window. The real expiration risk is the **underlying Shippo URL** the short link wraps — USPS QR return codes (`pd.returnQrUrl`) ~180 days, Shippo PDF labels (`pd.returnLabelUrl`) ~30 days. Optional HEAD-check mitigation deferred.
- There is no Slack webhook integration in this codebase. PR-5's structured logging is stdout JSON parsed by Render's log drain; any Slack/email alerting is a separate follow-up.
- `AUTO_REPLACEMENT_ENABLED` stays `false`. Day 7+ hard-stopped in both the cron and `applyCharges()`.

**9.0 PR status (as of April 21, 2026):**
- PR-1 ✅ shipped (commit `b1cf60b8d`). Defensive gates in `lateFees.js`: feature flag, processVersion floor, LATE_FEE_CENTS_OVERRIDE env hook.
- PR-2 ✅ shipped April 15, 2026 (commit `a1d808579`, process v4 live). See the "9.0 PR-2" section above for full details.
- PR-3a ✅ shipped April 16, 2026 (commits `ace2e68a0` + `bdcff51c0`). Charging-path correctness: Redis SMS dedupe migration (`overdueNotified:*` keys), unified daily $15 charging with `hasScan` stop-check, scan-lag-grace guard (`daysLate <= 1`), count-based $75 cap (5 charges, `code === 'late-fee'`), cron time to 17:00 UTC, `diagnose-overdue.js` Redis migration, URL guard for return label, 5 new scenario tests. CC reviewed + signed off on blocker fixes.
- PR-3b ✅ shipped April 16, 2026 (commit `be50062b8`). Operational emails + SMS quiet-hours:
  - §3b.1: Day-6 fire-and-forget operator email alert via SendGrid (`.catch()` wrapper, `DRY_RUN` respected, rides SMS Redis dedupe). Recipient: `OPS_ALERT_EMAIL` env var (defaults `amalyb@gmail.com`).
  - §3b.2: Daily late-fee digest email (`sendLateFeeDigest` helper). Model B buckets: `charged` + `skipped_*` only (no `day6_hard_stop`). Sent after for-loop, gated by `!DRY_RUN`.
  - §3b.3: `withinSendWindow()` in `server/util/time.js` (8 AM – 11 PM PT, respects `getNow()`/`FORCE_NOW`). Pattern A gates on `sendReturnReminders.js` (1 gate), `sendShippingReminders.js` (3 gates: 24h/eod/cancel), `sendShipByReminders.js` (1 gate). Pattern B gate on `sendLenderRequestReminders.js` (MAX_AGE_MS widened from 80 min → 13h, `withinSendWindow(getNow())` before markInFlight).
  - CC reviewed + signed off. Cleanup fixes applied: duplicate const removal (N1), JSDoc example fix (N2), stale comment update (N5).
- PR-3c ✅ shipped April 16, 2026 (commit `e59de3c42`). Comment cleanup in `lateFees.js`: updated AUTO_REPLACEMENT_ENABLED, isScanned(), getReplacementValue() docstrings, removed stale "Scenario B" label. Comment-only diff.
- PR-4: staging dry-run — operational step (no code change). Set `OVERDUE_FEES_CHARGING_ENABLED=true` + `LATE_FEE_CENTS_OVERRIDE=50` in Render, verify $0.50 charge in Stripe + `chargeHistory` advances. Requires an overdue test transaction. **Unblocked as of April 21 2026 after 9.2 + 9.2.1 + config drift fixes** — will run as Scenario 5 of the live QA plan (see `sherbrt_transaction_comms_v10.xlsx` → "Test Scenarios" tab).
- PR-5 ✅ shipped April 16, 2026. Structured JSON logging in `sendOverdueReminders.js` charge path: `overdue.charge`, `overdue.charge.skip`, `overdue.charge.error`, `overdue.charge.dryrun` events. Render log drain can filter on `event` field.
- PR-6: flip `OVERDUE_FEES_CHARGING_ENABLED=true` (remove `LATE_FEE_CENTS_OVERRIDE`) in Render console. Final step after PR-4 / Scenario 5 confirms pipeline works end-to-end.
- 9.1 copy refactor (blocked on 9.0 completing). Day-1 copy softened to "may apply" (scan-lag rule means we can't confirm lateness on day 1). Days 4-5 tightened ("$15/day late fee continues"). Day-6 softened to "may be charged" (not "will be charged" — matches days 4-5 framing, legally safer since replacement is operator-discretionary). Message-map JS updated to match. See `docs/9.1_overdue_copy_refactor.md` (committed `70399793a`).
- **9.2 pre-QA fixes ✅ shipped April 21, 2026 (commit `bb51f1f`, PR #53).** Eliminated 3 BLOCKERS + 2 HIGH + 1 follow-on silent-failure bugs found during pre-QA code review: B1 (undefined env var in overdue skip-path log), B2 (orphan `transition/store-shipping-urls` — the big one, unblocks `AUTO_CANCEL_DRY_RUN=0`), B3 (48h double-cancel path deleted), H1 (quiet-hours gate reordered above Redis lock in return reminders), H2 + H3 (retired `sdk.transactions.update` pattern across return + ship-by reminders — all four instances of this class now fixed). 16 new regression tests. Deviation: `ALLOWED_PROTECTED_DATA_KEYS` whitelist extended for B2. See "9.2 pre-QA fixes" section above for details.
- **9.2.1 ✅ shipped April 21, 2026 (commit `9b764e1`, PR #54).** One-line entry-point fix to `sendOverdueReminders.js` — wraps the call in `.then(process.exit(0))` / `.catch(process.exit(1))`. Previously every run was marked "Failed" in Render despite work completing, because open Redis/SDK keep-alives held the event loop until cron timeout. See "9.2.1" section above.
- **Overdue cron Render config drift ✅ resolved April 21, 2026.** Three dashboard config issues (F1: SendGrid key missing on cron service, F2: cron schedule at 09:00 UTC instead of 17:00 UTC, F4: `EMAIL_FROM_ADDRESS` missing) discovered during post-9.2 validation. All config-only fixes. 9.6-Email and 9.7-Email had never actually fired in production prior to these fixes — Log tab "Verified" status should be re-verified through Scenario 5. See "Overdue cron Render config drift" section above.

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
- `outbound.shipByDate` — ISO timestamp of ship-by date. **Authoritative source-of-truth as of 10.0 PR-2 (April 23, 2026)** — derived from Shippo's selected rate `estimated_days` + `SAFETY_BUFFER_DAYS`, business-day-subtracted. `computeShipByDate` in `lib/shipping.js` reads this FIRST before any recomputation.
- `outbound.lockedRate` — `{rateObjectId, estimatedDays, amountCents, provider, servicelevel}` persisted at borrower checkout (10.0 PR-2). At lender accept, `transition-privileged.js` purchases this exact `rateObjectId` from Shippo — guarantees borrower preauth cost matches actual label cost.
- `return.lockedRate` — same shape as `outbound.lockedRate`, for the return label. Return shipping always picks cheapest preferred service, no deadline filter.
- `outbound.labelUrl` / `outboundTrackingNumber` — Shippo outbound shipment data
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

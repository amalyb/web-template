# DRAFT — Task #30 writeup for CLAUDE_CONTEXT

This is a draft entry to append to `CLAUDE_CONTEXT.md` under the "Recent Fixes & Gotchas" section, dated May 1, 2026 (same day as the task #29 ship). It corrects the prior framing in the April 29 entry which described task #30 as "false-positive log / cosmetic noise in production logs" — investigation during the task #29 work proved both halves of that framing were wrong. It is real, it is silently lossy, and several downstream features depend on data this code path is supposed to be persisting.

Review, edit, and commit when ready. Two suggested commit shapes:

- **Standalone commit:** `docs(context): correct task #30 framing — silent persistence loss, not cosmetic noise` — clean for git history, easy to revert if I got something wrong here.
- **Fold into a future #30-fix commit:** if you want the doc to land alongside actual code fixes for #30, append the body of this file to that commit's `CLAUDE_CONTEXT.md` change and skip the standalone commit.

---

# Append below the May 1 task #29 entry, before the April 30 Cloudflare 307 entry

### May 1, 2026 — Task #30 framing correction (silent persistence loss, not cosmetic noise)

**Prior framing was wrong.** The April 29 entry called the
`[VERIFY][ACCEPT] Missing providerZip after upsert!` warning a
"false-positive log / cosmetic noise in production logs." Investigation
during the task #29 work proved this is wrong on both halves: the
warning is real, and the persistence loss it surfaces affects downstream
features that read `tx.attributes.protectedData.*`.

**What's actually happening.** `server/api-util/integrationSdk.js`'s
`txUpdateProtectedData` shapes its request body as
`{ metadata: { protectedData: pruned } }` and calls
`sdk.transactions.updateMetadata({ id, ...body })`. The Sharetribe
Integration API's `transactions/update_metadata` endpoint writes to
`tx.attributes.metadata` — NOT `tx.attributes.protectedData`. Whatever
you pass under `metadata` becomes the literal value of that field. Our
shape causes data to land at `tx.attributes.metadata.protectedData.X`
instead of the intended `tx.attributes.protectedData.X`. Verified by
extending `scripts/diag-tx-address.js` to read both paths on the
failing tx records — the keys we expected on `protectedData` exist
under `metadata.protectedData` (or are missing entirely; see clobber
discussion below).

The existing test at `server/api-util/integrationSdk.lockedRate.test.js:44`
verifies the wrapper shape (`mockUpdateMetadata.mock.calls[0][0].metadata.protectedData`)
but does NOT verify where the data actually lands on the transaction
record. So the misuse was structurally invisible to the test suite.

**Compounding bug — top-level clobber.** Sharetribe's `update_metadata`
endpoint replaces the entire `metadata` field wholesale (no
server-side merge across calls). Two `upsertProtectedData` calls in
the same accept flow:

1. First write: keys `[providerStreet, providerZip, ..., outbound, return]`
2. Second write: keys `[outbound]` only (when `outbound.acceptedAt` is set)

The second write sends `{ metadata: { protectedData: { outbound: {...} } } }`
which replaces the entire `metadata` object. The provider* and customer*
keys from the first write are wiped. Confirmed by reading
`tx.attributes.metadata` of `69f28897` and `69f0f9a8` — the only key
that survives in `metadata.protectedData` is `outbound`. The existing
test guards the inner-level clobber (`outbound.lockedRate` survival
inside `outbound`) but not the outer level.

**Why customer addresses still appear correct in
`tx.attributes.protectedData`.** The customer fields (`customerStreet`
etc.) get set during checkout via `transition/request-payment` /
`transition/confirm-payment`. The marketplace process for those
transitions has `actions.update-protected-data` wired up, so
`params.protectedData` on the transition itself persists. That's the
correct path. The doomed `updateMetadata` path is a SEPARATE write
that only runs at accept time for provider* fields, which is why the
data loss is selective.

**Why outbound labels work despite the persistence loss.**
`createShippingLabels` reads from the in-memory `params.protectedData`
(passed through from the request body), never re-fetches the
transaction. So the address data Shippo gets is correct regardless of
what's persisted. Task #29's address-validate fix uses the same
in-memory addresses and re-rates against fresh shipments, so it works.
**This is luck, not design.** Any feature that re-fetches the
transaction after accept silently gets back stale data.

**Blast radius — features actually broken today.** Anything that reads
`tx.attributes.protectedData.<X>` for `<X>` in the
`ALLOWED_PROTECTED_DATA_KEYS` whitelist after an `updateMetadata`-only
write:

- **`shippoTracking.js` webhook handlers** (lines 401, 437, 1208, 1455):
  reads `tx.protectedData.outbound.firstScanAt`,
  `tx.protectedData.outboundTrackingNumber`,
  `tx.protectedData.shippingNotification.firstScan.sent` — all written
  via `upsertProtectedData`. Webhook payloads from Shippo could match
  the wrong tx, miss first-scan SMS, or fail idempotency dedupe.
- **Ship-by SMS reminders** (`scripts/sendShipByReminders.js`): reads
  `tx.protectedData.outbound.shipByDate` and
  `tx.protectedData.outbound.firstScanAt`. Reminders may fire for
  packages already scanned, or skip packages that need them.
- **Return-T-minus-1 reminders** (`scripts/sendReturnReminders.js`):
  reads `tx.protectedData.return.tMinus1SentAt` for dedupe. Could
  re-fire reminders.
- **Auto-cancel-unshipped cron**
  (`scripts/sendAutoCancelUnshipped.js`): reads
  `tx.protectedData.shippingNotification` via `hasOutboundScan(tx)`.
  Could auto-cancel transactions that were actually shipped.
- **Lender outbound label email idempotency**: reads
  `tx.protectedData.lenderOutboundLabelEmailSent`. Could double-send
  emails.
- **Borrower return label email idempotency**: same pattern with
  `borrowerReturnLabelEmailSent`. Could double-send emails.
- **Return label generation** at accept: reads
  `tx.protectedData.providerStreet/etc` to gate the return-shipment
  call. The accept-time params pass through correctly, but if a webhook
  later writes `outbound.firstScanAt` and we re-evaluate gating from
  the persisted tx, we'd see empty fields and skip generation.

In practice, the most-frequent observable symptom is webhook
mis-matching for tracking events — which would manifest as missing
first-scan / delivered SMS or overdue reminders firing on already-
delivered packages. None of these have been reported by users to date,
which is consistent with the low test-tx volume and Sherbrt's
operator-mediated test scenarios so far.

**Why this hasn't blocked production. Yet.** Three things have masked
the symptom:

1. The accept-time `params.protectedData` flow has carried address
   data correctly through the in-memory path that `createShippingLabels`
   actually uses.
2. Phone/email come from the listing author's
   `relationships.provider.data.attributes.profile.protectedData.phone`
   (separate read path), so SMS sending hasn't broken.
3. Test-tx volume is low and most flows have been operator-driven, so
   anomalies in webhook delivery / reminder timing are absorbed
   without being attributed to this bug.

When real user volume hits, especially when overdue / first-scan
reminders need to fire reliably, this will start surfacing as
"reminders fire when they shouldn't" or "first-scan SMS missing."

**Recommended architectural fix (next session).**

The right path is **option A** from prior analysis: introduce a
privileged transition like `transition/operator-update-protected-data`
in the marketplace process (Sharetribe Console change) that has
`actions.update-protected-data` enabled. Then change
`server/lib/txData.js` `upsertProtectedData` to call this transition
via the integration SDK instead of `transactions.updateMetadata`. The
transition's params.protectedData genuinely merges into the
transaction's `protectedData` field. Existing readers don't change.
This is the durable fix.

Two cheaper alternatives we explicitly rejected for the long-term fix
but might use as a band-aid:

- **Option B — fall-back readers.** Update every reader of
  `tx.attributes.protectedData.<X>` to also check
  `tx.attributes.metadata.protectedData.<X>` if undefined. Doesn't fix
  the architecture (writes still go to the wrong field), and adds
  lookup overhead at every read site. Sharetribe support also
  effectively becomes a black box for diagnosing where data is —
  half-working state confuses humans more than it helps.
- **Option C — switch the wrapper.** Change `txUpdateProtectedData` to
  send `{ metadata: pruned }` (no inner `protectedData` wrapper). The
  data lands at `tx.attributes.metadata.<X>`. Readers still need to
  check `metadata.<X>` instead of `protectedData.<X>`, so it's
  Option B with a trivially-different shape. Doesn't address the
  clobber problem.

**Pre-conditions before the architectural fix can ship.**

1. Sharetribe Console: add `transition/operator-update-protected-data`
   (or whatever name) to the `default-booking v5` process, with
   `actor: 'operator'`, `actions: ['update-protected-data']`, no
   pre-conditions, no post-conditions, fires from any state where it's
   needed (likely all of them). Verify by attempting the transition
   from a known state via the integration SDK.
2. Decide on a fetch-then-merge wrapper around the new helper — the
   existing top-level clobber (which the `update_metadata` API
   exhibits) ALSO exists in transitions: `params.protectedData` on a
   transition replaces top-level keys wholesale. So writers still need
   to spread existing values OR the helper itself fetches the current
   tx and merges client-side before sending the transition.
3. Update `pruneProtectedData` and the whitelist as needed —
   `ALLOWED_PROTECTED_DATA_KEYS` should still apply to prevent unknown
   keys from being persisted.
4. Migrate existing data from `tx.attributes.metadata.protectedData.*`
   into `tx.attributes.protectedData.*` for any in-flight transactions
   that have data in the wrong place. Likely a one-shot script that
   reads `metadata.protectedData`, calls the new helper for each
   surviving key, and clears the metadata after success. Operator-only,
   run during a low-traffic window.

**Estimated effort.** Half-day to a full day of focused work, plus the
Sharetribe Console change which is only a few minutes but should be
done in a maintenance window or with a feature flag because it changes
the process definition.

**What's NOT changing in this commit.** This entry is documentation-
only — it does NOT ship a fix. The address-validate work for task #29
(commit `5acbb2e20`) is independent and unblocks Scenario 1 testing
without depending on a #30 resolution. Task #29's hard-fail
`labelCreationError` writes use the same `upsertProtectedData` helper
and inherit this same persistence loss (the `labelCreationError`
object lands at `metadata.protectedData.labelCreationError`, not
`protectedData.labelCreationError`). The mobile/web banner that reads
this would need to check both paths until #30 is fixed, OR we move
that field to the transaction's `metadata` directly (which is
operator-writable by design). Note for the mobile/web banner work
session.

**Files to read for the next session.**

- `server/api-util/integrationSdk.js:133-182` — `txUpdateProtectedData`
  (the misused write).
- `server/api-util/integrationSdk.lockedRate.test.js` — existing
  inner-level clobber test.
- `server/lib/txData.js:47-57` — `upsertProtectedData` wrapper.
- `node_modules/sharetribe-flex-integration-sdk/src/integration_sdk.js:241`
  — Sharetribe SDK's `update_metadata` definition.
- `scripts/diag-tx-address.js` — extended diag that reads both `protectedData`
  and `metadata.protectedData` paths.
- This entry, for blast-radius reference.

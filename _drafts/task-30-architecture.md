# Task #30 architectural fix — design checkpoint (REV 2 — post-CC-review)

This is a design document for the architectural fix to task #30 (silent persistence loss when `upsertProtectedData` writes to `tx.attributes.metadata.protectedData` instead of `tx.attributes.protectedData`). Read, edit, sign off, then we hand the implementation pieces to CC.

The fix has 5 phases that run in sequence. Phase 1 is a Sharetribe Console change you do manually. Phases 2-5 are code work for CC.

## REV 3 changelog (May 1, 2026 — post-Phase-0-CC-audit)

CC ran the pre-flight risk audit (Phase 0) and surfaced 2 RED findings + 4 minor refinements. Plan updated:

- **REMOVED `TASK_30_FIX_ENABLED` feature flag.** CC: "A flag that falls back to the buggy path is a regression with telemetry, not a rollback." Rollback path is now: Render deploy revert (1-2 min). Cleaner.
- **ADDED to Phase 2: update 4 existing test files** that mock `transactions.updateMetadata`: `integrationSdk.lockedRate.test.js`, `sendShipByReminders.persist.test.js`, `sendReturnReminders.persist.test.js`, `shippoTracking.upsert.test.js`. They must mock `transactions.show` + `transactions.transition` instead. CI breaks if not updated in same PR.
- **ADDED Phase 2 acceptance criteria:** the new wrapper MUST call `sdk.transactions.show` directly with NO caching layer. CC flagged `fetchTx` cache staleness as a possible foot-gun.
- **DOCUMENTED `deepMerge` array semantics.** The existing `deepMerge` replaces arrays wholesale. Any caller writing a partial array silently loses the rest. Note in helper docstring.
- **CONFIRMED 6 transitions, not 3.** CC noted `reviewed`/`reviewed-by-provider`/`reviewed-by-customer` are speculative (no current call sites fire from those states). Decision: keep all 6 as defensive future-proofing. Cost is 6 lines of EDN each, zero behavioral cost. Documented as "defensive — not load-bearing today" in the plan.
- **Reader audit confirmed clean.** Zero readers depend on the buggy path. Flip cold without transitional fallback for both whitelist keys AND `labelCreationError` (which has zero readers in this repo today).

## REV 2 changelog (May 1, 2026 — post-CC-review)

CC reviewed REV 1 and surfaced 5 corrections + 4 risks I missed. Updates folded in below.

- **6 transitions, not 5.** Added `operator-update-pd-cancelled`. CC found that `sendAutoCancelUnshipped.js:258` writes the auto-cancel idempotency marker AFTER firing `transition/auto-cancel-unshipped`, so the tx is in `state/cancelled` by then.
- **Hard-fail on unsupported state, not soft fallback.** Soft fallback would silently re-create the original bug for any state we missed. Hard-fail logs the unsupported state loudly so we add the missing transition immediately.
- **No `:privileged? true` flag** on the new transitions. That flag is for non-operator actors invoking privileged actions via the marketplace endpoint. Operator-only transitions via Integration SDK don't need it.
- **Vector-from `:from [...]` confirmed not supported by Sharetribe EDN.** Six separate transitions, one per state.
- **409-retry loop required** in the fetch-then-merge wrapper. Two simultaneous writers can race; mitigation is retry-on-conflict.
- **NEW risk: notification side effects.** New transitions trigger Sharetribe Console notification rules. Verify the new 6 are excluded from email/SMS rules in Console.
- **NEW risk: rate limits.** Every upsert is now 2 API calls. Pre-launch volume is fine; document for scale-up.
- **NEW risk: migration race.** Run during maintenance window OR fence with a feature flag that disables `txUpdateProtectedData` during migration.
- **NEW risk: per-key merge during migration.** Don't blanket-pick "metadata wins" — per-key timestamp logic or manual review.
- **NEW test requirement: assert data landed at `protectedData.X`** by calling `tx.show()` after the write. Existing tests only verify request shape, which is exactly the gap that hid the original bug.

---

## Phase 1 — Sharetribe Console: add the new privileged transition

### What we're adding

A new operator-only self-loop transition that exists solely to update `protectedData` from server-side code (cron jobs, webhooks, post-accept persistence). Pattern matches the existing `transition/privileged-apply-late-fees` (lines 128-143 of `process.edn`) but stripped down — no payment, no line items, just the protectedData update.

### EDN definition (for reference / dev parity)

```clojure
{:name :transition/operator-update-pd-accepted,
 :actor :actor.role/operator,
 :actions [{:name :action/update-protected-data}],
 :from :state/accepted,
 :to :state/accepted}
```

Note: NO `:privileged? true` flag (CC review). That flag is for non-operator actors invoking privileged actions via the marketplace endpoint, not operator transitions. Also no `:notifications []` — the absence of that key relies on Console-level notification rules being correctly configured to exclude these transitions; verify in Console (see verification checklist below).

### State coverage decision

The existing `upsertProtectedData` callers fire writes from these states:

- `:state/accepted` — most common (post-accept persistence, outbound label, return label, scan-flag idempotency, ship-by reminder dedupe, webhook first-scan)
- `:state/delivered` — webhook delivered events, return-T-minus-1 reminder dedupe, late-fee tracking
- `:state/reviewed-by-provider`, `:state/reviewed-by-customer`, `:state/reviewed` — late-arriving webhook scans after the review window starts

**Final list (REV 2): six transitions, one per state.**

```
transition/operator-update-pd-accepted        (from/to :state/accepted)
transition/operator-update-pd-delivered       (from/to :state/delivered)
transition/operator-update-pd-cancelled       (from/to :state/cancelled)         ← NEW per CC
transition/operator-update-pd-reviewed        (from/to :state/reviewed)
transition/operator-update-pd-reviewed-by-p   (from/to :state/reviewed-by-provider)
transition/operator-update-pd-reviewed-by-c   (from/to :state/reviewed-by-customer)
```

**Why `cancelled` is needed (CC catch).** `sendAutoCancelUnshipped.js:230-264` fires `transition/auto-cancel-unshipped` (line 232) THEN writes the `autoCancel` idempotency marker via `upsertProtectedData` (line 258). By that point the tx is in `state/cancelled`, not `state/accepted`. REV 1 missed this — exactly the kind of "real bug surfacing later" the user asked about during plan review. Hard-fail mode would have caught it the first time the auto-cancel cron ran, but better to ship it complete.

**Why one-per-state instead of one-with-vector-from:** CC verified by grepping `ext/transaction-processes` for `:from [` — zero matches. Sharetribe EDN does NOT support vector-from. The existing `privileged-apply-late-fees` (state/delivered) and `privileged-apply-late-fees-non-return` (state/accepted) split confirms the convention.

**Skipping these states intentionally** (no write paths exist or they're terminal with no current writes): `inquiry`, `pending-payment`, `payment-expired`, `preauthorized`, `declined`, `expired`. If a future writer needs one, add the transition then. The hard-fail behavior of the new helper will surface the gap immediately.

### How to make the change in Sharetribe Console

1. Sharetribe Console → Build → Transaction processes → `default-booking` (the active version, which is v5 per `process.edn:1`).
2. Click "Edit" on v5 — this creates a v6 draft.
3. Open the EDN editor (or the visual editor, but EDN is faster for this).
4. Paste the 5 new transitions after the existing `:transition/privileged-apply-late-fees-non-return` block (around line 163 in the local copy).
5. Save the draft.
6. Test the draft against a single test transaction first (Console offers a "test transition" affordance per state).
7. Once verified, publish the draft as v6 and switch the marketplace to v6.

### Local repo update

After publishing v6 in Console, also update `ext/transaction-processes/default-booking/process.edn` in the repo so the local copy matches production. This is a separate commit (or part of CC's commit). Don't forget — drift between Console and repo has bitten before.

### Risk

- Process version changes are non-trivial. Existing in-flight transactions will still run on v5 until they reach a terminal state. Both versions need to coexist briefly. Sharetribe handles this transparently — txs created on v5 stay on v5 until they finish; new txs use v6. So no migration of existing in-flight txs is needed for the version bump itself.
- The new transitions are additive — no existing transition is changed. Lowest possible risk.
- **NEW — Console notification rules (CC catch).** Self-loop transitions still trigger Sharetribe Console-configured notifications (customer/provider emails on every state change). After publishing v6, verify in Console → Build → Content → Email rules that the new 6 transitions are EXCLUDED from any notification sent to participants. Otherwise every webhook event spams users with state-change emails. This is a Console verification, not a code change.
- **NEW — rate limits (CC catch).** Each upsert is now 2 API calls (show + transition) instead of 1 (updateMetadata). Webhook handlers can fire 3-4 per package per day. Sharetribe Integration SDK rate limit varies by plan. At Sherbrt's current pre-launch volume this is fine. Document for the future scale-up review.

---

## Phase 2 — Code: refactor `txUpdateProtectedData` to use the new transition

### Goal

Change `server/api-util/integrationSdk.js:txUpdateProtectedData` to call the appropriate `operator-update-pd-<state>` transition via the integration SDK instead of `transactions.updateMetadata`. Keys land at `tx.attributes.protectedData.X` (the field every reader expects), not `tx.attributes.metadata.protectedData.X`.

### The challenge: top-level clobber still exists

Sharetribe transitions ALSO replace `params.protectedData` top-level keys wholesale. So if we naively send `{ protectedData: pruned }` and `pruned` is `{ outbound: {acceptedAt: ...} }`, then ALL OTHER protectedData keys (customer*, provider*, return, etc.) get wiped. Same clobber problem we just fixed in `update_metadata`, just at a different field.

### The solution: fetch-then-merge wrapper

Inside the new helper, before calling the transition:

1. Fetch the current tx state via `sdk.transactions.show({ id: txId })`.
2. Read `tx.attributes.protectedData` and `tx.attributes.state` (we need state to pick the right transition variant).
3. Deep-merge the patch into the current protectedData (using the existing `deepMerge`).
4. Apply the whitelist prune (`pruneProtectedData`) to the merged result.
5. Call the right transition with the FULL merged-and-pruned object as `params.protectedData`.

This avoids the clobber because we're sending the entire valid protectedData every time, and Sharetribe's "replace top-level keys" semantics now do the right thing (because the keys we're replacing match what was already there).

### Race-condition consideration (REV 2 — escalated per CC)

Two concurrent writers can fetch the same state and lose each other's changes. CC flagged this is now MORE severe than today's bug:

- Today (broken): two writers race, both write to `metadata.protectedData` — losing race results in losing webhook idempotency flags. Bad but contained.
- After fix (without retry): two writers race, both write to `protectedData` — losing race could clobber the borrower's checkout addresses or other already-correctly-stored data. Worse.

**Required mitigations (all three):**

1. **Always 409-retry the fetch-merge cycle.** Sharetribe returns 409/conflict-on-update when the tx version has shifted between fetch and write. Retry once. If second attempt also conflicts, fail loudly with ops alert.
2. **For tracking webhooks specifically: deep-merge only the relevant subtree** (e.g., merge into `tx.protectedData.return.firstScanAt` rather than replacing all of `tx.protectedData.return`). Smaller patch surface = smaller race window.
3. **Optionally pass a freshly-fetched tx from callers who already have one.** Most accept-time callers in `transition-privileged.js` just transitioned the tx and have it in scope. Skipping the redundant fetch is a perf win AND reduces stale-data risk. Defer to follow-up commit.

Sharetribe doesn't expose optimistic-concurrency tokens, so true safe-write requires either serializing all writers behind a queue OR accepting eventual consistency. The 409-retry handles the common case; serialization is over-engineering for current volume.

### State-to-transition mapping (REV 2)

```js
const PD_TRANSITION_BY_STATE = {
  'state/accepted':              'transition/operator-update-pd-accepted',
  'state/delivered':             'transition/operator-update-pd-delivered',
  'state/cancelled':             'transition/operator-update-pd-cancelled',         // NEW per CC
  'state/reviewed':              'transition/operator-update-pd-reviewed',
  'state/reviewed-by-provider':  'transition/operator-update-pd-reviewed-by-p',
  'state/reviewed-by-customer':  'transition/operator-update-pd-reviewed-by-c',
};
```

If the tx is in a state not listed above, `txUpdateProtectedData` HARD-FAILS with a structured error and ops alert (REV 2 — was soft-fallback in REV 1, changed per CC). Caller receives `{ success: false, reason: 'unsupported_state', state: 'state/X' }`. The hard-fail logs and ops-alert make any missing state immediately visible. The audit above + `cancelled` should mean this never fires in practice; if it does, we add the missing transition.

### Backwards compatibility

The function signature stays identical: `txUpdateProtectedData(txId, patch, opts)` returns `{ success, data }`. Every caller in `server/lib/txData.js`, `transition-privileged.js`, `shippoTracking.js`, `sendAutoCancelUnshipped.js` continues to work without changes. Only the implementation details under the hood change.

### Tests to add / update (REV 2 — per CC)

- Update `server/api-util/integrationSdk.lockedRate.test.js` to also assert the data is sent as `params.protectedData` on the new transition (not as `metadata.protectedData` on `updateMetadata`).
- Add `server/api-util/integrationSdk.transition.test.js`:
  - **CRITICAL — the test gap that hid the original bug:** assert data lands at `tx.attributes.protectedData.X` by calling `tx.show()` after the write. The existing test only asserts request shape, which is exactly why this bug went undetected for so long.
  - Fetches existing protectedData → deep-merges → sends correct transition for state.
  - **Hard-fails (REV 2)** with `{success:false, reason:'unsupported_state'}` for unsupported states. Was: falls back to updateMetadata. Changed per CC.
  - Spread/clobber regression: writing only `outbound.acceptedAt` preserves all other top-level keys.
  - Race-condition: 409 response triggers one retry.
  - Deep-merge correctness: writing `outbound.firstScanAt` doesn't replace siblings of `outbound`.

### File touchpoints

- `server/api-util/integrationSdk.js` — implementation change.
- `server/api-util/integrationSdk.lockedRate.test.js` — assertion update.
- New: `server/api-util/integrationSdk.transition.test.js`.

---

## Phase 3 — Migration script for in-flight transactions

### What needs migrating

Every transaction with non-empty `tx.attributes.metadata.protectedData` has data that was written via the broken `updateMetadata` path and never made it to `tx.attributes.protectedData`. We need to:

1. Find all such transactions.
2. For each, read `metadata.protectedData`, run it through the new write path so it lands at `protectedData`.
3. Optionally clear `metadata.protectedData` after the new write succeeds.

### The script

`scripts/migrate-task-30-data.js` — operator-only, supports `--dry-run`, `--limit=N`, `--state=<state>` (default: all). Idempotent (re-running on a migrated tx is a no-op).

### Constraints (REV 2 — per CC)

- The new `operator-update-pd-<state>` transitions only work in states they're defined for. With `cancelled` now in the list (REV 2), all 6 states are covered. For any tx in a state outside the 6 (terminal states like `expired`, `declined`, `payment-expired`), leave the data in `metadata.protectedData` as-is — those transitions are terminal with no current writes, no readers actively firing on them.
- Only run after Phase 2 is deployed AND verified. Otherwise the migration write would land in the same broken place.
- **NEW — migration race (CC catch).** Run during a maintenance window OR fence behind a feature flag that disables `txUpdateProtectedData` writes during the migration window. Otherwise an in-flight upsert can write to `metadata.protectedData` after migration reads but before it writes to `protectedData`, and we'd lose the in-flight write.
- **NEW — per-key conflict resolution (CC catch).** When `tx.metadata.protectedData.X` and `tx.protectedData.X` both exist with different values, blanket "metadata wins" is wrong. For some keys (post-accept writes that landed in metadata), metadata is newer; for others (request-payment writes that landed in protectedData via the transition), protectedData is newer. The script needs per-key timestamp logic OR a manual review step. Default safer-but-slower: prompt the operator on conflicts rather than auto-resolving.

### Estimated dataset size

Looking at the diag output earlier, the data we know is missing: provider* fields on the failing test transactions, plus any tx that had a webhook scan-flag write. Probably <50 tx today (low test volume). Run takes a minute.

---

## Phase 4 — Update CLAUDE_CONTEXT to declare task #30 done

After migration completes successfully, append a closing entry to the May 1 task #30 framing-correction entry that records:
- The Sharetribe Console v6 publish date and version.
- The shipped commit SHA for the code change.
- The migration script run date and tx count migrated.
- Confirmation that the `[VERIFY][ACCEPT] Missing providerZip` warning no longer fires.

---

## Phase 5 — Mobile/web `labelCreationError` banner cleanup

Once `labelCreationError` lands at the right field, the mobile and web banner code can read `tx.attributes.protectedData.labelCreationError` without falling back to `metadata.protectedData.labelCreationError`. Add this cleanup to the future task #25 / form-polish session — not blocking #30's completion.

---

## Order of operations

1. **You** — Phase 1: Sharetribe Console change (publish v6). I provide the EDN snippet; you paste in Console; verify with a one-off integration-SDK call. **15-30 min.**
2. **You** — commit the matching `process.edn` update to the repo (single docs-only commit alongside the Console change). **5 min.**
3. **CC** — Phase 2: refactor `txUpdateProtectedData` to use the new transition with fetch-then-merge. Tests. Single commit. **2-3 hours of CC time.**
4. **You** — review CC's diff, run the existing test suite locally, deploy to Render. **20 min.**
5. **CC** — Phase 3: migration script with `--dry-run` and `--limit`. Single commit. **45 min of CC time.**
6. **You** — run the migration with `--dry-run` first, review output, then run for real. **15 min.**
7. **You** — Phase 4: append the closing CLAUDE_CONTEXT entry. **5 min.**

**Total user time: ~80 min spread across 4 phases. Total CC time: ~3-4 hours of agent execution.**

---

## Sign-off questions

Before I write the CC briefs and the EDN snippet, three decisions to lock:

1. **Transition naming.** I proposed `transition/operator-update-pd-<state>` (5 transitions). Alternatives: `transition/sync-protected-data-<state>`, or one transition with a from-vector if Sharetribe's EDN supports it. **Going with `operator-update-pd-<state>` unless you object.**

2. **State coverage.** I proposed 5 states (`accepted`, `delivered`, `reviewed`, `reviewed-by-provider`, `reviewed-by-customer`). Skipping `preauthorized`, `inquiry`, `pending-payment`, terminal states. **Confirm or expand.**

3. **Fallback for unsupported states.** I proposed: if tx is in a state we don't have a transition for, log a warning and fall back to the existing `updateMetadata` path (preserves current broken-but-functional behavior, just doesn't make it worse). Alternative: hard-fail. Going with **fallback** unless you object — the fallback preserves existing behavior so no regressions.

Reply with edits / approval, then I'll generate Phase 1's exact EDN snippet for the Console + the CC brief for Phase 2.

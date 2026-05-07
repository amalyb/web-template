# Next session prompt — pickup from May 1, 2026

Copy-paste this whole block into a new Cowork session to start.

---

Hello — picking up where we left off. Read both CLAUDE_CONTEXT files (mobile
`~/sherbrt-mobile/CLAUDE_CONTEXT.md` and web
`~/shop-on-sherbet-cursor/CLAUDE_CONTEXT.md`), focus on the May 1, 2026
entries and the refreshed "🟢 Pickup Tomorrow" section.

## State of the world (end of May 1)

- ✅ **Task #29 (Shippo address validation) SHIPPED + verified end-to-end
  against live USPS** via `scripts/probe-shippo-live.js` ($0 net cost,
  real label printed and auto-voided). Commit `5acbb2e20` on `main`.
- ✅ **Task #30 Phase 1 SHIPPED.** Sharetribe `default-booking` v6 with
  6 new `operator-update-pd-<state>` self-loop transitions. Alias
  `default-booking/release-1` points at v6. Commit `c5f2d0b02` on `main`.
- ✅ **Task #30 Phase 2 SHIPPED end of last session.** Server-side
  `txUpdateProtectedData` refactored to use the new transitions instead
  of `transactions.updateMetadata`. Commit `19f27cded` on `main`. 28
  directly-affected tests pass. Render auto-deploy was in progress at
  end of session.
- ⏳ **Phase 1 + Phase 2 runtime verification deferred** to first organic
  tx accept post-deploy. User intended to test a real tx after wrap-up;
  may already have done so by the time you read this.
- ⏳ **Phase 3 (migration script) deferred to this session** —
  `scripts/migrate-task-30-data.js` to copy orphaned data from
  `tx.attributes.metadata.protectedData.*` → `tx.attributes.protectedData.*`
  for in-flight transactions whose writes landed in the wrong field
  before Phase 2 deployed.

## Step 1 — verify Phase 2 is working in production (~5 min)

Ask the user whether they ran an organic test tx after the May 1 wrap-up.

**If they did:**

Have them paste back the Render logs around the accept (search by tx ID
prefix). Look for:

- `[INT][PD] transition operator-update-pd-accepted` (or whichever state)
  — confirms the new helper ran.
- `[INT][PD][OK]` — confirms the transition succeeded.
- `[VERIFY][ACCEPT] Missing providerZip after upsert!` should NOT appear.

Then run the bug probe on the new tx:

```
cd ~/shop-on-sherbet-cursor
node scripts/probe-task-30.js <new-tx-prefix>
```

Expected (proves the fix end-to-end):
```
✅ Probe value found at tx.attributes.protectedData.shipByISO
=> Task #30 is NOT a bug. Data is going to the correct field.
```

**If they didn't test yet:**

Have them either trigger one organic test (one Stripe charge) or wait for
real activity. Phase 3 can proceed without runtime verification of Phase
2, but Phase 3 specifically depends on the new write path landing data
correctly. Strong recommendation: verify before Phase 3.

## Step 2 — Phase 3: migration script for in-flight transactions (~1 hour CC)

**Goal:** copy orphaned data from `tx.attributes.metadata.protectedData.*`
back to `tx.attributes.protectedData.*` for any in-flight transactions
that had writes land in the wrong field before Phase 2 shipped.

**Hand to CC.** Use the brief below (already pre-written and in
`_drafts/task-30-architecture.md` Phase 3 section — read it first).

Brief for CC (paste as-is into CC's terminal):

> Task #30 Phase 3 — write `scripts/migrate-task-30-data.js`. Phases 1
> and 2 are shipped (`c5f2d0b02` and `19f27cded` on `main`). Need a
> one-shot operator script to migrate orphaned protectedData from
> `tx.attributes.metadata.protectedData.*` → `tx.attributes.protectedData.*`
> for in-flight transactions whose writes landed in the wrong field
> before Phase 2 deployed.
>
> Requirements (per Phase 0 audit findings in CLAUDE_CONTEXT.md May 1
> entry):
> 1. Query Sharetribe via integration SDK for transactions with non-empty
>    `tx.attributes.metadata.protectedData`. Iterate.
> 2. For each tx: read keys, deep-merge into existing
>    `tx.attributes.protectedData` (don't blanket-overwrite — see #5),
>    write via the new `txUpdateProtectedData` (which uses the right
>    transition path now).
> 3. Skip tx in states not covered by the 6 transitions
>    (`expired`, `declined`, `payment-expired` — terminal-without-coverage).
>    For those, leave the orphaned data in place; nothing actively reads
>    those tx anymore.
> 4. **Per-key conflict resolution.** When `metadata.protectedData.X` AND
>    `protectedData.X` both exist with different values: prompt the
>    operator interactively to pick which to keep. Don't blanket "metadata
>    wins" — request-payment-time writes that already landed at
>    `protectedData.X` may be NEWER than the orphaned metadata copy.
> 5. **Migration race protection.** Either run during a maintenance
>    window OR fence behind a feature flag that disables
>    `txUpdateProtectedData` writes globally during the migration window.
>    Prefer the feature flag; document the env var name so user can flip
>    it on Render.
> 6. **Idempotent** — re-running on a migrated tx is a no-op.
> 7. Flags: `--dry-run`, `--limit=N`, `--state=X`, `--feature-flag-name=X`.
> 8. Report: count migrated, count skipped (terminal states), count
>    conflicts prompted, count of pre-existing keys preserved.
>
> Single commit. Tests with mocked tx data covering: dry-run, real run,
> conflict prompts, terminal-state skip, idempotency, feature-flag fence.
> Branch from `main`. CLAUDE_CONTEXT entry appended.

After CC reports back: review diff (same review pattern as Phase 2 — check
the migration logic, the conflict prompts, the feature flag, the tests).
Then merge. User runs `--dry-run` first, reviews output, then runs for
real during low-traffic window.

## Step 3 — close out task #30 (~5 min user)

After Phase 3 migration runs successfully:

- Re-run `scripts/probe-task-30.js` against any tx that was previously
  affected — should show probe value at `protectedData.X` (no more
  metadata orphans).
- Append a closing paragraph to the May 1 task #30 entry in CLAUDE_CONTEXT
  declaring the bug fixed end-to-end. Mark task #30 as done.

## Step 4 — pivot to mobile app launch path (the actual goal)

Tasks #29 and #30 were both unblockers for the launch path. With both
fixed, the user can resume the path that was interrupted on Day 11 / 12.
Priorities (in order):

1. **Resume Scenario 1 → 6 in v12 Test Scenarios workbook.** Scenario 1
   was in flight before Option A and task #29 intercepted; now fully
   unblocked. ONE Stripe charge per scenario, exercises the full pipeline.

2. **EAS production env-var change** (mobile heads-up from Day 12):
   Mobile `EXPO_PUBLIC_API_BASE_URL` must be `https://sherbrt.com` (apex,
   NOT `www.sherbrt.com`) before next TestFlight ship. Otherwise the iOS
   30s-hang-on-307-redirect bug ships to TestFlight users. Update in
   EAS production config (`eas.json` or EAS project secret) on
   `~/sherbrt-mobile`.

3. **Sharetribe Console microcopy verification** (Day 11 heads-up):
   verify in Console → Build → Content → Microcopy that
   `OrderBreakdown.providerTotalDefault`,
   `providerTotalReceived`, `providerTotalRefunded` all read "Your
   earnings" — the bundled `en.json` change in commit `97f44b3a4` only
   takes effect if Console microcopy doesn't override.

4. **Backlog (no blocking order):** task #25 (5-digit ZIP / US phone /
   2-letter state validators shared between web + mobile shipping forms),
   task #31 (consolidate 3-way phone field sprawl
   `protectedData.phoneNumber` / `protectedData.phone` /
   `protectedData.lenderShippingAddress.phoneNumber`), worktree cleanup,
   `ListingCard.js` migration to `getListingFieldLabel`.

## Files / scripts useful in this session

- `_drafts/task-30-architecture.md` — full plan including REV 3 with CC
  audit findings folded in.
- `scripts/probe-task-30.js` — verifies whether the bug is present on a
  given tx. Now expected to show "NOT a bug" after Phase 2 deploy.
- `scripts/diag-task-30-transition.js` — verifies a specific
  `operator-update-pd-<state>` transition routes data correctly. Will
  succeed on v6-pinned txs.
- `scripts/diag-tx-address.js` — extended diag that reads BOTH
  `protectedData` and `metadata.protectedData`. Useful for triaging
  any tx during/after migration.
- `scripts/probe-shippo-live.js` — verifies Shippo+USPS works
  end-to-end with $0 net cost via auto-void. Pattern for
  zero-Stripe-charge verifications.

## Decisions locked in (don't re-litigate)

- Hard-fail on unsupported state for task #30 (NOT soft fallback —
  fallback would silently re-create the bug).
- No feature flag for task #30 production code (rollback is Render
  deploy revert; flag would re-create the bug if flipped off).
- Phase 3 migration uses per-key conflict prompts (NOT blanket "metadata
  wins").
- Keep current 6 transition coverage; add more states only if hard-fail
  logs surface a missing one.
- Re-rate match logic at accept = exact `provider+servicelevel.token`,
  no cheapest fallback (preserves carrier neutrality).
- $2 ops alert threshold for re-rate price delta (Sherbrt absorbs delta).

---

*End of next-session prompt.*

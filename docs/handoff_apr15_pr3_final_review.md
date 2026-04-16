# Handoff: PR-3 Final Review → Implementation

**Date:** April 15, 2026
**Status:** PR-3 scope doc updated with all CC v2 feedback. Ready for CC final sign-off, then PR-3a implementation.

---

## Where we are

The 9.0 late-fee charging pipeline is being built in 6 PRs. PR-1 (gates) and PR-2 (transitions) are shipped and live on process v4. PR-3 is the last blocker before the feature flag can flip.

PR-3's scope doc (`docs/9.0_pr3_operational_cleanup.md`) has been through two rounds of CC design review. The second round returned 6 items + 2 policy decisions. All 8 have been resolved and folded into the doc as of commit `70399793a`.

The 9.1 overdue copy refactor doc (`docs/9.1_overdue_copy_refactor.md`) has also been updated — day 6 SMS copy softened from "will be charged" to "may be charged" in both the plain-text block and the JS message-map code.

## What was resolved in the CC v2 feedback round

1. **`daysLate <= 1` explicit guard** — Added to §3a.2. Returns `reason: 'scan-lag-grace'`. Codifies the scan-lag rule at code level so manual invocations or early cron fires can't falsely charge day 1.

2. **Delete dead Scenario A branch** — Explicit instruction added: delete `lateFees.js:246-260` entirely (don't comment out).

3. **`'daily-overdue'` scenario value** — New chargeHistory entries use this instead of `'non-return'`. Cap filter uses `code === 'late-fee'` (not scenario), so old entries are backward-compatible.

4. **`.catch()` hard acceptance requirement** — Elevated in PR-3b acceptance criteria. CC should flag any un-awaited `sendTransactionalEmail()` without `.catch()` as blocking.

5. **Vestigial `transition/privileged-apply-late-fees`** — Document in code comment; do NOT remove from process.edn (would require v5 push for zero behavioral benefit).

6. **`withinSendWindow()` testability** — Must respect `FORCE_NOW` / `getNow()` helper so scenario tests can simulate quiet-hours.

7. **Decision A (day 6 copy):** Softened to "may be charged" — matches days 4-5 framing, legally safer since replacement is operator-discretionary.

8. **Decision B (lenderRequest quiet-hours):** Pattern B = delay to 8 AM, not skip. Nudge still fires, just late. Borrower gets slightly better odds of lender action.

## What needs to happen next

### Step 1: Share PR-3 doc with CC for final sign-off

CC needs to confirm the 8 items above are correctly incorporated and that the doc is implementation-ready. Here's the prompt:

---

**Prompt for CC:**

> Please do a final review of `docs/9.0_pr3_operational_cleanup.md` (commit `70399793a`). This is the v2 feedback incorporation pass — your 6 items + 2 decisions have been folded in. Specifically verify:
>
> 1. §3a.2 has the `daysLate <= 1` scan-lag-grace guard (returns `reason: 'scan-lag-grace'`).
> 2. §3a.2 explicitly says to delete the dead Scenario A code path in `lateFees.js:246-260` (not comment out).
> 3. §3a.2 specifies `'daily-overdue'` as the scenario value for new chargeHistory entries, with a backward-compat note that the cap filter uses `code === 'late-fee'` not scenario.
> 4. §3a.2 documents the vestigial `transition/privileged-apply-late-fees` from `:state/delivered` — keep in process.edn, add code comment only.
> 5. PR-3b acceptance criteria includes `.catch()` as a hard requirement on all un-awaited `sendTransactionalEmail()` calls.
> 6. PR-3b acceptance criteria notes `withinSendWindow()` must respect `FORCE_NOW`/`getNow()` for testability.
> 7. §3b.3 Pattern B for lenderRequest says "delay to 8 AM" (not skip) — nudge still fires, just late.
> 8. Day-6 copy reference in §3b.1 uses "may be charged" (not "will be charged").
>
> Also check `docs/9.1_overdue_copy_refactor.md` — day 6 should say "may be charged" in both the plain-text copy block AND the `overdueMessages.day6` JS function.
>
> If everything looks correct, confirm sign-off and we'll begin PR-3a implementation. If anything's off, list what needs fixing.

---

### Step 2: Begin PR-3a implementation

After CC signs off, the implementation order is:

1. **3a.1** — Redis migration (`overdueNotified:*` keys, delete dead transition call block + TODO comment, update `diagnose-overdue.js`)
2. **3a.2** — Unified daily charging (delete Scenario A branch, add `hasScan` check + `daysLate <= 1` guard + cap, `'daily-overdue'` scenario, vestigial transition comment)
3. **3a.3** — Cron time move (`setUTCHours(9)` → `setUTCHours(17)`, rename `next9AM` → `nextRunTime`)
4. **3a.4** — Cap enforcement (count-based `MAX_LATE_FEE_CHARGES = 5`)
5. **Tests** — Update/create scenario tests per §3a.2 test plan

### Step 3: PR-3b, 3c, then remaining PRs

After PR-3a ships and bakes 24h:
- PR-3b (emails + quiet-hours)
- PR-3c (comment cleanup)
- PR-4 (staging dry-run)
- PR-5 (structured logging)
- PR-6 (flag flip — real money)

## Key files

| File | Role |
|------|------|
| `docs/9.0_pr3_operational_cleanup.md` | PR-3 scope doc (implementation spec) |
| `docs/9.1_overdue_copy_refactor.md` | 9.1 copy refactor spec (blocked on 9.0) |
| `CLAUDE_CONTEXT.md` | Full project context (read first) |
| `server/scripts/sendOverdueReminders.js` | Main cron — Redis migration + cron time change |
| `server/lib/lateFees.js` | Charging logic — unified daily model |
| `server/scripts/diagnose-overdue.js` | Diagnostic — Redis migration |
| `server/util/time.js` | New `withinSendWindow()` (PR-3b) |
| `server/email/emailClient.js` | SendGrid wrapper (caller usage only) |

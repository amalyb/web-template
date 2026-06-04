#!/usr/bin/env node
/**
 * reanchorAvailabilityExceptions.js
 *
 * One-time backfill: re-anchors every existing availability exception's
 * `start`/`end` from whatever TZ-basis it was originally written in
 * (device-local midnight, UTC midnight, etc.) to MARKETPLACE_TZ midnight
 * (America/Los_Angeles). Must run before the PR #79 (web) + mobile
 * tz-basis PRs deploy, or every existing ET-written exception silently
 * shifts one calendar day earlier in both apps' readers.
 *
 * INFERENCE HEURISTIC
 *
 *   The script reads `start`'s UTC hour-of-day and infers the lender's
 *   original TZ:
 *
 *      00:00 UTC -> already UTC midnight (old web pre-Round-3)
 *      04:00 UTC -> EDT  (UTC-4) — most common for this operator
 *      05:00 UTC -> EST  (UTC-5)
 *      06:00 UTC -> CDT  (UTC-6) — rare on Sherbrt
 *      07:00 UTC -> PDT  (UTC-7) — already LA, no shift needed
 *      08:00 UTC -> PST  (UTC-8) — already LA, no shift needed
 *      09:00 UTC -> AKDT (UTC-9) — flagged for review
 *      10:00 UTC -> HST  (UTC-10) — flagged for review
 *      other     -> flagged "unrecognized hour"; default to UTC handling
 *
 *   From the inferred TZ, computes the lender's intended calendar day
 *   (the YMD label that was on the cell they tapped) and re-writes the
 *   exception as
 *      [marketplaceDayStart(intent), marketplaceDayStart(intent + durationDays))
 *
 *   Multi-day blocks: duration = round((end - start) / 24h). Preserves the
 *   number of calendar days the lender originally blocked.
 *
 * SAFETY
 *   - DRY RUN by default. Use `--apply` to actually write.
 *   - Idempotent: an exception that's already LA-midnight-anchored is
 *     skipped silently. Re-running after a successful apply is a no-op.
 *   - Delete-then-create: the new exception cannot coexist with the old
 *     (same calendar day → would overlap and the API rejects). The script
 *     deletes the old THEN creates the new, so there's a brief window
 *     where the day is unblocked. For a one-time backfill on a small
 *     marketplace this is acceptable; document the window in your release
 *     notes if customers might be booking during the run.
 *   - On create failure (rare — should only happen if the new payload is
 *     malformed), the script logs loudly and continues; the affected
 *     calendar day is left unblocked until the script is re-run or fixed.
 *
 * USAGE
 *
 *   # Dry-run across the whole marketplace
 *   node server/scripts/reanchorAvailabilityExceptions.js
 *
 *   # Dry-run for one listing
 *   node server/scripts/reanchorAvailabilityExceptions.js \
 *     --listing-id 69160706-f857-4d72-b663-9cd3a705b1cb
 *
 *   # Apply for one listing (no `--apply` = dry-run)
 *   node server/scripts/reanchorAvailabilityExceptions.js \
 *     --listing-id 69160706-f857-4d72-b663-9cd3a705b1cb \
 *     --apply
 *
 *   # Apply across the whole marketplace, capped at 20 re-anchors
 *   node server/scripts/reanchorAvailabilityExceptions.js --apply --limit 20
 *
 * ENV
 *   INTEGRATION_CLIENT_ID, INTEGRATION_CLIENT_SECRET (required)
 *   FLEX_INTEGRATION_BASE_URL (optional)
 */

require('dotenv').config();

const moment = require('moment-timezone');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const MARKETPLACE_TZ = 'America/Los_Angeles';

// Mirror of src/util/dates.js:marketplaceDayStart. Anchored at day:1 +
// .add(day-1, 'days') so day overflow normalizes correctly (see PR #79
// BUG-1 fix). DST-safe because .add('days') counts calendar days.
const marketplaceDayStart = (year, month, day) =>
  moment
    .tz({ year, month, day: 1 }, MARKETPLACE_TZ)
    .startOf('day')
    .add(day - 1, 'days')
    .toDate();

const DAY_MS = 24 * 60 * 60 * 1000;

// CLI ---------------------------------------------------------------------

const parseArgs = argv => {
  const args = { apply: false, listingId: null, limit: Infinity, perPage: 100 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--listing-id') args.listingId = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--per-page') args.perPage = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 90).join('\n'));
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    }
  }
  return args;
};

// TZ inference -----------------------------------------------------------

// Returns { offsetHours, label, confidence }. `offsetHours` is signed and
// negative for the western hemisphere (e.g. -4 for EDT). `confidence` is
// 'high' for the common US-East / US-Pacific cases, 'low' for unusual
// values that warrant a human eyeball before --apply.
const inferOriginalTZ = startInstant => {
  const hour = startInstant.getUTCHours();
  const minute = startInstant.getUTCMinutes();
  const second = startInstant.getUTCSeconds();
  // Only whole-hour starts make sense for a "midnight in some TZ" anchor.
  // Anything with a non-zero minute/second is malformed data — punt.
  if (minute !== 0 || second !== 0) {
    return { offsetHours: 0, label: `off-grid ${hour}:${minute}:${second}`, confidence: 'low' };
  }
  switch (hour) {
    case 0:
      // Already UTC-midnight. Old web (pre-PR #79) wrote these via the
      // legacy formatDateToUtcMidnight path.
      return { offsetHours: 0, label: 'UTC-midnight (old web)', confidence: 'high' };
    case 4:
      return { offsetHours: -4, label: 'EDT', confidence: 'high' };
    case 5:
      return { offsetHours: -5, label: 'EST', confidence: 'high' };
    case 6:
      return { offsetHours: -6, label: 'CDT', confidence: 'medium' };
    case 7:
      return { offsetHours: -7, label: 'PDT (already LA)', confidence: 'high' };
    case 8:
      return { offsetHours: -8, label: 'PST (already LA) or MDT', confidence: 'high' };
    case 9:
      return { offsetHours: -9, label: 'AKDT or MST', confidence: 'medium' };
    case 10:
      return { offsetHours: -10, label: 'HST', confidence: 'medium' };
    default:
      return { offsetHours: -hour, label: `unrecognized hour ${hour}`, confidence: 'low' };
  }
};

// Decide what (if anything) to do with a single exception ----------------

// Returns either null (already correctly anchored) or an object describing
// the rewrite: { intentYMD, durationDays, newStart, newEnd, inference }.
const planRewrite = exception => {
  const stored = exception.attributes;
  const start = stored.start instanceof Date ? stored.start : new Date(stored.start);
  const end = stored.end instanceof Date ? stored.end : new Date(stored.end);
  const inference = inferOriginalTZ(start);

  // Compute the lender's intended calendar day = the YMD of `start` when
  // read in the inferred TZ. We do this by shifting the UTC instant by the
  // inferred offset and reading the resulting wall-clock YMD.
  const shifted = new Date(start.getTime() + inference.offsetHours * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const intentYMD = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // Multi-day blocks: preserve the number of calendar days. Round in case
  // the stored end crossed a DST boundary in the source TZ.
  const durationDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));

  const newStart = marketplaceDayStart(y, m, d);
  const newEnd = marketplaceDayStart(y, m, d + durationDays);

  // Idempotency: if the stored interval already matches what we'd write,
  // skip. Compare ms to avoid drift around milliseconds.
  if (newStart.getTime() === start.getTime() && newEnd.getTime() === end.getTime()) {
    return null;
  }
  return { intentYMD, durationDays, newStart, newEnd, inference };
};

// Main --------------------------------------------------------------------

const main = async () => {
  const args = parseArgs(process.argv);
  const sdk = getIntegrationSdk();

  console.log(
    `[reanchor] mode=${args.apply ? 'APPLY' : 'DRY RUN'} listingId=${args.listingId ||
      '(all)'} updateLimit=${args.limit === Infinity ? '∞' : args.limit}`
  );

  const stats = {
    scannedListings: 0,
    scannedExceptions: 0,
    ok: 0,
    rewritten: 0,
    wouldRewrite: 0,
    failed: 0,
    lowConfidence: 0,
  };
  let rewritesSoFar = 0;

  const processListing = async listing => {
    stats.scannedListings += 1;
    const listingId = listing.id.uuid;
    const title = listing.attributes?.title || '(no title)';

    // Flex caps `availabilityExceptions.query` range at 366 days, so we
    // can't ask for "everything in a 2-year window" in one call. Split
    // into two 365-day windows: past year and future year. Future-year
    // is the important one (any exception affecting an active booking
    // window lives there); past-year picks up anything still relevant
    // for record-keeping.
    const now = new Date();
    const windows = [
      { start: new Date(now.getTime() - 365 * DAY_MS), end: now },
      { start: now, end: new Date(now.getTime() + 365 * DAY_MS) },
    ];
    const exceptions = [];
    const seenIds = new Set();
    for (const w of windows) {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        // eslint-disable-next-line no-await-in-loop
        const res = await sdk.availabilityExceptions.query({
          listingId,
          start: w.start,
          end: w.end,
          perPage: args.perPage,
          page,
        });
        const data = res.data?.data || [];
        for (const ex of data) {
          if (seenIds.has(ex.id.uuid)) continue; // dedupe across windows
          seenIds.add(ex.id.uuid);
          exceptions.push(ex);
        }
        totalPages = res.data?.meta?.totalPages || 1;
        page += 1;
      }
    }

    if (exceptions.length === 0) {
      console.log(`  ${listingId}  ${title}  (no exceptions)`);
      return;
    }

    // Process LATEST exceptions first. When two consecutive days are both
    // UTC-midnight-stored, rewriting the earlier one first creates an
    // LA-anchored range that overlaps the still-old next day's UTC-midnight
    // range (e.g. new June 3 = [06-03T07Z, 06-04T07Z) overlaps old June 4
    // = [06-04T00Z, 06-05T00Z)). Reverse-chronological order avoids this:
    // by the time we get to the earlier day, the later day is already
    // LA-anchored and the new ranges abut at 07Z without overlap.
    exceptions.sort((a, b) => {
      const aStart = (a.attributes.start instanceof Date
        ? a.attributes.start
        : new Date(a.attributes.start)
      ).getTime();
      const bStart = (b.attributes.start instanceof Date
        ? b.attributes.start
        : new Date(b.attributes.start)
      ).getTime();
      return bStart - aStart; // descending
    });

    // Past-date guard: Flex rejects `availabilityExceptions.create` with
    // start more than 1 day in the past. If we tried delete-then-create on
    // a past exception, the delete would succeed but the create would
    // fail, leaving the exception lost forever. Past exceptions are also
    // booking-irrelevant (nobody can book a past date), so skipping them
    // entirely is the right call.
    const oneDayAgo = new Date(Date.now() - DAY_MS);

    for (const ex of exceptions) {
      stats.scannedExceptions += 1;
      const exId = ex.id.uuid;
      const plan = planRewrite(ex);
      if (!plan) {
        stats.ok += 1;
        // Show the calendar day this exception covers so the operator can
        // eyeball "yes, those are the days I meant to block" against the
        // count of `ok` lines.
        const okStart = ex.attributes.start instanceof Date
          ? ex.attributes.start
          : new Date(ex.attributes.start);
        const okYMD = moment.tz(okStart, MARKETPLACE_TZ).format('YYYY-MM-DD');
        const okDur = Math.max(
          1,
          Math.round(
            ((ex.attributes.end instanceof Date
              ? ex.attributes.end
              : new Date(ex.attributes.end)
            ).getTime() -
              okStart.getTime()) /
              DAY_MS
          )
        );
        console.log(`  ok        ${exId}  day=${okYMD} dur=${okDur}d  already LA-anchored`);
        continue;
      }

      const { intentYMD, durationDays, newStart, newEnd, inference } = plan;

      // Past-date skip: Flex rejects `availabilityExceptions.create` with
      // start more than 1 day in the past. If we proceeded with
      // delete-then-create here, the delete would succeed but the create
      // would fail, irretrievably losing the exception. Past exceptions
      // are also booking-irrelevant (nobody can book a past date), so
      // skipping them entirely is the right call.
      if (newStart.getTime() < oneDayAgo.getTime()) {
        stats.skippedPast = (stats.skippedPast || 0) + 1;
        console.log(`  skipped   ${exId}  day=${intentYMD}  (past, left untouched)`);
        continue;
      }
      const oldStartISO = (ex.attributes.start instanceof Date
        ? ex.attributes.start
        : new Date(ex.attributes.start)
      ).toISOString();

      if (inference.confidence === 'low') stats.lowConfidence += 1;

      const summary =
        `${exId}  day=${intentYMD} dur=${durationDays}d  ` +
        `was=${oldStartISO}  inferred=${inference.label}` +
        (inference.confidence !== 'high' ? ` (${inference.confidence} confidence)` : '');

      if (rewritesSoFar >= args.limit) {
        console.log(`  skipped   ${summary}  (limit reached)`);
        continue;
      }

      if (!args.apply) {
        stats.wouldRewrite += 1;
        rewritesSoFar += 1;
        console.log(`  would     ${summary}`);
        continue;
      }

      // APPLY: delete old, then create new. Delete-first because the new
      // exception would overlap the old on the same calendar day, and the
      // API rejects overlapping exceptions.
      try {
        // eslint-disable-next-line no-await-in-loop
        await sdk.availabilityExceptions.delete({ id: exId });
      } catch (err) {
        stats.failed += 1;
        console.error(`  FAILED    delete ${summary}`);
        console.error('           ', err?.data?.errors || err.message);
        continue; // don't create if the delete failed
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await sdk.availabilityExceptions.create({
          listingId,
          start: newStart,
          end: newEnd,
          seats: ex.attributes.seats,
        });
        stats.rewritten += 1;
        rewritesSoFar += 1;
        console.log(`  rewrote   ${summary}`);
      } catch (err) {
        stats.failed += 1;
        console.error(`  FAILED    create-after-delete ${summary}`);
        console.error('           ', err?.data?.errors || err.message);
        console.error(`           !! ${exId} was deleted but new exception was NOT created.`);
        console.error(`           !! Calendar day ${intentYMD} on listing ${listingId} is now UNBLOCKED.`);
      }
    }
  };

  if (args.listingId) {
    const res = await sdk.listings.show({ id: args.listingId });
    await processListing(res.data.data);
  } else {
    // Page through every listing.
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      // eslint-disable-next-line no-await-in-loop
      const res = await sdk.listings.query({ page, perPage: args.perPage });
      const listings = res.data?.data || [];
      totalPages = res.data?.meta?.totalPages || 1;
      console.log(`[reanchor] page ${page}/${totalPages} (${listings.length} listings)`);
      for (const listing of listings) {
        // eslint-disable-next-line no-await-in-loop
        await processListing(listing);
        if (rewritesSoFar >= args.limit && args.apply) break;
      }
      if (rewritesSoFar >= args.limit && args.apply) break;
      page += 1;
    }
  }

  console.log('\n[reanchor] done.');
  console.log(`  scanned listings:   ${stats.scannedListings}`);
  console.log(`  scanned exceptions: ${stats.scannedExceptions}`);
  console.log(`  already ok:         ${stats.ok}`);
  console.log(`  ${args.apply ? 'rewrote' : 'would rewrite'}:   ${args.apply ? stats.rewritten : stats.wouldRewrite}`);
  if (stats.skippedPast > 0) {
    console.log(`  skipped (past):     ${stats.skippedPast}  (left untouched)`);
  }
  if (stats.lowConfidence > 0) {
    console.log(`  low-confidence:     ${stats.lowConfidence}  (inspect before --apply)`);
  }
  if (stats.failed > 0) {
    console.log(`  failed:             ${stats.failed}  (see error log above)`);
  }
  if (!args.apply && stats.wouldRewrite > 0) {
    console.log('\n  Re-run with --apply to write these changes.');
  }
};

main().catch(err => {
  console.error('[reanchor] fatal:', err?.data?.errors || err);
  process.exit(1);
});

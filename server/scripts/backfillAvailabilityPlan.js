#!/usr/bin/env node
/**
 * backfillAvailabilityPlan.js
 *
 * One-time backfill: ensures every listing in the marketplace has the
 * day-shape availability plan that matches the marketplace's
 * Daily + oneSeat configuration. Walks `integrationSdk.listings.query`
 * across all pages and updates any listing whose `availabilityPlan` is
 * missing, empty, or in the wrong (`availability-plan/time`) shape.
 *
 * WHY THIS EXISTS
 *   The web wizard never successfully wrote an `availabilityPlan` for
 *   booking listings: the Details panel skipped it entirely, and the
 *   Availability panel sent `availability-plan/time` (rejected by
 *   Sharetribe on day-unit listings with HTTP 400). The mobile wizard
 *   writes the correct `availability-plan/day` shape. Listings that
 *   were created on web before the mobile wizard touched them have no
 *   plan stored, which can cause downstream booking weirdness. This
 *   script aligns them with the marketplace config.
 *
 * WHAT IT WRITES
 *   {
 *     type: 'availability-plan/day',
 *     entries: [
 *       { dayOfWeek: 'mon', seats: 1 },
 *       { dayOfWeek: 'tue', seats: 1 },
 *       { dayOfWeek: 'wed', seats: 1 },
 *       { dayOfWeek: 'thu', seats: 1 },
 *       { dayOfWeek: 'fri', seats: 1 },
 *       { dayOfWeek: 'sat', seats: 1 },
 *       { dayOfWeek: 'sun', seats: 1 },
 *     ],
 *   }
 *
 *   No `timezone` key — Sharetribe rejects it as "Disallowed key" on
 *   day-plans for this marketplace. Existing availability EXCEPTIONS
 *   (the per-date seats:0 carve-outs the lender has already set) are
 *   stored on a separate resource and are NOT touched.
 *
 * SAFETY
 *   - Defaults to DRY RUN. Use `--apply` to actually write.
 *   - Skips listings that already have a correct day-shape plan with
 *     all 7 days enabled at seats >= 1. Idempotent.
 *   - `--listing-id <uuid>` operates on a single listing (useful for
 *     spot-checking the script's behaviour before a wide apply).
 *   - `--limit N` caps the number of listings the script will UPDATE
 *     (not the number it scans).
 *
 * USAGE
 *
 *   # Dry-run across the whole marketplace
 *   node server/scripts/backfillAvailabilityPlan.js
 *
 *   # Dry-run for one listing
 *   node server/scripts/backfillAvailabilityPlan.js \
 *     --listing-id 69160706-f857-4d72-b663-9cd3a705b1cb
 *
 *   # Apply for one listing (no `--apply` = dry-run)
 *   node server/scripts/backfillAvailabilityPlan.js \
 *     --listing-id 69160706-f857-4d72-b663-9cd3a705b1cb \
 *     --apply
 *
 *   # Apply across the whole marketplace, capped at 50 updates
 *   node server/scripts/backfillAvailabilityPlan.js --apply --limit 50
 *
 * ENV
 *   INTEGRATION_CLIENT_ID, INTEGRATION_CLIENT_SECRET (required)
 *   FLEX_INTEGRATION_BASE_URL (optional — picks env, defaults to prod)
 */

require('dotenv').config();

const { getIntegrationSdk } = require('../api-util/integrationSdk');

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const DAY_PLAN = {
  type: 'availability-plan/day',
  entries: WEEKDAYS.map(dayOfWeek => ({ dayOfWeek, seats: 1 })),
};

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
      console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 70).join('\n'));
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    }
  }
  return args;
};

// Decide whether a listing needs the backfill -----------------------------

// Returns null if the plan is fine, otherwise a human-readable reason string
// describing why we're rewriting it.
const planNeedsBackfill = plan => {
  if (!plan) return 'no plan stored';
  if (plan.type !== 'availability-plan/day') return `wrong type: ${plan.type}`;
  const entries = Array.isArray(plan.entries) ? plan.entries : [];
  if (entries.length === 0) return 'plan has no entries';
  const enabledDays = new Set(
    entries.filter(e => Number(e.seats) >= 1).map(e => e.dayOfWeek)
  );
  const missing = WEEKDAYS.filter(d => !enabledDays.has(d));
  if (missing.length > 0) return `missing days: ${missing.join(',')}`;
  return null;
};

// Main --------------------------------------------------------------------

const main = async () => {
  const args = parseArgs(process.argv);
  const sdk = getIntegrationSdk();

  console.log(
    `[backfill] mode=${args.apply ? 'APPLY' : 'DRY RUN'} listingId=${args.listingId ||
      '(all)'} updateLimit=${args.limit === Infinity ? '∞' : args.limit}`
  );

  const stats = { scanned: 0, ok: 0, updated: 0, wouldUpdate: 0, failed: 0 };
  let updatesSoFar = 0;

  const processListing = async listing => {
    stats.scanned += 1;
    const id = listing.id.uuid;
    const title = listing.attributes?.title || '(no title)';
    const reason = planNeedsBackfill(listing.attributes?.availabilityPlan);

    if (!reason) {
      stats.ok += 1;
      console.log(`  ok       ${id}  ${title}`);
      return;
    }

    if (updatesSoFar >= args.limit) {
      console.log(`  skipped  ${id}  ${title}  (limit reached)`);
      return;
    }

    if (!args.apply) {
      stats.wouldUpdate += 1;
      updatesSoFar += 1;
      console.log(`  would    ${id}  ${title}  — ${reason}`);
      return;
    }

    try {
      await sdk.listings.update({ id, availabilityPlan: DAY_PLAN });
      stats.updated += 1;
      updatesSoFar += 1;
      console.log(`  updated  ${id}  ${title}  — was: ${reason}`);
    } catch (err) {
      stats.failed += 1;
      const apiErrors = err?.data?.errors || err?.response?.data?.errors;
      console.error(`  FAILED   ${id}  ${title}`);
      console.error('           ', apiErrors || err.message);
    }
  };

  if (args.listingId) {
    const res = await sdk.listings.show({ id: args.listingId });
    await processListing(res.data.data);
  } else {
    // Page through every listing in the marketplace. The Integration API
    // doesn't support filtering on `availabilityPlan`, so we scan all and
    // filter client-side via `planNeedsBackfill`.
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const res = await sdk.listings.query({ page, perPage: args.perPage });
      const listings = res.data.data || [];
      totalPages = res.data.meta?.totalPages || 1;
      console.log(`[backfill] page ${page}/${totalPages} (${listings.length} listings)`);
      for (const listing of listings) {
        // eslint-disable-next-line no-await-in-loop
        await processListing(listing);
        if (updatesSoFar >= args.limit && !args.apply) {
          // Keep scanning in dry-run so user sees the full picture;
          // in apply mode we stop early to honor the cap.
        }
        if (updatesSoFar >= args.limit && args.apply) break;
      }
      if (updatesSoFar >= args.limit && args.apply) break;
      page += 1;
    }
  }

  console.log('\n[backfill] done.');
  console.log(`  scanned:       ${stats.scanned}`);
  console.log(`  already ok:    ${stats.ok}`);
  console.log(`  ${args.apply ? 'updated' : 'would update'}: ${args.apply ? stats.updated : stats.wouldUpdate}`);
  if (stats.failed) console.log(`  failed:        ${stats.failed}`);
  if (!args.apply && (stats.wouldUpdate > 0 || stats.failed === 0)) {
    console.log('\n  Re-run with --apply to write these changes.');
  }
};

main().catch(err => {
  console.error('[backfill] fatal:', err?.data?.errors || err);
  process.exit(1);
});

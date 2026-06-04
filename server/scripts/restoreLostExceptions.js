#!/usr/bin/env node
/**
 * restoreLostExceptions.js
 *
 * One-shot recovery for two future-dated availability exceptions that
 * were deleted-but-not-recreated by an early bug in
 * `reanchorAvailabilityExceptions.js` (the "create after delete" failure
 * with the overlap error). Both blocks belong to a single listing.
 *
 * Once the main backfill script is fixed (process in reverse-chronological
 * order so an LA-anchored rewrite doesn't overlap a still-old later
 * exception), this script becomes obsolete and can be deleted.
 *
 * USAGE
 *   node server/scripts/restoreLostExceptions.js          # dry run
 *   node server/scripts/restoreLostExceptions.js --apply  # actually create
 */

require('dotenv').config();

const { getIntegrationSdk } = require('../api-util/integrationSdk');

const LISTING_ID = '685eeceb-23ea-4954-b196-560a00415489';

// Each entry is the YMD the lender originally meant to block.
// We re-create at LA midnight (07:00 UTC during PDT, 08:00 UTC during PST).
// June and July are both PDT, so 07:00 UTC.
const LOST_BLOCKS = [
  {
    ymd: '2026-06-03',
    start: '2026-06-03T07:00:00.000Z',
    end: '2026-06-04T07:00:00.000Z',
  },
  {
    ymd: '2026-07-01',
    start: '2026-07-01T07:00:00.000Z',
    end: '2026-07-02T07:00:00.000Z',
  },
];

const main = async () => {
  const apply = process.argv.includes('--apply');
  const sdk = getIntegrationSdk();

  console.log(`[restore] mode=${apply ? 'APPLY' : 'DRY RUN'} listingId=${LISTING_ID}`);

  for (const block of LOST_BLOCKS) {
    if (!apply) {
      console.log(`  would create  day=${block.ymd}  [${block.start}, ${block.end})  seats=0`);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await sdk.availabilityExceptions.create({
        listingId: LISTING_ID,
        start: new Date(block.start),
        end: new Date(block.end),
        seats: 0,
      });
      console.log(`  created       day=${block.ymd}  [${block.start}, ${block.end})`);
    } catch (err) {
      console.error(`  FAILED        day=${block.ymd}`);
      console.error('               ', err?.data?.errors || err.message);
    }
  }

  if (!apply) {
    console.log('\n  Re-run with --apply to actually create these.');
  } else {
    console.log('\n[restore] done.');
  }
};

main().catch(err => {
  console.error('[restore] fatal:', err?.data?.errors || err);
  process.exit(1);
});

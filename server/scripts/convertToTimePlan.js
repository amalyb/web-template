#!/usr/bin/env node
/**
 * convertToTimePlan.js
 *
 * Converts every published listing that is NOT already on
 * `availability-plan/time` to the plan shape that Sharetribe's booking
 * engine actually accepts for this marketplace:
 *
 *   {
 *     type: 'availability-plan/time',
 *     timezone: 'America/Los_Angeles',
 *     entries: 7 x { dayOfWeek, seats: 1, startTime: '00:00', endTime: '00:00' },
 *   }
 *
 * WHY THIS EXISTS
 *
 *   Checkout returned HTTP 409 `transaction-booking-time-not-available`
 *   for every listing on `availability-plan/day` or with no plan at all.
 *   Those listings expose a UTC-midnight day grid (`time-slot/day`,
 *   00:00Z boundaries); the client sends booking dates at LA midnight
 *   (07:00Z), which lands mid-slot and is rejected.
 *
 *   `timezone` cannot be added to a day-plan to move the grid —
 *   Sharetribe rejects it with HTTP 400 `validation-disallowed-key` at
 *   path ["availabilityPlan","timezone"]. Verified against production.
 *
 *   A 24h time-plan (startTime === endTime === '00:00') has no day grid
 *   at all: `timeslots.query` returns ONE continuous `time-slot/time`
 *   spanning the queried range. A continuous window contains any
 *   sub-interval, so LA-midnight bookings fit. This is the shape the
 *   listings that always worked were already on.
 *
 *   NOTE: the `timezone` key is kept for consistency with the existing
 *   working listings, but it is not what makes this work — with 24h
 *   entries the window is continuous in any timezone. It would only
 *   matter if entries had partial-day times or disabled weekdays.
 *
 * SAFETY
 *   - DRY RUN by default. `--apply` writes.
 *   - Backs up EVERY original plan (including dry-run) to
 *     server/scripts/backups/ before any write. Restore with --restore.
 *   - Idempotent: listings already on a 7-day 24h time-plan are skipped.
 *   - `--verify` re-queries timeslots after the run and asserts each
 *     converted listing returns a single continuous time-slot/time.
 *
 * USAGE
 *   node server/scripts/convertToTimePlan.js                  # dry run, all
 *   node server/scripts/convertToTimePlan.js --listing-id <uuid>
 *   node server/scripts/convertToTimePlan.js --apply --verify
 *   node server/scripts/convertToTimePlan.js --restore <backup-file>
 *
 * ENV
 *   INTEGRATION_CLIENT_ID, INTEGRATION_CLIENT_SECRET (required)
 *   REACT_APP_SHARETRIBE_SDK_CLIENT_ID (required for --verify)
 *   FLEX_INTEGRATION_BASE_URL (optional — defaults to prod)
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const TIME_PLAN = {
  type: 'availability-plan/time',
  timezone: 'America/Los_Angeles',
  entries: WEEKDAYS.map(dayOfWeek => ({
    dayOfWeek,
    seats: 1,
    startTime: '00:00',
    endTime: '00:00',
  })),
};

const BACKUP_DIR = path.join(__dirname, 'backups');

const parseArgs = argv => {
  const args = {
    apply: false, verify: false, listingId: null,
    limit: Infinity, perPage: 100, restore: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--verify') args.verify = true;
    else if (a === '--listing-id') args.listingId = argv[++i];
    else if (a === '--restore') args.restore = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--per-page') args.perPage = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 60).join('\n'));
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    }
  }
  return args;
};

// A plan is already correct if it is a time-plan with all 7 days at
// seats>=1 and 24h (startTime === endTime) entries.
const isAlreadyCorrect = plan => {
  if (!plan || plan.type !== 'availability-plan/time') return false;
  const entries = Array.isArray(plan.entries) ? plan.entries : [];
  const ok = new Set(
    entries
      .filter(e => Number(e.seats) >= 1 && e.startTime === e.endTime)
      .map(e => e.dayOfWeek)
  );
  return WEEKDAYS.every(d => ok.has(d));
};

const describePlan = plan => {
  if (!plan || !plan.type) return 'no plan';
  const n = Array.isArray(plan.entries) ? plan.entries.length : 0;
  return `${plan.type} tz=${plan.timezone || '(none)'} entries=${n}`;
};

const queryAllPublished = async (sdk, perPage) => {
  const out = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    // eslint-disable-next-line no-await-in-loop
    const res = await sdk.listings.query({ page, perPage, states: 'published' });
    out.push(...(res.data?.data || []));
    totalPages = res.data?.meta?.totalPages || 1;
    page += 1;
  }
  return out;
};

// --restore -----------------------------------------------------------------

const restore = async file => {
  const sdk = getIntegrationSdk();
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`[restore] from ${file} (captured ${backup.capturedAt}) — ${backup.listings.length} listing(s)`);
  let ok = 0;
  let failed = 0;
  for (const rec of backup.listings) {
    if (rec.availabilityPlan == null) {
      console.log(`  SKIP     ${rec.id}  original had NO plan — cannot un-set a plan via the API`);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await sdk.listings.update({ id: rec.id, availabilityPlan: rec.availabilityPlan });
      ok += 1;
      console.log(`  restored ${rec.id}  ${rec.title}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAILED   ${rec.id}  ${rec.title}`);
      console.error('           ', JSON.stringify(err?.data?.errors) || err.message);
    }
  }
  console.log(`\n[restore] done. restored=${ok} failed=${failed}`);
};

// --verify ------------------------------------------------------------------

const verify = async ids => {
  const sharetribeSdk = require('sharetribe-flex-sdk');
  const clientId = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
  if (!clientId) {
    console.error('[verify] REACT_APP_SHARETRIBE_SDK_CLIENT_ID not set — skipping verification');
    return;
  }
  const msdk = sharetribeSdk.createInstance({
    clientId,
    baseUrl: process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL || 'https://flex-api.sharetribe.com',
  });
  const start = new Date(Date.now() + 86400000);
  const end = new Date(Date.now() + 12 * 86400000);

  console.log(`\n[verify] timeslots ${start.toISOString()} -> ${end.toISOString()}`);
  let pass = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await msdk.timeslots.query({
        listingId: new sharetribeSdk.types.UUID(id), start, end,
      });
      const slots = res.data?.data || [];
      const single = slots.length === 1 && slots[0].attributes.type === 'time-slot/time';
      // continuous == covers the whole queried window end to end
      const continuous = single &&
        slots[0].attributes.start.getTime() <= start.getTime() &&
        slots[0].attributes.end.getTime() >= end.getTime();
      if (continuous) {
        pass += 1;
        console.log(`  PASS ${id}  1 x time-slot/time  ${slots[0].attributes.start.toISOString()} -> ${slots[0].attributes.end.toISOString()}`);
      } else {
        fail += 1;
        console.log(`  FAIL ${id}  ${slots.length} slot(s): ${slots.map(s => `${s.attributes.type} ${s.attributes.start.toISOString()}->${s.attributes.end.toISOString()}`).join(' | ') || '(none)'}`);
      }
    } catch (err) {
      fail += 1;
      console.error(`  FAIL ${id}  timeslots query error ${err?.status}: ${JSON.stringify(err?.data?.errors) || err.message}`);
    }
  }
  console.log(`[verify] pass=${pass} fail=${fail}`);
  return fail;
};

// main ----------------------------------------------------------------------

const main = async () => {
  const args = parseArgs(process.argv);

  if (args.restore) return restore(args.restore);

  const sdk = getIntegrationSdk();
  console.log(
    `[convert] mode=${args.apply ? 'APPLY' : 'DRY RUN'} listingId=${args.listingId || '(all published)'} limit=${args.limit === Infinity ? '∞' : args.limit}`
  );

  const listings = args.listingId
    ? [(await sdk.listings.show({ id: args.listingId })).data.data]
    : await queryAllPublished(sdk, args.perPage);

  const targets = [];
  const skipped = [];
  for (const l of listings) {
    const plan = l.attributes?.availabilityPlan;
    if (isAlreadyCorrect(plan)) skipped.push(l);
    else targets.push(l);
  }

  console.log(`\nscanned ${listings.length} published listing(s)`);
  console.log(`  already correct (time-plan, 7d, 24h): ${skipped.length}`);
  console.log(`  to convert:                           ${targets.length}\n`);

  if (targets.length === 0) {
    console.log('nothing to do.');
    return;
  }

  // Backup BEFORE any write — including on dry runs.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `plans-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({
    capturedAt: new Date().toISOString(),
    note: 'Original availabilityPlan values before convertToTimePlan.js. availabilityPlan:null means the listing had NO plan (not restorable via API).',
    listings: targets.map(l => ({
      id: l.id.uuid,
      title: l.attributes?.title || '(no title)',
      availabilityPlan: l.attributes?.availabilityPlan ?? null,
    })),
  }, null, 2));
  console.log(`[backup] ${backupFile}\n`);

  console.log('TARGETS');
  console.log('  #  listing id                            was                                          title');
  targets.forEach((l, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)} ${l.id.uuid}  ${describePlan(l.attributes?.availabilityPlan).padEnd(44)} ${l.attributes?.title || ''}`
    );
  });

  if (!args.apply) {
    console.log(`\n[convert] DRY RUN — nothing written. Re-run with --apply --verify to convert these ${targets.length} listing(s).`);
    return;
  }

  console.log('\nAPPLYING');
  const converted = [];
  let failed = 0;
  for (const l of targets) {
    if (converted.length >= args.limit) {
      console.log(`  skipped  ${l.id.uuid}  (limit reached)`);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await sdk.listings.update({ id: l.id.uuid, availabilityPlan: TIME_PLAN });
      converted.push(l.id.uuid);
      console.log(`  converted ${l.id.uuid}  ${l.attributes?.title || ''}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAILED    ${l.id.uuid}  ${l.attributes?.title || ''}`);
      console.error('            ', JSON.stringify(err?.data?.errors, null, 2) || err.message);
    }
  }
  console.log(`\n[convert] converted=${converted.length} failed=${failed}`);
  console.log(`[convert] restore with: node server/scripts/convertToTimePlan.js --restore ${backupFile}`);

  if (args.verify && converted.length) await verify(converted);
};

main().catch(e => {
  console.error('FATAL', e?.status, JSON.stringify(e?.data, null, 2) || e.message);
  process.exit(1);
});

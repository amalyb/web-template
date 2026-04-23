/**
 * PR-5: scan-lag grace
 *
 * Regression tests for the 12-hour scan-lag grace buffer added between the
 * "past cancel deadline" check and the hasOutboundScan check in
 * sendAutoCancelUnshipped.js. Carriers (USPS especially) can take 4-12
 * hours to register a scan after a physical drop; without this grace, a
 * cron tick that lands in that gap would fire a premature cancel on a
 * package that's actually already in motion.
 *
 * Structurally parallel to overdue's `daysLate <= 1` scan-lag guard in
 * server/lib/lateFees.js:294-296.
 */

process.env.AUTO_CANCEL_DRY_RUN = '1';

const moment = require('moment-timezone');
const { processTransaction, SCAN_LAG_GRACE_HOURS } = require('./sendAutoCancelUnshipped');

// Wednesday 2026-04-22 — not a Monday, so no Monday-grace shift on the
// cancel deadline. Deadline = 23:59:59 PT on 2026-04-22 = 06:59:59 UTC
// on 2026-04-23 (PDT is UTC-7 in April).
const BOOKING_START_UTC = '2026-04-22T00:00:00.000Z';
const DEADLINE_UTC = '2026-04-23T06:59:59.000Z';

const hoursPastDeadline = hours =>
  moment.utc(DEADLINE_UTC).add(hours, 'hours').toDate();

function makeTx({ hasScan = false } = {}) {
  const tx = {
    id: { uuid: 'test-tx' },
    attributes: {
      processName: 'default-booking',
      processVersion: 3,
      protectedData: {},
    },
    relationships: {
      booking: { data: { type: 'booking', id: { uuid: 'book-1' } } },
      listing: { data: { type: 'listing', id: { uuid: 'list-1' } } },
      customer: { data: { type: 'user', id: { uuid: 'cust-1' } } },
      provider: { data: { type: 'user', id: { uuid: 'prov-1' } } },
    },
  };
  if (hasScan) {
    tx.attributes.protectedData.outbound = { firstScanAt: '2026-04-22T12:00:00Z' };
  }
  return tx;
}

const included = [
  {
    type: 'booking',
    id: { uuid: 'book-1' },
    attributes: { start: BOOKING_START_UTC, state: 'accepted' },
  },
  {
    type: 'listing',
    id: { uuid: 'list-1' },
    attributes: {
      title: 'Test Listing',
      availabilityPlan: { timezone: 'America/Los_Angeles' },
    },
  },
  {
    type: 'user',
    id: { uuid: 'cust-1' },
    attributes: { profile: { protectedData: { phone: '+15550001111' } } },
  },
  {
    type: 'user',
    id: { uuid: 'prov-1' },
    attributes: { profile: { protectedData: { phone: '+15550002222' } } },
  },
];

const mockSdk = {
  transactions: {
    transition: jest.fn(() => Promise.resolve({ data: {} })),
  },
};

describe('PR-5 scan-lag grace', () => {
  let logSpy;
  let warnSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSdk.transactions.transition.mockClear();
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('SCAN_LAG_GRACE_HOURS is 12', () => {
    expect(SCAN_LAG_GRACE_HOURS).toBe(12);
  });

  test('hoursPastDeadline = 11.9 → skip with scan-lag-grace (no scan present)', async () => {
    const now = hoursPastDeadline(11.9);
    await processTransaction(makeTx({ hasScan: false }), included, now, mockSdk);

    const logs = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logs).toMatch(/SKIP reason=scan-lag-grace hoursPastDeadline=11\.9/);
    expect(logs).not.toMatch(/firing transition\/auto-cancel-unshipped/);
  });

  test('hoursPastDeadline = 12.1 with no scan → proceed to cancel (DRY_RUN)', async () => {
    const now = hoursPastDeadline(12.1);
    await processTransaction(makeTx({ hasScan: false }), included, now, mockSdk);

    const logs = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logs).not.toMatch(/SKIP reason=scan-lag-grace/);
    expect(logs).toMatch(/firing transition\/auto-cancel-unshipped \(dry=true\)/);
    expect(logs).toMatch(/DRY RUN — would cancel/);
  });

  test('hoursPastDeadline = 11.9 with scan present → scan-lag-grace fires first, no cancel', async () => {
    // scan-lag-grace is checked BEFORE hasOutboundScan, so this case
    // short-circuits at the grace guard. Either way, no cancel fires.
    const now = hoursPastDeadline(11.9);
    await processTransaction(makeTx({ hasScan: true }), included, now, mockSdk);

    const logs = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logs).toMatch(/SKIP reason=scan-lag-grace/);
    expect(logs).not.toMatch(/firing transition\/auto-cancel-unshipped/);
  });

  test('hoursPastDeadline = 13 with scan present → hasOutboundScan path skips cancel', async () => {
    // Past the grace window, but scan is now registered — existing
    // hasOutboundScan guard takes over and skips.
    const now = hoursPastDeadline(13);
    await processTransaction(makeTx({ hasScan: true }), included, now, mockSdk);

    const logs = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logs).not.toMatch(/SKIP reason=scan-lag-grace/);
    expect(logs).toMatch(/outbound scan present — package in motion, skipping/);
    expect(logs).not.toMatch(/firing transition\/auto-cancel-unshipped/);
  });
});

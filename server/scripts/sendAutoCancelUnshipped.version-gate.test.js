/**
 * PR-4 (10.0): sendAutoCancelUnshipped processVersion gate fix.
 *
 * The old gate was `processVersion !== 3` (hard equality). After the
 * v5 alias flip, every new transaction has processVersion===5 and the
 * cron silently skipped them all. Changed to `< 3` so v3/v4/v5/any
 * future bump all pass while v1/v2 are still excluded.
 *
 * This test behaviorally confirms the new gate by invoking
 * processTransaction with a v5 tx and asserting it does NOT short-circuit
 * at the version-gate log line. Uses DRY_RUN=1 to avoid real SDK calls.
 */

process.env.AUTO_CANCEL_DRY_RUN = '1';

const moment = require('moment-timezone');
const { processTransaction } = require('./sendAutoCancelUnshipped');

// Wednesday bookingStart + 13 hours past the cancel deadline → past the
// scan-lag grace window, no outbound scan → should proceed to cancel path.
const BOOKING_START_UTC = '2026-04-22T00:00:00.000Z';
const DEADLINE_UTC = '2026-04-23T06:59:59.000Z';
const pastDeadline = hours =>
  moment.utc(DEADLINE_UTC).add(hours, 'hours').toDate();

function makeTx({ processVersion }) {
  return {
    id: { uuid: 'test-tx-version' },
    attributes: {
      processName: 'default-booking',
      processVersion,
      protectedData: {},
    },
    relationships: {
      booking: { data: { type: 'booking', id: { uuid: 'book-1' } } },
      listing: { data: { type: 'listing', id: { uuid: 'list-1' } } },
      customer: { data: { type: 'user', id: { uuid: 'cust-1' } } },
      provider: { data: { type: 'user', id: { uuid: 'prov-1' } } },
    },
  };
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

const mockSdk = { transactions: { transition: jest.fn(() => Promise.resolve({})) } };

describe('PR-4: processVersion gate accepts v3/v4/v5', () => {
  let logSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSdk.transactions.transition.mockClear();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([3, 4, 5])('processVersion=%i passes the gate (reaches cancel path under DRY_RUN)', async (processVersion) => {
    const now = pastDeadline(13); // past scan-lag grace
    await processTransaction(makeTx({ processVersion }), included, now, mockSdk);
    const logs = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    // If the old `!== 3` gate were still active, v4/v5 would short-circuit here.
    expect(logs).not.toMatch(/not on default-booking v3\b/);
    // Should reach the cancel firing path under DRY_RUN.
    expect(logs).toMatch(/firing transition\/auto-cancel-unshipped \(dry=true\)/);
  });

  test.each([1, 2])('processVersion=%i is still rejected', async (processVersion) => {
    const now = pastDeadline(13);
    await processTransaction(makeTx({ processVersion }), included, now, mockSdk);
    const logs = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logs).toMatch(/not on default-booking v3\+/);
    expect(logs).not.toMatch(/firing transition\/auto-cancel-unshipped/);
  });
});

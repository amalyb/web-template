/**
 * PR-2 (10.0): computeShipByDate rewrite.
 *
 * The new implementation:
 *   1. Prefers `protectedData.outbound.shipByDate` if present (with a
 *      [ship-by:persisted] log). Returns that value directly.
 *   2. Otherwise, if `opts.transitDays` is provided, computes
 *      bookingStart − (transitDays + SAFETY_BUFFER) business days using
 *      the PT-based subtractBusinessDays helper.
 *   3. Otherwise, falls back to the static LEAD_FLOOR env var.
 *
 * Returns a JS Date so `adjustIfSundayUTC` and downstream callers can
 * invoke `.getUTCDay()` and `.toISOString()` without type-mismatches.
 */

const { computeShipByDate } = require('./shipping');
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));

// Flatten console.log call-args (including plain objects) to one string per
// call so regex matching works uniformly. Plain `c.join(' ')` stringifies
// objects to "[object Object]".
const flattenLogCalls = spy =>
  spy.mock.calls
    .map(args => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    .join('\n');

function makeTx({ bookingStartISO, persistedShipByDate, txId = 'tx-1' }) {
  const tx = {
    id: { uuid: txId },
    attributes: {
      booking: { attributes: { start: bookingStartISO } },
      protectedData: {},
    },
  };
  if (persistedShipByDate) {
    tx.attributes.protectedData.outbound = { shipByDate: persistedShipByDate };
  }
  return tx;
}

describe('computeShipByDate — persisted-first branch (10.0 PR-2)', () => {
  let logSpy;
  beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  test('returns persisted value when present (no recomputation)', async () => {
    const persisted = '2026-04-20T07:00:00.000Z';
    const tx = makeTx({
      bookingStartISO: '2026-04-25T00:00:00.000Z',
      persistedShipByDate: persisted,
    });
    const result = await computeShipByDate(tx);
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe(persisted);
    const logs = flattenLogCalls(logSpy);
    expect(logs).toMatch(/\[ship-by:persisted\]/);
    expect(logs).not.toMatch(/\[ship-by:computed\]/);
  });

  test('malformed persisted value falls through to computation', async () => {
    const tx = makeTx({
      bookingStartISO: '2026-04-25T00:00:00.000Z',
      persistedShipByDate: 'not-a-date',
    });
    const result = await computeShipByDate(tx);
    expect(result).toBeInstanceOf(Date);
    const logs = flattenLogCalls(logSpy);
    expect(logs).not.toMatch(/\[ship-by:persisted\]/);
    expect(logs).toMatch(/\[ship-by:computed\]/);
  });
});

describe('computeShipByDate — transitDays branch', () => {
  let logSpy;
  beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  test('uses transitDays + SAFETY_BUFFER for business-day subtraction', async () => {
    // bookingStart UTC → PT day = 2026-04-30 Thu (04-30 16:00 PT).
    // Wait — 2026-05-01T00:00:00Z is 2026-04-30 17:00 PDT, so PT day = Apr 30.
    // transitDays=2, buffer=1 → 3 BD back from start-of-day Apr 30 PT.
    // Wed 04/29 (1), Tue 04/28 (2), Mon 04/27 (3). Expect shipBy = Mon 04/27 PT.
    const tx = makeTx({ bookingStartISO: '2026-05-01T00:00:00.000Z' });
    const result = await computeShipByDate(tx, { transitDays: 2 });
    expect(result).toBeInstanceOf(Date);
    const { subtractBusinessDays } = require('./businessDays');
    // Normalize: computeShipByDate internally calls start.setUTCHours(0,0,0,0)
    // then passes that to subtractBusinessDays. Match that exact path here.
    const start = new Date('2026-05-01T00:00:00.000Z');
    start.setUTCHours(0, 0, 0, 0);
    const expected = subtractBusinessDays(start, 3).format('YYYY-MM-DD');
    const actual = dayjs(result).tz('America/Los_Angeles').format('YYYY-MM-DD');
    expect(actual).toBe(expected);

    const logs = flattenLogCalls(logSpy);
    expect(logs).toMatch(/\[ship-by:computed\]/);
    expect(logs).toMatch(/shippo-anchored/);
  });

  test('falls back to LEAD_FLOOR when transitDays is not provided', async () => {
    const tx = makeTx({ bookingStartISO: '2026-05-01T00:00:00.000Z' });
    const result = await computeShipByDate(tx);
    expect(result).toBeInstanceOf(Date);
    const logs = flattenLogCalls(logSpy);
    expect(logs).toMatch(/static-fallback/);
  });
});

describe('computeShipByDate — invalid/missing inputs', () => {
  test('returns null when no bookingStart and no persisted value', async () => {
    const tx = { id: { uuid: 'tx-x' }, attributes: { protectedData: {} } };
    expect(await computeShipByDate(tx)).toBeNull();
  });

  test('returns null when bookingStart is malformed', async () => {
    const tx = makeTx({ bookingStartISO: 'not-a-date' });
    expect(await computeShipByDate(tx)).toBeNull();
  });
});

describe('computeShipByDate — Date return type (regression for v3 bug)', () => {
  // Before v3 pseudocode fix, subtractBusinessDays returned a dayjs object
  // that was passed directly to adjustIfSundayUTC (which uses Date.getUTCDay).
  // Runtime TypeError. This test asserts the .toDate() conversion happened.
  test('return value is a native Date (has getUTCDay/toISOString)', async () => {
    const tx = makeTx({ bookingStartISO: '2026-05-01T00:00:00.000Z' });
    const result = await computeShipByDate(tx, { transitDays: 2 });
    expect(result).toBeInstanceOf(Date);
    expect(typeof result.getUTCDay).toBe('function');
    expect(typeof result.toISOString).toBe('function');
    // Invoking them shouldn't throw
    expect(() => result.getUTCDay()).not.toThrow();
    expect(() => result.toISOString()).not.toThrow();
  });
});

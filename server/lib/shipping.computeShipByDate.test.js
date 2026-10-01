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
    // bookingStart stored as UTC midnight May 1 → calendar day Fri May 1.
    // transitDays=2, buffer=1 → 3 BD back: Thu 4/30 (1), Wed 4/29 (2), Tue 4/28 (3).
    const tx = makeTx({ bookingStartISO: '2026-05-01T00:00:00.000Z' });
    const result = await computeShipByDate(tx, { transitDays: 2 });
    expect(result).toBeInstanceOf(Date);
    const actual = dayjs(result).tz('America/Los_Angeles').format('YYYY-MM-DD');
    expect(actual).toBe('2026-04-28');

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

// Regression: booking starts are stored as PT midnight. The old
// setUTCHours(0) normalization shifted the start to the previous PT day,
// giving every lender an extra lead day (observed Oct 1 2026: Oct 7 start,
// transitDays=2 → ship-by Oct 2 instead of Oct 3).
describe('computeShipByDate — counts back from the booking calendar day', () => {
  let logSpy;
  beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });
  const pt = d => dayjs(d).tz('America/Los_Angeles').format('YYYY-MM-DD');

  test('Bay Area (2 transit days): Wed Oct 7 PT start → Sat Oct 3', async () => {
    const tx = makeTx({ bookingStartISO: '2026-10-07T07:00:00.000Z' });
    expect(pt(await computeShipByDate(tx, { transitDays: 2 }))).toBe('2026-10-03');
  });

  test('same calendar day whether start is stored as PT or UTC midnight', async () => {
    const a = await computeShipByDate(makeTx({ bookingStartISO: '2026-10-07T07:00:00.000Z' }), { transitDays: 2 });
    const b = await computeShipByDate(makeTx({ bookingStartISO: '2026-10-07T00:00:00.000Z' }), { transitDays: 2 });
    expect(pt(a)).toBe(pt(b));
  });

  test('cross-country (5 transit days): Wed Oct 7 → Wed Sep 30 (6 BD, skips Sun)', async () => {
    // Tue 6 (1), Mon 5 (2), Sat 3 (3), Fri 2 (4), Thu 1 (5), Wed 9/30 (6)
    const tx = makeTx({ bookingStartISO: '2026-10-07T07:00:00.000Z' });
    expect(pt(await computeShipByDate(tx, { transitDays: 5 }))).toBe('2026-09-30');
  });

  test('result is PT start-of-day', async () => {
    const tx = makeTx({ bookingStartISO: '2026-10-07T07:00:00.000Z' });
    const r = await computeShipByDate(tx, { transitDays: 2 });
    expect(r.toISOString()).toBe('2026-10-03T07:00:00.000Z');
  });
});

describe('computeShipByDate — more start formats, DST, holidays', () => {
  let logSpy;
  beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  test('Monday start: PT, UTC and ET midnight all give the same ship-by', async () => {
    const shapes = ['2026-10-05T07:00:00.000Z', '2026-10-05T00:00:00.000Z', '2026-10-05T04:00:00.000Z'];
    const out = [];
    for (const s of shapes) out.push((await computeShipByDate(makeTx({ bookingStartISO: s }), { transitDays: 2 })).toISOString());
    // Mon Oct 5 − 3 BD: Sat 3 (1), Fri 2 (2), Thu 1 (3)
    expect(new Set(out)).toEqual(new Set(['2026-10-01T07:00:00.000Z']));
  });

  test('Thanksgiving inside the window: start Fri Nov 27, 2 transit → Mon Nov 23 (PST)', async () => {
    const r = await computeShipByDate(makeTx({ bookingStartISO: '2026-11-27T08:00:00.000Z' }), { transitDays: 2 });
    expect(r.toISOString()).toBe('2026-11-23T08:00:00.000Z');
  });

  test('across fall-back: start Wed Nov 4, 2 transit → Sat Oct 31 PDT midnight', async () => {
    // Tue 3 (1), Mon 2 (2), Sat Oct 31 (3) [skip Sun Nov 1]
    const r = await computeShipByDate(makeTx({ bookingStartISO: '2026-11-04T08:00:00.000Z' }), { transitDays: 2 });
    expect(r.toISOString()).toBe('2026-10-31T07:00:00.000Z');
  });
});

/**
 * Ship-by floor + reminder-too-soon gate (fix/ship-by-lead-time).
 */
const { applyShipByFloor, isTooSoonAfterAccept } = require('./shipping');
const { nextBusinessDay } = require('./businessDays');
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));
const pt = d => dayjs(d).tz('America/Los_Angeles').format('YYYY-MM-DD');

describe('nextBusinessDay', () => {
  test('Thu → Fri', () => {
    expect(nextBusinessDay(new Date('2026-10-01T18:33:00Z')).format('YYYY-MM-DD')).toBe('2026-10-02');
  });
  test('Fri → Sat (Saturday counts)', () => {
    expect(nextBusinessDay(new Date('2026-10-02T18:00:00Z')).format('YYYY-MM-DD')).toBe('2026-10-03');
  });
  test('Sat → Mon (skips Sunday)', () => {
    expect(nextBusinessDay(new Date('2026-10-03T18:00:00Z')).format('YYYY-MM-DD')).toBe('2026-10-05');
  });
  test('skips USPS holiday (Columbus Day Mon Oct 12 2026)', () => {
    expect(nextBusinessDay(new Date('2026-10-10T18:00:00Z')).format('YYYY-MM-DD')).toBe('2026-10-13');
  });
  test('uses PT calendar day (late-evening PT accept)', () => {
    // 2026-10-02T05:00Z = Thu Oct 1 10 PM PT → next BD Fri Oct 2
    expect(nextBusinessDay(new Date('2026-10-02T05:00:00Z')).format('YYYY-MM-DD')).toBe('2026-10-02');
  });
});

describe('applyShipByFloor', () => {
  const acceptThu = new Date('2026-10-01T18:33:00Z'); // Thu 11:33 AM PT

  test('leaves a later ship-by untouched', () => {
    const shipBy = new Date('2026-10-03T07:00:00Z');
    const r = applyShipByFloor(shipBy, acceptThu);
    expect(r.floored).toBe(false);
    expect(r.shipByDate).toBe(shipBy);
  });

  test('ship-by equal to next business day is not floored', () => {
    const r = applyShipByFloor(new Date('2026-10-02T07:00:00Z'), acceptThu);
    expect(r.floored).toBe(false);
  });

  test('same-day ship-by is pushed to next business day', () => {
    const r = applyShipByFloor(new Date('2026-10-01T07:00:00Z'), acceptThu);
    expect(r.floored).toBe(true);
    expect(pt(r.shipByDate)).toBe('2026-10-02');
    expect(r.shipByDate.toISOString()).toBe('2026-10-02T07:00:00.000Z');
  });

  test('past ship-by is pushed to next business day', () => {
    const r = applyShipByFloor(new Date('2026-09-28T07:00:00Z'), acceptThu);
    expect(r.floored).toBe(true);
    expect(pt(r.shipByDate)).toBe('2026-10-02');
  });

  test('null passes through', () => {
    expect(applyShipByFloor(null, acceptThu)).toEqual({ shipByDate: null, floored: false });
  });
});

describe('isTooSoonAfterAccept', () => {
  const accepted = '2026-10-01T18:33:43.285Z'; // 11:33 AM PT

  test('28 min after accept → too soon (the Oct 1 12:01 PM SMS)', () => {
    expect(isTooSoonAfterAccept(accepted, new Date('2026-10-01T19:01:00Z'), 12)).toBe(true);
  });
  test('13h after accept → ok', () => {
    expect(isTooSoonAfterAccept(accepted, new Date('2026-10-02T07:34:00Z'), 12)).toBe(false);
  });
  test('missing/invalid acceptedAt never blocks', () => {
    expect(isTooSoonAfterAccept(null, new Date(), 12)).toBe(false);
    expect(isTooSoonAfterAccept('nope', new Date(), 12)).toBe(false);
  });
});

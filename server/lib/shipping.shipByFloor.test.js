/**
 * Ship-by floor + reminder-too-soon gate (fix/ship-by-lead-time).
 */
const { applyShipByFloor, isTooSoonAfterAccept, assessFloorLateRisk, rateEstimatedDays } = require('./shipping');
const { nextBusinessDay, subtractBusinessDays, addBusinessDays } = require('./businessDays');
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

describe('DST-safe business-day math', () => {
  test('nextBusinessDay across fall-back: accept Sat Oct 31 2026 → Mon Nov 2 PST midnight', () => {
    expect(nextBusinessDay(new Date('2026-10-31T19:00:00Z')).toDate().toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });
  test('subtract across spring-forward: Mon Mar 15 2027 − 2 BD → Fri Mar 12 PST midnight', () => {
    expect(subtractBusinessDays(new Date('2027-03-15T19:00:00Z'), 2).toDate().toISOString()).toBe('2027-03-12T08:00:00.000Z');
  });
  test('accept Sat Mar 13 2027: ship-by Mon Mar 15 (PDT) is not falsely floored', () => {
    const r = applyShipByFloor(new Date('2027-03-15T07:00:00Z'), new Date('2027-03-13T20:00:00Z'));
    expect(r.floored).toBe(false);
  });
  test('addBusinessDays skips Sunday + holiday', () => {
    // Wed Nov 25 2026 + 1 BD → Thu 26 Thanksgiving skipped → Fri Nov 27
    expect(addBusinessDays(new Date('2026-11-25T20:00:00Z'), 1).format('YYYY-MM-DD')).toBe('2026-11-27');
  });
});

describe('floor edge cases', () => {
  test('accept Sun → Mon', () => {
    const r = applyShipByFloor(new Date('2026-10-03T07:00:00Z'), new Date('2026-10-04T19:00:00Z'));
    expect(pt(r.shipByDate)).toBe('2026-10-05');
  });
  test('accept Wed before Thanksgiving → Fri Nov 27', () => {
    const r = applyShipByFloor(new Date('2026-11-20T08:00:00Z'), new Date('2026-11-25T20:00:00Z'));
    expect(pt(r.shipByDate)).toBe('2026-11-27');
  });
  test('accept Thu 11:30 PM PT → Fri', () => {
    const r = applyShipByFloor(new Date('2026-09-30T07:00:00Z'), new Date('2026-10-02T06:30:00Z'));
    expect(pt(r.shipByDate)).toBe('2026-10-02');
  });
});

describe('assessFloorLateRisk', () => {
  const fri = nextBusinessDay(new Date('2026-10-01T16:00:00Z')).toDate(); // Fri Oct 2
  test('start Sat Oct 3, 2 transit days → arrives Mon Oct 5: late', () => {
    expect(assessFloorLateRisk({ shipByDate: fri, transitDays: 2, bookingStartISO: '2026-10-03T07:00:00.000Z' }))
      .toEqual({ arrivalYmd: '2026-10-05', startYmd: '2026-10-03', late: true, noBuffer: false });
  });
  test('start Mon Oct 5 (mobile UTC-midnight) → arrives on start day: noBuffer', () => {
    expect(assessFloorLateRisk({ shipByDate: fri, transitDays: 2, bookingStartISO: '2026-10-05T00:00:00.000Z' }))
      .toMatchObject({ late: false, noBuffer: true });
  });
  test('enough time → null', () => {
    expect(assessFloorLateRisk({ shipByDate: fri, transitDays: 2, bookingStartISO: '2026-10-07T07:00:00.000Z' })).toBeNull();
  });
  test('unknown transit → null', () => {
    expect(assessFloorLateRisk({ shipByDate: fri, transitDays: undefined, bookingStartISO: '2026-10-03T07:00:00.000Z' })).toBeNull();
  });
});

describe('rateEstimatedDays', () => {
  test('camelCase (SDK) and snake_case (REST)', () => {
    expect(rateEstimatedDays({ estimatedDays: 2 })).toBe(2);
    expect(rateEstimatedDays({ estimated_days: 5 })).toBe(5);
  });
  test('null/missing/free-text stay null (not 0)', () => {
    expect(rateEstimatedDays({ estimated_days: null })).toBeNull();
    expect(rateEstimatedDays({})).toBeNull();
    expect(rateEstimatedDays({ duration_terms: '1-5 business days' })).toBeNull();
  });
});

describe('SHIP_REMINDER_MIN_HOURS_AFTER_ACCEPT parsing', () => {
  const accepted = '2026-10-01T18:33:00Z';
  const at = new Date('2026-10-01T19:01:00Z'); // 28 min later
  const load = val => {
    let mod;
    jest.isolateModules(() => {
      if (val === undefined) delete process.env.SHIP_REMINDER_MIN_HOURS_AFTER_ACCEPT;
      else process.env.SHIP_REMINDER_MIN_HOURS_AFTER_ACCEPT = val;
      mod = require('./shipping');
    });
    delete process.env.SHIP_REMINDER_MIN_HOURS_AFTER_ACCEPT;
    return mod;
  };
  test('invalid value falls back to 12 (gate still on)', () => {
    expect(load('abc').isTooSoonAfterAccept(accepted, at)).toBe(true);
  });
  test('explicit 0 disables the gate', () => {
    expect(load('0').isTooSoonAfterAccept(accepted, at)).toBe(false);
  });
});

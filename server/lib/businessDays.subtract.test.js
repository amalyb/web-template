/**
 * PR-2 (10.0): subtractBusinessDays.
 *
 * Verifies the PT-based business-day subtraction helper against the
 * verification matrix in the scope doc (Open Questions / Risks section).
 *
 * Policy (scope decision #8):
 *   - Skip Sundays
 *   - Skip USPS federal holidays (PT-local YMD lookup)
 *   - KEEP Saturdays by default (opt-in `skipSaturday` available)
 */

const { subtractBusinessDays } = require('./businessDays');

// Fixtures — UTC-midnight bookingStarts that clearly land on the intended
// weekday when evaluated in PT. bookingStart stored by Sharetribe is
// typically UTC-midnight "on" the calendar day; 08:00Z is an anchor that
// resolves to the same PT calendar day during both PST and PDT.
const BOOKING_MON_NOV_30 = '2026-11-30T08:00:00.000Z'; // Monday, week of Thanksgiving
const BOOKING_MON_JAN_04 = '2027-01-04T08:00:00.000Z'; // Monday, after New Year
const BOOKING_MON = '2026-04-20T08:00:00.000Z';        // Monday (no holiday)
const BOOKING_TUE = '2026-04-21T08:00:00.000Z';        // Tuesday (no holiday)

describe('subtractBusinessDays — scope verification matrix', () => {
  test('1 BD from Monday (Apr 20) → Saturday (Apr 18, Sunday skipped)', () => {
    const r = subtractBusinessDays(BOOKING_MON, 1);
    expect(r.format('YYYY-MM-DD ddd')).toBe('2026-04-18 Sat');
  });

  test('1 BD from Tuesday (Apr 21) → Monday (Apr 20)', () => {
    const r = subtractBusinessDays(BOOKING_TUE, 1);
    expect(r.format('YYYY-MM-DD ddd')).toBe('2026-04-20 Mon');
  });

  test('2 BD from Tuesday (Apr 21) → Saturday (Apr 18, Sunday skipped)', () => {
    const r = subtractBusinessDays(BOOKING_TUE, 2);
    expect(r.format('YYYY-MM-DD ddd')).toBe('2026-04-18 Sat');
  });

  test('3 BD from Mon 2026-11-30 → Wed 2026-11-25 (Thanksgiving skipped)', () => {
    // Sun 11/29 skip, Sat 11/28 count=1, Fri 11/27 count=2,
    // Thu 11/26 Thanksgiving skip, Wed 11/25 count=3.
    const r = subtractBusinessDays(BOOKING_MON_NOV_30, 3);
    expect(r.format('YYYY-MM-DD ddd')).toBe('2026-11-25 Wed');
  });

  test('3 BD from Mon 2027-01-04 → Wed 2026-12-30 (New Year + year boundary)', () => {
    // Sun 01/03 skip, Sat 01/02 count=1, Fri 01/01 New Year skip,
    // Thu 12/31 count=2, Wed 12/30 count=3.
    const r = subtractBusinessDays(BOOKING_MON_JAN_04, 3);
    expect(r.format('YYYY-MM-DD ddd')).toBe('2026-12-30 Wed');
  });
});

describe('subtractBusinessDays — opts.skipSaturday', () => {
  test('1 BD from Monday with skipSaturday=true → Friday', () => {
    const r = subtractBusinessDays(BOOKING_MON, 1, { skipSaturday: true });
    expect(r.format('YYYY-MM-DD ddd')).toBe('2026-04-17 Fri');
  });

  test('skipSaturday=false (default) keeps Saturday as a business day', () => {
    const r = subtractBusinessDays(BOOKING_MON, 1, { skipSaturday: false });
    expect(r.format('YYYY-MM-DD ddd')).toBe('2026-04-18 Sat');
  });
});

describe('subtractBusinessDays — edge cases', () => {
  test('n=0 returns start-of-day unchanged', () => {
    const r = subtractBusinessDays(BOOKING_TUE, 0);
    expect(r.format('YYYY-MM-DD ddd')).toBe('2026-04-21 Tue');
  });

  test('returns dayjs instance, not Date', () => {
    const r = subtractBusinessDays(BOOKING_TUE, 1);
    // dayjs objects have .format/.day/.subtract; Dates don't.
    expect(typeof r.format).toBe('function');
    expect(typeof r.day).toBe('function');
    expect(typeof r.toDate).toBe('function');
  });

  test('.toDate() returns a valid JS Date', () => {
    const r = subtractBusinessDays(BOOKING_TUE, 1).toDate();
    expect(r).toBeInstanceOf(Date);
    expect(Number.isNaN(+r)).toBe(false);
  });
});

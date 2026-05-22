/**
 * Sunday / USPS-holiday-aware return-reminder copy (SMS 7 & 8).
 *
 * When a booking's return date lands on a non-shipping day (Sunday or a USPS
 * holiday), the borrower can't ship that day, so the copy must name the next
 * shipping day instead of "tomorrow" / "today" — mirroring the checkout
 * "Sunday end date" banner. Late-fee math is unaffected (see businessDays.js).
 *
 * Dates are parsed in Pacific time inside the helper, so these assertions are
 * deterministic regardless of the host timezone.
 *   2026-06-04 = Thursday (normal weekday)
 *   2026-06-07 = Sunday
 *   2026-05-25 = Memorial Day (USPS holiday, a Monday) -> next ship day Tuesday 5/26
 */
const { buildReturnReminderCopy, nextShippingDay } = require('./sendReturnReminders');

const ARGS = { itemTitle: 'Faille Halter Mini Dress', shortUrl: 'https://www.sherbrt.com/r/ABC123' };

describe('buildReturnReminderCopy — normal weekday return date', () => {
  test('T-1 says "back tomorrow", no closed-day language', () => {
    const m = buildReturnReminderCopy({ ...ARGS, kind: 'T-1', returnLocalDate: '2026-06-04' });
    expect(m).toContain('back tomorrow');
    expect(m).not.toMatch(/don't run/);
    expect(m).toContain(ARGS.shortUrl);
  });

  test('TODAY uses the original day-of copy', () => {
    const m = buildReturnReminderCopy({ ...ARGS, kind: 'TODAY', returnLocalDate: '2026-06-04' });
    expect(m).toContain("Today's the day");
    expect(m).toContain('$15/day');
    expect(m).not.toMatch(/don't run/);
  });
});

describe('buildReturnReminderCopy — Sunday return date (2026-06-07)', () => {
  test('T-1 names Monday and explains carriers are closed', () => {
    const m = buildReturnReminderCopy({ ...ARGS, kind: 'T-1', returnLocalDate: '2026-06-07' });
    expect(m).toContain("Carriers don't run Sunday");
    expect(m).toContain('back Monday');
    expect(m).not.toContain('tomorrow');
    expect(m).toContain(ARGS.shortUrl);
  });

  test('TODAY says booking ends today, ship Monday to avoid a late fee', () => {
    const m = buildReturnReminderCopy({ ...ARGS, kind: 'TODAY', returnLocalDate: '2026-06-07' });
    expect(m).toContain('ends today');
    expect(m).toContain("carriers don't run Sunday");
    expect(m).toContain('Ship Monday to avoid a late fee');
  });

  test('TODAY_NO_LABEL keeps the Sunday framing without a link', () => {
    const m = buildReturnReminderCopy({ kind: 'TODAY_NO_LABEL', itemTitle: ARGS.itemTitle, returnLocalDate: '2026-06-07' });
    expect(m).toContain('ends today');
    expect(m).toContain('Ship Monday');
    expect(m).toContain('dashboard');
    expect(m).not.toContain('http');
  });
});

describe('buildReturnReminderCopy — USPS holiday return date (Memorial Day 2026-05-25)', () => {
  test('rolls forward to the next shipping day (Tuesday) and says "the holiday"', () => {
    const m = buildReturnReminderCopy({ ...ARGS, kind: 'TODAY', returnLocalDate: '2026-05-25' });
    expect(m).toContain("carriers don't run the holiday");
    expect(m).toContain('Ship Tuesday');
  });
});

describe('buildReturnReminderCopy — consecutive closed days (Sunday before a Monday holiday)', () => {
  // 2026-05-24 = Sunday, 2026-05-25 = Memorial Day (Mon holiday) -> next ship Tuesday 5/26.
  // Exercises the roll-forward loop more than once; closedReason ("Sunday") differs
  // from the named ship day ("Tuesday").
  test('TODAY: Sunday return whose Monday is a holiday -> ship Tuesday', () => {
    const m = buildReturnReminderCopy({ ...ARGS, kind: 'TODAY', returnLocalDate: '2026-05-24' });
    expect(m).toContain("carriers don't run Sunday");
    expect(m).toContain('Ship Tuesday to avoid a late fee');
  });
});

describe('buildReturnReminderCopy — Friday USPS holiday rolls to Saturday', () => {
  // 2026-07-03 = observed Independence Day (Friday). Saturdays are shipping days,
  // so the next shipping day is Saturday 7/4 (confirms "Saturdays count").
  test('TODAY: Friday holiday -> ship Saturday', () => {
    const m = buildReturnReminderCopy({ ...ARGS, kind: 'TODAY', returnLocalDate: '2026-07-03' });
    expect(m).toContain("carriers don't run the holiday");
    expect(m).toContain('Ship Saturday');
  });
});

describe('buildReturnReminderCopy — falsy returnLocalDate falls back to normal copy', () => {
  test('T-1 with undefined returnLocalDate', () => {
    const m = buildReturnReminderCopy({ ...ARGS, kind: 'T-1', returnLocalDate: undefined });
    expect(m).toContain('back tomorrow');
    expect(m).not.toMatch(/don't run/);
  });
  test('TODAY with null returnLocalDate', () => {
    const m = buildReturnReminderCopy({ ...ARGS, kind: 'TODAY', returnLocalDate: null });
    expect(m).toContain("Today's the day");
    expect(m).not.toMatch(/don't run/);
  });
});

describe('nextShippingDay', () => {
  test('Sunday -> Monday', () => {
    expect(nextShippingDay('2026-06-07').format('dddd')).toBe('Monday');
  });
  test('Memorial Day (Mon holiday) -> Tuesday', () => {
    expect(nextShippingDay('2026-05-25').format('dddd')).toBe('Tuesday');
  });
  test('Sunday before a Monday holiday -> Tuesday (two-day roll)', () => {
    expect(nextShippingDay('2026-05-24').format('dddd')).toBe('Tuesday');
  });
  test('Friday holiday -> Saturday (carriers run Saturdays)', () => {
    expect(nextShippingDay('2026-07-03').format('YYYY-MM-DD')).toBe('2026-07-04');
  });
  test('normal Saturday stays Saturday (carriers run Saturdays)', () => {
    // 2026-06-06 is a Saturday
    expect(nextShippingDay('2026-06-06').format('YYYY-MM-DD')).toBe('2026-06-06');
  });
});

/**
 * Hourly-cron simulation of the lender ship-by reminders
 * (decideShippingReminders + quiet hours + once-only dedupe).
 * Scenarios A/B/E/G from the fix/ship-by-lead-time review.
 */
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));
const { decideShippingReminders, shipByCalendarDay } = require('./shipByReminderTiming');
const { withinSendWindow } = require('../util/time');

const TZ = 'America/Los_Angeles';
const fmt = d => (d ? dayjs(d).tz(TZ).format('ddd MMM D HH:mm') : null);

// Run the cron at :00 every hour from acceptedAt for `hours`, return first send times (PT).
function simulate({ acceptedAt, shipByDate, hours = 96 }) {
  const sent = { h24: null, eod: null };
  let t = dayjs(acceptedAt).add(1, 'hour').startOf('hour');
  const end = t.add(hours, 'hour');
  for (; t.isBefore(end); t = t.add(1, 'hour')) {
    const now = t.toDate();
    const d = decideShippingReminders({ shipByDate, acceptedAt, now, minHoursAfterAccept: 12 });
    if (d.due24h && !sent.h24 && withinSendWindow(now)) sent.h24 = now;
    if (d.dueEndOfDay && !sent.eod && withinSendWindow(now)) sent.eod = now;
  }
  return { h24: fmt(sent.h24), eod: fmt(sent.eod) };
}

describe('reminder cron simulation', () => {
  let logSpy;
  beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => logSpy.mockRestore());

  test('A: accept Thu 11:33 AM, ship-by Fri → reminder Fri 8 AM, not-scanned Fri 3 PM (nothing Thu)', () => {
    expect(simulate({ acceptedAt: '2026-10-01T18:33:43Z', shipByDate: '2026-10-02T07:00:00.000Z' }))
      .toEqual({ h24: 'Fri Oct 2 08:00', eod: 'Fri Oct 2 15:00' });
  });

  test('B: accept Thu 9 PM, ship-by Fri → reminder Fri 9 AM, not-scanned Fri 3 PM', () => {
    expect(simulate({ acceptedAt: '2026-10-02T04:00:00Z', shipByDate: '2026-10-02T07:00:00.000Z' }))
      .toEqual({ h24: 'Fri Oct 2 09:00', eod: 'Fri Oct 2 15:00' });
  });

  test('G (PST): accept Thu Nov 5 4:30 PM, ship-by Fri → reminder Fri 8 AM, not-scanned Fri 3 PM', () => {
    expect(simulate({ acceptedAt: '2026-11-06T00:30:00Z', shipByDate: '2026-11-06T08:00:00.000Z' }))
      .toEqual({ h24: 'Fri Nov 6 08:00', eod: 'Fri Nov 6 15:00' });
  });

  test('E: accept Sat 2 PM, ship-by Mon → no Sunday SMS; reminder Mon 8 AM', () => {
    expect(simulate({ acceptedAt: '2026-10-03T21:00:00Z', shipByDate: '2026-10-05T07:00:00.000Z' }))
      .toEqual({ h24: 'Mon Oct 5 08:00', eod: 'Mon Oct 5 15:00' });
  });

  test('normal lead: accept Thu 11:33 AM, ship-by Sat → reminder Fri noon, not-scanned Sat 3 PM', () => {
    expect(simulate({ acceptedAt: '2026-10-01T18:33:43Z', shipByDate: '2026-10-03T07:00:00.000Z' }))
      .toEqual({ h24: 'Fri Oct 2 12:00', eod: 'Sat Oct 3 15:00' });
  });

  test('missing acceptedAt: deadline 8 AM PT on ship-by day, reminder day before', () => {
    const r = decideShippingReminders({
      shipByDate: '2026-10-03T07:00:00.000Z', acceptedAt: null,
      now: new Date('2026-10-02T16:00:00Z'), minHoursAfterAccept: 12,
    });
    expect(fmt(r.deadline)).toBe('Sat Oct 3 08:00');
    expect(r.due24h).toBe(true);
  });
});

describe('end-of-day alert uses the PT ship-by day (regression for UTC-date bug)', () => {
  const shipByDate = '2026-10-02T07:00:00.000Z';
  test('5 PM PT the day before ship-by is NOT ship-by day', () => {
    const r = decideShippingReminders({ shipByDate, acceptedAt: null, now: new Date('2026-10-02T00:00:00Z') });
    expect(r.isShipByDay).toBe(false);
    expect(r.dueEndOfDay).toBe(false);
  });
  test('10 PM PT on ship-by day still in window (was cut off at 5 PM PDT)', () => {
    const r = decideShippingReminders({ shipByDate, acceptedAt: null, now: new Date('2026-10-03T05:00:00Z') });
    expect(r.dueEndOfDay).toBe(true);
  });
  test('2 PM PT on ship-by day is before the window', () => {
    const r = decideShippingReminders({ shipByDate, acceptedAt: null, now: new Date('2026-10-02T21:00:00Z') });
    expect(r.isShipByDay).toBe(true);
    expect(r.dueEndOfDay).toBe(false);
  });
});

describe('shipByCalendarDay', () => {
  test('PT midnight (PDT/PST) and legacy UTC midnight resolve to the same day', () => {
    expect(shipByCalendarDay('2026-10-02T07:00:00.000Z')).toBe('2026-10-02');
    expect(shipByCalendarDay('2026-11-06T08:00:00.000Z')).toBe('2026-11-06');
    expect(shipByCalendarDay('2026-10-02T00:00:00.000Z')).toBe('2026-10-02');
  });
});

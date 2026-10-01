// server/lib/shipByReminderTiming.js
//
// Pure timing decisions for the lender ship-by reminder cron
// (server/scripts/sendShippingReminders.js). Kept side-effect free so the
// hourly cron can be simulated in tests.
//
// All "which day is it" checks use the PT calendar. The previous code
// compared UTC dates, so 5 PM PT the day BEFORE ship-by (= 00:00Z on
// ship-by day) counted as ship-by day and the "hasn't been scanned yet"
// SMS fired a day early; and it anchored the 24h reminder with
// setUTCHours(acceptedAt UTC hour), which put the deadline on the previous
// PT evening for anyone accepting after 5 PM PT.

const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));
const { TZ, ymd } = require('./businessDays');
const { isTooSoonAfterAccept } = require('./shipping');

const HOUR_MS = 60 * 60 * 1000;
const EOD_START_HOUR_PT = 15; // "end of ship-by day" alert window opens 3 PM PT
const DEFAULT_DEADLINE_TIME_PT = '08:00'; // when acceptedAt is unknown

/**
 * PT calendar day (YYYY-MM-DD) a persisted shipByDate refers to. +12h makes
 * this correct whether it was stored as PT midnight (current) or UTC
 * midnight (pre-10.0 rows).
 */
function shipByCalendarDay(shipByDate) {
  const t = new Date(shipByDate).getTime();
  if (Number.isNaN(t)) return null;
  return ymd(new Date(t + 12 * HOUR_MS));
}

/**
 * Ship-by "deadline" instant used to time the 24h reminder: the ship-by PT
 * day at the PT time-of-day the lender accepted (so the reminder lands at a
 * familiar hour), or 8 AM PT if acceptedAt is unknown.
 */
function shipByDeadline(shipByDate, acceptedAt) {
  const day = shipByCalendarDay(shipByDate);
  if (!day) return null;
  let hhmm = DEFAULT_DEADLINE_TIME_PT;
  if (acceptedAt && !Number.isNaN(new Date(acceptedAt).getTime())) {
    hhmm = dayjs(acceptedAt).tz(TZ).format('HH:mm');
  }
  return dayjs.tz(`${day} ${hhmm}`, TZ).toDate();
}

/**
 * Decide which reminders are due at `now` (before Redis dedupe and quiet
 * hours, which the cron applies).
 *
 * @returns {{
 *   deadline: Date|null, reminderAt: Date|null,
 *   in24hWindow: boolean, tooSoonAfterAccept: boolean, sundayHold: boolean,
 *   due24h: boolean, isShipByDay: boolean, dueEndOfDay: boolean
 * }}
 */
function decideShippingReminders({ shipByDate, acceptedAt, now, minHoursAfterAccept }) {
  const nowMs = now.getTime();
  const deadline = shipByDeadline(shipByDate, acceptedAt);
  const empty = {
    deadline: null, reminderAt: null, in24hWindow: false, tooSoonAfterAccept: false,
    sundayHold: false, due24h: false, isShipByDay: false, dueEndOfDay: false,
  };
  if (!deadline) return empty;

  // 24h reminder anchor; if it lands on a PT Sunday, roll back to Saturday.
  let reminderAt = new Date(deadline.getTime() - 24 * HOUR_MS);
  if (dayjs(reminderAt).tz(TZ).day() === 0) {
    reminderAt = new Date(reminderAt.getTime() - 24 * HOUR_MS);
  }
  const in24hWindow = nowMs >= reminderAt.getTime() && nowMs < deadline.getTime();
  const tooSoonAfterAccept = minHoursAfterAccept === undefined
    ? isTooSoonAfterAccept(acceptedAt, now)
    : isTooSoonAfterAccept(acceptedAt, now, minHoursAfterAccept);
  // Don't let the too-soon deferral push the reminder onto a Sunday
  // (it then goes out Monday morning, which is ship-by day at the latest).
  const sundayHold = dayjs(now).tz(TZ).day() === 0;
  const due24h = in24hWindow && !tooSoonAfterAccept && !sundayHold;

  const isShipByDay = shipByCalendarDay(shipByDate) === ymd(now);
  const ptHour = Number(dayjs(now).tz(TZ).format('H'));
  const dueEndOfDay = isShipByDay && ptHour >= EOD_START_HOUR_PT;

  return { deadline, reminderAt, in24hWindow, tooSoonAfterAccept, sundayHold, due24h, isShipByDay, dueEndOfDay };
}

module.exports = {
  shipByCalendarDay,
  shipByDeadline,
  decideShippingReminders,
  EOD_START_HOUR_PT,
};

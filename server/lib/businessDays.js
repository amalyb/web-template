/**
 * Shared Business-Day Logic for Late Fees & Overdue Reminders
 * 
 * Centralizes the calculation of "chargeable days" that exclude:
 * - Sundays (non-chargeable weekday)
 * - USPS federal holidays (no mail delivery)
 * 
 * All date calculations use Pacific time (America/Los_Angeles) for consistency.
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'America/Los_Angeles';

/**
 * Weekdays that are non-chargeable (0 = Sunday in dayjs().day())
 */
const NON_CHARGEABLE_WEEKDAYS = [0]; // Sunday

/**
 * USPS federal holidays (no mail delivery) for 2025 and 2026
 * Format: YYYY-MM-DD strings
 * 
 * TODO: Extend USPS_HOLIDAYS beyond 2026-12-25 before the 2027 calendar year.
 */
const USPS_HOLIDAYS = new Set([
  // 2025
  '2025-01-01', // New Year's Day
  '2025-01-20', // Martin Luther King Jr. Day
  '2025-02-17', // Presidents' Day / Washington's Birthday
  '2025-05-26', // Memorial Day
  '2025-06-19', // Juneteenth National Independence Day
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-10-13', // Columbus Day / Indigenous Peoples' Day
  '2025-11-11', // Veterans Day
  '2025-11-27', // Thanksgiving Day
  '2025-12-25', // Christmas Day
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King Jr. Day
  '2026-02-16', // Presidents' Day / Washington's Birthday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth National Independence Day
  '2026-07-03', // observed Independence Day
  '2026-09-07', // Labor Day
  '2026-10-12', // Columbus Day / Indigenous Peoples' Day
  '2026-11-11', // Veterans Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
]);

/**
 * Check if a date is non-chargeable (Sunday or USPS holiday)
 * @param {string|Date|dayjs.Dayjs} d - Date to check
 * @returns {boolean} True if date is non-chargeable
 */
function isNonChargeableDate(d) {
  const dj = dayjs(d).tz(TZ).startOf('day');
  const weekday = dj.day(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const ymdStr = dj.format('YYYY-MM-DD');
  return NON_CHARGEABLE_WEEKDAYS.includes(weekday) || USPS_HOLIDAYS.has(ymdStr);
}

/**
 * Format date as YYYY-MM-DD in Pacific timezone
 * @param {string|Date|dayjs.Dayjs} d - Date to format
 * @returns {string} Date in YYYY-MM-DD format
 */
function ymd(d) {
  return dayjs(d).tz(TZ).format('YYYY-MM-DD');
}

/**
 * Compute "chargeable late days" between refDate and returnDate,
 * skipping Sundays and USPS holidays.
 * 
 * - We treat lateness as the number of chargeable days AFTER due date
 *   up to and including the reference date.
 * - Both dates are normalized to Pacific time, startOf('day').
 * - If refDate < returnDate, returns 0.
 * - Counting starts from the day after return date.
 * - For each day up to and including refDate, increment count if:
 *   - weekday is not Sunday, and
 *   - ymdStr not in USPS_HOLIDAYS.
 * 
 * @param {string|Date|dayjs.Dayjs} refDate - Reference date (scan date for Scenario A, today for Scenario B)
 * @param {string|Date|dayjs.Dayjs} returnDate - Return due date
 * @returns {number} Number of chargeable late days (0 or positive)
 * 
 * @example
 * // Due Friday, scanned Monday (with Sunday in between)
 * computeChargeableLateDays('2025-01-13', '2025-01-10') // => 2 (Sat + Mon, Sunday skipped)
 * 
 * // Due Wednesday, today is Monday (with Sunday in between)
 * computeChargeableLateDays('2025-01-13', '2025-01-08') // => 4 (Thu, Fri, Sat, Mon; Sunday skipped)
 * 
 * // Due right before Thanksgiving
 * computeChargeableLateDays('2025-11-28', '2025-11-26') // => 1 (Fri only; Thu 11/27 is Thanksgiving)
 */
function computeChargeableLateDays(refDate, returnDate) {
  const start = dayjs(returnDate).tz(TZ).startOf('day');
  const end = dayjs(refDate).tz(TZ).startOf('day');

  if (end.isBefore(start)) {
    return 0;
  }

  let chargeableDays = 0;
  let cursor = start.add(1, 'day'); // start counting the day AFTER due date

  while (!cursor.isAfter(end)) {
    if (!isNonChargeableDate(cursor)) {
      chargeableDays += 1;
    }
    cursor = cursor.add(1, 'day');
  }

  return chargeableDays;
}

module.exports = {
  TZ,
  ymd,
  isNonChargeableDate,
  computeChargeableLateDays,
  USPS_HOLIDAYS,
  NON_CHARGEABLE_WEEKDAYS,
};


/**
 * Canonical availability-plan shape for Sherbrt listings.
 *
 * WHY THIS SHAPE
 *
 * Sherbrt rents by the day, and the client sends booking boundaries at
 * marketplace-TZ midnight (07:00Z / 08:00Z — see MARKETPLACE_TZ in
 * ./dates). Two plan shapes were tried before this one:
 *
 *   `availability-plan/day`  — Sharetribe exposes a UTC-midnight day grid
 *     (`time-slot/day`, 00:00Z boundaries). An LA-midnight booking lands
 *     mid-slot and checkout fails with HTTP 409
 *     `transaction-booking-time-not-available`. The grid cannot be moved:
 *     adding `timezone` to a day-plan is rejected with HTTP 400
 *     `validation-disallowed-key` at path ["availabilityPlan","timezone"].
 *     Verified against production 2026-09-08.
 *
 *   `availability-plan/time` with 24h entries (this one) — `startTime`
 *     equal to `endTime` means "all day", so consecutive days merge and
 *     `timeslots.query` returns ONE continuous `time-slot/time` spanning
 *     the queried range. A continuous window contains any sub-interval,
 *     so LA-midnight bookings fit and checkout succeeds. This is the
 *     shape the listings that always worked were already on.
 *
 * The `timezone` key is kept for consistency with those listings, but it
 * is NOT what makes this work — with 24h entries the window is continuous
 * in any timezone. It would only matter if entries had partial-day times
 * or if some weekdays were disabled, in which case the availability edges
 * would fall at marketplace-TZ midnight.
 *
 * Consequence worth knowing: a 24h plan does not constrain anything. Every
 * day is available, and dates are blocked only by availability exceptions
 * and existing bookings. That is intentional for a rental marketplace where
 * lenders block specific dates rather than keeping a weekly schedule.
 *
 * Keep this in sync with:
 *   - server/scripts/convertToTimePlan.js (CommonJS copy, migration)
 *   - sherbrt-mobile app/lending/new/availability.tsx (the mobile wizard)
 */

import { MARKETPLACE_TZ } from './dates';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * The plan every bookable Sherbrt listing should carry.
 *
 * Returns a fresh object each call so callers can't mutate a shared
 * reference into the Redux store or an API payload.
 *
 * @returns {Object} availability-plan/time, 7 days, 1 seat, always open
 */
export const createDefaultAvailabilityPlan = () => ({
  type: 'availability-plan/time',
  timezone: MARKETPLACE_TZ,
  entries: WEEKDAYS.map(dayOfWeek => ({
    dayOfWeek,
    seats: 1,
    startTime: '00:00',
    endTime: '00:00',
  })),
});

/**
 * True when a plan is the bookable shape above: a time-plan covering all
 * seven days with at least one seat and 24h (startTime === endTime) entries.
 *
 * Anything else — a day-plan, a partial week, no plan — produces a UTC day
 * grid or no availability, and checkout will 409. Use this to decide whether
 * a listing needs upgrading rather than checking `type` alone.
 *
 * @param {Object} plan listing.attributes.availabilityPlan
 * @returns {boolean}
 */
export const isBookableAvailabilityPlan = plan => {
  if (!plan || plan.type !== 'availability-plan/time') {
    return false;
  }
  const entries = Array.isArray(plan.entries) ? plan.entries : [];
  const openDays = new Set(
    entries
      .filter(e => Number(e.seats) >= 1 && e.startTime === e.endTime)
      .map(e => e.dayOfWeek)
  );
  return WEEKDAYS.every(d => openDays.has(d));
};

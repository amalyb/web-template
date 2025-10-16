/**
 * Centralized Time Helper
 * 
 * Single source of truth for time operations with support for:
 * - FORCE_NOW: Override current time (ISO format)
 * - FORCE_TODAY: Override today's date (YYYY-MM-DD)
 * - FORCE_TOMORROW: Override tomorrow's date (YYYY-MM-DD)
 * 
 * All reminder scripts, transaction handlers, and webhooks should use
 * these functions instead of direct new Date() or Date.now() calls.
 * 
 * Environment Variables:
 * - TZ: Timezone (default: America/Los_Angeles)
 * - FORCE_NOW: Override current timestamp (e.g., 2025-01-15T09:30:00.000Z)
 * - FORCE_TODAY: Override today's date (e.g., 2025-01-15)
 * - FORCE_TOMORROW: Override tomorrow's date (e.g., 2025-01-16)
 */

const TZ = process.env.TZ || 'America/Los_Angeles';

/**
 * Internal helper: Convert timestamp to YYYY-MM-DD
 * @private
 */
function _isoDate(d) {
  return new Date(d).toISOString().split('T')[0];
}

/**
 * Get current time with FORCE_NOW override support
 * 
 * @returns {Date} Current time or overridden time
 * 
 * @example
 * // Normal usage
 * const now = getNow(); // => current time
 * 
 * // With override
 * process.env.FORCE_NOW = '2025-01-15T09:30:00.000Z';
 * const now = getNow(); // => 2025-01-15T09:30:00.000Z
 */
function getNow() {
  const forced = process.env.FORCE_NOW;
  if (forced) {
    console.log(`[TIME] FORCE_NOW=${forced}`);
    return new Date(forced);
  }
  return new Date();
}

/**
 * Get today's date (YYYY-MM-DD) with FORCE_TODAY override support
 * 
 * @returns {string} Today's date in YYYY-MM-DD format
 * 
 * @example
 * // Normal usage
 * const today = getToday(); // => '2025-01-15'
 * 
 * // With override
 * process.env.FORCE_TODAY = '2025-12-25';
 * const today = getToday(); // => '2025-12-25'
 */
function getToday() {
  const forced = process.env.FORCE_TODAY;
  if (forced) {
    console.log(`[TIME] FORCE_TODAY=${forced}`);
    return forced;
  }
  return _isoDate(getNow());
}

/**
 * Get tomorrow's date (YYYY-MM-DD) with FORCE_TOMORROW override support
 * 
 * @returns {string} Tomorrow's date in YYYY-MM-DD format
 * 
 * @example
 * // Normal usage
 * const tomorrow = getTomorrow(); // => '2025-01-16'
 * 
 * // With override
 * process.env.FORCE_TOMORROW = '2025-12-26';
 * const tomorrow = getTomorrow(); // => '2025-12-26'
 */
function getTomorrow() {
  const forced = process.env.FORCE_TOMORROW;
  if (forced) {
    console.log(`[TIME] FORCE_TOMORROW=${forced}`);
    return forced;
  }
  const now = getNow();
  return _isoDate(now.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Convert timestamp to YYYY-MM-DD format
 * 
 * @param {number|Date} d - Timestamp or Date object
 * @returns {string} Date in YYYY-MM-DD format
 * 
 * @example
 * yyyymmdd(Date.now()) // => '2025-01-15'
 * yyyymmdd(new Date('2025-01-15T09:30:00Z')) // => '2025-01-15'
 */
function yyyymmdd(d) {
  return _isoDate(d);
}

/**
 * Calculate difference in days between two dates
 * Always uses UTC to avoid timezone issues
 * 
 * @param {string} date1 - First date (YYYY-MM-DD)
 * @param {string} date2 - Second date (YYYY-MM-DD)
 * @returns {number} Number of days (date1 - date2)
 * 
 * @example
 * diffDays('2025-01-20', '2025-01-15') // => 5
 * diffDays('2025-01-15', '2025-01-20') // => -5
 */
function diffDays(date1, date2) {
  const d1 = new Date(date1 + 'T00:00:00.000Z'); // Force UTC
  const d2 = new Date(date2 + 'T00:00:00.000Z'); // Force UTC
  return Math.ceil((d1 - d2) / (1000 * 60 * 60 * 24));
}

/**
 * Add days to a date
 * Always uses UTC to avoid timezone issues
 * 
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} days - Number of days to add (can be negative)
 * @returns {Date} New date
 * 
 * @example
 * addDays('2025-01-15', 5) // => Date for 2025-01-20
 * addDays('2025-01-15', -2) // => Date for 2025-01-13
 */
function addDays(date, days) {
  const result = new Date(date + 'T00:00:00.000Z'); // Force UTC
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Check if two dates are the same day
 * 
 * @param {Date|string|number} date1 - First date
 * @param {Date|string|number} date2 - Second date
 * @returns {boolean} True if same day
 * 
 * @example
 * isSameDay(new Date('2025-01-15T09:00:00Z'), new Date('2025-01-15T18:00:00Z')) // => true
 * isSameDay('2025-01-15', '2025-01-16') // => false
 */
function isSameDay(date1, date2) {
  return yyyymmdd(date1) === yyyymmdd(date2);
}

/**
 * Check if current time is morning of given date (6 AM - 12 PM UTC)
 * Respects FORCE_NOW override
 * 
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {boolean} True if current time is morning of the given date
 * 
 * @example
 * // If FORCE_NOW = '2025-01-15T07:00:00.000Z' (7 AM UTC)
 * isMorningOf('2025-01-15') // => true
 * 
 * // If FORCE_NOW = '2025-01-15T14:00:00.000Z' (2 PM UTC)
 * isMorningOf('2025-01-15') // => false
 */
function isMorningOf(date) {
  const now = getNow(); // ← respects FORCE_NOW
  const target = new Date(date + 'T00:00:00.000Z');
  return isSameDay(now, target) && now.getUTCHours() >= 6 && now.getUTCHours() < 12;
}

/**
 * Get current timestamp in ISO format
 * Respects FORCE_NOW override
 * 
 * @returns {string} ISO timestamp
 * 
 * @example
 * timestamp() // => '2025-01-15T09:30:00.000Z'
 * 
 * // With FORCE_NOW
 * process.env.FORCE_NOW = '2025-12-25T12:00:00.000Z';
 * timestamp() // => '2025-12-25T12:00:00.000Z'
 */
function timestamp() {
  return getNow().toISOString();
}

/**
 * Get next 9 AM Pacific Time
 * Used for daily scheduling of reminder jobs
 * Respects FORCE_NOW override
 * 
 * Note: 9 AM PT ≈ 17:00 UTC (16:00 during DST)
 * This uses simplified 17:00 UTC calculation
 * 
 * @returns {Date} Next 9 AM PT
 * 
 * @example
 * // If current time is 8 AM PT (16:00 UTC)
 * getNext9AM() // => Today at 9 AM PT (17:00 UTC)
 * 
 * // If current time is 10 AM PT (18:00 UTC)
 * getNext9AM() // => Tomorrow at 9 AM PT (17:00 UTC)
 */
function getNext9AM() {
  const now = getNow(); // ← respects FORCE_NOW
  const next = new Date(now);
  next.setUTCHours(17, 0, 0, 0); // 9 AM PT ≈ 17:00 UTC
  
  if (now >= next) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  
  return next;
}

/**
 * Log current time state (useful for debugging reminder jobs)
 * Shows all FORCE_* overrides in effect
 * 
 * @example
 * logTimeState();
 * // => [TIME] now=2025-01-15T09:30:00.000Z today=2025-01-15 tomorrow=2025-01-16
 */
function logTimeState() {
  const now = timestamp();
  const today = getToday();
  const tomorrow = getTomorrow();
  console.log(`[TIME] now=${now} today=${today} tomorrow=${tomorrow}`);
}

module.exports = {
  TZ,
  getNow,
  getToday,
  getTomorrow,
  yyyymmdd,
  diffDays,
  addDays,
  isSameDay,
  isMorningOf,
  timestamp,
  getNext9AM,
  logTimeState,
};


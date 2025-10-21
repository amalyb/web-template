// server/lib/shipping.js
const { haversineMiles, geocodeZip } = require('./geo');
const { utcToZonedTime, format } = require('date-fns-tz');
const { startOfDay } = require('date-fns');

const LEAD_MODE = process.env.SHIP_LEAD_MODE || 'static';
const LEAD_FLOOR = Number(process.env.SHIP_LEAD_DAYS || 2);
const LEAD_MAX = Number(process.env.SHIP_LEAD_MAX || 5);

function getBookingStartISO(tx) {
  // Try a bunch of shapes defensively, including protectedData fallbacks
  return (
    tx?.attributes?.booking?.attributes?.start ||
    tx?.booking?.attributes?.start ||
    tx?.attributes?.protectedData?.bookingStartISO ||
    tx?.protectedData?.bookingStartISO ||
    null
  );
}

/**
 * Resolve origin and destination ZIP codes from transaction data
 * Priority order:
 * 1. Shippo label addresses (if preferLabelAddresses=true AND label exists - carrier-validated)
 * 2. ProtectedData (set at accept/booking - providerZip & customerZip)
 * 
 * @param {Object} tx - Transaction object
 * @param {Object} opts - Options { preferLabelAddresses: boolean } (default: true)
 * @returns {Promise<{fromZip: string|null, toZip: string|null}>}
 */
async function resolveZipsFromTx(tx, opts = {}) {
  const preferLabel = opts.preferLabelAddresses !== false;
  const pd = tx?.attributes?.protectedData || {};
  const md = tx?.attributes?.metadata || {};

  // 1) Label ZIPs (ground truth once purchased)
  let fromZip = null;
  let toZip = null;
  const lbl =
    tx?.attributes?.protectedData?.outboundLabel ||
    md?.shipping?.outboundLabel ||
    null;

  if (preferLabel && lbl) {
    fromZip = lbl?.from?.zip || lbl?.from?.postal_code || lbl?.address_from?.zip || null;
    toZip   = lbl?.to?.zip   || lbl?.to?.postal_code   || lbl?.address_to?.zip   || null;
  }

  // 2) Accept/checkout form ZIPs on the transaction (PD)
  fromZip = fromZip || pd.providerZip || pd.provider?.postal_code || null;  // lender @ accept
  toZip   = toZip   || pd.customerZip || pd.customer?.postal_code || null;  // borrower @ booking

  // 3) No profile/legacy fallbacks by design
  console.log('[ship-by] PD zips', {
    providerZip: pd.providerZip,
    customerZip: pd.customerZip,
    usedFrom: fromZip,
    usedTo: toZip,
  });

  return { fromZip, toZip };
}

/**
 * Compute lead days from miles using realistic transit thresholds
 * @param {number} miles - Distance in miles
 * @returns {number} Lead days before booking start
 */
function leadDaysFromMiles(miles) {
  if (miles <= 50) return 1;
  if (miles <= 250) return 2;
  if (miles <= 600) return 3;
  if (miles <= 1500) return 4;
  return 5;
}

/**
 * Compute lead days based on distance between origin and destination
 * Uses realistic distance thresholds:
 * - ≤50 miles: 1 day
 * - ≤250 miles: 2 days
 * - ≤600 miles: 3 days
 * - ≤1500 miles: 4 days
 * - >1500 miles: 5 days
 * 
 * @param {Object} params - { fromZip, toZip }
 * @returns {Promise<{leadDays: number, miles: number|null}>}
 */
async function computeLeadDaysDynamic({ fromZip, toZip }) {
  if (!fromZip || !toZip) {
    const staticFloor = Number(process.env.SHIP_LEAD_DAYS || 0);
    const lead = Math.max(1, staticFloor);
    return { leadDays: lead, miles: null };
  }

  const [fromLL, toLL] = await Promise.all([geocodeZip(fromZip), geocodeZip(toZip)]);
  if (!fromLL || !toLL) {
    const staticFloor = Number(process.env.SHIP_LEAD_DAYS || 0);
    const lead = Math.max(1, staticFloor);
    return { leadDays: lead, miles: null };
  }

  const miles = haversineMiles([fromLL.lat, fromLL.lng], [toLL.lat, toLL.lng]);
  const lead = leadDaysFromMiles(miles);

  // Debug log (safe/structured)
  console.log('[ship-by:distance]', {
    fromZip,
    toZip,
    miles: Math.round(miles),
    chosenLeadDays: lead,
  });

  return { leadDays: lead, miles };
}

/**
 * Adjust ship-by date if it falls on Sunday (move to Saturday)
 * @param {Date} date - The date to check/adjust
 * @returns {Date} Original date or Saturday if it was Sunday
 */
function adjustIfSundayUTC(date) {
  if (!date) return date;
  // 0 = Sunday (in UTC, since we normalized with setUTCHours earlier)
  if (date.getUTCDay() === 0) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - 1); // move to Saturday
    return d;
  }
  return date;
}

/**
 * Compute ship-by date and metadata for a transaction
 * Supports both static and distance-based lead time calculation
 * 
 * @param {Object} tx - Transaction object with booking and address data
 * @param {Object} opts - Options { preferLabelAddresses: boolean }
 * @returns {Promise<{shipByDate: Date, leadDays: number, miles: number|null, mode: string}>}
 */
async function computeShipBy(tx, opts = {}) {
  const startISO = getBookingStartISO(tx);
  if (!startISO) {
    return { shipByDate: null, leadDays: 0, miles: null, mode: 'none' };
  }

  const start = new Date(startISO);
  if (Number.isNaN(+start)) {
    return { shipByDate: null, leadDays: 0, miles: null, mode: 'none' };
  }
  
  // Normalize to UTC midnight to avoid timezone shifts
  start.setUTCHours(0, 0, 0, 0);

  let leadDays = LEAD_FLOOR;
  let miles = null;
  let mode = 'static';

  if (LEAD_MODE === 'distance') {
    const { fromZip, toZip } = await resolveZipsFromTx(tx, opts);
    console.log('[ship-by] zips', { fromZip, toZip });
    const result = await computeLeadDaysDynamic({ fromZip, toZip });
    leadDays = result.leadDays;
    miles = result.miles;
    mode = miles != null ? 'distance' : 'static';
  } else {
    // static (existing behavior)
    const staticFloor = Number(process.env.SHIP_LEAD_DAYS || 0);
    leadDays = Math.max(1, staticFloor);
    console.log('[ship-by:static]', { chosenLeadDays: leadDays });
  }

  const shipBy = new Date(start);
  shipBy.setUTCDate(shipBy.getUTCDate() - leadDays);

  // Optional toggle via env (recommended)
  const ADJUST_SUNDAY = String(process.env.SHIP_ADJUST_SUNDAY || '1') === '1';
  const adjusted = ADJUST_SUNDAY ? adjustIfSundayUTC(shipBy) : shipBy;

  if (ADJUST_SUNDAY && adjusted.getTime() !== shipBy.getTime()) {
    console.log('[ship-by:adjust]', {
      originalISO: shipBy.toISOString(),
      adjustedISO: adjusted.toISOString(),
      reason: 'sunday_to_saturday',
    });
  }
  
  // Final verification log
  console.log('[ship-by:final]', {
    startISO: startISO,
    leadDays: leadDays,
    miles: miles ? Math.round(miles) : null,
    shipByISO: adjusted.toISOString(),
    mode: mode
  });

  return { shipByDate: adjusted, leadDays, miles, mode };
}

/**
 * Legacy wrapper for backward compatibility
 * @deprecated Use computeShipBy instead
 */
async function computeShipByDate(tx, opts = {}) {
  const result = await computeShipBy(tx, opts);
  return result.shipByDate;
}

/**
 * Format ship-by date for SMS display (Pacific Time, start-of-day)
 * @param {Date} date - The date to format
 * @returns {string|null} Formatted date string or null
 */
function formatShipBy(date) {
  if (!date) return null;
  try {
    const tz = 'America/Los_Angeles';
    const z = utcToZonedTime(new Date(date), tz);
    const sod = startOfDay(z);
    return format(sod, 'MMM d', { timeZone: tz });
  } catch {
    return null;
  }
}

module.exports = { 
  computeShipBy,
  computeShipByDate,  // legacy
  formatShipBy, 
  getBookingStartISO,
  resolveZipsFromTx,
  computeLeadDaysDynamic,
  leadDaysFromMiles,
};
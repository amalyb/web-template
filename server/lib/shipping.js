// server/lib/shipping.js
const { haversineMiles, geocodeZip } = require('./geo');

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
 * 1. Outbound label addresses (most reliable - validated by carrier)
 * 2. Borrower checkout shipping address
 * 3. Lender profile address
 * 
 * @param {Object} tx - Transaction object
 * @param {Object} opts - Options { preferLabelAddresses: boolean }
 * @returns {Promise<{fromZip: string|null, toZip: string|null}>}
 */
async function resolveZipsFromTx(tx, opts = {}) {
  const preferLabel = opts.preferLabelAddresses !== false;

  let fromZip = null;
  let toZip = null;

  try {
    if (preferLabel) {
      const pd = tx?.attributes?.protectedData || tx?.protectedData || {};
      
      // Try from protectedData top-level fields (most reliable - from label creation)
      fromZip = fromZip || pd.providerZip;
      toZip = toZip || pd.customerZip;
      
      // Also check nested metadata.shipping.outboundLabel if present
      const lbl = tx?.attributes?.metadata?.shipping?.outboundLabel;
      fromZip = fromZip || lbl?.from?.zip || lbl?.from?.postal_code;
      toZip = toZip || lbl?.to?.zip || lbl?.to?.postal_code;
    }
  } catch (err) {
    console.warn('[ship-by] Error accessing label addresses:', err.message);
  }

  // Borrower destination (checkout) fallback
  try {
    const checkoutTo = tx?.attributes?.metadata?.checkout?.shippingAddress;
    toZip = toZip || checkoutTo?.postal_code || checkoutTo?.zip;
  } catch (err) {
    console.warn('[ship-by] Error accessing checkout address:', err.message);
  }

  // Lender origin fallback (profile)
  try {
    const lenderAddr = tx?.attributes?.metadata?.lender?.address;
    fromZip = fromZip || lenderAddr?.postal_code || lenderAddr?.zip;
  } catch (err) {
    console.warn('[ship-by] Error accessing lender address:', err.message);
  }

  return { fromZip, toZip };
}

/**
 * Compute lead days based on distance between origin and destination
 * Uses simple distance buckets:
 * - ≤200 miles: 1 day (respecting floor)
 * - 200-1000 miles: 2 days (respecting floor)
 * - >1000 miles: 3 days (respecting floor)
 * 
 * @param {Object} params - { fromZip, toZip }
 * @returns {Promise<number>} Lead days (between LEAD_FLOOR and LEAD_MAX)
 */
async function computeLeadDaysDynamic({ fromZip, toZip }) {
  if (!fromZip || !toZip) return LEAD_FLOOR;

  const [fromLL, toLL] = await Promise.all([geocodeZip(fromZip), geocodeZip(toZip)]);
  if (!fromLL || !toLL) return LEAD_FLOOR;

  const miles = haversineMiles([fromLL.lat, fromLL.lng], [toLL.lat, toLL.lng]);

  // Buckets (tuneable): ≤200mi:1d, 200–1000mi:2d, >1000mi:3d
  let lead = LEAD_FLOOR;
  if (miles <= 200) {
    lead = Math.max(1, LEAD_FLOOR);
  } else if (miles <= 1000) {
    lead = Math.max(2, LEAD_FLOOR);
  } else {
    lead = Math.max(3, LEAD_FLOOR);
  }

  // Cap to LEAD_MAX
  lead = Math.min(lead, LEAD_MAX);

  // Debug log (safe/structured)
  console.log('[ship-by:distance]', {
    fromZip,
    toZip,
    miles: Math.round(miles),
    chosenLeadDays: lead,
    floor: LEAD_FLOOR,
    max: LEAD_MAX,
  });

  return lead;
}

/**
 * Compute ship-by date for a transaction
 * Supports both static and distance-based lead time calculation
 * 
 * @param {Object} tx - Transaction object with booking and address data
 * @param {Object} opts - Options { preferLabelAddresses: boolean }
 * @returns {Promise<Date|null>} Ship-by date or null if cannot be computed
 */
async function computeShipByDate(tx, opts = {}) {
  const startISO = getBookingStartISO(tx);
  if (!startISO) return null;

  const start = new Date(startISO);
  if (Number.isNaN(+start)) return null;
  
  // Normalize to UTC midnight to avoid timezone shifts
  start.setUTCHours(0, 0, 0, 0);

  let leadDays = LEAD_FLOOR;

  if (LEAD_MODE === 'distance') {
    const { fromZip, toZip } = await resolveZipsFromTx(tx, opts);
    console.log('[ship-by] zips', { fromZip, toZip });
    leadDays = await computeLeadDaysDynamic({ fromZip, toZip });
  } else {
    // static (existing behavior)
    console.log('[ship-by:static]', { chosenLeadDays: leadDays });
  }

  const shipBy = new Date(start);
  shipBy.setUTCDate(shipBy.getUTCDate() - leadDays);
  return shipBy;
}

function formatShipBy(date) {
  if (!date) return null;
  try {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

module.exports = { 
  computeShipByDate, 
  formatShipBy, 
  getBookingStartISO,
  resolveZipsFromTx,
  computeLeadDaysDynamic,
};
// server/lib/shipping.js
const { haversineMiles, geocodeZip } = require('./geo');

// Shipping client initialization - supports EasyPost and Shippo
let shippingClient, useEasyPost = process.env.EASYPOST_ENABLED === 'true';

if (useEasyPost) {
  const EasyPost = require('@easypost/api');
  shippingClient = new EasyPost(process.env.EASYPOST_MODE === 'test'
    ? process.env.EASYPOST_TEST_API_KEY
    : process.env.EASYPOST_API_KEY
  );
  console.log('[Shipping] Using EasyPost integration');
} else {
  // Safe Shippo bootstrap that works in both older and newer SDK shapes,
  // AND won't crash locally if there's no token.

  try {
    const rawShippo = require('shippo');

    // Handle both possible SDK styles:
    //  - function style: const shippo = require('shippo')('TOKEN')
    //  - constructor style: const Shippo = require('shippo'); new Shippo('TOKEN')
    const token = process.env.SHIPPO_API_TOKEN || process.env.SHIPPO_TOKEN || 'DUMMY_TOKEN_FOR_DEV';

    let clientCandidate;
    if (typeof rawShippo === 'function') {
      // Old style SDK
      clientCandidate = rawShippo(token);
    } else if (typeof rawShippo === 'object' && typeof rawShippo.default === 'function') {
      // Some builds export { default: [Function] }
      clientCandidate = rawShippo.default(token);
    } else {
      // Try "new" style
      clientCandidate = new rawShippo(token);
    }

    shippingClient = clientCandidate;
    console.log('[shipping] Shippo client initialized (dev-safe).');
  } catch (err) {
    console.warn('[shipping] Shippo module not available or failed to init. Using stub for dev.', err);

    // Minimal stub so the rest of server can boot locally.
    shippingClient = {
      // Add any methods your code calls at startup, or leave empty if nothing is called until label purchase time.
      shipment: {
        create: async () => {
          throw new Error('Shippo disabled in dev');
        },
      },
      transaction: {
        create: async () => {
          throw new Error('Shippo disabled in dev');
        },
      },
    };
  }

  // export whatever the rest of shipping.js expects
  const shippo = shippingClient;

  console.log('[Shipping] Using Shippo integration');
}

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

  return adjusted;
}

function formatShipBy(date) {
  if (!date) return null;
  try {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC', // keep display aligned with UTC calculations
    });
  } catch {
    return null;
  }
}

module.exports = { 
  shippingClient,
  useEasyPost,
  computeShipByDate, 
  formatShipBy, 
  getBookingStartISO,
  resolveZipsFromTx,
  computeLeadDaysDynamic,
};
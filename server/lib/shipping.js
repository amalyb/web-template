// server/lib/shipping.js
const { haversineMiles, geocodeZip } = require('./geo');

// Shipping client initialization (modern Shippo SDK)
let shippo = null;

try {
  const { Shippo } = require('shippo');
  if (process.env.SHIPPO_API_TOKEN) {
    shippo = new Shippo({ apiKeyHeader: process.env.SHIPPO_API_TOKEN });
    console.log('[shipping] Shippo client initialized (new SDK)');
  } else {
    console.log('[shipping] SHIPPO_API_TOKEN not set; estimator will fall back');
  }
} catch (e) {
  console.log('[shipping] Failed to require shippo; estimator will fall back:', e?.message);
  shippo = null;
}

// For backwards compatibility with other parts of the codebase
const shippingClient = shippo;

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

  // DEBUG_SHIPBY structured logging (guarded)
  if (process.env.DEBUG_SHIPBY === '1') {
    const { fromZip, toZip } = await resolveZipsFromTx(tx, opts);
    let distanceMiles = null;
    if (LEAD_MODE === 'distance' && fromZip && toZip) {
      try {
        const [fromLL, toLL] = await Promise.all([geocodeZip(fromZip), geocodeZip(toZip)]);
        if (fromLL && toLL) {
          distanceMiles = haversineMiles([fromLL.lat, fromLL.lng], [toLL.lat, toLL.lng]);
        }
      } catch (e) {
        // ignore
      }
    }
    console.info('[shipby] borrowStart=%s leadMode=%s fixedLeadDays=%s distanceMi=%s dynamicDays=%s chosenDays=%s shipBy=%s',
      startISO,
      LEAD_MODE,
      LEAD_MODE === 'static' ? leadDays : null,
      distanceMiles !== null ? Math.round(distanceMiles) : null,
      LEAD_MODE === 'distance' ? leadDays : null,
      leadDays,
      adjusted.toISOString()
    );
  }

  return adjusted;
}

/**
 * Compute ship-by date with metadata (wrapper for computeShipByDate)
 * Returns an object with shipByDate, leadDays, miles, and mode
 * 
 * @param {Object} tx - Transaction object with booking and address data
 * @param {Object} opts - Options { preferLabelAddresses: boolean }
 * @returns {Promise<Object>} { shipByDate, leadDays, miles, mode }
 */
async function computeShipBy(tx, opts = {}) {
  // Reuse existing date computation
  const shipByDate = await computeShipByDate(tx, opts);
  
  // If date couldn't be computed, return a consistent empty shape
  if (!shipByDate) {
    return { shipByDate: null, leadDays: null, miles: null, mode: LEAD_MODE || 'static' };
  }

  let leadDays = LEAD_FLOOR;
  let miles = null;
  const mode = LEAD_MODE || 'static'; // 'static' | 'distance'

  if (mode === 'distance') {
    // We already have helpers in this file:
    // - resolveZipsFromTx(tx, opts)
    // - computeLeadDaysDynamic({ fromZip, toZip })
    // Miles are optional and only used for logging; compute if cheap, otherwise leave null.
    try {
      const { fromZip, toZip } = await resolveZipsFromTx(tx, opts);
      leadDays = await computeLeadDaysDynamic({ fromZip, toZip });
      // Compute miles if geocoding succeeds (for diagnostics)
      const [fromLL, toLL] = await Promise.all([geocodeZip(fromZip), geocodeZip(toZip)]);
      if (fromLL && toLL) {
        miles = haversineMiles([fromLL.lat, fromLL.lng], [toLL.lat, toLL.lng]);
      }
    } catch (e) {
      // Don't fail the purchase flow if distance data is unavailable
      // Fallback: keep default leadDays (LEAD_FLOOR) and miles=null
      console.warn('[ship-by] distance mode fallback:', e?.message);
    }
  }

  return { shipByDate, leadDays, miles, mode };
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

const { defaultParcel, preferredServices, includeReturn, DEBUG_SHIPPING_VERBOSE } = require('../config/shipping');

// Verbose logging helper (only logs when DEBUG_SHIPPING_VERBOSE=1)
const vlog = (...args) => DEBUG_SHIPPING_VERBOSE && console.log(...args);

// In-memory cache for shipping estimates
const estimateCache = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Generate cache key for estimates
 */
function getCacheKey({ fromZip, toZip, parcel }) {
  const parcelSig = parcel 
    ? `${parcel.length}x${parcel.width}x${parcel.height}x${parcel.weightOz}`
    : 'default';
  const servicesSig = preferredServices.join(',');
  return `${fromZip}:${toZip}:${parcelSig}:${servicesSig}:${includeReturn}`;
}

/**
 * Get cached estimate if available and not expired
 */
function getCachedEstimate(key) {
  const cached = estimateCache.get(key);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    estimateCache.delete(key);
    return null;
  }
  
  return cached.value;
}

/**
 * Store estimate in cache
 */
function setCachedEstimate(key, value) {
  estimateCache.set(key, {
    value,
    timestamp: Date.now()
  });
  
  // Simple cache size limit (prevent memory leak)
  if (estimateCache.size > 1000) {
    const firstKey = estimateCache.keys().next().value;
    estimateCache.delete(firstKey);
  }
}

/**
 * Default parcel specification (used when no parcel is provided)
 */
const defaultParcelSpec = { length: 12, width: 9, height: 3, weightOz: 16 };

/**
 * Build parcel payload for Shippo (strings + units, no template)
 */
const toShippoParcel = (parcel) => {
  const p = parcel || {};
  const d = defaultParcelSpec;
  return {
    // All fields must be strings per Shippo zod schema
    length: String(p.length ?? d.length),
    width:  String(p.width  ?? d.width),
    height: String(p.height ?? d.height),
    distanceUnit: 'in',   // allowed: "cm"|"in"|"ft"|"m"|"mm"|"yd"
    weight: String(p.weightOz ?? d.weightOz),
    massUnit: 'oz',       // allowed: "g"|"kg"|"lb"|"oz"
    // DO NOT set `template` when sending explicit dimensions
  };
};

const zipcodes = require('zipcodes');

/**
 * Build address payload for Shippo (zip/country + validate:false)
 * Uses zipcodes package to automatically look up city/state for any U.S. ZIP
 */
const toShippoAddress = (zipRaw) => {
  const zip = String(zipRaw || '').trim();
  const lookup = zipcodes.lookup(zip) || {};
  const { city = 'City', state = 'CA' } = lookup;

  return {
    name: 'Sherbrt User',
    street1: 'N/A',
    city,
    state,
    zip,
    country: 'US',
    validate: false,
  };
};

/**
 * Create a promise that times out after specified ms
 */
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Shippo API timeout')), timeoutMs)
    )
  ]);
}

/**
 * Runtime detection of Shippo rates method (supports multiple SDK shapes)
 * Returns an async function that calls the appropriate method, or null if not found
 */
const detectRatesMethod = (shippo) => {
  if (!shippo) return null;
  
  // Modern SDK: shippo.shipments.create(...) returns shipment with rates
  if (shippo.shipments && typeof shippo.shipments.create === 'function') {
    return async (payload) => {
      const shipment = await shippo.shipments.create(payload);
      // Modern SDK returns shipment object with rates array
      return shipment;
    };
  }
  
  // Legacy: rates.estimate(...)
  if (shippo.rates && typeof shippo.rates.estimate === 'function') {
    return async (payload) => shippo.rates.estimate(payload);
  }
  
  // Legacy: shipments.rates(...)
  if (shippo.shipments && typeof shippo.shipments.rates === 'function') {
    return async (payload) => shippo.shipments.rates(payload);
  }
  
  // Older factory style: shippo.shipment?.rates(...)
  if (shippo.shipment && typeof shippo.shipment.rates === 'function') {
    return async (payload) => shippo.shipment.rates(payload);
  }
  
  return null;
};

/**
 * Estimate one-way shipping between two ZIPs with timeout and retry.
 * Returns { amountCents, currency, debug } or null on failure.
 */
async function estimateOneWay({ fromZip, toZip, parcel }, retryCount = 0) {
  if (!shippo || !process.env.SHIPPO_API_TOKEN) {
    vlog('[estimateOneWay] Shippo not configured', { 
      hasClient: !!shippo,
      hasToken: !!process.env.SHIPPO_API_TOKEN 
    });
    return null;
  }
  if (!fromZip || !toZip) {
    vlog('[estimateOneWay] Missing zips', { 
      hasFromZip: !!fromZip, 
      hasToZip: !!toZip 
    });
    return null;
  }

  // Build address and parcel payloads
  const addressFrom = toShippoAddress(fromZip);
  const addressTo = toShippoAddress(toZip);
  const parcelPayload = toShippoParcel(parcel);

  // Detect the appropriate rates method
  const callRates = detectRatesMethod(shippo);
  if (!callRates) {
    vlog('[estimateOneWay] No compatible rates method on Shippo client', {
      keys: Object.keys(shippo || {}),
    });
    return null;
  }

  // Check cache
  const cacheKey = getCacheKey({ fromZip, toZip, parcel });
  const cached = getCachedEstimate(cacheKey);
  if (cached) {
    vlog('[estimateOneWay] Cache hit', { amountCents: cached.amountCents });
    return cached;
  }

  try {
    vlog('[estimateOneWay] Creating shipment for rate estimate', { 
      hasFromZip: !!fromZip,
      hasToZip: !!toZip,
      hasParcel: !!parcelPayload,
      retryCount
    });
    
    const payload = { addressFrom, addressTo, parcels: [parcelPayload] };
    vlog('[estimateOneWay] Payload preview', {
      addressFrom: { city: addressFrom.city, state: addressFrom.state, zip: addressFrom.zip, country: addressFrom.country },
      addressTo:   { city: addressTo.city, state: addressTo.state, zip: addressTo.zip, country: addressTo.country },
      parcel: parcelPayload,
    });
    
    // Get rates using detected method
    const ratesResp = await withTimeout(callRates(payload), 5000);

    // Normalize shapes: modern SDK returns {rates: [...]}, legacy may return {results: [...]} or array
    const allRates = Array.isArray(ratesResp?.rates)
      ? ratesResp.rates
      : (Array.isArray(ratesResp?.results) 
        ? ratesResp.results 
        : (Array.isArray(ratesResp) ? ratesResp : []));
    
    vlog('[estimateOneWay] rates', { 
      count: allRates.length, 
      sample: allRates.slice(0, 3).map(r => ({ 
        carrier: r.carrier || r.provider, 
        service: r.service || r.provider_service, 
        amount: r.amount, 
        currency: r.currency 
      })) 
    });

    if (!allRates.length) return null;

    const { preferredServices = [] } = require('../config/shipping');
    const nameOf = r => ((r.carrier || r.provider || '') + ' ' + (r.service || r.provider_service || '')).trim();
    const filtered = preferredServices.length
      ? allRates.filter(r => preferredServices.includes(nameOf(r)))
      : allRates;
    
    vlog('[estimateOneWay] filter', { 
      filteredCount: filtered.length, 
      unfilteredCount: allRates.length, 
      preferred: preferredServices 
    });

    const chosen = (filtered.length ? filtered : allRates)
      .slice()
      .sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0];

    if (!chosen || chosen.amount == null) return null;

    const result = {
      amountCents: Math.round(parseFloat(chosen.amount) * 100),
      currency: chosen.currency || 'USD',
      debug: { chosen: nameOf(chosen) }
    };
    
    // Cache successful result
    setCachedEstimate(cacheKey, result);
    
    vlog('[estimateOneWay] Estimate successful', {
      amountCents: result.amountCents,
      service: result.debug.chosen
    });
    return result;
  } catch (err) {
    const msg = (err && (err.message || err.toString())) || 'unknown error';
    vlog('[estimateOneWay] Error caught', { message: msg });
    
    // Retry once on network errors
    const isNetworkError = err.message?.includes('timeout') || 
                          err.message?.includes('ECONNREFUSED') ||
                          err.message?.includes('ETIMEDOUT') ||
                          err.code === 'ENOTFOUND';
    
    if (isNetworkError && retryCount < 1) {
      vlog('[estimateOneWay] Network error, retrying', { 
        error: err.message,
        retryCount: retryCount + 1 
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      return estimateOneWay({ fromZip, toZip, parcel }, retryCount + 1);
    }
    
    return null;
  }
}

/**
 * Estimate round trip (outbound + return) if includeReturn=true.
 */
async function estimateRoundTrip({ lenderZip, borrowerZip, parcel }) {
  vlog('[estimateRoundTrip] Starting', { 
    hasLenderZip: !!lenderZip,
    hasBorrowerZip: !!borrowerZip,
    includeReturn 
  });
  
  const out = await estimateOneWay({ fromZip: lenderZip, toZip: borrowerZip, parcel });
  if (!out) {
    vlog('[estimateRoundTrip] Outbound estimate failed - returning null');
    return null;
  }

  if (!includeReturn) {
    vlog('[estimateRoundTrip] Return not included, using outbound only');
    return out;
  }

  const ret = await estimateOneWay({ fromZip: borrowerZip, toZip: lenderZip, parcel });
  if (!ret) {
    vlog('[estimateRoundTrip] Return estimate failed, using outbound only (best-effort)');
    return out; // best-effort
  }

  if (ret.currency !== out.currency) {
    vlog('[estimateRoundTrip] Currency mismatch, using outbound only');
    return out; // keep it simple
  }

  const result = {
    amountCents: out.amountCents + ret.amountCents,
    currency: out.currency,
    debug: { out: out.debug, ret: ret.debug },
  };
  
  vlog('[estimateRoundTrip] Round trip estimate successful', {
    totalAmountCents: result.amountCents,
    outboundCents: out.amountCents,
    returnCents: ret.amountCents
  });
  return result;
}

// -- Keep street2 if a validator/normalizer dropped it ------------------------
/**
 * Re-applies street2 from original address if normalized/validated version lost it
 * @param {Object} original - Original raw address with street2
 * @param {Object} normalized - Normalized/validated address that may have lost street2
 * @returns {Object} Normalized address with street2 preserved
 */
function keepStreet2(original, normalized) {
  if (!original || !normalized) return normalized || original;
  if (original.street2 && !normalized.street2) {
    normalized.street2 = original.street2;
  }
  return normalized;
}

// -- Sandbox carrier account helper (cached) ----------------------------------
let carrierAccountsCache = null;
let carrierAccountsCacheTime = 0;
const CARRIER_ACCOUNT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get sandbox carrier accounts (USPS preferred, optionally UPS)
 * Caches result for 5 minutes to avoid rate limits
 * @param {Object} shippoClient - Shippo SDK instance
 * @returns {Promise<string[]>} Array of carrier account object_ids
 */
async function getSandboxCarrierAccounts(shippoClient) {
  const now = Date.now();
  
  // Return cached result if still valid
  if (carrierAccountsCache && (now - carrierAccountsCacheTime) < CARRIER_ACCOUNT_CACHE_TTL_MS) {
    console.log('[SHIPPO][CARRIER] Using cached carrier accounts:', carrierAccountsCache);
    return carrierAccountsCache;
  }
  
  if (!shippoClient) {
    console.warn('[SHIPPO][CARRIER] No Shippo client available');
    return [];
  }
  
  try {
    console.log('[SHIPPO][CARRIER] Fetching carrier accounts...');
    
    // List carrier accounts
    const response = await shippoClient.carrieraccounts.list();
    const accounts = response?.results || [];
    
    console.log('[SHIPPO][CARRIER] Found accounts:', accounts.map(a => ({
      carrier: a.carrier,
      object_id: a.object_id,
      test: a.test
    })));
    
    // Filter to USPS (and optionally UPS) test accounts
    const uspsAccounts = accounts.filter(a => 
      a.carrier?.toUpperCase() === 'USPS' && a.test === true && a.active !== false
    );
    const upsAccounts = accounts.filter(a => 
      a.carrier?.toUpperCase() === 'UPS' && a.test === true && a.active !== false
    );
    
    // Prefer USPS-only in sandbox for reliability
    const selectedAccounts = uspsAccounts.length > 0 
      ? uspsAccounts.map(a => a.object_id)
      : [...uspsAccounts, ...upsAccounts].map(a => a.object_id);
    
    console.log('[SHIPPO][CARRIER] Selected carrier accounts:', selectedAccounts);
    
    // Cache the result
    carrierAccountsCache = selectedAccounts;
    carrierAccountsCacheTime = now;
    
    return selectedAccounts;
  } catch (err) {
    console.error('[SHIPPO][CARRIER] Failed to fetch carrier accounts:', err.message);
    return [];
  }
}

// -- Debug logger that prints the *exact* payload we send to Shippo -----------
/**
 * Logs Shippo payload with address details when DEBUG_SHIPPO=1
 * @param {string} tag - Label for the log entry (e.g., "outbound:shipment")
 * @param {Object} payload - Shippo API payload { address_from, address_to, parcels, extra }
 */
function logShippoPayload(tag, { address_from, address_to, parcels, extra }) {
  if (process.env.DEBUG_SHIPPO !== '1') return;
  const pick = a => a && ({
    name: a.name, 
    street1: a.street1, 
    street2: a.street2,
    city: a.city, 
    state: a.state, 
    zip: a.zip, 
    country: a.country,
  });
  console.info(`[shippo][pre] ${tag}`, {
    address_from: pick(address_from),
    address_to: pick(address_to),
    parcels,
    ...(extra ? { extra } : {})
  });
}

/**
 * Format phone to E.164 (required by Shippo)
 * @param {string} phone - Raw phone number
 * @returns {string} E.164 formatted phone or empty string
 */
function formatPhoneE164(phone) {
  if (!phone) return '';
  
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // If it doesn't start with +, assume US number and add +1
  if (!cleaned.startsWith('+')) {
    // Remove leading 1 if present
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      cleaned = cleaned.substring(1);
    }
    cleaned = '+1' + cleaned;
  }
  
  // Validate E.164 format (1-15 digits after +)
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  if (!e164Regex.test(cleaned)) {
    console.warn('[PHONE] Invalid E.164 format:', phone, '→', cleaned);
    return phone; // Return original if normalization fails
  }
  
  return cleaned;
}

module.exports = { 
  shippingClient,
  shippo,
  computeShipBy,
  computeShipByDate, 
  formatShipBy, 
  getBookingStartISO,
  resolveZipsFromTx,
  computeLeadDaysDynamic,
  estimateOneWay,
  estimateRoundTrip,
  keepStreet2,
  logShippoPayload,
  getSandboxCarrierAccounts,
  formatPhoneE164,
};

// Optional sanity check for debugging
if (process.env.SHIPPO_DEBUG === 'true') {
  console.log('[diag] typeof computeShipBy =', typeof computeShipBy);
}
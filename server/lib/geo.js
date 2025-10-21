// server/lib/geo.js
// Lightweight geo helpers for distance-based ship-by logic
// NOTE: ZIP geocoding can be swapped later (Shippo/Carrier ETAs).
// For now: Mapbox (if token present). Cache aggressively.

// Use global fetch (Node 18+)
const fetch = global.fetch;

const _zipCache = new Map(); // Map<string, {lat:number, lng:number}>
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || null;

// Log token status once at module load (avoid log spam)
if (!MAPBOX_TOKEN && process.env.SHIP_LEAD_MODE === 'distance') {
  console.warn('[geo] MAPBOX_TOKEN not set; distance mode will fall back to static');
}

/**
 * Calculate distance between two points using Haversine formula
 * @param {[number, number]} coord1 - [lat, lng] of first point
 * @param {[number, number]} coord2 - [lat, lng] of second point
 * @returns {number} Distance in miles
 */
function haversineMiles([lat1, lon1], [lat2, lon2]) {
  const toRad = d => (d * Math.PI) / 180;
  const R = 3958.8; // miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Geocode a ZIP code to lat/lng coordinates using Mapbox
 * Results are cached in memory for performance
 * @param {string} zip - ZIP code to geocode
 * @returns {Promise<{lat: number, lng: number}|null>} Coordinates or null if not found
 */
async function geocodeZip(zip) {
  if (!zip) return null;
  const key = String(zip).trim();
  if (_zipCache.has(key)) {
    return _zipCache.get(key);
  }

  if (!MAPBOX_TOKEN) {
    // No geocoding possible; return null to trigger fallback
    // (startup warning already logged, don't spam per ZIP)
    return null;
  }

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      key
    )}.json?types=postcode&limit=1&access_token=${MAPBOX_TOKEN}`;
    
    // Node fetch doesn't support timeout directly, use AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!resp.ok) {
      console.warn(`[geo] Mapbox geocoding failed for ${key}: ${resp.status}`);
      return null;
    }
    
    const data = await resp.json();
    const feature = data.features && data.features[0];
    if (!feature || !Array.isArray(feature.center)) {
      console.warn(`[geo] No geocoding result for ZIP ${key}`);
      return null;
    }
    
    const [lng, lat] = feature.center;
    const val = { lat, lng };
    _zipCache.set(key, val);
    console.log(`[geo] Cached ${key} → ${lat.toFixed(2)},${lng.toFixed(2)}`);
    return val;
  } catch (err) {
    console.warn(`[geo] Geocoding error for ${key}:`, err.message);
    return null;
  }
}

module.exports = { haversineMiles, geocodeZip };


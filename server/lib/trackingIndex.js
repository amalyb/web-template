/**
 * Deterministic Shippo tracking → transaction index (Redis).
 * Key: shippo:tracking:<trackingNumber>
 * Value: { txId, direction: "outbound" | "return" }
 * Used by the webhook to resolve transaction from tracking number when Shippo metadata is missing.
 */

const { getRedis } = require('../redis');

/** TTL for tracking index entries: 120 days (≈ 10368000 seconds) */
const TRACKING_INDEX_TTL_SECONDS = 120 * 24 * 60 * 60; // 10368000

const KEY_PREFIX = 'shippo:tracking:';

/**
 * @param {string} trackingNumber
 * @param {{ txId: string, direction: 'outbound' | 'return' }} value
 * @param {{ ttlSeconds?: number }} [opts]
 */
async function setTrackingIndex(trackingNumber, value, opts = {}) {
  if (!trackingNumber || !value?.txId || !value?.direction) {
    return;
  }
  const ttlSeconds = opts.ttlSeconds ?? TRACKING_INDEX_TTL_SECONDS;
  const redis = getRedis();
  const key = KEY_PREFIX + String(trackingNumber).trim();
  const payload = { txId: value.txId, direction: value.direction };
  try {
    await redis.set(key, JSON.stringify(payload), 'EX', ttlSeconds);
    console.log('[SHIPPO][TRACKING-INDEX][SET]', {
      trackingNumber: trackingNumber,
      txId: value.txId,
      direction: value.direction,
    });
  } catch (e) {
    console.warn('[SHIPPO][TRACKING-INDEX][SET-ERROR]', {
      trackingNumber: trackingNumber,
      error: e?.message,
    });
  }
}

/**
 * @param {string} trackingNumber
 * @returns {Promise<{ txId: string, direction: 'outbound' | 'return' } | null>}
 */
async function getTrackingIndex(trackingNumber) {
  if (!trackingNumber) return null;
  const redis = getRedis();
  const key = KEY_PREFIX + String(trackingNumber).trim();
  try {
    const raw = await redis.get(key);
    if (!raw) {
      console.log('[SHIPPO-WEBHOOK][TRACKING-INDEX][MISS]', { trackingNumber });
      return null;
    }
    const parsed = JSON.parse(raw);
    const txId = parsed?.txId || null;
    const direction = parsed?.direction || null;
    console.log('[SHIPPO-WEBHOOK][TRACKING-INDEX][HIT]', {
      trackingNumber,
      txId: txId || undefined,
      direction: direction || undefined,
    });
    return txId && direction ? { txId, direction } : null;
  } catch (e) {
    console.warn('[SHIPPO-WEBHOOK][TRACKING-INDEX][GET-ERROR]', {
      trackingNumber,
      error: e?.message,
    });
    console.log('[SHIPPO-WEBHOOK][TRACKING-INDEX][MISS]', { trackingNumber });
    return null;
  }
}

module.exports = {
  setTrackingIndex,
  getTrackingIndex,
  TRACKING_INDEX_TTL_SECONDS,
  KEY_PREFIX,
};

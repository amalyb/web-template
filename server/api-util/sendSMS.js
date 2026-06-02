const twilio = require('twilio');
const { maskPhone } = require('./phone');
const { attempt, sent, failed } = require('./metrics');
console.log('📦 Twilio module loaded');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// In-memory duplicate prevention (resets on restart)
const recentSends = new Map(); // key: `${transactionId}:${transition}:${role}`, value: timestamp
const DUPLICATE_WINDOW_MS = 60000; // 60 seconds

// Redis-backed dedupe: catches duplicates that the in-memory Map cannot
// (cross-dyno, post-restart, retries spaced >60 s apart). 7-day TTL is
// well past any reasonable Twilio retry window. We lazy-load Redis so
// scripts that don't need it (e.g. unit tests) aren't forced to.
let _redis = null;
let _redisLoaded = false;
function getRedisLazy() {
  if (_redisLoaded) return _redis;
  _redisLoaded = true;
  try {
    _redis = require('../redis').getRedis();
  } catch (e) {
    console.warn('[sms] Redis dedupe unavailable, falling back to in-memory only:', e?.message);
    _redis = null;
  }
  return _redis;
}
const REDIS_DEDUPE_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
// Key includes `tag` to avoid collisions between distinct messages that
// share (txId, transition, role) — notably accept-flow borrower SMS where
// `accept_to_borrower` and `label_created_to_borrower` are both
// transition=transition/accept, role=customer but are different messages.
// Without `tag` in the key the second one would be suppressed for 7 days.
// `tag` may be undefined for ad-hoc sends; we coerce to '' to keep the
// key deterministic in that case.
const redisDedupeKey = (txId, transition, role, tag) =>
  `sms:dedupe:${txId}:${transition}:${role}:${tag || ''}`;

// Helper function to normalize phone number to E.164 format
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;

  // US default if 10 digits
  if (digits.length === 10) return `+1${digits}`;

  // If it already includes country code
  return `+${digits}`;
}

// E.164 validation
function isE164(num) { 
  return /^\+\d{10,15}$/.test(String(num || '')); 
}

// Duplicate prevention helper
function isDuplicateSend(transactionId, transition, role) {
  if (!transactionId || !transition || !role) {
    return false; // Can't prevent duplicates without all identifiers
  }
  
  const key = `${transactionId}:${transition}:${role}`;
  const now = Date.now();
  const lastSent = recentSends.get(key);
  
  if (lastSent && (now - lastSent) < DUPLICATE_WINDOW_MS) {
    return true; // Duplicate detected within window
  }
  
  // Update the timestamp and clean old entries
  recentSends.set(key, now);
  
  // Clean up old entries (older than 5 minutes) to prevent memory leaks
  if (recentSends.size > 1000) { // Only clean when we have many entries
    const cutoff = now - (5 * 60 * 1000); // 5 minutes
    for (const [k, timestamp] of recentSends.entries()) {
      if (timestamp < cutoff) {
        recentSends.delete(k);
      }
    }
  }
  
  return false;
}

// Optional in-memory STOP list (resets on restart)
const stopList = new Set();

// DRY_RUN and ONLY_PHONE guards
const DRY_RUN = process.env.SMS_DRY_RUN === '1';
const ONLY_PHONE = process.env.ONLY_PHONE || null;

/**
 * sendSMS(phone, message, opts?)
 * opts: { 
 *   role?: 'lender' | 'borrower' | 'customer',
 *   transactionId?: string,
 *   transition?: string,
 *   tag?: string,
 *   meta?: object
 * }
 */
async function sendSMS(to, message, opts = {}) {
  const { role, transactionId, transition, tag, meta } = opts;
  
  if (!role && process.env.METRICS_LOG === '1') {
    console.warn('[metrics] skipped: no role provided to sendSMS');
  }

  if (!to || !message) {
    console.warn('📭 Missing phone number or message');
    return Promise.resolve({ skipped: true, reason: 'missing_phone_or_message' });
  }

  // Normalize the phone number to E.164 first
  const toE164 = normalizePhoneNumber(to);
  
  // ONLY_PHONE filter - compare normalized numbers
  if (ONLY_PHONE) {
    const onlyE164 = normalizePhoneNumber(ONLY_PHONE);
    if (onlyE164 && toE164 !== onlyE164) {
      console.log('[sms] ONLY_PHONE set, skipping', { to: maskPhone(toE164), ONLY_PHONE: maskPhone(onlyE164), template: tag });
      console.log(`[SHIPPO_SMS_DEBUG] SMS skipped due to ONLY_PHONE filter: to=${maskPhone(toE164 || to)}, ONLY_PHONE=${maskPhone(onlyE164)}, tag=${tag || 'none'}, reason=only_phone_filter`);
      return Promise.resolve({ skipped: true, reason: 'only_phone_filter' });
    }
  }

  // DRY_RUN guard - log what would be sent
  if (DRY_RUN) {
    console.log('[sms][DRY_RUN] would send:', { to, template: tag, body: message });
    console.log(`[SHIPPO_SMS_DEBUG] SMS skipped due to DRY_RUN: to=${maskPhone(toE164 || to)}, tag=${tag || 'none'}, reason=dry_run`);
    return Promise.resolve({ skipped: true, reason: 'dry_run' });
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn('⚠️ Twilio env vars missing — skipping SMS');
    console.log(`[SHIPPO_SMS_DEBUG] SMS skipped due to missing credentials: to=${maskPhone(toE164 || to)}, tag=${tag || 'none'}, reason=missing_twilio_credentials`);
    return Promise.resolve({ skipped: true, reason: 'missing_twilio_credentials' });
  }

  // Duplicate prevention check — two layers:
  //   1. In-memory Map (60-second window, per-process; catches Twilio retries
  //      and accidental double-dispatch within a single request handler).
  //   2. Redis (7-day TTL, cross-process; catches duplicates the in-memory
  //      layer cannot — cross-dyno, post-restart, retries spaced >60s).
  //      Falls back to in-memory only if Redis is unavailable.
  if (transactionId && transition && role) {
    if (isDuplicateSend(transactionId, transition, role)) {
      console.warn(`🔄 [DUPLICATE] SMS suppressed for ${transactionId}:${transition}:${role} within ${DUPLICATE_WINDOW_MS}ms window (in-memory)`);
      return { suppressed: true, reason: 'duplicate_within_window' };
    }
    const redis = getRedisLazy();
    if (redis) {
      try {
        const key = redisDedupeKey(transactionId, transition, role, tag);
        // SET NX so the first writer wins; subsequent identical sends see
        // the key already present and bail.
        const acquired = await redis.set(key, Date.now().toString(), 'EX', REDIS_DEDUPE_TTL_SEC, 'NX');
        if (acquired !== 'OK') {
          console.warn(`🔄 [DUPLICATE] SMS suppressed for ${transactionId}:${transition}:${role}:${tag || ''} via Redis dedupe (already sent within ${REDIS_DEDUPE_TTL_SEC}s)`);
          return { suppressed: true, reason: 'duplicate_redis_dedupe' };
        }
      } catch (e) {
        console.warn('[sms] Redis dedupe check failed, proceeding with in-memory only:', e?.message);
      }
    }
  }

  // toE164 already computed above for ONLY_PHONE check
  if (!toE164) {
    console.warn(`📱 Invalid phone number format: ${to}`);
    console.log(`[SHIPPO_SMS_DEBUG] SMS skipped due to invalid phone format: to=${to}, tag=${tag || 'none'}, reason=invalid_phone_format`);
    if (role) failed(role, 'invalid_format');
    return Promise.resolve({ skipped: true, reason: 'invalid_phone_format' });
  }

  // E.164 validation
  if (!isE164(toE164)) {
    console.warn('[SMS] invalid phone, aborting:', to ? maskPhone(to) : 'null');
    console.log(`[SHIPPO_SMS_DEBUG] SMS skipped due to invalid E.164 format: to=${maskPhone(toE164)}, tag=${tag || 'none'}, reason=invalid_e164_format`);
    if (role) failed(role, 'invalid_e164');
    return Promise.resolve({ skipped: true, reason: 'invalid_e164_format' });
  }

  // Check STOP list
  if (stopList.has(toE164)) {
    console.warn('[SMS] suppressed: number opted out (STOP):', maskPhone(toE164));
    return { suppressed: true, reason: 'stop_list' };
  }

  // 🔍 CRITICAL INVESTIGATION: Get call stack to identify which function called sendSMS
  const stack = new Error().stack;
  const caller = stack.split('\n')[2]?.trim() || 'Unknown caller';
  
  // Gate full-number logs for local debugging only
  const devFullLogs = process.env.SMS_DEBUG_FULL === '1' && process.env.NODE_ENV !== 'production';
  
  // Metrics: attempt only if role provided
  if (role) attempt(role);
  
  // Enhanced logging with tag and meta information
  const metaJson = meta ? JSON.stringify(meta) : '{}';
  const bodyJson = JSON.stringify(message);
  console.log(`[SMS:OUT] tag=${tag || 'none'} to=${maskPhone(toE164)} meta=${metaJson} body=${bodyJson}`);
  
  if (devFullLogs) {
    console.debug('[DEV ONLY] Raw number:', to);
    console.debug('[DEV ONLY] E.164 number:', toE164);
    console.debug('[DEV ONLY] Caller function:', caller);
  }

  // Build statusCallback URL with tag and transactionId parameters
  let statusCallbackUrl = undefined;
  if (process.env.PUBLIC_BASE_URL) {
    const params = new URLSearchParams();
    if (tag) params.append('tag', tag);
    if (transactionId) params.append('txId', transactionId);
    if (meta?.listingId) params.append('listingId', meta.listingId);
    
    statusCallbackUrl = `${process.env.PUBLIC_BASE_URL}/api/twilio/sms-status`;
    if (params.toString()) {
      statusCallbackUrl += `?${params.toString()}`;
    }
  }

  const payload = {
    to: toE164, // real E.164 - unmasked
    body: message,
    statusCallback: statusCallbackUrl,
  };

  // Always use Messaging Service for better deliverability
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    payload.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    console.error('❌ TWILIO_MESSAGING_SERVICE_SID not set - SMS may fail');
    console.error('❌ Please set TWILIO_MESSAGING_SERVICE_SID in your environment');
    // Still try with fallback, but warn that it may not work
    payload.from = process.env.TWILIO_PHONE_NUMBER;
  }

  return client.messages
    .create(payload)
    .then(msg => {
      // Success - SMS was actually sent
      if (role) sent(role);
      console.log(`[SMS:OUT] tag=${tag || 'none'} to=${maskPhone(toE164)} meta=${metaJson} body=${bodyJson} sid=${msg.sid}`);
      return { sent: true, message: msg, sid: msg.sid };
    })
    .catch(err => {
      // Optional: map Twilio error codes as before (21610 etc.)
      const code = err?.code || err?.status || 'unknown';
      if (role) failed(role, code);
      console.warn('[SMS] failed', { 
        code, 
        rawPhone: maskPhone(to), 
        e164Phone: maskPhone(toE164),
        error: err.message 
      });

      // 21610: STOP. Avoid future sends in this process.
      if (String(code) === '21610') stopList.add(toE164);
      throw err;
    });
}

// Backward-compatible export
module.exports = sendSMS;        // default export (existing callers)
module.exports.sendSMS = sendSMS; // named export (new callers can use { sendSMS }) 
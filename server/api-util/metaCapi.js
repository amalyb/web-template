// server/api-util/metaCapi.js
// Meta Conversions API (CAPI) sender for Sherbrt.
//
// Sends server-side conversion events to Meta to complement the browser Pixel.
// Design rules:
//   - NEVER throws to callers: all failures are caught, logged and swallowed so
//     signup / listing publication are never blocked by Meta latency or downtime.
//   - PII is SHA-256 hashed (email, phone, name, city, state, zip, country,
//     external_id). fbp / fbc / IP / user-agent are sent in the clear per Meta spec.
//   - Never logs raw access tokens or raw PII (only counts + trace ids).
//
// Config via env (test and prod kept separate by using different .env files):
//   META_CAPI_ACCESS_TOKEN  (required)  - System User token for the dataset
//   META_DATASET_ID         (default 838865308919724)
//   META_GRAPH_API_VERSION  (default v23.0) - bump to current supported version
//   META_TEST_EVENT_CODE    (optional)  - when set, events route to Test Events
//   META_CAPI_ENABLED       (default true) - master kill switch ("false" disables)
//   META_CAPI_TIMEOUT_MS    (default 4000)
//   META_CAPI_MAX_RETRIES   (default 2)

const crypto = require('crypto');

const DATASET_ID = process.env.META_DATASET_ID || '838865308919724';
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || '';
const API_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || '';
const ENABLED_FLAG = (process.env.META_CAPI_ENABLED || 'true').toLowerCase() !== 'false';
const TIMEOUT_MS = parseInt(process.env.META_CAPI_TIMEOUT_MS || '4000', 10);
const MAX_RETRIES = parseInt(process.env.META_CAPI_MAX_RETRIES || '2', 10);

const isEnabled = () => ENABLED_FLAG && !!ACCESS_TOKEN && !!DATASET_ID;

// ---- normalization + hashing ------------------------------------------------
const normalizeBasic = v => (v == null ? '' : String(v).trim().toLowerCase());
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');

// Hash a value after normalization. Returns undefined for empty input so the
// key is omitted from user_data entirely.
const hashField = (value, normalizer = normalizeBasic) => {
  const normalized = normalizer(value);
  if (!normalized) return undefined;
  return sha256(normalized);
};

const normalizePhone = v => (v == null ? '' : String(v).replace(/[^0-9]/g, ''));
const normalizeZip = v => (v == null ? '' : String(v).trim().toLowerCase().split('-')[0]);
const normalizeAlpha = v => (v == null ? '' : String(v).trim().toLowerCase().replace(/[^a-z]/g, ''));
const normalizeCountry = v => {
  const c = normalizeBasic(v);
  if (!c) return '';
  if (c === 'usa' || c === 'united states' || c === 'us') return 'us';
  return c.replace(/[^a-z]/g, '').slice(0, 2);
};

/**
 * Build a Meta user_data object from raw (unhashed) inputs.
 */
const buildUserData = (raw = {}) => {
  const ud = {};
  const em = hashField(raw.email);
  const ph = hashField(raw.phone, normalizePhone);
  const fn = hashField(raw.firstName);
  const ln = hashField(raw.lastName);
  const ct = hashField(raw.city, normalizeAlpha);
  const st = hashField(raw.state, normalizeAlpha);
  const zp = hashField(raw.zip, normalizeZip);
  const country = hashField(raw.country, normalizeCountry);
  const externalId = raw.externalId ? sha256(normalizeBasic(raw.externalId)) : undefined;

  if (em) ud.em = [em];
  if (ph) ud.ph = [ph];
  if (fn) ud.fn = [fn];
  if (ln) ud.ln = [ln];
  if (ct) ud.ct = [ct];
  if (st) ud.st = [st];
  if (zp) ud.zp = [zp];
  if (country) ud.country = [country];
  if (externalId) ud.external_id = [externalId];

  // Non-hashed fields (Meta expects these in the clear).
  if (raw.fbp) ud.fbp = raw.fbp;
  if (raw.fbc) ud.fbc = raw.fbc;
  if (raw.clientIpAddress) ud.client_ip_address = raw.clientIpAddress;
  if (raw.clientUserAgent) ud.client_user_agent = raw.clientUserAgent;

  return ud;
};

const matchKeyCount = ud => Object.keys(ud || {}).length;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Extract fbp/fbc/ip/user-agent from an Express request.
const firstForwardedIp = req => {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || undefined;
};
const readRequestContext = req => ({
  fbp: (req.cookies && req.cookies._fbp) || (req.body && req.body.fbp) || undefined,
  fbc: (req.cookies && req.cookies._fbc) || (req.body && req.body.fbc) || undefined,
  clientIpAddress: firstForwardedIp(req),
  clientUserAgent: req.get ? req.get('user-agent') : (req.headers && req.headers['user-agent']),
});

async function postToMeta(payload, attempt = 1) {
  const url =
    'https://graph.facebook.com/' +
    API_VERSION +
    '/' +
    DATASET_ID +
    '/events?access_token=' +
    encodeURIComponent(ACCESS_TOKEN);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = { raw: text };
    }
    if (!res.ok) {
      const retriable = res.status >= 500 || res.status === 429;
      if (retriable && attempt <= MAX_RETRIES) {
        await sleep(250 * attempt);
        return postToMeta(payload, attempt + 1);
      }
      return { ok: false, status: res.status, body: json };
    }
    return { ok: true, status: res.status, body: json };
  } catch (err) {
    const isAbort = err && err.name === 'AbortError';
    if (attempt <= MAX_RETRIES) {
      await sleep(250 * attempt);
      return postToMeta(payload, attempt + 1);
    }
    return { ok: false, status: 0, error: isAbort ? 'timeout' : (err && err.message) || 'network-error' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a single conversion event to Meta CAPI. Never throws.
 * Returns { skipped } | { ok, status, body }.
 */
async function sendCapiEvent({
  eventName,
  eventId,
  eventTime,
  eventSourceUrl,
  actionSource = 'website',
  userData = {},
  customData,
}) {
  if (!isEnabled()) {
    console.warn('[MetaCAPI] skipped: not configured (missing token or disabled)');
    return { skipped: true, reason: 'not-configured' };
  }
  if (!eventName || !eventId) {
    console.warn('[MetaCAPI] skipped: missing eventName or eventId');
    return { skipped: true, reason: 'missing-fields' };
  }

  const event = {
    event_name: eventName,
    event_time: eventTime || Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: actionSource,
    user_data: userData,
  };
  if (eventSourceUrl) event.event_source_url = eventSourceUrl;
  if (customData) event.custom_data = customData;

  const payload = { data: [event] };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  const started = Date.now();
  const result = await postToMeta(payload);
  const durationMs = Date.now() - started;

  const logBase = {
    event_name: eventName,
    event_id: eventId,
    event_time: event.event_time,
    match_keys: matchKeyCount(userData),
    test_event: !!TEST_EVENT_CODE,
    duration_ms: durationMs,
  };
  if (result.ok) {
    console.log(
      '[MetaCAPI] sent ' +
        JSON.stringify({
          ...logBase,
          status: result.status,
          events_received: result.body && result.body.events_received,
          fbtrace_id: result.body && result.body.fbtrace_id,
        })
    );
  } else {
    console.error(
      '[MetaCAPI] failed ' +
        JSON.stringify({
          ...logBase,
          status: result.status,
          error: result.error,
          meta_error: result.body && result.body.error && result.body.error.message,
          fbtrace_id: result.body && result.body.fbtrace_id,
        })
    );
  }
  return result;
}

module.exports = {
  isEnabled,
  sha256,
  hashField,
  buildUserData,
  readRequestContext,
  sendCapiEvent,
  config: { DATASET_ID, API_VERSION, hasToken: !!ACCESS_TOKEN, testMode: !!TEST_EVENT_CODE },
};

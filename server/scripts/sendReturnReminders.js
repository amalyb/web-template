#!/usr/bin/env node
/**
 * Return Reminder SMS Script
 * 
 * Sends SMS reminders to borrowers for return shipments:
 * - T-1 day: QR/label reminder (ship back tomorrow)
 * - Today: Ship back today reminder
 * - Tomorrow: Due tomorrow reminder
 * 
 * OPTION A: Uses Integration SDK via getFlexSdk() helper
 * - Prefers Integration SDK when INTEGRATION_CLIENT_ID + INTEGRATION_CLIENT_SECRET are set
 * - Falls back to Marketplace SDK if Integration credentials not available
 * - Same pattern as other cron scripts (shipping/overdue reminders)
 * - No exchangeToken() call needed - Integration SDK handles auth automatically
 * 
 * Environment Variables (Option A):
 * Required (Integration SDK - preferred):
 * - INTEGRATION_CLIENT_ID
 * - INTEGRATION_CLIENT_SECRET
 * 
 * Optional (Marketplace SDK fallback):
 * - REACT_APP_SHARETRIBE_SDK_CLIENT_ID
 * - SHARETRIBE_SDK_CLIENT_SECRET
 * 
 * Both SDKs use:
 * - SHARETRIBE_SDK_BASE_URL or REACT_APP_SHARETRIBE_SDK_BASE_URL
 *   (defaults to https://flex-api.sharetribe.com)
 * 
 * CRON SCHEDULING (Render/Heroku):
 * Run every 15 minutes: 0,15,30,45 * * * * node server/scripts/sendReturnReminders.js
 * 
 * Example dry-run (no real SMS):
 * SMS_DRY_RUN=1 ONLY_PHONE=+15551234567 node server/scripts/sendReturnReminders.js --verbose
 * 
 * Example forcing a date window for testing:
 * SMS_DRY_RUN=1 FORCE_TODAY=2025-11-21 FORCE_TOMORROW=2025-11-22 node server/scripts/sendReturnReminders.js --verbose
 */
require('dotenv').config();

let sendSMS = null;
try {
  const smsModule = require('../api-util/sendSMS');
  sendSMS = smsModule.sendSMS;
} catch (error) {
  console.warn('⚠️ SMS module not available — SMS functionality disabled');
  sendSMS = () => Promise.resolve();
}

// ✅ Use centralized SDK helper (same as shipping/overdue scripts)
// This automatically prefers Integration SDK when INTEGRATION_CLIENT_ID/SECRET are set
const getFlexSdk = require('../util/getFlexSdk');
const { shortLink } = require('../api-util/shortlink');
const { isNonChargeableDate, USPS_HOLIDAYS } = require('../lib/businessDays');
const { getRedis } = require('../redis');
const { withinSendWindow, getNow } = require('../util/time');
const { upsertProtectedData } = require('../lib/txData');
const { resolveReturnLabelUrl } = require('../lib/shippo');

// In-memory guards to avoid repeat sends within the same daemon process
// if Flex protectedData updates fail. Keys are txId → local date string.
const sentTodayByTx = new Map(); // due-today per-day guard
const lateSentTodayByTx = new Map(); // late per-day guard
let dueTodayUpdateFailures = 0;
let lateUpdateFailures = 0;
const redis = getRedis();
const redisLockFallbackStore = new Map();

// Pacific Time date handling (mirrors server/lib/businessDays.js pattern)
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const TZ = 'America/Los_Angeles';
const SEND_HOUR_PT = 8;
const SEND_MINUTE_PT = 0;
const DEFAULT_ACCEPT_HOUR_PT = 9;

// Roll a return-due date forward to the next day carriers actually run (skips
// Sundays + USPS holidays via isNonChargeableDate). Mirrors the checkout
// "Sunday end date" banner so a borrower whose booking ends on a closed day is
// told the real ship day (e.g. "Monday") instead of "tomorrow" / "today".
// returnLocalDate is a PT YYYY-MM-DD string; parsed with dayjs.tz so it isn't
// shifted by the host timezone.
function nextShippingDay(returnLocalDate) {
  let d = dayjs.tz(returnLocalDate, TZ).startOf('day');
  for (let i = 0; i < 14 && isNonChargeableDate(d); i++) {
    d = d.add(1, 'day');
  }
  return d;
}

// Borrower return-reminder copy with Sunday / USPS-holiday-aware variants.
// kind: 'T-1' | 'TODAY' | 'TODAY_NO_LABEL'. When the return date lands on a
// non-shipping day, the copy names the next shipping day and mirrors the
// checkout banner's "carriers don't run" framing. Exported for unit testing.
function buildReturnReminderCopy({ kind, itemTitle, shortUrl, returnLocalDate }) {
  const closed = returnLocalDate ? isNonChargeableDate(dayjs.tz(returnLocalDate, TZ)) : false;

  if (!closed) {
    if (kind === 'T-1') {
      return `📦 Sherbrt 🍧: It's almost return time! Use your QR/label to ship "${itemTitle}" back tomorrow: ${shortUrl}.`;
    }
    if (kind === 'TODAY') {
      return `⏰ Sherbrt 🍧: Today's the day for you to ship back "${itemTitle}"! Late returns may incur $15/day fees. Use your QR/label to ship back: ${shortUrl}.`;
    }
    return `⏰ Sherbrt 🍧: Today's the day for you to ship back "${itemTitle}"! Late returns may incur $15/day fees. Check your dashboard for return instructions.`;
  }

  const returnDj = dayjs.tz(returnLocalDate, TZ).startOf('day');
  const closedReason = USPS_HOLIDAYS && USPS_HOLIDAYS.has(returnDj.format('YYYY-MM-DD'))
    ? 'the holiday'
    : returnDj.format('dddd'); // e.g. "Sunday"
  const shipDayName = nextShippingDay(returnLocalDate).format('dddd'); // e.g. "Monday"

  if (kind === 'T-1') {
    return `📦 Sherbrt 🍧: It's almost return time! Carriers don't run ${closedReason}, so use your QR/label to ship "${itemTitle}" back ${shipDayName}: ${shortUrl}.`;
  }
  if (kind === 'TODAY') {
    return `⏰ Sherbrt 🍧: Your booking for "${itemTitle}" ends today, but carriers don't run ${closedReason}. Ship ${shipDayName} to avoid a late fee — use your QR/label: ${shortUrl}.`;
  }
  return `⏰ Sherbrt 🍧: Your booking for "${itemTitle}" ends today, but carriers don't run ${closedReason}. Ship ${shipDayName} to avoid a late fee. Check your dashboard for return instructions.`;
}
const DEFAULT_ACCEPT_MINUTE_PT = 0;

// ---- CLI flags / env guards ----
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const getOpt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const DRY = has('--dry-run') || process.env.SMS_DRY_RUN === '1';
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const DEBUG_SMS = process.env.DEBUG_SMS === '1';
const DEFAULT_LIMIT = process.env.NODE_ENV === 'production' ? 25 : 0;
const parsedLimit = parseInt(getOpt('--limit', process.env.LIMIT ?? DEFAULT_LIMIT), 10);
const LIMIT = Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_LIMIT;
const DEFAULT_MAX_LATE_AGE_DAYS = process.env.NODE_ENV === 'production' ? 14 : 0;
const parsedMaxLateAge = parseInt(process.env.MAX_LATE_AGE_DAYS ?? DEFAULT_MAX_LATE_AGE_DAYS, 10);
const MAX_LATE_AGE_DAYS = Number.isFinite(parsedMaxLateAge) ? parsedMaxLateAge : DEFAULT_MAX_LATE_AGE_DAYS;
const ONLY_PHONE = process.env.ONLY_PHONE; // e.g. +15551234567 for targeted test

if (DRY) {
  const realSend = sendSMS;
  sendSMS = async (to, body, opts = {}) => {
    const { tag, meta } = opts;
    const metaJson = meta ? JSON.stringify(meta) : '{}';
    const bodyJson = JSON.stringify(body);
    console.log(`[SMS:OUT] tag=${tag || 'none'} to=${to} meta=${metaJson} body=${bodyJson} dry-run=true`);
    if (VERBOSE) console.log('opts:', opts);
    // Match the real sendSMS skip envelope so the post-send block treats dry-run
    // as "not sent" and does NOT write idempotency markers to production data.
    return { skipped: true, reason: 'dry_run', dryRun: true };
  };
}

function yyyymmdd(d) {
  // Convert date to Pacific Time and format as YYYY-MM-DD
  return dayjs(d).tz(TZ).format('YYYY-MM-DD');
}

function resolveAcceptAtPT(protectedData, bookingEndPT, nowPT, txId) {
  const acceptedAtRaw = protectedData?.outbound?.acceptedAt;
  let acceptAtPT = acceptedAtRaw ? dayjs(acceptedAtRaw).tz(TZ) : null;
  const hasValidAcceptAt = acceptAtPT?.isValid?.();

  if (!hasValidAcceptAt) {
    console.warn('[RETURN-LATE][MISSING_ACCEPTED_AT]', { txId });
    const base = bookingEndPT?.isValid?.() ? bookingEndPT : nowPT;
    acceptAtPT = base
      .clone()
      .hour(DEFAULT_ACCEPT_HOUR_PT)
      .minute(DEFAULT_ACCEPT_MINUTE_PT)
      .second(0)
      .millisecond(0);
  }

  return acceptAtPT;
}

const DISABLE_RETURN_REMINDERS = process.env.DISABLE_RETURN_REMINDERS === '1';
const DISABLE_RETURN_REMINDERS_FOR_TX =
  process.env.DISABLE_RETURN_REMINDERS_FOR_TX &&
  process.env.DISABLE_RETURN_REMINDERS_FOR_TX.trim();

// Terminal states that should NEVER receive a return reminder. The base
// query filter (state=delivered) is the primary gate; this set is a
// defensive canary to make spurious traffic obvious in cron logs. Both
// US ('canceled') and UK ('cancelled') spellings are accepted because
// Sharetribe's API uses UK internally while our display layer uses US.
const TERMINAL_STATES_DENYLIST = new Set([
  'canceled',
  'cancelled',
  'declined',
  'expired',
  'payment-expired',
]);

function safeStringify(data, maxLen) {
  try {
    const s = JSON.stringify(data);
    if (maxLen && s.length > maxLen) return `${s.slice(0, maxLen)}...<truncated>`;
    return s;
  } catch (e) {
    return '[unstringifiable]';
  }
}

function logAxios(err, context) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const url = err?.config?.url || err?.response?.config?.url;
  console.error(
    `[RETURN-REMINDER-AXIOS] context=${context || 'unknown'} status=${status || 'n/a'} url=${url || 'n/a'} message=${err?.message || err}`
  );
  if (data !== undefined) {
    console.error(`[RETURN-REMINDER-AXIOS] data=${safeStringify(data, 2000)}`);
  }
}

const listTransactionMethods = (sdk) => Object.keys(sdk?.transactions || {});

const normalizeTxId = (txId) =>
  txId?.uuid ||
  txId?.id?.uuid ||
  txId?.id ||
  (typeof txId === 'string' ? txId : txId?.toString?.());

async function acquireRedisLock(key, ttlSeconds, { context } = {}) {
  const status = redis?.status;
  if (!redis || status === 'end') {
    const prod = process.env.NODE_ENV === 'production';
    if (prod) {
      console.error(`[RETURN-REMINDER-REDIS] Redis unavailable in prod; skipping sends to prevent SMS spam (status=${status || 'none'}) context=${context || 'unknown'}`);
      return { acquired: false, degraded: true };
    }
    console.error(`[RETURN-REMINDER-REDIS] unavailable (status=${status || 'none'}) context=${context || 'unknown'} — falling back to protectedData guards (non-prod)`);
    return { acquired: true, degraded: true };
  }

  if (status === 'mock') {
    const existing = redisLockFallbackStore.get(key);
    const now = Date.now();
    if (existing && existing > now) {
      return { acquired: false, mock: true };
    }
    const expiresAt = now + ttlSeconds * 1000;
    redisLockFallbackStore.set(key, expiresAt);
    setTimeout(() => redisLockFallbackStore.delete(key), ttlSeconds * 1000).unref();
    return { acquired: true, mock: true };
  }

  try {
    const res = await redis.set(key, '1', 'NX', 'EX', ttlSeconds);
    if (res !== 'OK') {
      console.log(`[RETURN-REMINDER-REDIS] lock already held key=${key} context=${context || 'unknown'}`);
      return { acquired: false };
    }
    return { acquired: true };
  } catch (e) {
    console.error(`[RETURN-REMINDER-REDIS] lock error key=${key} context=${context || 'unknown'} message=${e?.message || e}`);
    return { acquired: true, degraded: true };
  }
}

async function sendReturnReminders(allowExitOnError = true) {
  if (DISABLE_RETURN_REMINDERS) {
    console.log(`[RETURN-REMINDERS] disabled via env (pid=${process.pid})`);
    return;
  }

  console.log('🚀 Starting return reminder SMS script...');
  console.log(`[RETURN-REMINDER] limiting sends to LIMIT=${LIMIT || 'unlimited'}`);
  
  try {
    // Initialize SDK using centralized helper (same pattern as shipping/overdue scripts)
    const sdk = getFlexSdk();
    console.log('✅ SDK initialized');
    if (VERBOSE) {
      console.log('[RETURN-REMINDER-DEBUG] sdk.transactions methods:', listTransactionMethods(sdk));
    }
    
    // Safety check: log which marketplace we're targeting
    console.log('[RETURN-REMINDER] Using Flex SDK for marketplace:', process.env.REACT_APP_SHARETRIBE_MARKETPLACE_ID || 'unknown');

    // today/tomorrow window (allow overrides for testing)
    // Calculate dates in Pacific Time (mirrors server/lib/businessDays.js pattern)
    const nowPT = dayjs().tz(TZ);
    const today = process.env.FORCE_TODAY || nowPT.format('YYYY-MM-DD');
    const tomorrow = process.env.FORCE_TOMORROW || nowPT.add(1, 'day').format('YYYY-MM-DD');
    console.log(`[RETURN-REMINDER-DEBUG] 📅 Current time (PT): ${nowPT.format()}`);
    console.log(`[RETURN-REMINDER-DEBUG] 📅 Window: today=${today}, tomorrow=${tomorrow}`);

    // Query transactions for T-1, today, and tomorrow (with pagination)
    const ONLY_STATE = process.env.ONLY_STATE;
    const PAGE_SIZE = parseInt(process.env.ONLY_PAGE_SIZE || process.env.PER_PAGE || '5', 10) || 5;

    const baseQuery = {
      // Return reminders fire while the item is OUT with the borrower — that is
      // state/accepted (active rental + return window). state/delivered means the
      // RETURN already completed (item back to lender via complete-return), so it
      // must NOT be the target or the reminder can never match a live rental.
      state: ONLY_STATE || 'accepted',
      include: ['customer', 'listing', 'booking', 'provider'],
      per_page: PAGE_SIZE, // narrow default; env overrides above
    };

    // Self-test mode: validate Flex access without sending SMS
    if (process.env.RETURN_REMINDERS_FLEX_SELFTEST === '1') {
      try {
        console.log('[RETURN-REMINDER-SELFTEST] running minimal Flex access check');
        const selfTestQuery = {
          state: ONLY_STATE || 'accepted',
          include: [],
          per_page: 1,
          page: 1,
        };
        console.log('[RETURN-REMINDER-QUERY]', safeStringify(selfTestQuery, 2000));
        const res = await sdk.transactions.query(selfTestQuery);
        const first = res?.data?.data?.[0]?.id?.uuid || res?.data?.data?.[0]?.id || null;
        console.log(`[RETURN-REMINDER-SELFTEST] success firstTx=${first || 'none'}`);
        return;
      } catch (err) {
        logAxios(err, `sdk.transactions.query selftest state=${ONLY_STATE || 'accepted'}`);
        if (allowExitOnError) process.exit(1);
        return;
      }
    }

    const ONLY_TX = process.env.ONLY_TX;
  const onlyTxId = ONLY_TX; // bare UUID string; Integration SDK rejects a plain { uuid } object here

    let sent = 0, failed = 0, processed = 0;
    let totalCandidates = 0;
    let page = 1;
    let hasNext = true;
    let stopProcessing = false;

    const processTxPage = async (res, { pageLabel } = {}) => {
      const txs = res?.data?.data || [];
      const meta = res?.data?.meta || {};
      totalCandidates += txs.length;

      const pageDisplay = pageLabel ?? page;
      console.log(`[RETURN-REMINDER] page=${pageDisplay} count=${txs.length} next_page=${meta.next_page}`);

      const included = new Map();
      for (const inc of res?.data?.included || []) {
        // key like "user/UUID"
        const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
        included.set(key, inc);
      }

      for (const tx of txs) {
        if (LIMIT && sent >= LIMIT) {
          stopProcessing = true;
          break;
        }

        processed++;

        const txId = tx?.id?.uuid || tx?.id?.uuid?.uuid || tx?.id?.toString?.() || tx?.id;
        if (DISABLE_RETURN_REMINDERS_FOR_TX && txId === DISABLE_RETURN_REMINDERS_FOR_TX) {
          console.log(`[RETURN-REMINDERS] disabled for tx=${txId} via env (pid=${process.pid})`);
          continue;
        }
        if (ONLY_TX && txId !== ONLY_TX) {
          if (VERBOSE) console.log(`[RETURN-REMINDER-DEBUG] skipping non-target tx=${txId || '(no id)'} ONLY_TX=${ONLY_TX}`);
          continue;
        }

        // Defensive state filter (added May 7, 2026 after spurious 8-SMS
        // reminders fired for payment-expired/expired/canceled txns).
        // Two layers:
        //   1. Terminal-state denylist (canceled/cancelled/declined/expired/
        //      payment-expired) → [SKIP-TERMINAL-STATE]. Loud log; if this
        //      ever fires repeatedly the upstream query filter is broken.
        //   2. Allowlist (state must equal expectedState) → [SKIP-WRONG-STATE].
        //      Catches inquiry/pending-payment/preauthorized/accepted etc.
        // Integration SDK returns "state/delivered"; marketplace SDK may
        // return bare "delivered" — strip the "state/" prefix to accept both.
        const expectedState = ONLY_STATE || 'accepted';
        const txState = tx?.attributes?.state || '';
        const normalizedTxState = txState.replace(/^state\//, '');
        if (TERMINAL_STATES_DENYLIST.has(normalizedTxState)) {
          console.log(`[RETURN-REMINDER][SKIP-TERMINAL-STATE] tx=${txId || '(no id)'} state=${txState} lastTransition=${tx?.attributes?.lastTransition || 'n/a'} — terminal state should never receive a return reminder. If this fires repeatedly, investigate upstream query filter.`);
          continue;
        }
        if (normalizedTxState !== expectedState) {
          console.log(`[RETURN-REMINDER][SKIP-WRONG-STATE] tx=${txId || '(no id)'} state=${txState} expected=${expectedState} lastTransition=${tx?.attributes?.lastTransition || 'n/a'}`);
          continue;
        }

        const deliveryEnd = tx?.attributes?.deliveryEnd;
        const deliveryEndRaw = deliveryEnd;
        const deliveryEndNormalized = deliveryEnd ? dayjs(deliveryEnd).tz(TZ).format('YYYY-MM-DD') : null;

        const bookingRef = tx?.relationships?.booking?.data;
        const bookingKey = bookingRef ? `${bookingRef.type}/${bookingRef.id?.uuid || bookingRef.id}` : null;
        const booking = bookingKey ? included.get(bookingKey) : null;
        const bookingEndRaw = booking?.attributes?.end || null;
        const bookingEndUTC = bookingEndRaw ? dayjs.utc(bookingEndRaw) : null;
        const bookingEndPT = bookingEndRaw ? dayjs(bookingEndRaw).tz(TZ) : null;
        const endsAtMidnight =
          bookingEndPT && bookingEndPT.format('HH:mm:ss') === '00:00:00';
        // Sharetribe day-bookings store booking.end at UTC midnight,
        // end-exclusive. For a 2-night booking displayed "Mon Jun 1 — Wed
        // Jun 3", booking.end = "2026-06-03T00:00:00Z" — the day the borrower
        // ships back. The previous bookingEndPT.format() converted to PT
        // first, yielding "2026-06-02" (since UTC midnight = 5 PM PT prev
        // day) and made T-1 fire Mon Jun 1 instead of Tue Jun 2.
        const endsAtUTCMidnight =
          bookingEndUTC && bookingEndUTC.format('HH:mm:ss') === '00:00:00';

        // Use the booking-end calendar date as the return due date so the day-of
        // (8-SMS) window aligns with the overdue script's due date and lands exactly
        // one day before the first overdue reminder (9.1). For UTC-midnight
        // day-bookings (Sharetribe default), read the UTC calendar date so the
        // due date matches Sharetribe's "Booking end" display; otherwise fall
        // through to the PT-converted date for any future non-midnight ends.
        const dueLocalDate = bookingEndUTC
          ? (endsAtUTCMidnight
              ? bookingEndUTC.format('YYYY-MM-DD')
              : bookingEndPT.format('YYYY-MM-DD'))
          : null;

        const lateStartLocalDate = dueLocalDate;
        
        // [RETURN-REMINDER-DEBUG] Log transaction details for debugging
        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || tx?.id || '(no id)'} bookingEndRaw=${bookingEndRaw} bookingEndPT=${bookingEndPT ? bookingEndPT.format() : null} endsAtMidnight=${endsAtMidnight} dueLocalDate=${dueLocalDate} deliveryEndRaw=${deliveryEndRaw} deliveryEndNormalized=${deliveryEndNormalized} today=${today} tomorrow=${tomorrow} lateStartLocalDate=${lateStartLocalDate}`);
        
        if (!dueLocalDate) {
          console.log(`[RETURN-REMINDER][SKIP] tx=${tx?.id?.uuid || '(no id)'} reason=missing booking end bookingKey=${bookingKey} bookingEndRaw=${bookingEndRaw}`);
          continue;
        }

        const tMinus1ForTx = dayjs(dueLocalDate).tz(TZ).subtract(1, 'day').format('YYYY-MM-DD');
        // getFirstChargeableLateDate is not exported by businessDays.js; this stays
        // null and is retained only for the debug logs below (see CLAUDE_CONTEXT
        // May 22 follow-up). Late-fee day counting lives in computeChargeableLateDays.
        const firstChargeableLateDate = null;

        const pd = tx?.attributes?.protectedData || {};
        const returnData = pd.return || {};
        const returnSms = pd.returnSms || {};

        const matchesTMinus1 = today === tMinus1ForTx;
        const matchesToday = today === dueLocalDate;

        const isScannedOrInTransit =
          returnData.firstScanAt ||
          returnData.status === 'accepted' ||
          returnData.status === 'in_transit';

        // Policy: late fees (and late messaging) begin on booking end local date (no extra grace)
        const inLateWindow =
          bookingEndPT &&
          !isScannedOrInTransit &&
          (nowPT.isAfter(bookingEndPT) || today === lateStartLocalDate);

        const matchesWindow = matchesTMinus1 || matchesToday || inLateWindow;
        
        if (!matchesWindow) {
          console.log(`[RETURN-REMINDER][SKIP] tx=${tx?.id?.uuid || '(no id)'} reason=not return day window due=${dueLocalDate} bookingEndRaw=${bookingEndRaw} window=T-1:${tMinus1ForTx}|TODAY:${dueLocalDate}|LATE>=${lateStartLocalDate}`);
          continue;
        }
        
        // Determine which reminder window this transaction falls into
        let reminderType = null;
        if (matchesTMinus1) {
          reminderType = 'T-1';
        } else if (matchesToday) {
          reminderType = 'TODAY';
        } else if (inLateWindow) {
          reminderType = 'LATE';
        }

        console.log(
          `[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} MATCHES window - reminderType=${reminderType} ` +
          `policy=late-starts-at-due-date lateStartLocalDate=${lateStartLocalDate} inLateWindow=${inLateWindow} ` +
          `due=${dueLocalDate} tMinus1ForTx=${tMinus1ForTx} firstChargeableLateDate=${firstChargeableLateDate} todayPT=${today} bookingEndPT=${bookingEndPT ? bookingEndPT.format() : null} endsAtMidnight=${endsAtMidnight} matchesTMinus1=${matchesTMinus1} matchesToday=${matchesToday}`
        );

        if (reminderType === 'LATE' && MAX_LATE_AGE_DAYS > 0 && lateStartLocalDate) {
          const lateStartDate = dayjs(lateStartLocalDate).tz(TZ).startOf('day');
          const lateAgeDays = nowPT.startOf('day').diff(lateStartDate, 'day');
          if (lateAgeDays > MAX_LATE_AGE_DAYS) {
            console.log(
              `[RETURN-REMINDER][SKIP] tx=${tx?.id?.uuid || '(no id)'} reason=late-too-old ageDays=${lateAgeDays} max=${MAX_LATE_AGE_DAYS}`
            );
            continue;
          }
        }

        // resolve customer from included
        const custRef = tx?.relationships?.customer?.data;
        const custKey = custRef ? `${custRef.type}/${custRef.id?.uuid || custRef.id}` : null;
        const customer = custKey ? included.get(custKey) : null;

        // resolve listing from included (for item title in SMS copy)
        const listingRef = tx?.relationships?.listing?.data;
        const listingKey = listingRef ? `${listingRef.type}/${listingRef.id?.uuid || listingRef.id}` : null;
        const listing = listingKey ? included.get(listingKey) : null;
        const itemTitle = listing?.attributes?.title || 'your item';
        
        // Per-booking phone wins over account phone. Precedence:
        //   1. tx.protectedData.customerPhone   (booking-specific, set at checkout)
        //      …with several legacy aliases tried in turn for older bookings.
        //   2. profile.protectedData.phoneNumber (canonical user-profile slot)
        //   3. profile.protectedData.phone       (legacy slot; fallback through deprecation soak)
        // Per-booking phone never overwrites the borrower's account number —
        // see Phase D task #31 (gifting / different recipient phone).
        const protectedData = tx?.attributes?.protectedData || {};
        const normalizePhoneCandidate = (val) => {
          const trimmed = val && String(val).trim();
          if (!trimmed) return null;
          return trimmed.length >= 7 ? trimmed : null;
        };

        const checkoutPhoneCandidate =
          protectedData.customerPhone ||
          protectedData.phone ||
          protectedData.customer_phone ||
          protectedData?.checkoutDetails?.customerPhone ||
          protectedData?.checkoutDetails?.phone;
        const checkoutPhone = normalizePhoneCandidate(checkoutPhoneCandidate);

        const profilePhoneCandidate =
          customer?.attributes?.profile?.protectedData?.phoneNumber ||
          customer?.attributes?.profile?.protectedData?.phone;
        const profilePhone = normalizePhoneCandidate(profilePhoneCandidate);

        const borrowerPhone = checkoutPhone || profilePhone || null;

        if (!borrowerPhone) {
          console.warn(`[RETURN-REMINDER][NO-PHONE] Skipping return-day SMS, no checkout/prof phone`, { txId: tx?.id?.uuid || '(no id)' });
          continue;
        }
        
        console.log(`[RETURN-REMINDER][PHONE-SELECTED] tx=${tx?.id?.uuid || '(no id)'} used=${checkoutPhone ? 'checkoutPhone(protectedData)' : 'profilePhone'}`);

        if (ONLY_PHONE && borrowerPhone !== ONLY_PHONE) {
          if (VERBOSE) console.log(`↩️ Skipping ${borrowerPhone} (ONLY_PHONE=${ONLY_PHONE})`);
          continue;
        }
        
        const maskedPhone = borrowerPhone.replace(/\d(?=\d{4})/g, '*');
        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} borrowerPhone=${maskedPhone}`);

        // choose message based on due date derived from booking end
        let message;
        let tag;
        let lateSendAtPT = null;
        let acceptAtPT = null;
        let lateStartDatePT = lateStartLocalDate;
        
        const effectiveReminderDate = reminderType === 'LATE' ? lateStartLocalDate : dueLocalDate;
        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} effectiveReminderDate=${effectiveReminderDate} reminderType=${reminderType}`);

        // Targeted diagnostics for known spam case
        const targetTxId = '693c9fee-ac5a-4077-af79-60c0c25f00af';
        if (txId === targetTxId) {
          console.log(
            `[RETURN-REMINDER-TARGET] nowPT=${nowPT.format()} due=${dueLocalDate} firstChargeableLateDate=${firstChargeableLateDate} reminderType=${reminderType} ` +
            `matchesToday=${matchesToday} matchesLate=${inLateWindow} ` +
            `todayReminderSentAt=${returnData.todayReminderSentAt || 'null'} ` +
            `tomorrowReminderSentAt=${returnData.tomorrowReminderSentAt || 'null'} ` +
            `tMinus1SentAt=${returnData.tMinus1SentAt || 'null'} ` +
            `dueTodayLastSentLocalDate=${returnSms.dueTodayLastSentLocalDate || 'null'} ` +
            `lateLastSentLocalDate=${returnSms.lateLastSentLocalDate || 'null'}`
          );
        }
        
        // Local date string in PT for idempotency (per calendar day)
        const todayLocalDate = nowPT.format('YYYY-MM-DD');

        if (reminderType === 'T-1') {
          // Idempotency: skip if T-1 already sent
          if (returnData.tMinus1SentAt) {
            console.log(`[RETURN-REMINDER-DEBUG] tx=${txId || '(no id)'} skipping T-1 reminder, already sent at ${returnData.tMinus1SentAt}`);
            continue;
          }

          // Skip if the return is already in motion (mirrors the TODAY branch):
          // no point telling someone to "ship back tomorrow" once they've shipped.
          if (
            returnData.firstScanAt ||
            returnData.status === 'in_transit' ||
            returnData.status === 'accepted'
          ) {
            console.log(`[return-reminders] 🚚 Return already scanned/in transit for tx ${tx?.id?.uuid || '(no id)'} - skipping T-1 reminder`);
            continue;
          }

          // T-1 day: Send QR/label (use real label if available)
          // Canonical fields preferred: pd.returnQrUrl / pd.returnLabelUrl. If both
          // are absent, fall back to re-fetching from Shippo via pd.returnTransactionId
          // (defense-in-depth — see resolveReturnLabelUrl). If nothing resolves, skip
          // this pass and let the next cron cycle pick it up.
          const resolvedLabel = await resolveReturnLabelUrl(pd);

          if (!resolvedLabel) {
            console.warn(`[RETURN-REMINDER][NO-LABEL] tx=${tx?.id?.uuid || '(no id)'} — no returnQrUrl/returnLabelUrl and no Shippo re-fetch via returnTransactionId. Skipping this pass.`);
            continue;
          }

          const returnLabelUrl = resolvedLabel.url;
          // Log whether we're using QR or label URL, and where it came from
          console.log(`[return-reminders] Using ${resolvedLabel.type} URL from ${resolvedLabel.source} for tx ${tx?.id?.uuid || '(no id)'}`);

          const shortUrl = await shortLink(returnLabelUrl);
          console.log('[SMS] shortlink', { type: 'return', short: shortUrl, original: returnLabelUrl });
          message = buildReturnReminderCopy({ kind: 'T-1', itemTitle, shortUrl, returnLocalDate: dueLocalDate });
          tag = 'return_tminus1_to_borrower';
          
        } else if (reminderType === 'TODAY') {
          // Today: Ship back
          // Idempotency check: skip if already sent
          if (returnData.todayReminderSentAt) {
            console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} skipping TODAY reminder, already sent at ${returnData.todayReminderSentAt}`);
            continue;
          }
          // Durable per-day idempotency (PT calendar day)
          if (returnSms.dueTodayLastSentLocalDate === todayLocalDate) {
            console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} skipping TODAY reminder, already sent for local day ${todayLocalDate} (returnSms.dueTodayLastSentLocalDate)`);
            continue;
          }
          // In-memory guard if last update failed this process
          if (sentTodayByTx.get(txId) === todayLocalDate) {
            console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} skipping TODAY reminder due to in-memory guard for local day ${todayLocalDate} (protectedData update previously failed)`);
            continue;
          }
          
          // Check if package already scanned - skip reminder if so
          if (
            returnData.firstScanAt ||
            returnData.status === 'accepted' ||
            returnData.status === 'in_transit'
          ) {
            console.log(`[return-reminders] 🚚 Package already scanned for tx ${tx?.id?.uuid || '(no id)'} - skipping day-of reminder`);
            continue;
          }

          // Use the same dueLocalDate derived above (UTC-date for UTC-midnight
          // day-bookings). Previously this re-derived from bookingEndPT, which
          // for end-exclusive UTC-midnight bookings resolves to the PT-day BEFORE
          // the actual return ship day and made the day-of 8-SMS silently never
          // fire for every Sharetribe day-booking.
          const returnDayLocalDate = dueLocalDate;
          const sendAtPT = returnDayLocalDate
            ? dayjs.tz(
                `${returnDayLocalDate} ${String(SEND_HOUR_PT).padStart(2, '0')}:${String(SEND_MINUTE_PT).padStart(2, '0')}:00`,
                TZ
              )
            : null;
          const isReturnDay = returnDayLocalDate && nowPT.format('YYYY-MM-DD') === returnDayLocalDate;
          const isDueToSend = isReturnDay && sendAtPT && (nowPT.isSame(sendAtPT) || nowPT.isAfter(sendAtPT));
          if (!isDueToSend) {
            if (ONLY_TX && txId === ONLY_TX) {
              console.log(`[RETURN-DUE-TODAY][NOT-DUE-YET]`, {
                txId,
                nowPT: nowPT.format(),
                sendAtPT: sendAtPT ? sendAtPT.format() : 'n/a',
              });
            }
            continue;
          }
          
          // Canonical fields preferred, Shippo re-fetch fallback — matches T-1 branch.
          const resolvedLabel = await resolveReturnLabelUrl(pd);

          if (resolvedLabel) {
            const returnLabelUrl = resolvedLabel.url;
            const shortUrl = await shortLink(returnLabelUrl);
            console.log('[SMS] shortlink', { type: 'return', short: shortUrl, original: returnLabelUrl, source: resolvedLabel.source });
            message = buildReturnReminderCopy({ kind: 'TODAY', itemTitle, shortUrl, returnLocalDate: dueLocalDate });
            tag = 'return_reminder_today';
          } else {
            message = buildReturnReminderCopy({ kind: 'TODAY_NO_LABEL', itemTitle, returnLocalDate: dueLocalDate });
            tag = 'return_reminder_today_no_label';
          }
          
        } else if (reminderType === 'LATE') {
          // OPTION A IMPLEMENTATION: Late reminders disabled in sendReturnReminders.js
          // Only sendOverdueReminders.js sends late-day SMS (Day 1-6 with escalating messages + fee charging)
          // This script now only handles pre-due reminders (T-1, TODAY)
          console.log(`[SMS][LATE][SKIP] disabled in sendReturnReminders tx=${tx?.id?.uuid || tx?.id || '(no id)'} - late reminders handled by sendOverdueReminders.js`);
          continue;
        }

        // If no message was generated, skip before locking to avoid burning locks
        if (!message) {
          console.warn(`[RETURN-REMINDER-DEBUG] tx=${txId} reminderType=${reminderType} has no message; skipping without lock`);
          continue;
        }

        // Quiet-hours gate must run BEFORE acquireRedisLock. The per-tx lock
        // has a 24h TTL; if the first tick of the day lands in quiet hours
        // and the lock is grabbed, every subsequent tick that day short-
        // circuits on "lock already held" and the SMS is lost for the day.
        // Pattern A: 15-min cron poll naturally retries once we're back in
        // the send window.
        if (!withinSendWindow(getNow())) {
          console.log(`[RETURN-REMINDER][QUIET-HOURS] tx=${tx?.id?.uuid || '(no id)'} — deferred to next poll`);
          continue;
        }

        // Per-tx per-day per-type Redis lock to prevent duplicates
        const perTxLockKey = `return-reminders:${reminderType}:${txId}:${todayLocalDate}`;
        const perTxLock = await acquireRedisLock(perTxLockKey, 60 * 60 * 24, {
          context: `tx:${txId}:${reminderType}`,
        });
        if (!perTxLock.acquired) {
          console.log(`[RETURN-REMINDER-REDIS] lock hit; skipping tx=${txId} type=${reminderType} day=${todayLocalDate}`);
          continue;
        }
        if (perTxLock.degraded) {
          console.warn('[RETURN-REMINDER-REDIS] proceeding without reliable lock (degraded)');
        } else if (perTxLock.mock) {
          console.warn('[RETURN-REMINDER-REDIS] using in-memory mock lock (non-prod fallback)');
        }

        if (VERBOSE) {
          console.log(`📬 To ${borrowerPhone} (tx ${tx?.id?.uuid || ''}) → ${message}`);
        }

        try {
          if (VERBOSE || DEBUG_SMS) {
            console.log(`[RETURN-REMINDER][SEND] about to send tag=${tag} tx=${tx?.id?.uuid || '(no id)'} phone=${maskedPhone} type=${reminderType}`);
          }
          const smsResult = await sendSMS(borrowerPhone, message, { 
            role: 'borrower', 
            kind: 'return-reminder',
            tag: tag,
            meta: { transactionId: tx?.id?.uuid || tx?.id }
          });
          
          // Only mark reminder as sent for idempotency if SMS was actually sent
          if (!smsResult?.skipped) {
            console.log(`[RETURN-REMINDER][SENT] tx=${tx?.id?.uuid || '(no id)'} phone=${maskedPhone}`);
            if (VERBOSE || DEBUG_SMS) {
              console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} SMS sent successfully - tag=${tag} sid=${smsResult?.sid || 'n/a'}`);
            }
            const timestamp = new Date().toISOString();
            
            if (reminderType === 'T-1') {
              try {
                await upsertProtectedData(
                  normalizeTxId(tx.id),
                  {
                    return: {
                      ...returnData,
                      tMinus1SentAt: timestamp,
                    },
                  },
                  { source: 'return-reminders' }
                );
                console.log(`💾 Marked T-1 SMS as sent for tx ${tx?.id?.uuid || '(no id)'}`);
              } catch (updateError) {
                logAxios(updateError, `upsertProtectedData T-1 tx=${txId} day=${todayLocalDate}`);
                console.error(`❌ Failed to mark T-1 as sent:`, updateError.message);
              }
            } else if (reminderType === 'TODAY') {
              try {
                await upsertProtectedData(
                  normalizeTxId(tx.id),
                  {
                    return: {
                      ...returnData,
                      todayReminderSentAt: timestamp,
                    },
                    returnSms: {
                      ...returnSms,
                      dueTodayLastSentLocalDate: todayLocalDate,
                    },
                  },
                  { source: 'return-reminders' }
                );
                console.log(`💾 Marked TODAY reminder as sent for tx ${tx?.id?.uuid || '(no id)'}`);
              } catch (updateError) {
                logAxios(updateError, `upsertProtectedData TODAY tx=${txId} day=${todayLocalDate}`);
                console.error(`❌ Failed to mark TODAY reminder as sent:`, updateError.message);
                // Prevent spam in this daemon cycle if Flex update fails
                sentTodayByTx.set(txId, todayLocalDate);
                dueTodayUpdateFailures += 1;
                console.warn(`[RETURN-REMINDER-DEBUG] Applied in-memory TODAY guard for tx=${txId} localDay=${todayLocalDate} (dueTodayUpdateFailures=${dueTodayUpdateFailures})`);
              }
            } else if (reminderType === 'LATE') {
              console.log('[RETURN-LATE-SMS-SENT]', {
                txId,
                nowPT: nowPT.format(),
                lateSendAtPT: lateSendAtPT ? lateSendAtPT.format() : null,
                acceptAtPT: acceptAtPT ? acceptAtPT.format() : null,
                bookingEndPT: bookingEndPT ? bookingEndPT.format() : null,
                tag,
              });
              // Mark late reminder as sent (once per PT day)
              try {
                await upsertProtectedData(
                  normalizeTxId(tx.id),
                  {
                    return: {
                      ...returnData,
                      tomorrowReminderSentAt: timestamp,
                    },
                    returnSms: {
                      ...returnSms,
                      lateLastSentLocalDate: todayLocalDate,
                    },
                  },
                  { source: 'return-reminders' }
                );
                console.log(`💾 Marked LATE reminder as sent for tx ${tx?.id?.uuid || '(no id)'} (lateStartLocalDate=${lateStartLocalDate})`);
              } catch (updateError) {
                logAxios(updateError, `upsertProtectedData LATE tx=${txId} day=${todayLocalDate}`);
                console.error(`❌ Failed to mark LATE as sent:`, updateError.message);
                // Prevent spam in this daemon cycle if Flex update fails
                lateSentTodayByTx.set(txId, todayLocalDate);
                lateUpdateFailures += 1;
                console.warn(`[RETURN-REMINDER-DEBUG] Applied in-memory LATE guard for tx=${txId} localDay=${todayLocalDate} (lateUpdateFailures=${lateUpdateFailures})`);
              }
            }
            
            sent++;
          } else {
            console.log(`[RETURN-REMINDER-DEBUG] ⏭️ SMS skipped (${smsResult.reason}) - NOT marking reminder as sent for tx ${tx?.id?.uuid || '(no id)'}`);
          }
        } catch (e) {
          console.error(`❌ SMS failed to ${borrowerPhone}:`, e?.message || e);
          failed++;
        }

        if (LIMIT && sent >= LIMIT) {
          console.log(`⏹️ Limit reached (${LIMIT}). Stopping.`);
          stopProcessing = true;
          break;
        }
      }

      return meta.next_page;
    };

    if (ONLY_TX) {
      console.log(`[RETURN-REMINDER-DEBUG] ONLY_TX=${ONLY_TX} → fetching single transaction via show()`);
      if (VERBOSE) console.log('[RETURN-REMINDER-DEBUG] ONLY_TX request id shape:', onlyTxId);
      try {
        const res = await sdk.transactions.show({
          id: onlyTxId,
          include: ['customer', 'listing', 'booking', 'provider'],
        });
        // show() returns a single object; processTxPage expects a query-shaped array.
        if (res?.data && !Array.isArray(res.data.data)) {
          res.data.data = [res.data.data];
        }
        await processTxPage(res, { pageLabel: 'ONLY_TX' });
      } catch (err) {
        logAxios(err, `sdk.transactions.show ONLY_TX=${ONLY_TX} idShape=${safeStringify(onlyTxId, 200)}`);
        throw err;
      }

      console.log(`📊 Found ${totalCandidates} candidate transactions across 1 page(s)`);
      console.log(`\n📊 Done. Sent=${sent} Failed=${failed} Processed=${processed}`);
      if (DRY) console.log('🧪 DRY-RUN mode: no real SMS were sent.');
      return;
    }

    while (hasNext && !stopProcessing) {
      let res;
      try {
        const queryPayload = { ...baseQuery, page };
        console.log('[RETURN-REMINDER-QUERY]', safeStringify(queryPayload, 2000));
        res = await sdk.transactions.query(queryPayload);
      } catch (err) {
        logAxios(err, `sdk.transactions.query page=${page} base=${safeStringify(baseQuery, 500)}`);
        throw err;
      }
      const nextPage = await processTxPage(res, { pageLabel: page });
      hasNext = !!nextPage;
      page += 1;
    }

    const pagesProcessed = page - 1;
    console.log(`📊 Found ${totalCandidates} candidate transactions across ${pagesProcessed} page(s)`);
    console.log(`\n📊 Done. Sent=${sent} Failed=${failed} Processed=${processed}`);
    if (DRY) console.log('🧪 DRY-RUN mode: no real SMS were sent.');
    
  } catch (err) {
    console.error('\n❌ Fatal error:', err?.message || err);
    if (err.response) {
      console.error('🔎 Flex API response status:', err.response.status);
      console.error('🔎 Flex API response data:', JSON.stringify(err.response.data, null, 2));
    }
    if (err.stack) {
      console.error('🔎 Stack trace:', err.stack);
    }
    if (allowExitOnError) {
      process.exit(1);
    }
  }
}

// ============================================================================
// TEST COMMANDS (for local/testing)
// ============================================================================
// Example dry-run (no real SMS):
// SMS_DRY_RUN=1 ONLY_PHONE=+15551234567 node server/scripts/sendReturnReminders.js --verbose
//
// Example forcing a date window for testing:
// SMS_DRY_RUN=1 FORCE_TODAY=2025-11-21 FORCE_TOMORROW=2025-11-22 node server/scripts/sendReturnReminders.js --verbose
//
// Verification steps:
// 1. Run in DRY_RUN mode: Should complete without errors, log "Done. Sent=0" if no matches
// 2. Check logs: Should see reasonable [RETURN-REMINDER-DEBUG] lines for each transaction checked
// 3. Verify SDK initialization: Should see "[FlexSDK] Using Integration SDK..." or "[FlexSDK] Using Marketplace SDK..."
// 4. No [FLEX-400-DIAG] spam: Diagnostic logging removed, only essential logs remain
// ============================================================================

// Run the script if called directly
if (require.main === module) {
  if (argv.includes('--daemon')) {
    // Run as daemon with internal scheduling
    console.log('🔄 Starting return reminders daemon (every 15 minutes)');
    let isRunning = false;
    const runOnceSafely = async () => {
      if (DISABLE_RETURN_REMINDERS) {
        console.log(`[RETURN-REMINDERS] disabled via env (pid=${process.pid})`);
        return;
      }
      if (isRunning) {
        console.log('⏳ Previous run still in progress, skipping this tick');
        return;
      }
      const tickLock = await acquireRedisLock('return-reminders:tick-lock', 1200, {
        context: 'tick',
      });
      if (!tickLock.acquired) {
        console.log('[RETURN-REMINDER-REDIS] tick lock already held; skipping this tick');
        return;
      }
      if (tickLock.degraded) {
        console.warn('[RETURN-REMINDER-REDIS] proceeding without reliable tick lock (degraded)');
      } else if (tickLock.mock) {
        console.warn('[RETURN-REMINDER-REDIS] using in-memory mock tick lock (non-prod fallback)');
      }
      isRunning = true;
      try {
          await sendReturnReminders(false);
        } catch (error) {
          console.error('❌ Daemon error:', error?.message || error);
          if (error?.response) {
            console.error('🔎 Flex API response status:', error.response.status);
            console.error('🔎 Flex API response data:', JSON.stringify(error.response.data, null, 2));
          }
          if (error?.stack) {
            console.error('🔎 Stack trace:', error.stack);
          }
      } finally {
        isRunning = false;
      }
    };

    // Schedule future runs
    setInterval(runOnceSafely, 15 * 60 * 1000); // 15 minutes

    // Run immediately
    runOnceSafely();
  } else {
    sendReturnReminders()
      .then(() => {
        console.log('🎉 Return reminder script completed successfully');
        process.exit(0);
      })
      .catch((error) => {
        console.error('💥 Return reminder script failed:', error.message);
        process.exit(1);
      });
  }
}

module.exports = { sendReturnReminders, buildReturnReminderCopy, nextShippingDay };
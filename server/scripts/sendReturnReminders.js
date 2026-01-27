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
const { getFirstChargeableLateDate } = require('../lib/businessDays');
const { getRedis } = require('../redis');

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
    return { dryRun: true };
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

async function updateTransactionProtectedData(sdk, txId, protectedDataPatch, { context } = {}) {
  const txApi = sdk?.transactions || {};
  const available = listTransactionMethods(sdk);
  const method = typeof txApi.update === 'function'
    ? 'update'
    : typeof txApi.updateMetadata === 'function'
      ? 'updateMetadata'
      : typeof txApi.updateProtectedData === 'function'
        ? 'updateProtectedData'
        : null;

  if (!method) {
    const message = `[RETURN-REMINDER] No transaction update method available; methods=[${available.join(', ') || 'none'}]`;
    const err = new Error(message);
    err.availableMethods = available;
    throw err;
  }

  const idForMetadata = normalizeTxId(txId);

  try {
    if (method === 'update') {
      return await txApi.update({
        id: txId,
        attributes: { protectedData: protectedDataPatch },
      });
    }
    if (method === 'updateMetadata') {
      return await txApi.updateMetadata({
        id: idForMetadata,
        protectedData: protectedDataPatch,
      });
    }
    // updateProtectedData is not standard, but handle if present.
    return await txApi.updateProtectedData({
      id: idForMetadata,
      protectedData: protectedDataPatch,
    });
  } catch (err) {
    console.error(
      `[RETURN-REMINDER][TX-UPDATE-ERROR] method=${method} context=${context || 'unknown'} available=[${available.join(', ') || 'none'}] message=${err?.message || err}`
    );
    throw err;
  }
}

function logAvailableTransactionMethods(sdk) {
  console.error(
    `[RETURN-REMINDER-DEBUG] sdk.transactions methods: ${listTransactionMethods(sdk).join(', ') || 'none'}`
  );
}

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
      state: ONLY_STATE || 'delivered',
      include: ['customer', 'listing', 'booking', 'provider'],
      per_page: PAGE_SIZE, // narrow default; env overrides above
    };

    // Self-test mode: validate Flex access without sending SMS
    if (process.env.RETURN_REMINDERS_FLEX_SELFTEST === '1') {
      try {
        console.log('[RETURN-REMINDER-SELFTEST] running minimal Flex access check');
        const selfTestQuery = {
          state: ONLY_STATE || 'delivered',
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
        logAxios(err, `sdk.transactions.query selftest state=${ONLY_STATE || 'delivered'}`);
        if (allowExitOnError) process.exit(1);
        return;
      }
    }

    const ONLY_TX = process.env.ONLY_TX;
  const onlyTxId = ONLY_TX && ONLY_TX.includes('-') ? { uuid: ONLY_TX } : ONLY_TX;

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

        const deliveryEnd = tx?.attributes?.deliveryEnd;
        const deliveryEndRaw = deliveryEnd;
        const deliveryEndNormalized = deliveryEnd ? dayjs(deliveryEnd).tz(TZ).format('YYYY-MM-DD') : null;

        const bookingRef = tx?.relationships?.booking?.data;
        const bookingKey = bookingRef ? `${bookingRef.type}/${bookingRef.id?.uuid || bookingRef.id}` : null;
        const booking = bookingKey ? included.get(bookingKey) : null;
        const bookingEndRaw = booking?.attributes?.end || null;
        const bookingEndPT = bookingEndRaw ? dayjs(bookingEndRaw).tz(TZ) : null;
        const endsAtMidnight =
          bookingEndPT && bookingEndPT.format('HH:mm:ss') === '00:00:00';

        const dueLocalDate = bookingEndPT
          ? (endsAtMidnight ? bookingEndPT.subtract(1, 'day') : bookingEndPT).format('YYYY-MM-DD')
          : null;

        const lateStartLocalDate = bookingEndPT ? bookingEndPT.format('YYYY-MM-DD') : null;
        
        // [RETURN-REMINDER-DEBUG] Log transaction details for debugging
        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || tx?.id || '(no id)'} bookingEndRaw=${bookingEndRaw} bookingEndPT=${bookingEndPT ? bookingEndPT.format() : null} endsAtMidnight=${endsAtMidnight} dueLocalDate=${dueLocalDate} deliveryEndRaw=${deliveryEndRaw} deliveryEndNormalized=${deliveryEndNormalized} today=${today} tomorrow=${tomorrow} lateStartLocalDate=${lateStartLocalDate}`);
        
        if (!dueLocalDate) {
          console.log(`[RETURN-REMINDER][SKIP] tx=${tx?.id?.uuid || '(no id)'} reason=missing booking end bookingKey=${bookingKey} bookingEndRaw=${bookingEndRaw}`);
          continue;
        }

        const tMinus1ForTx = dayjs(dueLocalDate).tz(TZ).subtract(1, 'day').format('YYYY-MM-DD');
        const firstChargeableLateDate =
          typeof getFirstChargeableLateDate === 'function' ? getFirstChargeableLateDate(dueLocalDate) : null;

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
        
        // Prefer checkout-entered phone stored on the transaction, then fall back to profile phone
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
          customer?.attributes?.profile?.protectedData?.phone ||
          customer?.attributes?.profile?.protectedData?.phoneNumber;
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

          // T-1 day: Send QR/label (use real label if available)
          // Check for return label in priority order: QR URL (preferred), then label URL
          let returnLabelUrl = pd.returnQrUrl ||  // Preferred: USPS QR code URL
                              pd.returnLabelUrl || // Fallback: PDF label URL
                              returnData.label?.url || 
                              pd.returnLabel || 
                              pd.shippingLabelUrl || 
                              pd.returnShippingLabel;
          
          // If no return label exists, log warning (label should have been created during accept transition)
          if (!returnLabelUrl && !returnData.tMinus1SentAt) {
            console.warn(`[RETURN-REMINDER-DEBUG] [return-reminders] ⚠️ No return label found for tx ${tx?.id?.uuid || '(no id)'} - label should have been created during accept transition - SKIPPING`);
            // Note: Creating a real Shippo label here would require addresses, parcel info, etc.
            // For now, skip sending T-1 reminder if no label exists (better than sending placeholder)
            continue;
          }
          
          // Log whether we're using QR or label URL
          const labelType = pd.returnQrUrl ? 'QR' : 'label';
          const labelSource = pd.returnQrUrl ? 'returnQrUrl' : 
                             pd.returnLabelUrl ? 'returnLabelUrl' : 
                             returnData.label?.url ? 'returnData.label.url' : 'other';
          console.log(`[return-reminders] Using ${labelType} URL from ${labelSource} for tx ${tx?.id?.uuid || '(no id)'}`);
          
          const shortUrl = await shortLink(returnLabelUrl);
          console.log('[SMS] shortlink', { type: 'return', short: shortUrl, original: returnLabelUrl });
          const labelNoun = labelType === 'QR' ? 'QR code' : 'shipping label';
          message = `📦 It's almost return time! Please ship your item back tomorrow using this ${labelNoun}: ${shortUrl}. Late fees are $15/day if it ships after the return date. Thanks for sharing style 💌`;
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

          const returnDayLocalDate = bookingEndPT ? bookingEndPT.format('YYYY-MM-DD') : null;
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
          
          const returnLabelUrl = pd.returnQrUrl || // Preferred: USPS QR code URL
                                pd.returnLabelUrl || 
                                returnData.label?.url || 
                                pd.returnLabel || 
                                pd.shippingLabelUrl || 
                                pd.returnShippingLabel;

          if (returnLabelUrl) {
            const shortUrl = await shortLink(returnLabelUrl);
            console.log('[SMS] shortlink', { type: 'return', short: shortUrl, original: returnLabelUrl });
            message = `Sherbrt 🍧: 📦 Today's the day! Ship your Sherbrt item back: ${shortUrl}`;
            tag = 'return_reminder_today';
          } else {
            message = `Sherbrt 🍧: 📦 Today's the day! Ship your Sherbrt item back. Check your dashboard for return instructions.`;
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
                await updateTransactionProtectedData(
                  sdk,
                  tx.id,
                  {
                    ...pd,
                    return: {
                      ...returnData,
                      tMinus1SentAt: timestamp,
                    },
                  },
                  { context: `T-1 tx=${txId} day=${todayLocalDate}` }
                );
                console.log(`💾 Marked T-1 SMS as sent for tx ${tx?.id?.uuid || '(no id)'}`);
              } catch (updateError) {
                logAxios(updateError, `sdk.transactions.update T-1 tx=${txId} day=${todayLocalDate}`);
                logAvailableTransactionMethods(sdk);
                console.error(`❌ Failed to mark T-1 as sent:`, updateError.message);
              }
            } else if (reminderType === 'TODAY') {
              try {
                await updateTransactionProtectedData(
                  sdk,
                  tx.id,
                  {
                    ...pd,
                    return: {
                      ...returnData,
                      todayReminderSentAt: timestamp,
                    },
                    returnSms: {
                      ...returnSms,
                      dueTodayLastSentLocalDate: todayLocalDate,
                    },
                  },
                  { context: `TODAY tx=${txId} day=${todayLocalDate}` }
                );
                console.log(`💾 Marked TODAY reminder as sent for tx ${tx?.id?.uuid || '(no id)'}`);
              } catch (updateError) {
                logAxios(updateError, `sdk.transactions.update TODAY tx=${txId} day=${todayLocalDate}`);
                logAvailableTransactionMethods(sdk);
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
                await updateTransactionProtectedData(
                  sdk,
                  tx.id,
                  {
                    ...pd,
                    return: {
                      ...returnData,
                      tomorrowReminderSentAt: timestamp,
                    },
                    returnSms: {
                      ...returnSms,
                      lateLastSentLocalDate: todayLocalDate,
                    },
                  },
                  { context: `LATE tx=${txId} day=${todayLocalDate}` }
                );
                console.log(`💾 Marked LATE reminder as sent for tx ${tx?.id?.uuid || '(no id)'} (lateStartLocalDate=${lateStartLocalDate})`);
              } catch (updateError) {
                logAxios(updateError, `sdk.transactions.update LATE tx=${txId} day=${todayLocalDate}`);
                logAvailableTransactionMethods(sdk);
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

module.exports = { sendReturnReminders }; 
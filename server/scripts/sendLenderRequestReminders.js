#!/usr/bin/env node
/**
 * Lender Request Reminder SMS Script (60-minute follow-up)
 *
 * Sends a single follow-up SMS to the lender if they haven't accepted or
 * rejected a borrow request within 60 minutes of it being placed.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY / WHAT
 * ──────────────────────────────────────────────────────────────────────────
 * A borrower creates a request and the lender is notified immediately via
 * the initial lender SMS (see server/api/initiate-privileged.js). If the
 * lender doesn't act, this worker nudges them once at ~60 minutes:
 *
 *   "Sherbrt 🍧: Don't leave <FirstName> hanging! <$Earnings> is waiting
 *    for you! 🤑🤑🤑 Just tap to accept: <shortUrl>."
 *
 * Requests auto-expire (transition/expire) at min(
 *   firstEnteredPreauthorized + 6 days,
 *   bookingStart + 1 day,
 *   bookingEnd,
 * ), so the 60-minute window is always safely before auto-expire (minimum
 * floor is ≥ several hours in practice; we still re-check tx.state before
 * sending).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 60–80 MINUTE WINDOW LOGIC
 * ──────────────────────────────────────────────────────────────────────────
 * The Render cron runs every 15 minutes. A naive "age > 60 min" filter
 * would keep matching the same tx on every subsequent run. We instead pick
 * transactions whose age is in [60, 80) minutes:
 *
 *   - Lower bound 60m: don't nudge too early.
 *   - Upper bound 80m: 60m + one 15m cron tick + 5m of slack for long
 *     runs / cron jitter. Anything older than 80m has either already been
 *     reminded on a prior run, or is stale enough that we let it go.
 *
 * The window alone is not a correctness guarantee — it's a filter. The
 * real "send once" guarantee is the idempotency flag below.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCY CONTRACT (Redis-backed)
 * ──────────────────────────────────────────────────────────────────────────
 * We use a "flag-before-send" pattern backed by Redis to eliminate any
 * risk of double-texting a lender. Redis (not protectedData) because the
 * Integration SDK we run under doesn't expose transactions.update — and
 * Redis is already used throughout the codebase (shortlinks, tracking,
 * return reminders) for exactly this kind of ephemeral cross-run state.
 *
 * Keys per transaction:
 *
 *   lenderReminder:{txId}:sent     (TTL 7 days)  → SMS already sent
 *   lenderReminder:{txId}:inFlight (TTL 10 min)  → a run is mid-send now
 *
 * Send sequence for each eligible tx:
 *
 *   1. If :sent exists → skip.
 *   2. If :inFlight exists → skip (another run — or a recently crashed
 *      run — is/was mid-send; 10-min TTL auto-clears a true crash).
 *   3. SET :inFlight with 10-min TTL.
 *   4. Call sendSMS().
 *   5a. On success → SET :sent (7-day TTL), DEL :inFlight.
 *   5b. On failure → DEL :inFlight so next cron tick can retry if still
 *       in the 60–80m window.
 *
 * If step 5 itself fails after a successful send, the inFlight key stays
 * until its 10-min TTL expires — by which point the tx has aged past the
 * 80m upper bound of the send window and will no longer be picked up, so
 * the lender is NOT re-texted.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CRON SCHEDULING (Render/Heroku)
 * ──────────────────────────────────────────────────────────────────────────
 * Run every 15 minutes:
 *   *\/15 * * * * npm run worker:lender-request-reminders
 *
 * For local testing (no real SMS, no protectedData writes):
 *   npm run test:lender-request-reminders
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

const getFlexSdk = require('../util/getFlexSdk');
const { shortLink } = require('../api-util/shortlink');
const { saleUrl } = require('../util/url');
const { getRedis } = require('../redis');
const {
  calculateLenderPayoutTotal,
  formatMoneyServerSide,
} = require('../api-util/lenderEarnings');

// ---- CLI flags / env guards ----
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const getOpt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const DRY = has('--dry-run') || process.env.DRY_RUN === '1' || process.env.SMS_DRY_RUN === '1';
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const LIMIT = parseInt(getOpt('--limit', process.env.LIMIT || '0'), 10) || 0;
const ONLY_PHONE = process.env.ONLY_PHONE;

const MIN_AGE_MS = 60 * 60 * 1000; // 60 minutes
const MAX_AGE_MS = 80 * 60 * 1000; // 80 minutes (60 + one 15m cron tick + 5m slack)
const INFLIGHT_TTL_SEC = 10 * 60; // 10 minutes — longer than any one SMS send
const SENT_TTL_SEC = 7 * 24 * 60 * 60; // 7 days — comfortably outlasts 80m window

const redisKey = (txId, suffix) => `lenderReminder:${txId}:${suffix}`;

const REQUEST_TRANSITIONS = new Set([
  'transition/request-payment',
  'transition/request-payment-after-inquiry',
  // confirm-payment fires automatically (Stripe) within seconds of
  // request-payment, so by the 60-min mark the lastTransition is almost
  // always confirm-payment and the state is preauthorized.
  'transition/confirm-payment',
]);

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

/**
 * Redis-backed idempotency helpers. No-op writes in DRY mode.
 */
async function markInFlight(redis, txId) {
  if (DRY) {
    console.log(`[lender-request-reminder] DRY-RUN: Would SET ${redisKey(txId, 'inFlight')} (TTL ${INFLIGHT_TTL_SEC}s)`);
    return;
  }
  await redis.set(redisKey(txId, 'inFlight'), new Date().toISOString(), 'EX', INFLIGHT_TTL_SEC);
}

async function clearInFlight(redis, txId) {
  if (DRY) {
    console.log(`[lender-request-reminder] DRY-RUN: Would DEL ${redisKey(txId, 'inFlight')}`);
    return;
  }
  await redis.del(redisKey(txId, 'inFlight'));
}

async function markSent(redis, txId) {
  if (DRY) {
    console.log(`[lender-request-reminder] DRY-RUN: Would SET ${redisKey(txId, 'sent')} (TTL ${SENT_TTL_SEC}s)`);
    return;
  }
  await redis.set(redisKey(txId, 'sent'), new Date().toISOString(), 'EX', SENT_TTL_SEC);
  await redis.del(redisKey(txId, 'inFlight'));
}

async function sendLenderRequestReminders() {
  console.log('[lender-request-reminder] Starting lender request reminder SMS script...');

  try {
    const sdk = getFlexSdk();
    const redis = getRedis();

    const integrationClientId = process.env.INTEGRATION_CLIENT_ID || 'MISSING';
    const integrationBaseUrl =
      process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL ||
      process.env.SHARETRIBE_SDK_BASE_URL ||
      process.env.FLEX_INTEGRATION_API_BASE_URL ||
      'MISSING';

    console.log('[lender-request-reminder] Integration env summary', {
      hasClientId: !!integrationClientId && integrationClientId !== 'MISSING',
      integrationClientIdPrefix: integrationClientId !== 'MISSING' ? integrationClientId.slice(0, 6) : null,
      integrationBaseUrl,
    });

    console.log('[lender-request-reminder] SDK initialized');

    const query = {
      lastTransitions:
        'transition/request-payment,transition/request-payment-after-inquiry,transition/confirm-payment',
      include: ['listing', 'provider', 'customer'],
      'fields.listing': 'title',
      'fields.provider': 'profile',
      'fields.customer': 'profile',
      per_page: 100,
    };

    let transactions, included;
    try {
      const response = await sdk.transactions.query(query);
      transactions = response?.data?.data || [];
      included = new Map();
      for (const inc of response?.data?.included || []) {
        const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
        included.set(key, inc);
      }
    } catch (queryError) {
      const responseBody =
        queryError.response?.data ||
        (typeof queryError.toJSON === 'function' ? queryError.toJSON() : null) ||
        queryError;
      console.error('[lender-request-reminder] Flex query failed', {
        status: queryError.response?.status,
        statusText: queryError.response?.statusText,
        data: queryError.response?.data,
        headers: queryError.response?.headers && {
          'x-sharetribe-request-id': queryError.response.headers['x-sharetribe-request-id'],
        },
        message: queryError.message,
        code: queryError.code,
        fallbackBody: responseBody,
      });
      try {
        console.error('[lender-request-reminder] Raw error dump:', JSON.stringify(responseBody, null, 2));
      } catch {
        console.error('[lender-request-reminder] Raw error (non-serializable):', responseBody);
      }
      throw queryError;
    }

    console.log(`[lender-request-reminder] Found ${transactions.length} eligible transactions`);
    if (transactions.length > 0) {
      // Log first few transactions for debugging state/transition visibility
      for (const t of transactions.slice(0, 5)) {
        const a = t?.attributes || {};
        const ageMin = a.createdAt ? Math.round((Date.now() - new Date(a.createdAt).getTime()) / 60000) : '?';
        console.log(`[lender-request-reminder]   tx=${t?.id?.uuid} state=${a.state} last=${a.lastTransition} ageMin=${ageMin}`);
      }
      if (transactions.length > 5) console.log(`[lender-request-reminder]   ... and ${transactions.length - 5} more`);
    }

    const now = new Date();
    const nowMs = now.getTime();
    let sent = 0, skipped = 0, failed = 0, processed = 0;

    for (const tx of transactions) {
      processed++;

      const txId = tx?.id?.uuid || tx?.id;
      const attrs = tx?.attributes || {};
      const state = attrs.state;
      const lastTransition = attrs.lastTransition;
      const protectedData = attrs.protectedData || {};

      // Re-check state & transition (query is a starting point, not a lock).
      // pending-payment: Stripe hasn't confirmed yet (rare at 60m, but possible).
      // preauthorized: Stripe confirmed, lender hasn't acted yet (the common case).
      // Note: Integration SDK returns namespaced states (e.g. 'state/preauthorized')
      const normalizedState = state?.replace(/^state\//, '') || '';
      if ((normalizedState !== 'pending-payment' && normalizedState !== 'preauthorized') || !REQUEST_TRANSITIONS.has(lastTransition)) {
        if (VERBOSE) console.log(`[lender-request-reminder] Skipping tx ${txId} — state=${state} lastTransition=${lastTransition}`);
        skipped++;
        continue;
      }

      // Age window: [60m, 80m)
      const createdAt = attrs.createdAt ? new Date(attrs.createdAt).getTime() : null;
      if (!createdAt) {
        if (VERBOSE) console.log(`[lender-request-reminder] Skipping tx ${txId} — no createdAt`);
        skipped++;
        continue;
      }
      const ageMs = nowMs - createdAt;
      if (ageMs < MIN_AGE_MS || ageMs >= MAX_AGE_MS) {
        if (VERBOSE) console.log(`[lender-request-reminder] Skipping tx ${txId} — ageMin=${Math.round(ageMs / 60000)} out of window`);
        skipped++;
        continue;
      }

      // Idempotency: inspect Redis flags
      let sentFlag = null;
      let inFlightFlag = null;
      try {
        sentFlag = await redis.get(redisKey(txId, 'sent'));
        inFlightFlag = await redis.get(redisKey(txId, 'inFlight'));
      } catch (redisErr) {
        console.error(`[lender-request-reminder] Redis read failed for tx ${txId}, skipping to be safe:`, redisErr.message);
        skipped++;
        continue;
      }
      if (sentFlag) {
        if (VERBOSE) console.log(`[lender-request-reminder] Skipping tx ${txId} — already sent at ${sentFlag}`);
        skipped++;
        continue;
      }
      if (inFlightFlag) {
        if (VERBOSE) console.log(`[lender-request-reminder] Skipping tx ${txId} — inFlight since ${inFlightFlag}`);
        skipped++;
        continue;
      }

      // Resolve provider (lender) phone
      const providerRef = tx?.relationships?.provider?.data;
      const providerKey = providerRef ? `${providerRef.type}/${providerRef.id?.uuid || providerRef.id}` : null;
      const provider = providerKey ? included.get(providerKey) : null;
      const providerPhone =
        provider?.attributes?.profile?.protectedData?.phone ||
        provider?.attributes?.profile?.protectedData?.phoneNumber ||
        null;

      if (!providerPhone) {
        if (VERBOSE) console.log(`[lender-request-reminder] Skipping tx ${txId} — no provider phone`);
        skipped++;
        continue;
      }
      if (ONLY_PHONE && providerPhone !== ONLY_PHONE) {
        if (VERBOSE) console.log(`[lender-request-reminder] Skipping ${providerPhone} (ONLY_PHONE=${ONLY_PHONE})`);
        skipped++;
        continue;
      }

      // Borrower first name
      const customerRef = tx?.relationships?.customer?.data;
      const customerKey = customerRef ? `${customerRef.type}/${customerRef.id?.uuid || customerRef.id}` : null;
      const customer = customerKey ? included.get(customerKey) : null;
      let borrowerFirstName =
        customer?.attributes?.profile?.firstName ||
        customer?.attributes?.profile?.displayName?.split(/\s+/)[0] ||
        null;
      if (!borrowerFirstName) {
        const rawName = protectedData.customerName;
        if (typeof rawName === 'string' && rawName.trim()) {
          borrowerFirstName = rawName.trim().split(/\s+/)[0];
        }
      }
      if (!borrowerFirstName) borrowerFirstName = 'your borrower';

      // Lender payout from persisted line items
      const lineItems = attrs.lineItems || [];
      const payoutTotal = calculateLenderPayoutTotal(lineItems);
      const formattedPayout = payoutTotal ? formatMoneyServerSide(payoutTotal) : null;
      if (!formattedPayout) {
        if (VERBOSE) console.log(`[lender-request-reminder] Skipping tx ${txId} — could not compute lender payout from lineItems`);
        skipped++;
        continue;
      }

      // Short link to sale page (matches initial lender SMS)
      const fullSaleUrl = saleUrl(txId);
      let shortUrl = fullSaleUrl;
      try {
        shortUrl = await shortLink(fullSaleUrl);
      } catch (e) {
        console.warn(`[lender-request-reminder] shortLink failed for tx ${txId}, using full URL:`, e.message);
      }

      const message = `Sherbrt 🍧: Don't leave ${borrowerFirstName} hanging! ${formattedPayout} is waiting for you! 🤑🤑🤑 Just tap to accept: ${shortUrl}.`;

      const listingRef = tx?.relationships?.listing?.data;
      const listingId = listingRef?.id?.uuid || listingRef?.id || null;

      // Step 1: flag inFlight BEFORE sending (10-min TTL auto-clears on crash)
      try {
        await markInFlight(redis, txId);
      } catch (flagErr) {
        console.error(`[lender-request-reminder] Failed to write inFlight flag for tx ${txId}, skipping:`, flagErr.message);
        failed++;
        continue;
      }

      // Step 2: send
      let smsResult;
      try {
        smsResult = await sendSMS(providerPhone, message, {
          role: 'lender',
          tag: 'lender_request_reminder_60m',
          meta: { transactionId: txId, listingId },
        });
      } catch (smsErr) {
        console.error(`[lender-request-reminder] SMS failed for tx ${txId}:`, smsErr?.message || smsErr);
        // Rollback: clear inFlight so next cron tick can retry (if still in window)
        try {
          await clearInFlight(redis, txId);
        } catch (rollbackErr) {
          console.error(`[lender-request-reminder] Rollback DEL failed for tx ${txId}:`, rollbackErr.message);
        }
        failed++;
        continue;
      }

      if (smsResult?.skipped) {
        // sendSMS decided not to send (e.g. suppression). Clear inFlight without marking sent.
        console.log(`[lender-request-reminder] SMS skipped by sendSMS (${smsResult.reason}) for tx ${txId}`);
        try {
          await clearInFlight(redis, txId);
        } catch (e) {
          console.error(`[lender-request-reminder] Failed to clear inFlight after sendSMS skip:`, e.message);
        }
        skipped++;
        continue;
      }

      // Step 3: mark sent. If this write fails, inFlight stays set until its
      // 10-min TTL expires — by then the tx has aged past the 80m window and
      // won't be picked up again. No double-text.
      try {
        await markSent(redis, txId);
        sent++;
        console.log(`[lender-request-reminder] Sent reminder for tx ${txId}`);
      } catch (postWriteErr) {
        console.error(`[lender-request-reminder] SMS sent but Redis SET :sent failed for tx ${txId} — inFlight will TTL-expire after 80m window:`, postWriteErr.message);
        sent++;
      }

      if (LIMIT && sent >= LIMIT) {
        console.log(`[lender-request-reminder] Limit reached (${LIMIT}). Stopping.`);
        break;
      }
    }

    console.log(`\n[lender-request-reminder] Done. Sent=${sent} Skipped=${skipped} Failed=${failed} Processed=${processed}`);
    if (DRY) {
      console.log('[lender-request-reminder] DRY-RUN mode: no real SMS were sent and no Redis keys were written.');
    }
  } catch (err) {
    console.error('[lender-request-reminder] Fatal:', {
      status: err.response && err.response.status,
      data: err.response && err.response.data,
      message: err.message,
      code: err.code,
    });
    process.exit(1);
  }
}

if (require.main === module) {
  sendLenderRequestReminders()
    .then(() => {
      console.log('[lender-request-reminder] Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[lender-request-reminder] Script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { sendLenderRequestReminders };

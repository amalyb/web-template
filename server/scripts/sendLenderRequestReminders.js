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
 * IDEMPOTENCY CONTRACT (protectedData.lenderRequestReminder)
 * ──────────────────────────────────────────────────────────────────────────
 * We use a "flag-before-send with rollback" pattern to eliminate any
 * risk of double-texting a lender, at the (accepted) cost of very rarely
 * missing a reminder if a process crashes at exactly the wrong moment.
 *
 * States of protectedData.lenderRequestReminder:
 *
 *   (unset)          → never attempted. Eligible to send.
 *   { inFlight, attemptedAt }
 *                    → another run (or this one) is mid-send.
 *                      - If attemptedAt is within the last 10 minutes,
 *                        skip (a concurrent run may be sending now).
 *                      - If attemptedAt is older than 10 minutes, we
 *                        assume the prior run sent the SMS but crashed
 *                        before writing sentAt. Treat as SENT. Skip.
 *                        (We'd rather miss a reminder than double-text.)
 *   { sentAt }       → already reminded. Skip forever.
 *   { failedAt, error, inFlight:false }
 *                    → prior send threw. Eligible to retry if still in
 *                      the 60–80m window.
 *
 * Send sequence for each eligible tx:
 *
 *   1. Write { inFlight:true, attemptedAt: now }.
 *   2. Call sendSMS().
 *   3a. On success → write { sentAt: now } (clears inFlight).
 *   3b. On failure → write { inFlight:false, failedAt: now, error }.
 *       Next cron tick will retry if tx is still inside the window.
 *
 * If step 3 itself fails after a successful send, the inFlight flag
 * stays set. On the next run, the >10-minute staleness rule above
 * treats it as sent, so the lender is NOT re-texted.
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
const INFLIGHT_STALE_MS = 10 * 60 * 1000; // 10 minutes

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
 * Write protectedData.lenderRequestReminder for a tx.
 * No-op in DRY mode.
 */
async function writeReminderFlag(sdk, tx, protectedData, patch) {
  if (DRY) {
    console.log('[lender-request-reminder] DRY-RUN: Would write lenderRequestReminder:', patch);
    return;
  }
  await sdk.transactions.update({
    id: tx.id,
    attributes: {
      protectedData: {
        ...protectedData,
        lenderRequestReminder: patch,
      },
    },
  });
}

async function sendLenderRequestReminders() {
  console.log('[lender-request-reminder] Starting lender request reminder SMS script...');

  try {
    const sdk = getFlexSdk();

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
      if ((state !== 'pending-payment' && state !== 'preauthorized') || !REQUEST_TRANSITIONS.has(lastTransition)) {
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

      // Idempotency: inspect existing flag
      const flag = protectedData.lenderRequestReminder || null;
      if (flag?.sentAt) {
        if (VERBOSE) console.log(`[lender-request-reminder] Skipping tx ${txId} — already sent at ${flag.sentAt}`);
        skipped++;
        continue;
      }
      if (flag?.inFlight) {
        const attemptedAtMs = flag.attemptedAt ? new Date(flag.attemptedAt).getTime() : 0;
        const inFlightAge = nowMs - attemptedAtMs;
        if (inFlightAge < INFLIGHT_STALE_MS) {
          if (VERBOSE) console.log(`[lender-request-reminder] Skipping tx ${txId} — inFlight (fresh, ${Math.round(inFlightAge / 1000)}s)`);
          skipped++;
          continue;
        }
        // Stale inFlight: treat as sent (rare-no-text > any-double-text)
        console.log(`[lender-request-reminder] Skipping tx ${txId} — stale inFlight (${Math.round(inFlightAge / 60000)}m old), treating as sent`);
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
      const attemptedAtIso = new Date().toISOString();

      // Step 1: flag inFlight BEFORE sending
      try {
        await writeReminderFlag(sdk, tx, protectedData, {
          inFlight: true,
          attemptedAt: attemptedAtIso,
        });
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
          await writeReminderFlag(sdk, tx, protectedData, {
            inFlight: false,
            failedAt: new Date().toISOString(),
            error: String(smsErr?.message || smsErr).slice(0, 500),
          });
        } catch (rollbackErr) {
          console.error(`[lender-request-reminder] Rollback write failed for tx ${txId}:`, rollbackErr.message);
        }
        failed++;
        continue;
      }

      if (smsResult?.skipped) {
        // sendSMS decided not to send (e.g. suppression). Clear inFlight without marking sent.
        console.log(`[lender-request-reminder] SMS skipped by sendSMS (${smsResult.reason}) for tx ${txId}`);
        try {
          await writeReminderFlag(sdk, tx, protectedData, {
            inFlight: false,
            skippedAt: new Date().toISOString(),
            reason: smsResult.reason || 'unknown',
          });
        } catch (e) {
          console.error(`[lender-request-reminder] Failed to clear inFlight after sendSMS skip:`, e.message);
        }
        skipped++;
        continue;
      }

      // Step 3: mark sent. If this write fails, inFlight stays set → next
      // run's staleness check (>10m) will treat it as sent. No double-text.
      try {
        await writeReminderFlag(sdk, tx, protectedData, {
          sentAt: new Date().toISOString(),
        });
        sent++;
        console.log(`[lender-request-reminder] Sent reminder for tx ${txId}`);
      } catch (postWriteErr) {
        console.error(`[lender-request-reminder] SMS sent but post-write failed for tx ${txId} — inFlight will stale-expire as sent:`, postWriteErr.message);
        sent++;
      }

      if (LIMIT && sent >= LIMIT) {
        console.log(`[lender-request-reminder] Limit reached (${LIMIT}). Stopping.`);
        break;
      }
    }

    console.log(`\n[lender-request-reminder] Done. Sent=${sent} Skipped=${skipped} Failed=${failed} Processed=${processed}`);
    if (DRY) {
      console.log('[lender-request-reminder] DRY-RUN mode: no real SMS were sent and no protectedData was updated.');
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

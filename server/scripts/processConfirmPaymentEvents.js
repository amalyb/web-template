#!/usr/bin/env node
/**
 * Confirm-Payment Events Poller
 *
 * Polls the Sharetribe Integration API events stream for
 * `transaction/transitioned` events whose resource has
 * `lastTransition === 'transition/confirm-payment'`, then dispatches the
 * lender booking-request SMS. Replaces the in-handler dispatch we used to
 * run from initiate-privileged.js — that fired on request-payment
 * (pending-payment) and spammed lenders for abandoned PaymentSheet
 * sessions that died at the 15-min payment-expired timeout.
 *
 * WHY POLLING. Sharetribe Flex doesn't expose webhooks; polling the
 * Integration API events endpoint is the established pattern in this repo
 * (mirrors sendShippingReminders.js / sendLenderRequestReminders.js /
 * sendAutoCancelUnshipped.js). Both web and mobile clients fire
 * transition/confirm-payment via sdk.transactions.transition directly
 * (not through /api/transition-privileged), so the server endpoint never
 * sees the transition.
 *
 * CRON. Every 2 minutes (`*\/2 * * * *`) with a 5-minute lookback window.
 * The 3-minute overlap is intentional: late events still get picked up if
 * a tick is delayed or skipped, and the helper's Redis dedup
 * (`lenderBookingSms:{txId}:sent`, 7d TTL) prevents duplicate SMS from
 * the overlap.
 *
 * LATENCY. Borrower confirms payment → up to ~2 min until lender SMS.
 * Acceptable for booking flow (lender has a 24h window to accept).
 */
require('dotenv').config();

const getFlexSdk = require('../util/getFlexSdk');
const { sendLenderBookingRequestSMS } = require('../api-util/lender-booking-sms');

const argv = process.argv.slice(2);
const has = flag => argv.includes(flag);
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const DRY = has('--dry-run') || process.env.DRY_RUN === '1';

const LOOKBACK_MS = 5 * 60 * 1000;
const TARGET_TRANSITION = 'transition/confirm-payment';

async function processConfirmPaymentEvents({ sdk } = {}) {
  const flexSdk = sdk || getFlexSdk();

  const now = new Date();
  const createdAtStart = new Date(now.getTime() - LOOKBACK_MS).toISOString();

  console.log('[confirm-payment-events] Querying events stream', {
    eventTypes: 'transaction/transitioned',
    createdAtStart,
    lookbackMs: LOOKBACK_MS,
    dryRun: DRY,
  });

  let events;
  try {
    const resp = await flexSdk.events.query({
      eventTypes: 'transaction/transitioned',
      createdAtStart,
    });
    events = resp?.data?.data || [];
  } catch (queryErr) {
    console.error('[confirm-payment-events] events.query failed', {
      status: queryErr.response && queryErr.response.status,
      message: queryErr.message,
    });
    throw queryErr;
  }

  const matching = events.filter(
    ev => ev?.attributes?.resource?.attributes?.lastTransition === TARGET_TRANSITION
  );

  console.log('[confirm-payment-events] Event summary', {
    fetched: events.length,
    matched: matching.length,
    target: TARGET_TRANSITION,
  });

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const ev of matching) {
    const txId = ev?.attributes?.resource?.id?.uuid || ev?.attributes?.resource?.id;
    if (!txId) {
      if (VERBOSE) {
        console.warn('[confirm-payment-events] Event missing resource id; skipping', { eventId: ev?.id });
      }
      continue;
    }

    attempted++;

    try {
      const showResp = await flexSdk.transactions.show({
        id: txId,
        include: ['listing', 'customer', 'provider'],
      });
      const tx = showResp?.data?.data;
      const included = showResp?.data?.included || [];
      const listing = included.find(r => r.type === 'listing') || null;
      const lineItems = tx?.attributes?.lineItems || null;

      if (!tx) {
        console.warn('[confirm-payment-events] Transaction not found; skipping', { txId });
        failed++;
        continue;
      }

      if (DRY) {
        console.log('[confirm-payment-events] DRY-RUN: would dispatch lender SMS', {
          txId,
          listingId: listing?.id?.uuid || listing?.id,
        });
        continue;
      }

      await sendLenderBookingRequestSMS({ tx, listing, lineItems, sdk: flexSdk });
      succeeded++;
    } catch (err) {
      failed++;
      console.error('[confirm-payment-events] Per-event failure (isolated)', {
        txId,
        eventId: ev?.id?.uuid || ev?.id,
        message: err.message,
      });
    }
  }

  console.log('[confirm-payment-events] Run complete', {
    fetched: events.length,
    matched: matching.length,
    attempted,
    succeeded,
    failed,
  });

  return { fetched: events.length, matched: matching.length, attempted, succeeded, failed };
}

if (require.main === module) {
  processConfirmPaymentEvents()
    .then(() => {
      console.log('[confirm-payment-events] Script completed successfully');
      process.exit(0);
    })
    .catch(err => {
      console.error('[confirm-payment-events] Fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { processConfirmPaymentEvents };

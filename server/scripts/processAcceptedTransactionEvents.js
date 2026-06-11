#!/usr/bin/env node
/**
 * Accepted-Transaction Events Poller
 * -----------------------------------------------------------------------------
 * Polls the Sharetribe Integration API events stream for
 * `transaction/transitioned` events whose resource has
 * `lastTransition === 'transition/accept'` — i.e. a lender accepted a
 * borrow request — and emails the operator (you) a summary. This is the
 * "new transaction" notification you wanted (replaces a Zapier zap you
 * hadn't built yet because it has never fired).
 *
 * WHY POLLING. Same as the rest of the repo: Sharetribe has no webhooks, so
 * we poll events.query. This mirrors processConfirmPaymentEvents.js exactly,
 * just with a different target transition and an email instead of an SMS.
 *
 * NOTE. `transition/accept` is the lender-initiated accept in your
 * default-booking process (confirmed in
 * ext/transaction-processes/default-booking/process.edn). If you also want
 * operator-initiated accepts, add 'transition/operator-accept' to
 * ACCEPT_TRANSITIONS.
 *
 * CRON. Recommended every 2 min with a 5-min lookback (matches confirm-payment).
 * Per-transaction Redis dedup (`operatorAlert:accept:<txId>`) suppresses
 * duplicates from window overlap.
 */
require('dotenv').config();

const getFlexSdk = require('../util/getFlexSdk');
const { sendOperatorAlert } = require('../api-util/operatorAlertEmail');

const argv = process.argv.slice(2);
const has = flag => argv.includes(flag);
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const DRY = has('--dry-run') || process.env.DRY_RUN === '1';

const LOOKBACK_MS = Number(process.env.ACCEPT_LOOKBACK_MS || 5 * 60 * 1000);
const ACCEPT_TRANSITIONS = (process.env.ACCEPT_TRANSITIONS || 'transition/accept')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function buildAcceptEmail({ tx, listing, customer, provider }) {
  const txId = tx?.id?.uuid || tx?.id || '(unknown)';
  const listingTitle = listing?.attributes?.title || '(unknown listing)';

  const nameOf = u => {
    const p = u?.attributes?.profile || {};
    return p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') || '(unknown)';
  };
  const borrowerName = nameOf(customer);
  const lenderName = nameOf(provider);

  const booking = tx?.attributes?.protectedData?.bookingDates || null;
  const payinTotal = tx?.attributes?.payinTotal
    ? `${tx.attributes.payinTotal.amount / 100} ${tx.attributes.payinTotal.currency}`
    : '(n/a)';

  const consoleUrl = `https://console.sharetribe.com/o/transactions/${txId}`;

  const text = [
    `A lender accepted a borrow request 🎉`,
    ``,
    `Listing:  ${listingTitle}`,
    `Lender:   ${lenderName}`,
    `Borrower: ${borrowerName}`,
    `Total:    ${payinTotal}`,
    booking ? `Dates:    ${JSON.stringify(booking)}` : null,
    `Tx ID:    ${txId}`,
    ``,
    `View in Console: ${consoleUrl}`,
  ].filter(l => l !== null).join('\n');

  return { subject: `✅ Booking accepted — ${listingTitle}`, text };
}

async function processAcceptedTransactionEvents({ sdk } = {}) {
  const flexSdk = sdk || getFlexSdk();
  const createdAtStart = new Date(Date.now() - LOOKBACK_MS).toISOString();

  console.log('[accept-events] Querying events stream', {
    eventTypes: 'transaction/transitioned',
    acceptTransitions: ACCEPT_TRANSITIONS,
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
  } catch (err) {
    console.error('[accept-events] events.query failed', {
      status: err.response && err.response.status,
      message: err.message,
    });
    throw err;
  }

  const matching = events.filter(ev =>
    ACCEPT_TRANSITIONS.includes(ev?.attributes?.resource?.attributes?.lastTransition)
  );
  console.log('[accept-events] Event summary', {
    fetched: events.length,
    matched: matching.length,
    targets: ACCEPT_TRANSITIONS,
  });

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const ev of matching) {
    const txId = ev?.attributes?.resource?.id?.uuid || ev?.attributes?.resource?.id;
    if (!txId) {
      if (VERBOSE) console.warn('[accept-events] event missing tx id; skipping', ev?.id);
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
      // customer/provider are users; disambiguate by relationship id.
      const customerId = tx?.relationships?.customer?.data?.id?.uuid;
      const providerId = tx?.relationships?.provider?.data?.id?.uuid;
      const users = included.filter(r => r.type === 'user');
      const customer = users.find(u => (u.id?.uuid || u.id) === customerId) || null;
      const provider = users.find(u => (u.id?.uuid || u.id) === providerId) || null;

      if (!tx) {
        console.warn('[accept-events] transaction not found; skipping', { txId });
        failed++;
        continue;
      }

      const { subject, text } = buildAcceptEmail({ tx, listing, customer, provider });
      const res = await sendOperatorAlert({
        subject,
        text,
        dedupKey: `operatorAlert:accept:${txId}`,
        dryRun: DRY,
      });
      if (res.sent) succeeded++;
      else skipped++;
    } catch (err) {
      failed++;
      console.error('[accept-events] per-event failure (isolated)', { txId, message: err.message });
    }
  }

  console.log('[accept-events] Run complete', {
    fetched: events.length,
    matched: matching.length,
    attempted,
    succeeded,
    skipped,
    failed,
  });
  return { fetched: events.length, matched: matching.length, attempted, succeeded, skipped, failed };
}

if (require.main === module) {
  processAcceptedTransactionEvents()
    .then(() => {
      console.log('[accept-events] Script completed successfully');
      process.exit(0);
    })
    .catch(err => {
      console.error('[accept-events] Fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { processAcceptedTransactionEvents };

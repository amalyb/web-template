// server/scripts/sendAutoCancelUnshipped.js
//
// Cron daemon that fires transition/auto-cancel-unshipped for accepted
// bookings whose ship-by deadline has passed with no outbound carrier scan.
//
// Policy (per product decisions, Apr 2026):
//   - Deadline = 11:59pm lender-local on booking start date (D)
//   - Monday-start bookings get 24h grace → deadline shifts to end of Tue
//   - Full refund (rental + commission + shipping) via process.edn actions
//   - Void outbound + return Shippo labels to reclaim label costs
//   - Send 3.2-SMS to borrower, 3.2b-SMS to lender
//   - Idempotent via protectedData.autoCancel.sent flag
//   - Hourly cadence
//
// ⚠️  REQUIRES: transition/auto-cancel-unshipped to exist in the live
// ⚠️  Sharetribe process. That means:
// ⚠️    1. process.edn committed ✅ (done)
// ⚠️    2. flex-cli process push --process=default-booking \
// ⚠️       --path=ext/transaction-processes/default-booking
// ⚠️    3. Flip release alias in Sharetribe Console to the new version
// ⚠️  Without steps 2+3, the transition call will error with "unknown transition".

const moment = require('moment-timezone');
const getFlexSdk = require('../util/getFlexSdk');
const { upsertProtectedData, hasOutboundScan } = require('../lib/txData');
const { voidShippoLabel } = require('../lib/shippo');
let { sendSMS } = require('../api-util/sendSMS');
const { calculateLenderPayoutTotal, formatMoneyServerSide } = require('../api-util/lenderEarnings');

const TX_PROCESS = 'default-booking';
const TRANSITION = 'transition/auto-cancel-unshipped';
const DRY_RUN = process.env.AUTO_CANCEL_DRY_RUN === '1' || process.env.AUTO_CANCEL_DRY_RUN === 'true';
const DEFAULT_LENDER_TZ = 'America/Los_Angeles';
const SCAN_LAG_GRACE_HOURS = 12;

// ============================================================
// SDK
// ============================================================
//
// Unified on the Integration SDK (via getFlexSdk()) so both the listing/booking
// query AND the operator-actor transition use the same auth path as every
// other cron in this project (sendShippingReminders, sendReturnReminders,
// sendOverdueReminders, etc.). Requires:
//   - INTEGRATION_CLIENT_ID
//   - INTEGRATION_CLIENT_SECRET
// in the cron's env vars. No exchangeToken() call, so no marketplace user-app
// credential coupling.

// ============================================================
// TIME HELPERS
// ============================================================

/**
 * Returns the cancel deadline as a moment in lender-local time.
 *
 * Base rule: 11:59pm lender-local on booking start date (D).
 * Monday grace: If D falls on a Monday, shift to 11:59pm Tuesday (D+1).
 */
function getCancelDeadline(bookingStartUtc, lenderTz) {
  const tz = lenderTz || DEFAULT_LENDER_TZ;
  const bookingStartDate = moment.utc(bookingStartUtc).format('YYYY-MM-DD');
  // End-of-day = 23:59:59 (not 23:59:00) so the "11:59pm" intent is honored
  // to the second rather than being 59s early.
  let deadline = moment.tz(`${bookingStartDate} 23:59:59`, 'YYYY-MM-DD HH:mm:ss', tz);
  if (deadline.day() === 1 /* Monday */) {
    deadline = deadline.add(1, 'day');
  }
  return deadline;
}

function isPastCancelDeadline(now, bookingStartUtc, lenderTz) {
  const deadline = getCancelDeadline(bookingStartUtc, lenderTz);
  return moment(now).isSameOrAfter(deadline);
}

// ============================================================
// INCLUDED LOOKUP
// ============================================================

// Resolve an included resource given a relationship ref. Handles both
// shapes, so this is safe even if we ever switch SDKs again:
//  - marketplace SDK: `included` is a Map keyed "type/id"
//  - integration SDK: `included` is an Array of resources
function findIncluded(included, ref) {
  if (!ref || !included) return null;
  const data = ref.data || ref;
  if (!data) return null;
  const type = data.type;
  const id = data.id?.uuid || data.id;
  if (!type || !id) return null;

  if (typeof included.get === 'function') {
    return included.get(`${type}/${id}`) || null;
  }
  if (Array.isArray(included)) {
    return included.find(x => x.type === type && (x.id?.uuid === id || x.id === id)) || null;
  }
  return null;
}

// ============================================================
// CORE LOGIC
// ============================================================

async function fetchAcceptedBookings(sdk) {
  // NOTE: we deliberately do NOT pass `fields.listing` here. `availabilityPlan`
  // is not part of the Sharetribe sparse-field whitelist for listings, so
  // including it in `fields.listing` causes it to be silently dropped — which
  // then makes our lender-timezone lookup fall back to PT for every lender
  // (incorrect for anyone outside PT). Fetching the full listing resource is
  // the safe default. `fields.provider`/`fields.customer` are fine because we
  // only read `profile` off those, which is whitelisted.
  const res = await sdk.transactions.query({
    state: 'accepted',
    include: ['booking', 'listing', 'provider', 'customer'],
    'fields.provider': 'profile',
    'fields.customer': 'profile',
    per_page: 100,
  });
  return {
    txs: res.data.data,
    included: res.data.included,
  };
}

async function processTransaction(tx, included, now, sdk) {
  const txId = tx.id?.uuid || tx.id;
  const logPrefix = `[auto-cancel-unshipped][${txId}]`;

  // Idempotency
  if (tx.attributes?.protectedData?.autoCancel?.sent) {
    console.log(`${logPrefix} already auto-canceled, skipping`);
    return;
  }

  // Process-version gate: transition/auto-cancel-unshipped was introduced in
  // default-booking v3 (April 14, 2026). Transactions on v1 or v2 can't accept
  // this transition — firing it would return "unknown transition". v1 txs
  // also have diverged booking/tx state (e.g., operator-declined booking
  // while tx stays in accepted) because v1's state machine has no
  // cancel-from-accepted path.
  //
  // 10.0 PR-4 fix: was `processVersion !== 3` (hard equality), which silently
  // skipped every v5 transaction after the expire-tightening alias flip.
  // Changed to `< 3` so v3, v4, v5, and any future bump all pass the gate
  // while still excluding v1/v2.
  const processName = tx.attributes?.processName;
  const processVersion = tx.attributes?.processVersion;
  if (processName !== TX_PROCESS || processVersion < 3) {
    console.log(
      `${logPrefix} not on ${TX_PROCESS} v3+ (process=${processName} v${processVersion}), skipping`
    );
    return;
  }

  const pd = tx.attributes?.protectedData || {};

  // Resolve included resources
  const booking = findIncluded(included, tx.relationships?.booking);
  const listing = findIncluded(included, tx.relationships?.listing);
  const customer = findIncluded(included, tx.relationships?.customer);
  const provider = findIncluded(included, tx.relationships?.provider);

  // Booking-status gate: Sharetribe's booking.status is independent of
  // transaction state. Operator-decline in Console on v1 txs marks the booking
  // "declined" but leaves the tx state at accepted. Respect the booking-level
  // signal so we never re-cancel an already-declined booking.
  const bookingStatus = booking?.attributes?.state || booking?.attributes?.status;
  if (bookingStatus && bookingStatus !== 'accepted' && bookingStatus !== 'proposed') {
    console.log(`${logPrefix} booking.status=${bookingStatus} — not active, skipping`);
    return;
  }

  // Lender timezone from listing availability plan (set at listing creation),
  // fall back to PT.
  const lenderTz =
    listing?.attributes?.availabilityPlan?.timezone ||
    DEFAULT_LENDER_TZ;

  // Booking start: Sharetribe stores day-bookings as UTC-midnight on the
  // `start` attribute of the included booking resource.
  const bookingStart =
    booking?.attributes?.start ||
    booking?.attributes?.displayStart ||
    null;

  if (!bookingStart) {
    console.warn(`${logPrefix} no bookingStart on included booking, skipping`);
    return;
  }

  if (!isPastCancelDeadline(now, bookingStart, lenderTz)) {
    const deadline = getCancelDeadline(bookingStart, lenderTz);
    console.log(`${logPrefix} not past deadline (${deadline.format()}, tz=${lenderTz}), skipping`);
    return;
  }

  // Safety bound: don't auto-cancel txs whose deadline is more than 7 days in
  // the past. Flag for operator review instead.
  const deadline = getCancelDeadline(bookingStart, lenderTz);
  if (moment(now).diff(deadline, 'days') > 7) {
    console.warn(`${logPrefix} deadline >7d in the past — needs operator review, skipping`);
    return;
  }

  // Scan-lag grace: don't cancel within the first 12 hours past deadline.
  // Carriers (especially USPS) can take 4-12 hours to register a scan, so a
  // lender drop at 11:50pm lender-local on D may not show a scan until 6-8am
  // D+1. Structurally parallel to overdue's daysLate <= 1 guard (lateFees.js:294).
  const hoursPastDeadline = moment(now).diff(deadline, 'hours', true);
  if (hoursPastDeadline < SCAN_LAG_GRACE_HOURS) {
    console.log(`${logPrefix} SKIP reason=scan-lag-grace hoursPastDeadline=${hoursPastDeadline.toFixed(1)}`);
    return;
  }

  // Skip if package already in motion
  if (hasOutboundScan(tx)) {
    console.log(`${logPrefix} outbound scan present — package in motion, skipping`);
    return;
  }

  // ---- All gates passed. Cancel. ----
  console.log(`${logPrefix} firing ${TRANSITION} (dry=${DRY_RUN})`);

  if (DRY_RUN) {
    console.log(`${logPrefix} DRY RUN — would cancel + refund + void labels + SMS`);
    return;
  }

  // 1) Fire transition via Integration SDK (operator transition).
  //    Full refund happens via process.edn actions.
  await sdk.transactions.transition({
    id: txId,
    transition: TRANSITION,
    params: {},
  });

  // 2) Void Shippo labels (best-effort — don't block on failure).
  const outboundTx = pd.outboundTransactionId || pd.outbound?.transactionId;
  const returnTx = pd.returnTransactionId || pd.return?.transactionId;
  for (const shippoTxId of [outboundTx, returnTx].filter(Boolean)) {
    try {
      await voidShippoLabel(shippoTxId);
      console.log(`${logPrefix} voided Shippo tx ${shippoTxId}`);
    } catch (e) {
      console.warn(`${logPrefix} failed to void Shippo tx ${shippoTxId}:`, e.message);
    }
  }

  // 3) Send 3.2 + 3.2b SMS
  try {
    await sendCancelSMSes(tx, { listing, customer, provider });
  } catch (e) {
    console.warn(`${logPrefix} SMS dispatch failed:`, e.message);
  }

  // 4) Idempotency marker
  await upsertProtectedData(txId, {
    autoCancel: {
      sent: true,
      sentAt: new Date().toISOString(),
      reason: 'unshipped',
    },
  }, { source: 'auto-cancel-unshipped' });

  console.log(`${logPrefix} ✅ complete`);
}

async function sendCancelSMSes(tx, { listing, customer, provider }) {
  const pd = tx.attributes?.protectedData || {};
  const txId = tx.id?.uuid || tx.id;
  const itemTitle = listing?.attributes?.title || 'your item';

  const borrowerPhone =
    customer?.attributes?.profile?.protectedData?.phone ||
    customer?.attributes?.profile?.protectedData?.phoneNumber ||
    pd.customerPhone;
  const lenderPhone =
    provider?.attributes?.profile?.protectedData?.phone ||
    provider?.attributes?.profile?.protectedData?.phoneNumber ||
    pd.providerPhone;

  if (borrowerPhone) {
    const msg = `🚫 Sherbrt 🍧: Your borrow request for "${truncate(itemTitle, 40)}" was auto-canceled because the lender didn't ship in time. Full refund will hit your card in 5–10 business days. Browse other looks: https://sherbrt.com/s`;
    await sendSMS(borrowerPhone, msg, {
      role: 'borrower',
      tag: 'auto_cancel_to_borrower',
      transactionId: txId,
      transition: TRANSITION,
      meta: { txId, listingId: listing?.id?.uuid || listing?.id },
    });
  }

  if (lenderPhone) {
    const listingId = listing?.id?.uuid || listing?.id;
    // 3.2b copy update (April 28 2026):
    //   - Static ManageListingsPage URL (https://sherbrt.com/listings) so
    //     lenders land on their availability/edit dashboard, not a single
    //     listing relist link.
    //   - Earnings amount uses the same helper as 1-SMS / 1a-SMS / 1b-SMS so
    //     the four lender-side messages can never drift on the figure shown.
    const lineItems = tx?.attributes?.lineItems || [];
    const payoutTotal = calculateLenderPayoutTotal(lineItems);
    const formattedPayout = payoutTotal ? formatMoneyServerSide(payoutTotal) : null;
    const earningsClause = formattedPayout
      ? `You missed out on ${formattedPayout}.`
      : `You missed out on those earnings.`;
    const msg = `⚠️ Sherbrt 🍧: Your listing "${truncate(itemTitle, 40)}" was auto-canceled because it wasn't shipped in time. ${earningsClause} Update your listing availability for future requests: https://sherbrt.com/listings`;
    await sendSMS(lenderPhone, msg, {
      role: 'lender',
      tag: 'auto_cancel_to_lender',
      transactionId: txId,
      transition: TRANSITION,
      meta: { txId, listingId },
    });
  }
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ============================================================
// DAEMON LOOP
// ============================================================

async function runOnce() {
  const now = moment.utc().toDate();
  console.log(`[auto-cancel-unshipped] run @ ${now.toISOString()} dry=${DRY_RUN}`);

  try {
    const sdk = getFlexSdk();
    const { txs, included } = await fetchAcceptedBookings(sdk);
    console.log(`[auto-cancel-unshipped] ${txs.length} accepted tx(s)`);

    for (const tx of txs) {
      try {
        await processTransaction(tx, included, now, sdk);
      } catch (err) {
        console.error(`[auto-cancel-unshipped] tx ${tx.id?.uuid || tx.id} failed:`, err);
      }
    }
  } catch (err) {
    console.error('[auto-cancel-unshipped] run failed:', err);
  }
}

async function runDaemon() {
  const intervalMs = Number(process.env.AUTO_CANCEL_INTERVAL_MS || 60 * 60 * 1000);
  console.log(`[auto-cancel-unshipped] daemon starting, interval=${intervalMs}ms, dry=${DRY_RUN}`);
  await runOnce();
  setInterval(runOnce, intervalMs);
}

if (require.main === module) {
  if (process.argv.includes('--once')) {
    runOnce().then(() => process.exit(0));
  } else if (process.argv.includes('--daemon')) {
    runDaemon();
  } else {
    console.log('Usage: node server/scripts/sendAutoCancelUnshipped.js [--once|--daemon]');
    process.exit(1);
  }
}

module.exports = {
  runOnce,
  processTransaction,
  isPastCancelDeadline,
  getCancelDeadline,
  findIncluded,
  SCAN_LAG_GRACE_HOURS,
};

// ============================================================
// BEFORE ENABLING IN PROD
// ============================================================
// [ ] 1. process.edn pushed to Sharetribe via flex-cli and alias flipped
// [x] 2. voidShippoLabel() helper (server/lib/shippo.js) — implemented
// [x] 3. Lender timezone: uses listing.attributes.availabilityPlan.timezone
// [x] 4. SDK unified on Integration SDK via getFlexSdk() to match every other
//        cron (sendShippingReminders, sendReturnReminders, sendOverdueReminders)
// [x] 5. sendSMS called with positional signature (to, message, opts)
// [x] 6. bookingStart read from included booking resource, not tx.booking
// [ ] 7. Test with AUTO_CANCEL_DRY_RUN=1 for at least a week before
//        enabling live cancels
// [x] 8. render.yaml worker entry — added with AUTO_CANCEL_DRY_RUN=1

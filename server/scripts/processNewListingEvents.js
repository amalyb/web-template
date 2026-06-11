#!/usr/bin/env node
/**
 * New-Listing (awaiting review) Events Poller
 * -----------------------------------------------------------------------------
 * Polls the Sharetribe Integration API events stream for `listing/created`
 * and `listing/updated` events and emails the operator (you) ONLY when a
 * listing enters the `pendingApproval` state — i.e. it's submitted and waiting
 * for your manual review before going live. This fixes the Zapier "catch-all"
 * problem where you got an email on every edit (e.g. a saved photo).
 *
 * HOW WE AVOID THE NOISE.
 *   • listing/created with state === 'pendingApproval'  → new submission → email
 *   • listing/updated where the NEW state === 'pendingApproval' AND
 *     previousValues shows the state actually changed into it → email
 *   • Any update where state is already pendingApproval but didn't change
 *     (a photo edit, etc.) → previousValues.attributes.state is absent → skip
 * Per-listing Redis dedup (`operatorAlert:listingPending:<listingId>`) is the
 * final backstop against cron-overlap duplicates.
 *
 * NOTE ON LISTING APPROVAL. This assumes Sharetribe's listing-approval feature
 * is ON (Console → ... → Listings → require approval), so new listings land in
 * pendingApproval. If you ever turn approval OFF, listings publish immediately;
 * set LISTING_TRIGGER_STATE=published to alert on go-live instead.
 *
 * CRON. Recommended every 5 min with a 10-min lookback.
 */
require('dotenv').config();

const getFlexSdk = require('../util/getFlexSdk');
const { sendOperatorAlert } = require('../api-util/operatorAlertEmail');

const argv = process.argv.slice(2);
const has = flag => argv.includes(flag);
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const DRY = has('--dry-run') || process.env.DRY_RUN === '1';

const LOOKBACK_MS = Number(process.env.LISTING_LOOKBACK_MS || 10 * 60 * 1000);
const TRIGGER_STATE = process.env.LISTING_TRIGGER_STATE || 'pendingApproval';

function shouldNotify(ev) {
  const eventType = ev?.attributes?.eventType; // 'listing/created' | 'listing/updated'
  const resource = ev?.attributes?.resource;
  const newState = resource?.attributes?.state;
  const prev = ev?.attributes?.previousValues?.attributes || {};

  if (newState !== TRIGGER_STATE) return false;

  // Created directly into the trigger state → notify.
  if (eventType === 'listing/created') return true;

  // Updated INTO the trigger state → previousValues must include a different
  // prior state. If state isn't in previousValues, the state didn't change in
  // this event (e.g. a photo edit while already pending) → skip.
  if (Object.prototype.hasOwnProperty.call(prev, 'state')) {
    return prev.state !== TRIGGER_STATE;
  }
  return false;
}

async function enrich(flexSdk, listingId) {
  // Best-effort enrichment: author name + title for a friendlier email.
  try {
    const resp = await flexSdk.listings.show({ id: listingId, include: ['author'] });
    const listing = resp?.data?.data;
    const included = resp?.data?.included || [];
    const author = included.find(r => r.type === 'user') || null;
    return { listing, author };
  } catch (err) {
    if (VERBOSE) console.warn('[listing-events] enrich failed', { listingId, message: err.message });
    return { listing: null, author: null };
  }
}

function buildListingEmail({ resource, listing, author }) {
  const attrs = listing?.attributes || resource?.attributes || {};
  const listingId = (listing?.id?.uuid || listing?.id || resource?.id?.uuid || resource?.id) ?? '(unknown)';
  const title = attrs.title || '(untitled)';
  const price = attrs.price ? `${attrs.price.amount / 100} ${attrs.price.currency}` : '(no price)';
  const state = attrs.state || '(unknown)';

  const authorProfile = author?.attributes?.profile || {};
  const authorName =
    authorProfile.displayName ||
    [authorProfile.firstName, authorProfile.lastName].filter(Boolean).join(' ') ||
    '(unknown lender)';

  const consoleUrl = `https://console.sharetribe.com/o/listings/${listingId}`;

  const text = [
    `A new listing is awaiting your review (state: ${state})`,
    ``,
    `Title:  ${title}`,
    `Price:  ${price}`,
    `Lender: ${authorName}`,
    `Listing ID: ${listingId}`,
    ``,
    `Review it in Console: ${consoleUrl}`,
  ].join('\n');

  return { subject: `📝 New listing to review — ${title}`, text };
}

async function processNewListingEvents({ sdk } = {}) {
  const flexSdk = sdk || getFlexSdk();
  const createdAtStart = new Date(Date.now() - LOOKBACK_MS).toISOString();

  console.log('[listing-events] Querying events stream', {
    eventTypes: 'listing/created,listing/updated',
    triggerState: TRIGGER_STATE,
    createdAtStart,
    lookbackMs: LOOKBACK_MS,
    dryRun: DRY,
  });

  let events;
  try {
    const resp = await flexSdk.events.query({
      eventTypes: 'listing/created,listing/updated',
      createdAtStart,
    });
    events = resp?.data?.data || [];
  } catch (err) {
    console.error('[listing-events] events.query failed', {
      status: err.response && err.response.status,
      message: err.message,
    });
    throw err;
  }

  const matching = events.filter(shouldNotify);
  console.log('[listing-events] Event summary', {
    fetched: events.length,
    matched: matching.length,
    triggerState: TRIGGER_STATE,
  });

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const ev of matching) {
    const resource = ev?.attributes?.resource;
    const listingId = resource?.id?.uuid || resource?.id;
    if (!listingId) {
      if (VERBOSE) console.warn('[listing-events] event missing listing id; skipping', ev?.id);
      continue;
    }
    attempted++;
    try {
      const { listing, author } = await enrich(flexSdk, listingId);
      const { subject, text } = buildListingEmail({ resource, listing, author });
      const res = await sendOperatorAlert({
        subject,
        text,
        dedupKey: `operatorAlert:listingPending:${listingId}`,
        dryRun: DRY,
      });
      if (res.sent) succeeded++;
      else skipped++;
    } catch (err) {
      failed++;
      console.error('[listing-events] per-event failure (isolated)', { listingId, message: err.message });
    }
  }

  console.log('[listing-events] Run complete', {
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
  processNewListingEvents()
    .then(() => {
      console.log('[listing-events] Script completed successfully');
      process.exit(0);
    })
    .catch(err => {
      console.error('[listing-events] Fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { processNewListingEvents, shouldNotify };

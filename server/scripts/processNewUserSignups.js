#!/usr/bin/env node
/**
 * New-User-Signup Events Poller
 * -----------------------------------------------------------------------------
 * Polls the Sharetribe Integration API events stream for `user/created`
 * events and emails the operator (you) a summary of each new signup,
 * including the user type (lender / borrower) and zipcode when available.
 *
 * WHY POLLING. Sharetribe has no webhooks. Polling events.query is the
 * established pattern in this repo (see processConfirmPaymentEvents.js,
 * sendShippingReminders.js, etc.). Replaces the Zapier "new user" zap.
 *
 * CRON. Recommended every 5 min with a 10-min lookback. The overlap is
 * intentional; per-user Redis dedup (`operatorAlert:signup:<userId>`)
 * prevents duplicate emails from window overlap or worker restarts.
 *
 * FIELD NAMES. `userType` is read from profile.publicData.userType (the
 * Sharetribe-standard key). Zipcode field keys vary per marketplace because
 * they're defined in Console's hosted user-fields asset, so we search a
 * configurable list of candidate keys across publicData + protectedData and
 * surface whatever we find. Override via:
 *   USER_TYPE_KEY         (default: userType)
 *   USER_ZIP_KEYS         (comma list; default: zip,zipcode,postalCode,postal_code)
 *   USER_TYPE_LABELS      (optional JSON map, e.g. {"a":"Lender","b":"Borrower"})
 * On a dry-run the email body also dumps the available publicData/protectedData
 * keys so you can confirm the exact zip key, then lock it into USER_ZIP_KEYS.
 */
require('dotenv').config();

const getFlexSdk = require('../util/getFlexSdk');
const { sendOperatorAlert } = require('../api-util/operatorAlertEmail');

const argv = process.argv.slice(2);
const has = flag => argv.includes(flag);
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const DRY = has('--dry-run') || process.env.DRY_RUN === '1';

const LOOKBACK_MS = Number(process.env.SIGNUP_LOOKBACK_MS || 10 * 60 * 1000);
const USER_TYPE_KEY = process.env.USER_TYPE_KEY || 'userType';
const ZIP_KEYS = (process.env.USER_ZIP_KEYS || 'zip,zipcode,postalCode,postal_code')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

let TYPE_LABELS = {};
try {
  if (process.env.USER_TYPE_LABELS) TYPE_LABELS = JSON.parse(process.env.USER_TYPE_LABELS);
} catch (e) {
  console.warn('[signup-events] USER_TYPE_LABELS is not valid JSON; ignoring.');
}

const firstDefined = (obj, keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
};

function buildSignupEmail({ user, dryRun }) {
  const attrs = user?.attributes || {};
  const profile = attrs.profile || {};
  const publicData = profile.publicData || {};
  const protectedData = profile.protectedData || {};

  const rawType = publicData[USER_TYPE_KEY];
  const userType = (rawType && TYPE_LABELS[rawType]) || rawType || '(not set)';

  const zip =
    firstDefined(publicData, ZIP_KEYS) ||
    firstDefined(protectedData, ZIP_KEYS) ||
    '(not found)';

  const name = profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || '(no name)';
  const email = attrs.email || '(email not in event)';
  const userId = user?.id?.uuid || user?.id || '(unknown id)';
  const created = attrs.createdAt || '';

  const lines = [
    `New ${userType} signup on Sherbrt`,
    ``,
    `Name:      ${name}`,
    `Email:     ${email}`,
    `User type: ${userType}`,
    `Zipcode:   ${zip}`,
    `User ID:   ${userId}`,
    created ? `Created:   ${created}` : null,
    ``,
    `Console: https://console.sharetribe.com/`,
  ].filter(l => l !== null);

  if (dryRun) {
    lines.push(
      ``,
      `— dry-run field discovery —`,
      `publicData keys:    ${Object.keys(publicData).join(', ') || '(none)'}`,
      `protectedData keys: ${Object.keys(protectedData).join(', ') || '(none)'}`,
      `raw ${USER_TYPE_KEY}: ${JSON.stringify(rawType)}`
    );
  }

  const subject = `🆕 New ${userType} signup — ${name}`;
  return { subject, text: lines.join('\n') };
}

async function processNewUserSignups({ sdk } = {}) {
  const flexSdk = sdk || getFlexSdk();
  const createdAtStart = new Date(Date.now() - LOOKBACK_MS).toISOString();

  console.log('[signup-events] Querying events stream', {
    eventTypes: 'user/created',
    createdAtStart,
    lookbackMs: LOOKBACK_MS,
    dryRun: DRY,
  });

  let events;
  try {
    const resp = await flexSdk.events.query({ eventTypes: 'user/created', createdAtStart });
    events = resp?.data?.data || [];
  } catch (err) {
    console.error('[signup-events] events.query failed', {
      status: err.response && err.response.status,
      message: err.message,
    });
    throw err;
  }

  console.log('[signup-events] Fetched', events.length, 'user/created events');

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const ev of events) {
    const user = ev?.attributes?.resource;
    const userId = user?.id?.uuid || user?.id;
    if (!userId) {
      if (VERBOSE) console.warn('[signup-events] event missing user resource; skipping', ev?.id);
      continue;
    }
    attempted++;
    try {
      const { subject, text } = buildSignupEmail({ user, dryRun: DRY });
      const res = await sendOperatorAlert({
        subject,
        text,
        dedupKey: `operatorAlert:signup:${userId}`,
        dryRun: DRY,
      });
      if (res.sent) succeeded++;
      else skipped++;
    } catch (err) {
      failed++;
      console.error('[signup-events] per-event failure (isolated)', { userId, message: err.message });
    }
  }

  console.log('[signup-events] Run complete', {
    fetched: events.length,
    attempted,
    succeeded,
    skipped,
    failed,
  });
  return { fetched: events.length, attempted, succeeded, skipped, failed };
}

if (require.main === module) {
  processNewUserSignups()
    .then(() => {
      console.log('[signup-events] Script completed successfully');
      process.exit(0);
    })
    .catch(err => {
      console.error('[signup-events] Fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { processNewUserSignups };

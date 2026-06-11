#!/usr/bin/env node
/**
 * Combined Operator-Alerts Cron Runner
 * -----------------------------------------------------------------------------
 * Runs all three operator-alert pollers sequentially in a single process, so
 * they can share ONE Render cron job (one schedule, one billing minimum)
 * instead of three. Replaces the separate signup-alert-emails /
 * listing-review-alert-emails / booking-accepted-alert-emails crons.
 *
 *   tick → signups → listings → accepts → exit
 *
 * FAULT ISOLATION. Each poller is wrapped in its own try/catch, so a failure
 * (or 403, timeout, etc.) in one does NOT prevent the others from running.
 * The process exits non-zero only if at least one poller threw — that way a
 * partial failure still shows up red in the Render dashboard, while the
 * pollers that succeeded have already done their work.
 *
 * SCHEDULE. Recommended every 2 minutes (`*\/2 * * * *`). All three pollers use
 * their own internal lookback windows (default 10 min for signups/listings,
 * 5 min for accepts) plus per-entity Redis dedup, so running them all at the
 * 2-min cadence is safe — the overlap is deduped, nothing is double-sent.
 *
 * Honors the same flags/env as the individual scripts:
 *   --dry-run / DRY_RUN=1     log instead of sending
 *   --verbose / VERBOSE=1     extra per-event logging
 * Each underlying poller reads these from the environment, so they propagate
 * automatically.
 */
require('dotenv').config();

const getFlexSdk = require('../util/getFlexSdk');
const { processNewUserSignups } = require('./processNewUserSignups');
const { processNewListingEvents } = require('./processNewListingEvents');
const { processAcceptedTransactionEvents } = require('./processAcceptedTransactionEvents');

// The three pollers, in run order. Add/remove here to change what the cron does.
const POLLERS = [
  { name: 'signups', run: processNewUserSignups },
  { name: 'listings', run: processNewListingEvents },
  { name: 'accepts', run: processAcceptedTransactionEvents },
];

async function processOperatorAlerts({ sdk } = {}) {
  // Share a single SDK instance across all three pollers (one auth/token,
  // fewer cold starts). Each poller accepts an injected sdk.
  const flexSdk = sdk || getFlexSdk();

  console.log('[operator-alerts] Combined run starting', {
    pollers: POLLERS.map(p => p.name),
    at: new Date().toISOString(),
  });

  const results = {};
  const errors = [];

  for (const poller of POLLERS) {
    const startedAt = Date.now();
    try {
      console.log(`[operator-alerts] ▶ ${poller.name} starting`);
      const summary = await poller.run({ sdk: flexSdk });
      results[poller.name] = { ok: true, summary, ms: Date.now() - startedAt };
      console.log(`[operator-alerts] ✔ ${poller.name} done`, summary);
    } catch (err) {
      // Isolated failure — log and continue to the next poller.
      results[poller.name] = { ok: false, error: err.message, ms: Date.now() - startedAt };
      errors.push({ poller: poller.name, message: err.message });
      console.error(`[operator-alerts] x ${poller.name} FAILED (isolated):`, err.message);
    }
  }

  console.log('[operator-alerts] Combined run complete', {
    results,
    failedPollers: errors.map(e => e.poller),
  });

  return { results, errors };
}

if (require.main === module) {
  processOperatorAlerts()
    .then(({ errors }) => {
      if (errors.length) {
        // Surface partial failure to Render (red run) while keeping successes.
        console.error('[operator-alerts] Completed WITH failures:', errors.map(e => e.poller).join(', '));
        process.exit(1);
      }
      console.log('[operator-alerts] Completed successfully');
      process.exit(0);
    })
    .catch(err => {
      // Should be rare — only fires if something outside the per-poller
      // try/catch throws (e.g. SDK construction).
      console.error('[operator-alerts] Fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { processOperatorAlerts };

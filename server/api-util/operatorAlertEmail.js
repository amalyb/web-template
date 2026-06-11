// server/api-util/operatorAlertEmail.js
/**
 * Operator Alert Email helper
 * -----------------------------------------------------------------------------
 * Small shared helper used by the operator-facing event pollers
 * (processNewUserSignups.js / processNewListingEvents.js /
 * processAcceptedTransactionEvents.js) to send admin alert emails to the
 * marketplace operator (you) and to dedupe so a given event only emails once.
 *
 * WHY THIS EXISTS. Sharetribe's built-in process notifications can only be
 * delivered to a transaction's parties (customer / provider) — never to an
 * operator/admin address. So operator-facing alerts (new signup, new listing
 * awaiting review, lender accepted a request) must be sent by us. This mirrors
 * the existing SMS-poller pattern in the repo but targets email instead.
 *
 * Delivery uses the existing SendGrid client (server/email/emailClient.js).
 * Dedup uses the existing Redis helper (server/redis.js); when REDIS_URL is
 * unset it falls back to an in-memory map (fine for local dry-runs).
 */

const { sendTransactionalEmail } = require('../email/emailClient');
const { getRedis } = require('../redis');

// Where operator alerts are sent. Override per-deploy with OPERATOR_ALERT_EMAIL.
const OPERATOR_ALERT_EMAIL = process.env.OPERATOR_ALERT_EMAIL || 'amalia@sherbrt.com';

// Dedup keys live for 30 days — long enough to survive cron overlap / restarts,
// short enough not to grow unbounded.
const DEDUP_TTL_SEC = 30 * 24 * 60 * 60;

/**
 * Has this alert already been sent? (Redis-backed, fail-open.)
 * @param {string} key - stable dedup key, e.g. `operatorAlert:signup:<userId>`
 * @returns {Promise<boolean>}
 */
async function alreadySent(key) {
  try {
    const redis = getRedis();
    const v = await redis.get(key);
    return !!v;
  } catch (err) {
    // Fail open: better to risk a duplicate email than to drop the alert.
    console.warn('[operatorAlert] dedup check failed; proceeding without dedup:', err.message);
    return false;
  }
}

/**
 * Mark an alert as sent (best-effort).
 * @param {string} key
 */
async function markSent(key) {
  try {
    const redis = getRedis();
    await redis.set(key, new Date().toISOString(), 'EX', DEDUP_TTL_SEC);
  } catch (err) {
    console.warn('[operatorAlert] failed to persist dedup key:', err.message);
  }
}

/**
 * Send an operator alert email, with optional dedup.
 *
 * @param {Object} params
 * @param {string} params.subject
 * @param {string} params.text                 - plain-text body
 * @param {string} [params.html]               - html body (defaults to text)
 * @param {string} [params.dedupKey]           - if set, send at most once per key
 * @param {boolean} [params.dryRun=false]      - log instead of sending
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function sendOperatorAlert({ subject, text, html, dedupKey, dryRun = false }) {
  if (dedupKey && (await alreadySent(dedupKey))) {
    console.log('[operatorAlert] duplicate suppressed:', dedupKey);
    return { sent: false, reason: 'duplicate' };
  }

  if (dryRun) {
    console.log('[operatorAlert] DRY-RUN — would send:', {
      to: OPERATOR_ALERT_EMAIL,
      subject,
      dedupKey: dedupKey || '(none)',
    });
    console.log('[operatorAlert] DRY-RUN body:\n' + text);
    return { sent: false, reason: 'dry-run' };
  }

  await sendTransactionalEmail({
    to: OPERATOR_ALERT_EMAIL,
    subject,
    text,
    html: html || `<pre style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif">${text}</pre>`,
  });

  if (dedupKey) await markSent(dedupKey);
  return { sent: true };
}

module.exports = {
  sendOperatorAlert,
  OPERATOR_ALERT_EMAIL,
  // exported for testing
  _alreadySent: alreadySent,
  _markSent: markSent,
};

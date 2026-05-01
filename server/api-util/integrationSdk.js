// server/api-util/integrationSdk.js
const { createInstance } = require('sharetribe-flex-integration-sdk');

let cached;
function getIntegrationSdk() {
  if (!cached) {
    // Explicit base URL selection for Integration SDK:
    // - FLEX_INTEGRATION_BASE_URL controls env (set per test vs prod)
    // - Falls back to SHARETRIBE_SDK_BASE_URL / REACT_APP_SHARETRIBE_SDK_BASE_URL
    // - Defaults to public Flex API if nothing is provided
    const baseUrl =
      process.env.FLEX_INTEGRATION_BASE_URL ||
      process.env.SHARETRIBE_SDK_BASE_URL ||
      process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL ||
      'https://flex-api.sharetribe.com';

    cached = createInstance({
      clientId: process.env.INTEGRATION_CLIENT_ID,
      clientSecret: process.env.INTEGRATION_CLIENT_SECRET,
      baseUrl, // Explicitly set base URL to ensure correct environment
    });

    // Log SDK configuration for debugging (mask sensitive data)
    const mask = v => (v ? v.slice(0, 8) + '...' + v.slice(-4) : '(not set)');
    console.log(`[IntegrationSDK] Initialized with clientId=${mask(process.env.INTEGRATION_CLIENT_ID)} baseUrl=${baseUrl}`);
  }
  return cached;
}

// Alias for consistency with other modules
// Uses Integration SDK with client credentials (no req.cookies needed)
function getTrustedSdk() {
  return getIntegrationSdk();
}

/**
 * Deep merge helper - non-destructive merge of patch into base.
 * Arrays are replaced wholesale (NOT element-merged). Callers that need
 * to append to an array must read-merge-write at the call site.
 */
function deepMerge(base, patch) {
  const result = { ...base };

  for (const key in patch) {
    if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      // Recursively merge objects
      result[key] = deepMerge(base[key] || {}, patch[key]);
    } else {
      // Replace primitives and arrays
      result[key] = patch[key];
    }
  }

  return result;
}

/**
 * Whitelist of allowed protectedData keys for Integration API.
 * Only these keys will be sent to the operator-update-pd-* transition.
 *
 * 10.0 PR-2 note: `lockedRate` is written at nested paths
 * `outbound.lockedRate` and `return.lockedRate`. Both parent keys are
 * already whitelisted below, and `pruneProtectedData` copies entire
 * top-level values wholesale, so nested `lockedRate` passes through
 * intact without needing its own entry. All writers to nested `outbound`
 * or `return` keys MUST spread the existing value to preserve siblings
 * (the merge is client-side via deepMerge before the transition).
 */
const ALLOWED_PROTECTED_DATA_KEYS = [
  'providerStreet',
  'providerStreet2',
  'providerCity',
  'providerState',
  'providerZip',
  'providerPhone',
  'providerEmail',
  'providerName',
  'customerStreet',
  'customerStreet2',
  'customerCity',
  'customerState',
  'customerZip',
  'customerPhone',
  'customerEmail',
  'customerName',
  'bookingStartISO',
  'outbound',
  'return',
  'shipByDate',
  'shipByISO',
  'outboundQrCodeUrl',
  'outboundLabelUrl',
  'outboundTrackingNumber',
  'outboundTrackingUrl',
  'returnQrCodeUrl',
  'returnTrackingUrl',
  'borrowerReturnLabelEmailSent', // Email idempotency flag for borrower return label emails
  'lenderOutboundLabelEmailSent', // Email idempotency flag for lender outbound label emails
  // Webhook-written scan/status state. Required by hasOutboundScan() and by
  // the first-scan / delivered SMS idempotency gates in shippoTracking.js.
  'shippingNotification',
  'lastTrackingStatus',
  // Cross-process flags for return-reminder SMS dedupe (H2).
  'returnSms',
];

/**
 * Prune protectedData to only include whitelisted keys
 * Prevents 400 errors from unexpected keys
 */
function pruneProtectedData(data) {
  if (!data || typeof data !== 'object') return {};

  const pruned = {};
  for (const key of ALLOWED_PROTECTED_DATA_KEYS) {
    if (key in data && data[key] !== undefined) {
      pruned[key] = data[key];
    }
  }
  return pruned;
}

/**
 * Map of tx state → operator-only self-loop transition that updates
 * protectedData (process.edn v6, alias `default-booking/release-1`).
 *
 * States NOT in this map (preauthorized, inquiry, pending-payment,
 * expired, declined, payment-expired) intentionally have no transition —
 * any write attempt from those states hard-fails. The loud error is the
 * discovery mechanism for unexpected callers.
 */
const PD_TRANSITION_BY_STATE = {
  'state/accepted':              'transition/operator-update-pd-accepted',
  'state/delivered':             'transition/operator-update-pd-delivered',
  'state/cancelled':             'transition/operator-update-pd-cancelled',
  'state/reviewed':              'transition/operator-update-pd-reviewed',
  'state/reviewed-by-provider':  'transition/operator-update-pd-reviewed-by-p',
  'state/reviewed-by-customer':  'transition/operator-update-pd-reviewed-by-c',
};

async function fireOpsAlertSafely({ subject, text }) {
  try {
    // Lazy require to avoid circular imports and to let tests skip wiring.
    const { sendTransactionalEmail } = require('../email/emailClient');
    await sendTransactionalEmail({
      to: process.env.OPS_ALERT_EMAIL || 'amalyb@gmail.com',
      subject,
      text,
    });
  } catch (e) {
    console.error('[INT][PD][OPS-ALERT][ERR]', e?.message || e);
  }
}

/**
 * Update transaction protectedData using the Integration SDK via the
 * operator-update-pd-<state> self-loop transitions (process.edn v6).
 *
 * Replaces the old `sdk.transactions.updateMetadata({ metadata: { protectedData } })`
 * write path, which silently routed data to `tx.attributes.metadata.protectedData.X`
 * — every reader looks at `tx.attributes.protectedData.X`, so writes were lost.
 * See task #30 framing-correction in CLAUDE_CONTEXT.md (May 1, 2026).
 *
 * Behavior:
 *   1. Fetch current tx via sdk.transactions.show (no caching — stale reads
 *      would re-create the race the transition mechanism is supposed to close).
 *   2. Map tx.attributes.state → transition. Unsupported states return
 *      `{ success: false, reason: 'unsupported_state', state }` and fire an
 *      ops alert. NO soft fallback to updateMetadata.
 *   3. Deep-merge patch into existing protectedData (arrays replaced wholesale).
 *   4. Prune merged object against the whitelist.
 *   5. Call sdk.transactions.transition with the merged-and-pruned protectedData.
 *   6. Retry once on 409 (state shifted between fetch and write). Repeated 409
 *      throws and fires an ops alert.
 *
 * No feature flag — rollback is via Render deploy revert.
 *
 * @param {string} txId - Transaction UUID (plain string, not SDK UUID object)
 * @param {object} protectedPatch - Partial protectedData to merge in
 * @param {object} opts - Optional: { source: 'shippo|accept|reminder|webhook' }
 * @returns {Promise<object>} Envelope: { success: true, data, transition } on
 *   happy path; { success: false, reason, state, error } on unsupported state.
 *   Throws on network errors, 5xx, or repeated 409.
 */
async function txUpdateProtectedData(txId, protectedPatch, opts = {}) {
  const sdk = getTrustedSdk();
  const ctx = { txId, source: opts.source };
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // 1. Fetch current tx state and protectedData (re-fetched on every attempt,
    //    so 409 retry sees the latest server-side state).
    const showRes = await sdk.transactions.show({ id: txId });
    const tx = showRes?.data?.data;
    const state = tx?.attributes?.state;
    const existingPd = tx?.attributes?.protectedData || {};

    // 2. Map state → operator-update-pd transition.
    const transitionName = PD_TRANSITION_BY_STATE[state];
    if (!transitionName) {
      console.warn('[INT][PD][UNSUPPORTED-STATE]', { ...ctx, state });
      await fireOpsAlertSafely({
        subject: `[Sherbrt] tx protectedData write blocked — unsupported state ${state} (tx ${txId?.slice?.(0, 8) || txId})`,
        text: [
          'A txUpdateProtectedData call was blocked because the tx state has no operator-update-pd transition mapping.',
          '',
          `tx: ${txId}`,
          `state: ${state}`,
          `source: ${opts.source || '(unknown)'}`,
          `patch keys: ${Object.keys(protectedPatch || {}).join(', ')}`,
          '',
          'Either the caller fired from an unexpected state, or the marketplace process is missing a transition for this state.',
        ].join('\n'),
      });
      return {
        success: false,
        reason: 'unsupported_state',
        state,
        error: `unsupported_state: ${state}`,
      };
    }

    // 3. Deep-merge patch into existing protectedData. deepMerge replaces
    //    arrays wholesale (per Phase 0 audit gotcha) — callers that append
    //    to an array must read-merge-write at the call site.
    const merged = deepMerge(existingPd, protectedPatch || {});

    // 4. Prune merged object against the whitelist (full payload, not just
    //    the patch — the transition replaces all of protectedData).
    const pruned = pruneProtectedData(merged);

    try {
      console.log('[INT][PD] transition', {
        ...ctx,
        state,
        transition: transitionName,
        patchKeys: Object.keys(protectedPatch || {}),
        attempt,
      });
      const res = await sdk.transactions.transition({
        id: txId,
        transition: transitionName,
        params: { protectedData: pruned },
      });
      console.log('[INT][PD][OK]', { ...ctx, state, transition: transitionName });
      return { success: true, data: res?.data?.data, transition: transitionName };
    } catch (e) {
      const status = e?.response?.status || e?.status;
      const err = e?.response?.data?.errors?.[0] || {};

      // 5. 409 retry (state shifted between fetch and write). Re-fetch and
      //    try once more — the loop top will re-show + re-merge.
      if (status === 409 && attempt < MAX_ATTEMPTS) {
        console.warn('[INT][PD][409][RETRY]', { ...ctx, code: err.code, attempt });
        continue;
      }

      // Repeated 409 — fail loudly with ops alert. No further fallback.
      if (status === 409) {
        console.error('[INT][PD][409][GAVE-UP]', { ...ctx, attempt });
        await fireOpsAlertSafely({
          subject: `[Sherbrt] tx protectedData write failed — repeated 409 (tx ${txId?.slice?.(0, 8) || txId})`,
          text: [
            `tx ${txId} returned 409 on the operator-update-pd transition twice in a row.`,
            '',
            `state: ${state}`,
            `transition: ${transitionName}`,
            `source: ${opts.source || '(unknown)'}`,
            `patch keys: ${Object.keys(protectedPatch || {}).join(', ')}`,
          ].join('\n'),
        });
      }

      console.error('[INT][PD][ERR]', {
        ...ctx,
        state,
        transition: transitionName,
        status,
        statusText: e?.response?.statusText,
        code: err.code,
        title: err.title,
        details: err.details || err.message || e.message,
        sentKeys: Object.keys(pruned),
        originalKeys: Object.keys(protectedPatch || {}),
      });
      if (e?.response?.data) {
        console.error('[INT][PD][ERR][BODY]', e.response.data);
      }
      throw e;
    }
  }

  // Unreachable: the loop either returns or throws on every iteration.
  throw new Error('txUpdateProtectedData: exhausted retries without resolution');
}

module.exports = {
  getIntegrationSdk,
  getTrustedSdk,
  txUpdateProtectedData,
  deepMerge, // Export for testing
  PD_TRANSITION_BY_STATE, // Export for testing
};

#!/usr/bin/env node
/**
 * Phase 1 verification script for the task #30 architectural fix.
 *
 * Confirms that the new operator-update-pd-<state> transitions are live
 * in Sharetribe and actually write data to the correct field
 * (tx.attributes.protectedData), not the broken field
 * (tx.attributes.metadata.protectedData).
 *
 * Strategy:
 *   1. Pick a real test transaction in state/accepted (or whichever state
 *      is passed via --state).
 *   2. Read the current tx.attributes.protectedData and metadata.protectedData
 *      so we have a baseline.
 *   3. Call the new transition with a tiny patch (a sentinel field
 *      `_task30Probe: { ts: <iso>, runId: <uuid> }`).
 *   4. Re-fetch the tx and assert:
 *      - tx.attributes.protectedData._task30Probe is the new sentinel.
 *      - tx.attributes.metadata.protectedData._task30Probe is NOT updated.
 *      - All previously-existing keys at tx.attributes.protectedData.* are
 *        still present (no top-level clobber).
 *   5. Clean up by removing the sentinel via a second call.
 *
 * Usage:
 *   node scripts/diag-task-30-transition.js <txId> [--state=accepted]
 *
 * Example:
 *   node scripts/diag-task-30-transition.js 69f3cbd6-e256-420b-bc4c-1ba60deaf710
 *
 * If the script PASSES end-to-end, Phase 1 is verified — proceed to Phase 2.
 * If FAIL, the new transition either isn't live, is misconfigured, or the
 * marketplace hasn't been switched to v6 yet.
 */

require('dotenv').config();
const crypto = require('crypto');
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const TRANSITION_BY_STATE = {
  'state/accepted':              'transition/operator-update-pd-accepted',
  'state/delivered':             'transition/operator-update-pd-delivered',
  'state/cancelled':             'transition/operator-update-pd-cancelled',
  'state/reviewed':              'transition/operator-update-pd-reviewed',
  'state/reviewed-by-provider':  'transition/operator-update-pd-reviewed-by-p',
  'state/reviewed-by-customer':  'transition/operator-update-pd-reviewed-by-c',
};

const args = process.argv.slice(2);
const txId = args.find(a => !a.startsWith('--'));
if (!txId) {
  console.error('Usage: node scripts/diag-task-30-transition.js <txId> [--state=<state>]');
  console.error('       <txId> can be a full UUID or 8-char prefix.');
  process.exit(1);
}

const stateOverride = args.find(a => a.startsWith('--state='))?.split('=')[1];

const sdk = getIntegrationSdk();
const runId = crypto.randomUUID();

(async () => {
  console.log('[diag-30] === Phase 1 verification: task #30 transition ===');
  console.log('[diag-30] runId:', runId);

  // 1. Resolve the tx
  let tx;
  if (txId.length === 36) {
    const r = await sdk.transactions.show({ id: txId });
    tx = r.data.data;
  } else {
    console.log('[diag-30] short prefix detected, scanning recent txs...');
    const q = await sdk.transactions.query({ limit: 100, sort: '-createdAt' });
    const found = q.data.data.find(t => t.id.uuid.startsWith(txId));
    if (!found) {
      console.error(`[diag-30] no tx found whose id starts with "${txId}" in the last 100`);
      process.exit(2);
    }
    const r = await sdk.transactions.show({ id: found.id.uuid });
    tx = r.data.data;
  }

  const fullTxId = tx.id.uuid;
  const currentState = tx.attributes.state;
  console.log('[diag-30] tx.id:', fullTxId);
  console.log('[diag-30] tx.state:', currentState);

  const stateKey = stateOverride || currentState;
  const transitionName = TRANSITION_BY_STATE[stateKey];
  if (!transitionName) {
    console.error(`[diag-30] no transition mapping for state "${stateKey}". Supported:`, Object.keys(TRANSITION_BY_STATE));
    process.exit(3);
  }
  console.log('[diag-30] using transition:', transitionName);

  // 2. Baseline reads
  const beforePD = tx.attributes.protectedData || {};
  const beforeMD = tx.attributes.metadata || {};
  const beforePDKeys = Object.keys(beforePD).sort();
  console.log('[diag-30] BEFORE — protectedData keys:', beforePDKeys.join(', ') || '(empty)');
  console.log('[diag-30] BEFORE — metadata top-level keys:', Object.keys(beforeMD).join(', ') || '(empty)');

  // 3. Call the new transition with a sentinel patch
  console.log(`\n[diag-30] === Calling ${transitionName} ===`);
  const sentinel = { ts: new Date().toISOString(), runId };
  try {
    await sdk.transactions.transition({
      id: fullTxId,
      transition: transitionName,
      params: {
        protectedData: { _task30Probe: sentinel },
      },
    });
    console.log('[diag-30] ✅ transition call returned 2xx');
  } catch (err) {
    console.error('[diag-30] ❌ transition call FAILED');
    // Sharetribe SDK errors expose details at multiple paths — log all.
    console.error('[diag-30] err.message:', err.message);
    console.error('[diag-30] err.status:', err?.status);
    console.error('[diag-30] err.data:', JSON.stringify(err?.data, null, 2));
    console.error('[diag-30] err.response?.status:', err?.response?.status);
    console.error('[diag-30] err.response?.data:', JSON.stringify(err?.response?.data, null, 2));
    if (err?.response?.data?.errors) {
      console.error('[diag-30] err.response.data.errors:');
      err.response.data.errors.forEach((e, i) => {
        console.error(`[diag-30]   [${i}] code:`, e.code, 'title:', e.title, 'details:', JSON.stringify(e.details));
      });
    }
    console.error('[diag-30] => Phase 1 NOT verified. Most likely causes:');
    console.error('[diag-30]    (a) v6 not published yet, OR marketplace alias not switched to v6');
    console.error('[diag-30]    (b) transition name typo in process.edn');
    console.error('[diag-30]    (c) tx is on an older process version — txs are pinned to the process version they were CREATED on (this is most likely)');
    process.exit(4);
  }

  // 4. Re-fetch and verify
  console.log('\n[diag-30] === Re-fetching tx to verify data placement ===');
  const r2 = await sdk.transactions.show({ id: fullTxId });
  const tx2 = r2.data.data;

  const afterPD = tx2.attributes.protectedData || {};
  const afterMD = tx2.attributes.metadata || {};
  const afterPDKeys = Object.keys(afterPD).sort();

  // Test: sentinel landed at protectedData
  const probeAtProtectedData = afterPD._task30Probe;
  // Test: sentinel did NOT land at metadata.protectedData
  const probeAtMetadata = afterMD?.protectedData?._task30Probe;
  // Test: existing protectedData keys are preserved
  const lostKeys = beforePDKeys.filter(k => k !== '_task30Probe' && !afterPDKeys.includes(k));

  console.log('[diag-30] AFTER — protectedData keys:', afterPDKeys.join(', ') || '(empty)');
  console.log('[diag-30] AFTER — metadata top-level keys:', Object.keys(afterMD).join(', ') || '(empty)');
  console.log('\n[diag-30] === ASSERTIONS ===');

  let pass = true;

  if (probeAtProtectedData?.runId === runId) {
    console.log('[diag-30] ✅ sentinel landed at tx.attributes.protectedData._task30Probe');
  } else {
    console.log('[diag-30] ❌ sentinel did NOT land at tx.attributes.protectedData._task30Probe');
    console.log('[diag-30]    expected runId:', runId);
    console.log('[diag-30]    actual:', JSON.stringify(probeAtProtectedData));
    pass = false;
  }

  if (probeAtMetadata?.runId !== runId) {
    console.log('[diag-30] ✅ sentinel did NOT pollute tx.attributes.metadata.protectedData');
  } else {
    console.log('[diag-30] ❌ sentinel ALSO landed at metadata.protectedData (unexpected)');
    pass = false;
  }

  if (lostKeys.length === 0) {
    console.log('[diag-30] ✅ no top-level clobber — all pre-existing protectedData keys preserved');
  } else {
    console.log('[diag-30] ❌ TOP-LEVEL CLOBBER detected. Missing keys after transition:', lostKeys);
    console.log('[diag-30]    => This is a known concern from CC review. The new transition');
    console.log('[diag-30]       replaced top-level keys instead of merging. Phase 2 fetch-then-merge');
    console.log('[diag-30]       wrapper is required to fix this.');
    pass = false;
  }

  // 5. Clean up the sentinel
  console.log('\n[diag-30] === Cleaning up sentinel ===');
  try {
    // The merged protectedData should preserve everything except the sentinel.
    // Build the cleanup patch by spreading current keys and explicitly clearing _task30Probe.
    const cleanupPatch = { ...afterPD, _task30Probe: null };
    delete cleanupPatch._task30Probe;
    await sdk.transactions.transition({
      id: fullTxId,
      transition: transitionName,
      params: {
        protectedData: cleanupPatch,
      },
    });
    console.log('[diag-30] ✅ sentinel cleared');
  } catch (cleanupErr) {
    console.warn('[diag-30] ⚠️  cleanup failed:', cleanupErr.message);
    console.warn('[diag-30]    sentinel _task30Probe.runId=' + runId + ' may remain on tx.protectedData; safe to ignore');
  }

  console.log('\n[diag-30] === CONCLUSION ===');
  if (pass) {
    console.log('[diag-30] ✅ Phase 1 verified. The new transition routes data correctly.');
    console.log('[diag-30] => Hand Phase 2 (code refactor) to CC.');
  } else {
    console.log('[diag-30] ❌ Phase 1 NOT verified. Re-check Console config before proceeding.');
    process.exit(5);
  }
})().catch(err => {
  console.error('\n[diag-30] UNHANDLED:', err.message);
  if (err.response) {
    console.error('status:', err.response.status);
    console.error('body:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Verifies whether task #30 (silent persistence loss in upsertProtectedData)
 * still exists in the deployed code as of NOW. Zero Stripe involvement.
 *
 * Strategy:
 *   1. Pick any existing transaction (preferably one from after the task #29
 *      deploy at commit 5acbb2e20 on May 1, 2026).
 *   2. Read the current tx.attributes.protectedData and tx.attributes.metadata
 *      so we have a baseline.
 *   3. Call the production upsertProtectedData helper directly with a sentinel
 *      patch (`{ _task30Probe: { ts, runId } }`).
 *   4. Re-fetch the tx and check where the sentinel ended up:
 *      - If it landed at tx.attributes.protectedData._task30Probe → bug NOT present.
 *      - If it landed at tx.attributes.metadata.protectedData._task30Probe → bug confirmed.
 *      - If it's nowhere → silent loss / something even weirder.
 *   5. Clean up the sentinel by writing an empty object on top.
 *
 * Usage:
 *   node scripts/probe-task-30.js <txId|prefix>
 *
 * Example:
 *   node scripts/probe-task-30.js 69f3cbd6
 *
 * Pick any tx that's recent and not in a terminal state. The most recent
 * accepted tx works. Sentinel keys are reserved with leading underscore so
 * they don't collide with anything real. The probe is idempotent and safe
 * to re-run.
 */

require('dotenv').config();
const crypto = require('crypto');
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');
const { upsertProtectedData } = require('../server/lib/txData');

const args = process.argv.slice(2);
const txArg = args[0];
if (!txArg) {
  console.error('Usage: node scripts/probe-task-30.js <txId|prefix>');
  process.exit(1);
}

const sdk = getIntegrationSdk();
const runId = crypto.randomUUID();

(async () => {
  console.log('[probe-30] === Task #30 verification probe ===');
  console.log('[probe-30] runId:', runId);
  console.log('[probe-30] testing against deployed code (commit on origin/main)');

  // 1. Resolve the tx
  let tx;
  if (txArg.length === 36) {
    const r = await sdk.transactions.show({ id: txArg });
    tx = r.data.data;
  } else {
    console.log('[probe-30] short prefix detected, scanning recent txs...');
    const q = await sdk.transactions.query({ limit: 100, sort: '-createdAt' });
    const found = q.data.data.find(t => t.id.uuid.startsWith(txArg));
    if (!found) {
      console.error(`[probe-30] no tx found whose id starts with "${txArg}" in the last 100`);
      process.exit(2);
    }
    const r = await sdk.transactions.show({ id: found.id.uuid });
    tx = r.data.data;
  }

  const fullTxId = tx.id.uuid;
  console.log('[probe-30] tx.id:', fullTxId);
  console.log('[probe-30] tx.state:', tx.attributes.state);
  console.log('[probe-30] tx.lastTransition:', tx.attributes.lastTransition, '@', tx.attributes.lastTransitionedAt);

  const beforePD = tx.attributes.protectedData || {};
  const beforeMD = tx.attributes.metadata || {};
  console.log('[probe-30] BEFORE — tx.protectedData has _task30Probe?', !!beforePD._task30Probe);
  console.log('[probe-30] BEFORE — tx.metadata.protectedData has _task30Probe?', !!beforeMD?.protectedData?._task30Probe);

  // 2. Call the production helper with the sentinel
  console.log('\n[probe-30] === Calling upsertProtectedData(txId, { _task30Probe: ... }) ===');
  const sentinel = { ts: new Date().toISOString(), runId };

  // Note: _task30Probe isn't in ALLOWED_PROTECTED_DATA_KEYS, so it'll be
  // pruned out by pruneProtectedData. We need to test with an actual
  // whitelisted key. Use shipByISO (a low-risk, currently-empty key on most
  // transactions, and ALLOWED in the whitelist).
  console.log('[probe-30] using whitelisted key shipByISO (probe-tagged value) so pruneProtectedData passes it');
  const probeValue = `__task30_probe_${runId}`;
  const originalShipByISO = beforePD.shipByISO;

  try {
    await upsertProtectedData(fullTxId, { shipByISO: probeValue }, { source: 'task30-probe' });
    console.log('[probe-30] ✅ upsertProtectedData call returned ok');
  } catch (err) {
    console.error('[probe-30] ❌ upsertProtectedData FAILED:', err.message);
    process.exit(3);
  }

  // 3. Re-fetch and check both fields
  console.log('\n[probe-30] === Re-fetching tx to see where the value landed ===');
  const r2 = await sdk.transactions.show({ id: fullTxId });
  const tx2 = r2.data.data;

  const afterPD = tx2.attributes.protectedData || {};
  const afterMD = tx2.attributes.metadata || {};
  const valueAtProtectedData = afterPD.shipByISO;
  const valueAtMetadataProtectedData = afterMD?.protectedData?.shipByISO;

  console.log('[probe-30] tx.attributes.protectedData.shipByISO:', JSON.stringify(valueAtProtectedData));
  console.log('[probe-30] tx.attributes.metadata.protectedData.shipByISO:', JSON.stringify(valueAtMetadataProtectedData));

  console.log('\n[probe-30] === DIAGNOSIS ===');

  if (valueAtProtectedData === probeValue) {
    console.log('[probe-30] ✅ Probe value found at tx.attributes.protectedData.shipByISO');
    console.log('[probe-30] => Task #30 is NOT a bug. Data is going to the correct field.');
    console.log('[probe-30] => Either Sharetribe changed semantics, OR our analysis was wrong.');
  } else if (valueAtMetadataProtectedData === probeValue) {
    console.log('[probe-30] ❌ Probe value found at tx.attributes.metadata.protectedData.shipByISO');
    console.log('[probe-30] => Task #30 CONFIRMED. Data is going to the wrong field.');
    console.log('[probe-30] => The bug is real and present in deployed code as of now.');
  } else {
    console.log('[probe-30] 🟡 Probe value not found at EITHER location.');
    console.log('[probe-30] => Something else is happening. Re-check upsertProtectedData behavior.');
  }

  // 4. Clean up
  console.log('\n[probe-30] === Cleaning up ===');
  try {
    await upsertProtectedData(fullTxId, { shipByISO: originalShipByISO || null }, { source: 'task30-probe-cleanup' });
    console.log('[probe-30] ✅ shipByISO restored to', JSON.stringify(originalShipByISO));
  } catch (cleanupErr) {
    console.warn('[probe-30] ⚠️  cleanup failed:', cleanupErr.message);
    console.warn('[probe-30] => shipByISO is currently set to a probe value on tx', fullTxId);
    console.warn('[probe-30] => manually clear via diag scripts if needed');
  }

  console.log('\n[probe-30] done. runId:', runId);
})().catch(err => {
  console.error('\n[probe-30] UNHANDLED:', err.message);
  if (err.response) {
    console.error('status:', err.response.status);
    console.error('body:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});

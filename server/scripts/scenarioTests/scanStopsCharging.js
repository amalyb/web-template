#!/usr/bin/env node
/**
 * Scenario: Carrier scan stops all charging immediately.
 *
 * Policy (PR-3a unified daily model): If a USPS scan is detected
 * (firstScanAt or carrier status indicates in-transit/accepted), no further
 * charging occurs regardless of tx state or days late.
 *
 * Prerequisite: Provide a transaction ID for a tx that HAS a firstScanAt
 * (carrier scan present). State can be accepted or delivered — both should
 * return scan-detected.
 *
 * Usage:
 *   node server/scripts/scenarioTests/scanStopsCharging.js <txId>
 */
require('dotenv').config();

const dayjs = require('dayjs');
const {
  buildSdk,
  fetchTx,
  extractReturnData,
  logTxSummary,
  assertInvariant,
  simulateLateFees,
  exitFromAssertions,
} = require('./scenarioUtils');

const TAG = '[SCENARIO-TEST][SCAN-STOPS-CHARGING]';

async function main() {
  const txId = process.argv[2];
  if (!txId) {
    console.error(`${TAG} Usage: node server/scripts/scenarioTests/scanStopsCharging.js <transactionId>`);
    process.exit(1);
  }

  const allowMutations = process.env.ALLOW_MUTATIONS === '1';
  const now = process.env.FORCE_NOW ? new Date(process.env.FORCE_NOW) : new Date();
  console.log(`${TAG} Starting (dry=${!allowMutations}) txId=${txId} now=${dayjs(now).toISOString()}`);

  const sdk = buildSdk({ allowMutations });
  const { tx, included } = await fetchTx({ sdk, txId });
  logTxSummary({ tag: TAG, tx, included });

  const returnData = extractReturnData(tx);

  let lateResult;
  try {
    lateResult = await simulateLateFees({ sdk, txId, now });
  } catch (err) {
    console.error(`${TAG} simulateLateFees error`, err.message);
    process.exit(1);
  }

  console.log(`${TAG} late fee simulation result`, lateResult);

  const assertions = [];

  // Precondition: scan must be present
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: !!returnData.firstScanAt || ['accepted', 'in_transit'].includes((returnData.status || '').toLowerCase()),
      success: `Carrier scan present (firstScanAt=${returnData.firstScanAt || 'n/a'} status=${returnData.status || 'n/a'})`,
      failure: 'No carrier scan — wrong fixture for this test',
    })
  );

  // Must return scan-detected, no charge
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: lateResult.charged === false,
      success: 'No charge applied',
      failure: `Unexpected charge: charged=${lateResult.charged}`,
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: lateResult.reason === 'scan-detected',
      success: 'Reason is scan-detected',
      failure: `Expected reason=scan-detected, got reason=${lateResult.reason}`,
    })
  );

  // No items, no amounts
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: !lateResult.items && !lateResult.amounts,
      success: 'No items or amounts in result',
      failure: `Unexpected data: items=${JSON.stringify(lateResult.items)} amounts=${JSON.stringify(lateResult.amounts)}`,
    })
  );

  exitFromAssertions(assertions);
}

main().catch(err => {
  console.error(`${TAG} Unhandled error`, err);
  process.exit(1);
});

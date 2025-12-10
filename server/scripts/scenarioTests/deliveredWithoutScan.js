#!/usr/bin/env node
/**
 * Scenario: Delivered state without return scan.
 * Verifies it is treated as non-return overdue and never auto-payouts.
 */
require('dotenv').config();

const dayjs = require('dayjs');
const {
  buildSdk,
  fetchTx,
  extractReturnData,
  extractTransitions,
  logTxSummary,
  assertInvariant,
  simulateLateFees,
  exitFromAssertions,
} = require('./scenarioUtils');

const TAG = '[SCENARIO-TEST][DELIVERED-WITHOUT-SCAN]';

async function main() {
  const txId = process.argv[2];
  if (!txId) {
    console.error(`${TAG} Usage: node server/scripts/scenarioTests/deliveredWithoutScan.js <transactionId>`);
    process.exit(1);
  }

  const allowMutations = process.env.ALLOW_MUTATIONS === '1';
  const now = process.env.FORCE_NOW ? new Date(process.env.FORCE_NOW) : new Date();
  console.log(`${TAG} Starting (dry=${!allowMutations}) txId=${txId} now=${dayjs(now).toISOString()}`);

  const sdk = buildSdk({ allowMutations });
  const { tx, included } = await fetchTx({ sdk, txId });
  logTxSummary({ tag: TAG, tx, included });

  const returnData = extractReturnData(tx);
  console.log(`${TAG} return.protectedData`, returnData);

  const transitions = extractTransitions(tx, included);
  const payoutTransitions = transitions.filter(t =>
    ['transition/complete', 'transition/complete-return', 'transition/complete-replacement'].includes(t.transition)
  );

  let lateResult;
  try {
    lateResult = await simulateLateFees({ sdk, txId, now });
  } catch (err) {
    console.error(`${TAG} simulateLateFees error`, err.message);
    process.exit(1);
  }

  console.log(`${TAG} late fee simulation result`, lateResult);

  const assertions = [];
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: tx?.attributes?.state === 'delivered',
      success: 'State is delivered',
      failure: `Unexpected state ${tx?.attributes?.state}`,
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: !returnData.firstScanAt,
      success: 'No firstScanAt (unscanned return)',
      failure: 'firstScanAt present unexpectedly',
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: lateResult.scenario === 'non-return',
      success: `Classified as non-return (lateDays=${lateResult.lateDays ?? 'n/a'})`,
      failure: `Unexpected scenario classification: ${lateResult.scenario}`,
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: payoutTransitions.length === 0,
      success: 'No payout transitions found',
      failure: `Payout transitions present: ${payoutTransitions.map(t => t.transition).join(', ') || 'unknown'}`,
    })
  );

  if (typeof lateResult.lateDays === 'number' && lateResult.lateDays >= 5) {
    assertions.push(
      assertInvariant({
        tag: TAG,
        condition: (lateResult.items || []).includes('replacement') || returnData.replacementCharged === true,
        success: 'Replacement would be charged at day 5+',
        failure: 'Replacement NOT indicated even though lateDays >= 5',
      })
    );
  }

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: returnData.replacementCharged !== true || (lateResult.items || []).includes('replacement'),
      success: 'Replacement not yet charged unless simulation indicates it',
      failure: 'replacementCharged already true unexpectedly',
    })
  );

  exitFromAssertions(assertions);
}

main().catch(err => {
  console.error(`${TAG} Unhandled error`, err);
  process.exit(1);
});

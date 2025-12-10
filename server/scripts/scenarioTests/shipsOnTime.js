#!/usr/bin/env node
/**
 * Scenario: Borrower ships on time (happy path).
 * Verifies overdue logic is a no-op and payout happens via complete-return.
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

const TAG = '[SCENARIO-TEST][SHIPS-ON-TIME]';

async function main() {
  const txId = process.argv[2];
  if (!txId) {
    console.error(`${TAG} Usage: node server/scripts/scenarioTests/shipsOnTime.js <transactionId>`);
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
  const hasCompleteReturn = payoutTransitions.some(t => t.transition === 'transition/complete-return');
  const hasOtherPayouts = payoutTransitions.some(
    t => t.transition !== 'transition/complete-return'
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
      condition: !!returnData.firstScanAt,
      success: 'firstScanAt present (return scanned)',
      failure: 'firstScanAt missing for on-time scenario',
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: lateResult.charged === false || lateResult.reason === 'not-overdue' || lateResult.reason === 'no-op',
      success: 'Overdue logic is no-op (no charges)',
      failure: `Overdue logic attempted charges: ${JSON.stringify(lateResult)}`,
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: returnData.replacementCharged !== true,
      success: 'No replacement charge for on-time return',
      failure: 'replacementCharged is true unexpectedly',
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: hasCompleteReturn,
      success: 'Payout observed via transition/complete-return',
      failure: 'Missing transition/complete-return payout',
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: !hasOtherPayouts,
      success: 'No alternate payout transitions detected',
      failure: `Unexpected payout transitions: ${payoutTransitions.map(t => t.transition).join(', ')}`,
    })
  );

  exitFromAssertions(assertions);
}

main().catch(err => {
  console.error(`${TAG} Unhandled error`, err);
  process.exit(1);
});

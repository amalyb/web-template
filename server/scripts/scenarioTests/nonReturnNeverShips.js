#!/usr/bin/env node
/**
 * Scenario: Borrower never ships the return.
 * Verifies overdue handling stays in non-return path and no payout occurs.
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

const TAG = '[SCENARIO-TEST][NON-RETURN]';

async function main() {
  const txId = process.argv[2];
  if (!txId) {
    console.error(`${TAG} Usage: node server/scripts/scenarioTests/nonReturnNeverShips.js <transactionId>`);
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
  } else {
    assertions.push(
      assertInvariant({
        tag: TAG,
        condition: returnData.replacementCharged !== true,
        success: 'Replacement not charged before threshold',
        failure: 'Unexpected replacementCharged before day 5',
      })
    );
  }

  exitFromAssertions(assertions);
}

main().catch(err => {
  console.error(`${TAG} Unhandled error`, err);
  process.exit(1);
});

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

  // Under the unified daily model (PR-3a), the non-return path returns
  // scenario='non-return' for daysLate >= 2. For daysLate <= 1, the
  // scan-lag-grace guard fires first (no scenario field). Both are valid
  // for this test — the key invariant is that it's NOT scan-detected or
  // delivered-without-scan (which would mean the item was returned).
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: lateResult.scenario === 'non-return' || lateResult.reason === 'scan-lag-grace' || lateResult.reason === 'not-overdue',
      success: `Classified as non-return path (scenario=${lateResult.scenario ?? 'n/a'} reason=${lateResult.reason ?? 'n/a'} lateDays=${lateResult.lateDays ?? 'n/a'})`,
      failure: `Unexpected classification: scenario=${lateResult.scenario} reason=${lateResult.reason}`,
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

  // Under unified daily model, there are no replacement charges.
  // Verify that the result never includes 'replacement' in items.
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: !(lateResult.items || []).includes('replacement'),
      success: 'No replacement charge (unified daily model — late-fee only)',
      failure: `Unexpected replacement charge in items: ${(lateResult.items || []).join(', ')}`,
    })
  );

  exitFromAssertions(assertions);
}

main().catch(err => {
  console.error(`${TAG} Unhandled error`, err);
  process.exit(1);
});

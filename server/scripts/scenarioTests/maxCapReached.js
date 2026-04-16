#!/usr/bin/env node
/**
 * Scenario: $75 cap (5 charges) prevents further late fees.
 *
 * Policy (PR-3a): Count-based cap — once 5 late-fee charges exist in
 * chargeHistory, no further charges fire. The cap filter uses
 * `code === 'late-fee'` (not scenario) so old 'non-return' entries
 * from before the 'daily-overdue' rename still count.
 *
 * Prerequisite: Provide a transaction ID for an `accepted` tx with no scan
 * and whose chargeHistory already contains 5+ entries with items containing
 * `code: 'late-fee'`. The tx must be overdue (daysLate >= 2).
 *
 * Usage:
 *   FORCE_NOW="2026-04-23T17:00:00Z" node server/scripts/scenarioTests/maxCapReached.js <txId>
 */
require('dotenv').config();

const dayjs = require('dayjs');
const { MAX_LATE_FEE_CHARGES } = require('../../lib/lateFees');
const {
  buildSdk,
  fetchTx,
  extractReturnData,
  logTxSummary,
  assertInvariant,
  simulateLateFees,
  exitFromAssertions,
} = require('./scenarioUtils');

const TAG = '[SCENARIO-TEST][MAX-CAP-REACHED]';

async function main() {
  const txId = process.argv[2];
  if (!txId) {
    console.error(`${TAG} Usage: node server/scripts/scenarioTests/maxCapReached.js <transactionId>`);
    process.exit(1);
  }

  const allowMutations = process.env.ALLOW_MUTATIONS === '1';
  const now = process.env.FORCE_NOW ? new Date(process.env.FORCE_NOW) : new Date();
  console.log(`${TAG} Starting (dry=${!allowMutations}) txId=${txId} now=${dayjs(now).toISOString()}`);

  const sdk = buildSdk({ allowMutations });
  const { tx, included } = await fetchTx({ sdk, txId });
  logTxSummary({ tag: TAG, tx, included });

  const returnData = extractReturnData(tx);
  const chargeHistory = returnData.chargeHistory || [];
  const priorCount = chargeHistory.filter(
    e => e.items?.some(i => i.code === 'late-fee')
  ).length;

  console.log(`${TAG} Prior late-fee charges: ${priorCount}/${MAX_LATE_FEE_CHARGES}`);

  let lateResult;
  try {
    lateResult = await simulateLateFees({ sdk, txId, now });
  } catch (err) {
    console.error(`${TAG} simulateLateFees error`, err.message);
    process.exit(1);
  }

  console.log(`${TAG} late fee simulation result`, lateResult);

  const assertions = [];

  // Precondition: must have >= MAX_LATE_FEE_CHARGES prior charges
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: priorCount >= MAX_LATE_FEE_CHARGES,
      success: `${priorCount} prior charges (>= cap of ${MAX_LATE_FEE_CHARGES})`,
      failure: `Only ${priorCount} charges — fixture needs ${MAX_LATE_FEE_CHARGES}+ to test cap`,
    })
  );

  // Must return max-charges-reached, no charge
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: lateResult.charged === false,
      success: 'No charge applied (cap enforced)',
      failure: `Unexpected charge: charged=${lateResult.charged}`,
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: lateResult.reason === 'max-charges-reached',
      success: `Reason is max-charges-reached (chargeCount=${lateResult.chargeCount})`,
      failure: `Expected reason=max-charges-reached, got reason=${lateResult.reason}`,
    })
  );

  // chargeCount in result should match
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: lateResult.chargeCount === priorCount,
      success: `chargeCount=${lateResult.chargeCount} matches priorCount=${priorCount}`,
      failure: `chargeCount mismatch: result=${lateResult.chargeCount} actual=${priorCount}`,
    })
  );

  exitFromAssertions(assertions);
}

main().catch(err => {
  console.error(`${TAG} Unhandled error`, err);
  process.exit(1);
});

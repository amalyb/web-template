#!/usr/bin/env node
/**
 * Scenario: Day 1 overdue — scan-lag-grace prevents charging.
 *
 * Policy (PR-3a): The scan-lag rule says "charge for day N-1 on day N's cron."
 * On day 1 there is no day 0 to charge for, so the cron must never charge.
 * The `daysLate <= 1` guard in applyCharges() codifies this at code level.
 *
 * Prerequisite: Provide a transaction ID for an `accepted` tx whose return
 * due date is *yesterday* relative to FORCE_NOW (or real now). The tx must
 * NOT have a firstScanAt (no carrier scan).
 *
 * Usage:
 *   FORCE_NOW="2026-04-17T17:00:00Z" node server/scripts/scenarioTests/day1NeverCharges.js <txId>
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

const TAG = '[SCENARIO-TEST][DAY1-NEVER-CHARGES]';

async function main() {
  const txId = process.argv[2];
  if (!txId) {
    console.error(`${TAG} Usage: node server/scripts/scenarioTests/day1NeverCharges.js <transactionId>`);
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

  // Must return scan-lag-grace with no charge
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: lateResult.charged === false,
      success: 'No charge applied on day 1',
      failure: `Unexpected charge: charged=${lateResult.charged}`,
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: lateResult.reason === 'scan-lag-grace',
      success: `Reason is scan-lag-grace (daysLate=${lateResult.daysLate ?? lateResult.lateDays})`,
      failure: `Expected reason=scan-lag-grace, got reason=${lateResult.reason}`,
    })
  );

  // daysLate should be exactly 1
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: (lateResult.daysLate ?? lateResult.lateDays) <= 1,
      success: `daysLate=${lateResult.daysLate ?? lateResult.lateDays} (<=1)`,
      failure: `daysLate=${lateResult.daysLate ?? lateResult.lateDays} — this tx is not a day-1 fixture`,
    })
  );

  // No scan should be present (precondition)
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: !returnData.firstScanAt,
      success: 'No carrier scan (precondition met)',
      failure: `firstScanAt present: ${returnData.firstScanAt} — wrong fixture for this test`,
    })
  );

  exitFromAssertions(assertions);
}

main().catch(err => {
  console.error(`${TAG} Unhandled error`, err);
  process.exit(1);
});

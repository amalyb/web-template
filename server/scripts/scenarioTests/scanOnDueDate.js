#!/usr/bin/env node
/**
 * Scenario: Carrier scan on due date — no charges should ever fire.
 *
 * Policy (PR-3a): A scan on the due date (or before) means the borrower
 * shipped on time. hasScan is true, so applyCharges returns scan-detected
 * immediately. This tests the earliest possible scan timing.
 *
 * Prerequisite: Provide a transaction ID for a tx whose firstScanAt is on
 * or before the return due date. Can be any state (accepted or delivered).
 *
 * Usage:
 *   node server/scripts/scenarioTests/scanOnDueDate.js <txId>
 */
require('dotenv').config();

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const {
  buildSdk,
  fetchTx,
  extractReturnData,
  logTxSummary,
  assertInvariant,
  simulateLateFees,
  exitFromAssertions,
} = require('./scenarioUtils');

const TAG = '[SCENARIO-TEST][SCAN-ON-DUE-DATE]';
const TZ = 'America/Los_Angeles';

async function main() {
  const txId = process.argv[2];
  if (!txId) {
    console.error(`${TAG} Usage: node server/scripts/scenarioTests/scanOnDueDate.js <transactionId>`);
    process.exit(1);
  }

  const allowMutations = process.env.ALLOW_MUTATIONS === '1';
  const now = process.env.FORCE_NOW ? new Date(process.env.FORCE_NOW) : new Date();
  console.log(`${TAG} Starting (dry=${!allowMutations}) txId=${txId} now=${dayjs(now).toISOString()}`);

  const sdk = buildSdk({ allowMutations });
  const { tx, included } = await fetchTx({ sdk, txId });
  logTxSummary({ tag: TAG, tx, included });

  const returnData = extractReturnData(tx);
  const returnDueAt = returnData.dueAt || tx?.attributes?.booking?.end;

  console.log(`${TAG} returnDueAt=${returnDueAt} firstScanAt=${returnData.firstScanAt}`);

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
      condition: !!returnData.firstScanAt,
      success: `Carrier scan present: ${returnData.firstScanAt}`,
      failure: 'No firstScanAt — wrong fixture for this test',
    })
  );

  // Precondition: scan should be on or before due date
  if (returnData.firstScanAt && returnDueAt) {
    const scanDay = dayjs(returnData.firstScanAt).tz(TZ).startOf('day');
    const dueDay = dayjs(returnDueAt).tz(TZ).startOf('day');
    assertions.push(
      assertInvariant({
        tag: TAG,
        condition: scanDay.isBefore(dueDay) || scanDay.isSame(dueDay),
        success: `Scan (${scanDay.format('YYYY-MM-DD')}) is on/before due date (${dueDay.format('YYYY-MM-DD')})`,
        failure: `Scan (${scanDay.format('YYYY-MM-DD')}) is AFTER due date (${dueDay.format('YYYY-MM-DD')}) — still valid but not the intended fixture`,
      })
    );
  }

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
      failure: `Expected scan-detected, got reason=${lateResult.reason}`,
    })
  );

  exitFromAssertions(assertions);
}

main().catch(err => {
  console.error(`${TAG} Unhandled error`, err);
  process.exit(1);
});

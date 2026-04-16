#!/usr/bin/env node
/**
 * Scenario: Daily charge fires for accepted tx with no scan (day >= 2).
 *
 * Policy (PR-3a unified daily model): After the scan-lag-grace period (day 1),
 * the cron charges $15/day, quantity 1. This test verifies that for daysLate >= 2
 * the charge fires correctly with the expected line item shape.
 *
 * Prerequisite: Provide a transaction ID for an `accepted` tx whose return
 * due date is at least 2 days ago relative to FORCE_NOW. The tx must NOT have
 * a firstScanAt (no carrier scan) and must NOT have been charged for today yet.
 *
 * Usage:
 *   FORCE_NOW="2026-04-18T17:00:00Z" node server/scripts/scenarioTests/dailyChargeWithNoScan.js <txId>
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

const TAG = '[SCENARIO-TEST][DAILY-CHARGE-NO-SCAN]';
const LATE_FEE_CENTS = 1500;

async function main() {
  const txId = process.argv[2];
  if (!txId) {
    console.error(`${TAG} Usage: node server/scripts/scenarioTests/dailyChargeWithNoScan.js <transactionId>`);
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

  // Preconditions
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: tx?.attributes?.state === 'accepted',
      success: 'State is accepted',
      failure: `Unexpected state: ${tx?.attributes?.state}`,
    })
  );

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: !returnData.firstScanAt,
      success: 'No carrier scan (precondition met)',
      failure: `firstScanAt present: ${returnData.firstScanAt} — wrong fixture`,
    })
  );

  // The result depends on feature flag state. With flag off: feature-flag-disabled
  // with wouldCharge summary. With flag on (or dry-run via buildSdk): charged=true.
  // Both are valid — we just verify the charge shape.
  const isChargeAttempt = lateResult.charged === true ||
    lateResult.reason === 'feature-flag-disabled';

  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: isChargeAttempt,
      success: `Charge attempted (charged=${lateResult.charged} reason=${lateResult.reason ?? 'n/a'})`,
      failure: `No charge attempt: reason=${lateResult.reason} — is daysLate >= 2?`,
    })
  );

  // Verify late-fee line item
  if (lateResult.charged) {
    assertions.push(
      assertInvariant({
        tag: TAG,
        condition: (lateResult.items || []).includes('late-fee'),
        success: 'Line item includes late-fee',
        failure: `Missing late-fee in items: ${(lateResult.items || []).join(', ')}`,
      })
    );

    assertions.push(
      assertInvariant({
        tag: TAG,
        condition: (lateResult.amounts || []).some(a => a.code === 'late-fee' && a.cents === LATE_FEE_CENTS),
        success: `Charged $${LATE_FEE_CENTS / 100} (correct amount)`,
        failure: `Unexpected amounts: ${JSON.stringify(lateResult.amounts)}`,
      })
    );
  } else if (lateResult.wouldCharge) {
    // Feature flag off — verify wouldCharge summary
    assertions.push(
      assertInvariant({
        tag: TAG,
        condition: lateResult.wouldCharge.some(w => w.code === 'late-fee' && w.cents === LATE_FEE_CENTS),
        success: `wouldCharge shows $${LATE_FEE_CENTS / 100} late-fee`,
        failure: `Unexpected wouldCharge: ${JSON.stringify(lateResult.wouldCharge)}`,
      })
    );
  }

  // No replacement charges under unified model
  assertions.push(
    assertInvariant({
      tag: TAG,
      condition: !(lateResult.items || []).includes('replacement'),
      success: 'No replacement charge (unified daily model)',
      failure: 'Unexpected replacement charge',
    })
  );

  exitFromAssertions(assertions);
}

main().catch(err => {
  console.error(`${TAG} Unhandled error`, err);
  process.exit(1);
});

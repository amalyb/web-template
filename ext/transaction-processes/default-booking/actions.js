/**
 * Custom payout gating actions for the default-booking process.
 *
 * These actions wrap the built-in `stripe-create-payout` action with guards
 * that enforce return or replacement confirmation before payout.
 */

function getLogger(ctx) {
  return ctx?.log || console;
}

function getTransaction(ctx) {
  return ctx?.transaction || ctx?.tx || ctx?.order || null;
}

async function runStripePayout(ctx) {
  const callAction = ctx?.callAction;
  if (typeof callAction !== 'function') {
    throw new Error('[PAYOUT_BLOCKED] callAction is not available to invoke stripe-create-payout');
  }
  return callAction({ name: 'stripe-create-payout' });
}

async function actionCompleteReturn(ctx) {
  const log = getLogger(ctx);
  const tx = getTransaction(ctx);
  const txId = tx?.id?.uuid || tx?.id || 'unknown';
  const returnData = tx?.attributes?.protectedData?.return || {};
  const hasScan = !!returnData.firstScanAt;
  const replacementCharged = !!returnData.replacementCharged;

  if (!hasScan && !replacementCharged) {
    log.error('[PAYOUT_BLOCKED] No return scan or replacement charge – refusing complete-return', {
      txId,
      hasScan,
      replacementCharged,
    });
    throw new Error('[PAYOUT_BLOCKED] No return scan or replacement charge – refusing complete-return');
  }

  log.info('[PAYOUT_OK] complete-return', { txId, hasScan, replacementCharged });
  return runStripePayout(ctx);
}

async function actionCompleteReplacement(ctx) {
  const log = getLogger(ctx);
  const tx = getTransaction(ctx);
  const txId = tx?.id?.uuid || tx?.id || 'unknown';
  const returnData = tx?.attributes?.protectedData?.return || {};
  const replacementCharged = !!returnData.replacementCharged;
  const hasScan = !!returnData.firstScanAt;

  if (!replacementCharged) {
    log.error('[PAYOUT_BLOCKED] Replacement not charged – refusing complete-replacement', {
      txId,
      hasScan,
      replacementCharged,
    });
    throw new Error('[PAYOUT_BLOCKED] Replacement not charged – refusing complete-replacement');
  }

  log.info('[PAYOUT_OK] complete-replacement', { txId, hasScan, replacementCharged });
  return runStripePayout(ctx);
}

module.exports = {
  'action/complete-return': actionCompleteReturn,
  'action/complete-replacement': actionCompleteReplacement,
  actionCompleteReturn,
  actionCompleteReplacement,
};

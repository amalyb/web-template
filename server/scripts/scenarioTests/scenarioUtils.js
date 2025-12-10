require('dotenv').config();

const { getTrustedSdk } = require('../../api-util/integrationSdk');
const { applyCharges } = require('../../lib/lateFees');

const TAG = '[SCENARIO-TEST][UTIL]';

function buildSdk({ allowMutations = false } = {}) {
  const base = getTrustedSdk();
  if (allowMutations) {
    console.log(`${TAG} Mutations ENABLED (ALLOW_MUTATIONS=1)`);
    return base;
  }

  console.log(`${TAG} Read-only mode (mutations blocked, transitions stubbed)`);
  const readonlyTx = {
    ...base.transactions,
    show: base.transactions.show.bind(base.transactions),
    transition: async ({ id, transition, params }) => {
      console.log(`${TAG} DRY transition blocked`, { id, transition, params });
      return { data: { dryRun: true } };
    },
  };

  return { ...base, transactions: readonlyTx };
}

async function fetchTx({ sdk, txId, include = [] }) {
  const mergedInclude = Array.from(new Set(['listing', 'transitions', ...include]));
  const response = await sdk.transactions.show({ id: txId, include: mergedInclude });
  const tx = response.data.data;
  const included = response.data.included || [];
  const includedMap = new Map(included.map(i => [`${i.type}/${i.id.uuid || i.id}`, i]));
  return { tx, included, includedMap };
}

function extractReturnData(tx) {
  const pd = tx?.attributes?.protectedData || {};
  return pd.return || {};
}

function summarizeReturn(returnData) {
  return {
    dueAt: returnData.dueAt,
    firstScanAt: returnData.firstScanAt,
    replacementCharged: returnData.replacementCharged,
    lastLateFeeDayCharged: returnData.lastLateFeeDayCharged,
    chargeHistoryCount: (returnData.chargeHistory || []).length,
    status: returnData.status,
  };
}

function extractTransitions(tx, included = []) {
  const attrTransitions = tx?.attributes?.transitions || [];
  const includedTransitions = included
    .filter(i => i.type === 'transactionTransition')
    .map(t => ({
      id: t.id?.uuid || t.id,
      transition: t.attributes?.transition,
      createdAt: t.attributes?.createdAt,
    }));

  const combined = [...attrTransitions, ...includedTransitions];
  combined.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  return combined;
}

function logTxSummary({ tag, tx, included }) {
  const ret = extractReturnData(tx);
  const summary = summarizeReturn(ret);
  const state = tx?.attributes?.state;
  const lastTransition = tx?.attributes?.lastTransition;
  const txId = tx?.id?.uuid || tx?.id;

  console.log(`${tag} TX ${txId}`, {
    state,
    lastTransition,
    return: summary,
  });

  const transitions = extractTransitions(tx, included);
  if (transitions.length) {
    console.log(`${tag} Transitions (${transitions.length})`);
    transitions.forEach(t => {
      console.log(`${tag} transition`, {
        transition: t.transition || t,
        createdAt: t.createdAt,
      });
    });
  } else {
    console.log(`${tag} No transitions found (include missing?)`);
  }
}

function assertInvariant({ tag, condition, success, failure }) {
  if (condition) {
    console.log(`${tag} PASS - ${success}`);
    return true;
  }
  console.error(`${tag} FAIL - ${failure}`);
  return false;
}

async function simulateLateFees({ sdk, txId, now }) {
  return applyCharges({
    sdkInstance: sdk,
    txId,
    now: now || new Date(),
  });
}

function exitFromAssertions(assertions) {
  const allPass = assertions.every(Boolean);
  if (allPass) {
    console.log(`${TAG} ✅ PASS`);
    process.exit(0);
  } else {
    console.error(`${TAG} ❌ FAIL`);
    process.exit(1);
  }
}

module.exports = {
  TAG,
  buildSdk,
  fetchTx,
  extractReturnData,
  summarizeReturn,
  extractTransitions,
  logTxSummary,
  assertInvariant,
  simulateLateFees,
  exitFromAssertions,
};

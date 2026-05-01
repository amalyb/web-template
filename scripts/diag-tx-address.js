#!/usr/bin/env node
/**
 * Diagnostic: print the address-shaped protectedData for one or more
 * transaction IDs (full or 8-char prefix supported via -shortId match).
 *
 * Usage: node scripts/diag-tx-address.js <txId|prefix> [<txId|prefix> ...]
 *
 * Prints customerStreet*, customerCity/State/Zip, customerPhone/Email,
 * providerStreet*, providerCity/State/Zip, providerPhone/Email, plus
 * the last 6 transitions for context.
 *
 * Safe to run any time. No mutations.
 */
require('dotenv').config();

const { getIntegrationSdk } = require('../server/api-util/integrationSdk');
const sdk = getIntegrationSdk();

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node scripts/diag-tx-address.js <txId> [<txId> ...]');
  process.exit(1);
}

function pretty(label, val) {
  console.log(`  ${label}: ${val === undefined || val === null || val === '' ? '(empty)' : JSON.stringify(val)}`);
}

(async () => {
  for (const arg of args) {
    console.log('\n========================================');
    console.log('Looking up tx:', arg);
    console.log('========================================');

    let tx = null;
    try {
      // Try a direct show first (works for full UUIDs).
      const r = await sdk.transactions.show({ id: arg });
      tx = r.data.data;
    } catch (e) {
      // Fall back to a small recent-tx scan and filter by prefix.
      console.log('  direct show failed, scanning recent txs by prefix...');
      const q = await sdk.transactions.query({ limit: 100, sort: '-createdAt' });
      const found = q.data.data.find(t => t.id.uuid.startsWith(arg));
      if (!found) {
        console.error(`  no tx found whose id starts with "${arg}" in the last 100`);
        continue;
      }
      const r = await sdk.transactions.show({ id: found.id.uuid });
      tx = r.data.data;
    }

    const a = tx.attributes;
    const pd = a.protectedData || {};
    console.log('\nid:', tx.id.uuid);
    console.log('createdAt:', a.createdAt);
    console.log('lastTransition:', a.lastTransition, '@', a.lastTransitionedAt);
    console.log('processName:', a.processName, 'v' + a.processVersion);

    console.log('\n--- recipient (customer / borrower) address ---');
    pretty('customerName', pd.customerName);
    pretty('customerStreet', pd.customerStreet);
    pretty('customerStreet2', pd.customerStreet2);
    pretty('customerCity', pd.customerCity);
    pretty('customerState', pd.customerState);
    pretty('customerZip', pd.customerZip);
    pretty('customerPhone', pd.customerPhone);
    pretty('customerEmail', pd.customerEmail);

    console.log('\n--- sender (provider / lender) address ---');
    pretty('providerName', pd.providerName);
    pretty('providerStreet', pd.providerStreet);
    pretty('providerStreet2', pd.providerStreet2);
    pretty('providerCity', pd.providerCity);
    pretty('providerState', pd.providerState);
    pretty('providerZip', pd.providerZip);
    pretty('providerPhone', pd.providerPhone);
    pretty('providerEmail', pd.providerEmail);

    console.log('\n--- Shippo-related artifacts on tx ---');
    pretty('outboundTransactionId', pd.outboundTransactionId);
    pretty('returnTransactionId', pd.returnTransactionId);
    pretty('outboundLabelUrl', pd.outboundLabelUrl);
    pretty('returnLabelUrl', pd.returnLabelUrl);
    pretty('outboundTrackingNumber', pd.outboundTrackingNumber);
    pretty('returnTrackingNumber', pd.returnTrackingNumber);
    pretty('shippoCarrier', pd.shippoCarrier);
    pretty('shippoServiceLevel', pd.shippoServiceLevel);

    const trs = (a.transitions || []).slice(-6);
    console.log('\n--- last 6 transitions ---');
    for (const tr of trs) {
      console.log(`  ${tr.createdAt}  ${tr.transition}  by:${tr.by}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // TASK #30 PROBE: Sharetribe Integration API's transactions.updateMetadata
    // writes to tx.attributes.metadata, NOT tx.attributes.protectedData.
    // Our upsertProtectedData wraps the keys at metadata.protectedData.{X}.
    // If task #30 is what we think, the keys we expected on protectedData
    // will actually be at metadata.protectedData here.
    // ────────────────────────────────────────────────────────────────────────
    const md = a.metadata || {};
    console.log('\n--- tx.attributes.metadata (where updateMetadata writes) ---');
    console.log('  top-level metadata keys:', Object.keys(md).join(', ') || '(empty)');
    if (md.protectedData) {
      console.log('  metadata.protectedData keys:', Object.keys(md.protectedData).sort().join(', '));
      console.log('  metadata.protectedData.providerStreet:', JSON.stringify(md.protectedData.providerStreet ?? '(not set)'));
      console.log('  metadata.protectedData.providerZip:', JSON.stringify(md.protectedData.providerZip ?? '(not set)'));
      console.log('  metadata.protectedData.outboundTrackingNumber:', JSON.stringify(md.protectedData.outboundTrackingNumber ?? '(not set)'));
    } else {
      console.log('  metadata.protectedData: (not present)');
    }
  }
})().catch(e => {
  console.error('\nUNHANDLED:', e.message);
  if (e.response) {
    console.error('status:', e.response.status);
    console.error('body:', JSON.stringify(e.response.data, null, 2));
  }
  process.exit(1);
});

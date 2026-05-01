#!/usr/bin/env node
/**
 * Diagnostic: list recent transactions for a lender + show shipping address state.
 * Usage: node scripts/diag-lender-tx.js [lenderEmail]
 */
require('dotenv').config();

// Use the exact same wrapper the server uses, no surprises
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const email = process.argv[2] || 'amaliaebornstein@gmail.com';

console.log('[diag] env vars:');
console.log('  INTEGRATION_CLIENT_ID:', (process.env.INTEGRATION_CLIENT_ID || '').slice(0,8) + '...');
console.log('  INTEGRATION_CLIENT_SECRET present?', !!process.env.INTEGRATION_CLIENT_SECRET);
console.log('  FLEX_INTEGRATION_BASE_URL:', process.env.FLEX_INTEGRATION_BASE_URL || '(not set)');
console.log('  SHARETRIBE_SDK_BASE_URL:', process.env.SHARETRIBE_SDK_BASE_URL || '(not set)');

const sdk = getIntegrationSdk();

(async () => {
  console.log('\n[diag] Step 1: marketplace.show()');
  try {
    const mk = await sdk.marketplace.show();
    console.log('  marketplace name:', mk.data.data.attributes.name);
  } catch (e) {
    console.error('  FAILED:', e.message);
    // Sharetribe SDK errors expose .status / .data on the error itself, plus
    // sometimes axios-style .response, plus sometimes a nested .ctx
    const all = {
      message: e.message,
      status: e.status,
      data: e.data,
      response_status: e.response && e.response.status,
      response_data: e.response && e.response.data,
      ctx: e.ctx,
      config_url: e.response && e.response.config && e.response.config.url,
      config_method: e.response && e.response.config && e.response.config.method,
      config_baseURL: e.response && e.response.config && e.response.config.baseURL,
    };
    console.error('  ALL ERROR FIELDS:', JSON.stringify(all, null, 2));
    process.exit(1);
  }

  console.log('\n[diag] Step 2: users.show({ email })');
  let user;
  try {
    const r = await sdk.users.show({ email }, { expand: true });
    user = r.data.data;
  } catch (e) {
    console.error('  users.show failed:', e.message);
    if (e.response) {
      console.error('  status:', e.response.status, 'url:', e.response.config && e.response.config.url);
      console.error('  body:', JSON.stringify(e.response.data, null, 2));
    }
    // Fall back to query
    console.log('  ...trying users.query({ email }) instead');
    const q = await sdk.users.query({ email }, { expand: true });
    if (!q.data.data.length) { console.error('  No user with that email'); process.exit(2); }
    user = q.data.data[0];
  }
  const pd = user.attributes.profile.protectedData || {};
  console.log('\n===== LENDER PROFILE =====');
  console.log('id:', user.id.uuid);
  console.log('email:', user.attributes.email);
  console.log('lenderShippingAddress:', JSON.stringify(pd.lenderShippingAddress || null, null, 2));
  console.log('legacy phone:', pd.phone || '(none)');
  console.log('legacy phoneNumber:', pd.phoneNumber || '(none)');

  console.log('\n[diag] Step 3: recent transactions where lender is provider');
  const tx = await sdk.transactions.query({
    providerId: user.id.uuid,
    limit: 8,
    sort: '-createdAt',
  });
  if (!tx.data.data.length) { console.log('(none)'); return; }
  for (const t of tx.data.data) {
    const a = t.attributes;
    const txPd = a.protectedData || {};
    const provFields = ['providerStreetAddress','providerCity','providerState','providerZipCode','providerPhone','providerEmail'];
    const provPresent = provFields.filter(k => txPd[k]);
    console.log('---');
    console.log('tx id:', t.id.uuid);
    console.log('createdAt:', a.createdAt);
    console.log('lastTransition:', a.lastTransition, '@', a.lastTransitionedAt);
    console.log('processName:', a.processName, 'v' + a.processVersion);
    console.log('protectedData keys:', Object.keys(txPd).sort().join(', ') || '(empty)');
    console.log('provider fields present:', provPresent.length ? provPresent.join(', ') : '(none)');
    const trs = (a.transitions || []).slice(-6);
    console.log('transition history (last 6):');
    for (const tr of trs) {
      console.log(`  ${tr.createdAt}  ${tr.transition}  by:${tr.by}`);
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

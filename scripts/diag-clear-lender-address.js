#!/usr/bin/env node
/**
 * Diagnostic: clear lenderShippingAddress from a lender's profile so we can
 * test Scenario B (no-saved-address fallback). Pairs with diag-restore for
 * post-test cleanup.
 *
 * Usage:
 *   node scripts/diag-clear-lender-address.js [lenderEmail]
 *     defaults to amaliaebornstein@gmail.com
 */
require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const email = process.argv[2] || 'amaliaebornstein@gmail.com';
const sdk = getIntegrationSdk();

(async () => {
  console.log('[clear] target email:', email);

  // Find user
  const r = await sdk.users.show({ email }, { expand: true });
  const user = r.data.data;
  const pd = user.attributes.profile.protectedData || {};
  const userId = user.id.uuid;

  console.log('[clear] user id:', userId);
  console.log('[clear] BEFORE — lenderShippingAddress:',
    JSON.stringify(pd.lenderShippingAddress || null, null, 2));

  if (!pd.lenderShippingAddress) {
    console.log('[clear] already empty, nothing to do');
    return;
  }

  // Save the current address so we can restore it later — write to a
  // sibling key so we don't lose it.
  const backup = {
    ...pd,
    _lenderShippingAddressBackup: pd.lenderShippingAddress,
    lenderShippingAddress: null,
  };

  await sdk.users.updateProfile({
    id: userId,
    protectedData: backup,
  });

  // Verify
  const r2 = await sdk.users.show({ id: userId }, { expand: true });
  const pd2 = r2.data.data.attributes.profile.protectedData || {};
  console.log('[clear] AFTER — lenderShippingAddress:',
    JSON.stringify(pd2.lenderShippingAddress || null, null, 2));
  console.log('[clear] backup stored at protectedData._lenderShippingAddressBackup');
  console.log('[clear] DONE — address cleared. Run diag-restore to put it back.');
})().catch(e => {
  console.error('ERR', e.message);
  if (e.data) console.error(JSON.stringify(e.data, null, 2));
  process.exit(1);
});

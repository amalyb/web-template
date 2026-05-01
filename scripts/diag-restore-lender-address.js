#!/usr/bin/env node
/**
 * Diagnostic: restore lenderShippingAddress from the backup field that
 * diag-clear-lender-address.js wrote. Also clears the backup key.
 *
 * Usage:
 *   node scripts/diag-restore-lender-address.js [lenderEmail]
 */
require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const email = process.argv[2] || 'amaliaebornstein@gmail.com';
const sdk = getIntegrationSdk();

(async () => {
  const r = await sdk.users.show({ email }, { expand: true });
  const user = r.data.data;
  const pd = user.attributes.profile.protectedData || {};
  const userId = user.id.uuid;

  if (!pd._lenderShippingAddressBackup) {
    console.log('[restore] no backup found — nothing to restore');
    return;
  }

  const restored = {
    ...pd,
    lenderShippingAddress: pd._lenderShippingAddressBackup,
    _lenderShippingAddressBackup: null,
  };

  await sdk.users.updateProfile({
    id: userId,
    protectedData: restored,
  });

  const r2 = await sdk.users.show({ id: userId }, { expand: true });
  const pd2 = r2.data.data.attributes.profile.protectedData || {};
  console.log('[restore] AFTER — lenderShippingAddress:',
    JSON.stringify(pd2.lenderShippingAddress || null, null, 2));
  console.log('[restore] DONE');
})().catch(e => {
  console.error('ERR', e.message);
  if (e.data) console.error(JSON.stringify(e.data, null, 2));
  process.exit(1);
});

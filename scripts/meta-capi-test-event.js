/**
 * Standalone Meta Conversions API Test Events sender.
 *
 * Usage:
 *   1. In .env set META_CAPI_ACCESS_TOKEN and META_TEST_EVENT_CODE
 *      (copy the test code from Events Manager > Test Events).
 *   2. node scripts/meta-capi-test-event.js
 *
 * Sends one CompleteRegistration and one LenderActivated with sample (fake)
 * matching data so you can confirm connectivity, hashing and Event Match
 * Quality in the Test Events tab. Uses the same metaCapi module as production.
 */
try {
  require('dotenv').config();
} catch (e) {
  // dotenv optional; env may already be set in the shell
}

const { sendCapiEvent, buildUserData, isEnabled, config } = require('../server/api-util/metaCapi');

(async () => {
  console.log('[test] metaCapi config:', config, 'enabled:', isEnabled());
  if (!process.env.META_TEST_EVENT_CODE) {
    console.warn('[test] META_TEST_EVENT_CODE is not set — events will go to LIVE, not Test Events.');
  }

  const userData = buildUserData({
    email: 'test.user@example.com',
    phone: '+1 (415) 555-0123',
    firstName: 'Test',
    lastName: 'User',
    city: 'San Francisco',
    state: 'CA',
    zip: '94103',
    country: 'US',
    externalId: 'test-user-1',
    clientUserAgent: 'sherbrt-capi-test/1.0',
    clientIpAddress: '203.0.113.10',
  });
  console.log('[test] user_data match keys:', Object.keys(userData));

  const stamp = Date.now();
  const cr = await sendCapiEvent({
    eventName: 'CompleteRegistration',
    eventId: 'test-cr-' + stamp,
    eventSourceUrl: 'https://sherbrt.com/signup',
    userData,
    customData: { content_name: 'Lender Signup' },
  });
  console.log('[test] CompleteRegistration:', JSON.stringify(cr, null, 2));

  const la = await sendCapiEvent({
    eventName: 'LenderActivated',
    eventId: 'test-la-' + stamp,
    eventSourceUrl: 'https://sherbrt.com/l/new',
    userData,
    customData: { content_name: 'First Listing Published' },
  });
  console.log('[test] LenderActivated:', JSON.stringify(la, null, 2));

  process.exit(cr.ok && la.ok ? 0 : 1);
})().catch(err => {
  console.error('[test] fatal:', err);
  process.exit(1);
});

// scripts/verify-flex-request-payment.js
const flexSdk = require('sharetribe-flex-sdk');

function env(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${name}`);
  return v;
}

(async () => {
  try {
    const clientId = env('REACT_APP_SHARETRIBE_SDK_CLIENT_ID');
    const clientSecret = env('SHARETRIBE_SDK_CLIENT_SECRET');
    const baseUrl = process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL || 'https://flex-api.sharetribe.com';
    const listingId = env('VERIFY_LISTING_ID');

    const sdk = flexSdk.createInstance({
      clientId,
      clientSecret,
      baseUrl,
    });

    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() + 2);
    const end = new Date(start);
    end.setDate(end.getDate() + 3);

    const bookingStart = start.toISOString();
    const bookingEnd = end.toISOString();

    const bodyParams = {
      transition: 'transition/request-payment',
      params: {
        listingId,
        bookingStart,
        bookingEnd,
        seats: 1,
      },
    };

    const res = await sdk.transactions.initiateSpeculative(bodyParams, {});
    const tx = res?.data?.data?.[0];
    const pd = tx?.attributes?.protectedData || {};
    const nested = pd?.stripePaymentIntents?.default || {};

    const secret = nested?.stripePaymentIntentClientSecret;
    const piId   = nested?.stripePaymentIntentId;
    const looksStripey = typeof secret === 'string' && /^pi_/.test(secret) && /_secret_/.test(secret);
    const idLooksStripey = typeof piId === 'string' && /^pi_/.test(piId);

    console.log('[VERIFY] transition: transition/request-payment (speculative)');
    console.log('[VERIFY] secretTail:', (secret || '').slice(-10), 'looksStripey:', !!looksStripey);
    console.log('[VERIFY] idLooksStripey:', !!idLooksStripey);

    if (looksStripey && idLooksStripey) {
      console.log('VERDICT: PASS — PaymentIntent created by Flex on request-payment');
      process.exit(0);
    } else {
      console.log('VERDICT: FAIL — Stripe PI fields are not in expected format');
      process.exit(2);
    }
  } catch (e) {
    console.error('ERROR:', e?.message || e);
    process.exit(1);
  }
})();


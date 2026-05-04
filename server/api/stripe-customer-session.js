/**
 * GET /api/stripe-customer-session
 *
 * Day 12 Phase E (saved payment methods on mobile). Mints a Stripe
 * ephemeral key tied to the current user's Sharetribe-managed Stripe
 * customer. The mobile client passes the returned `stripeCustomerId` +
 * `ephemeralKeySecret` to `initPaymentSheet` so saved cards appear as
 * the first option in Stripe's PaymentSheet.
 *
 * No customer yet (user hasn't saved a card) → returns
 * `{ stripeCustomerId: null, ephemeralKeySecret: null }` and the mobile
 * client falls back to the no-saved-card PaymentSheet flow.
 *
 * Auth: same cookie as the privileged endpoints. The trusted SDK call
 * runs with the user's session, so the `currentUser.show` lookup is
 * naturally scoped to the caller.
 *
 * No `stripe` npm dep on this server (deliberate — keeps the deploy
 * surface area small). Stripe's ephemeral-keys endpoint is a single
 * form-encoded POST and `node-fetch` is already a dependency, so we
 * call it directly.
 */
const fetch = require('node-fetch');
const { getTrustedSdk, handleError, serialize } = require('../api-util/sdk');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

// API version pinned to match what `@stripe/stripe-react-native@0.50.x`
// expects on the mobile side. If QA surfaces a version-mismatch error
// (Stripe will throw with something like "Stripe API version supplied
// does not match the version expected"), bump this to the version the
// SDK reports.
const STRIPE_API_VERSION = '2024-06-20';

const sendTransit = (res, status, payload) => {
  res
    .status(status)
    .set('Content-Type', 'application/transit+json')
    .send(serialize(payload))
    .end();
};

module.exports = async (req, res) => {
  if (!STRIPE_SECRET_KEY) {
    console.error('[stripe-customer-session] STRIPE_SECRET_KEY not configured');
    return res
      .status(500)
      .json({ error: 'Server is not configured for Stripe payments' })
      .end();
  }

  try {
    const trustedSdk = await getTrustedSdk(req);

    // Read the current user's Sharetribe-linked Stripe customer.
    // `include: ['stripeCustomer']` is enough to surface the customer ID
    // — `defaultPaymentMethod` is fetched separately when the mobile
    // client needs it (the saved-cards screen pulls the full set via
    // PaymentSheet's own data layer using the ephemeral key).
    const userResponse = await trustedSdk.currentUser.show({
      include: ['stripeCustomer'],
    });

    const included = userResponse?.data?.included || [];
    const stripeCustomerEntity = included.find(e => e.type === 'stripeCustomer');
    const stripeCustomerId = stripeCustomerEntity?.attributes?.stripeCustomerId;

    if (!stripeCustomerId) {
      // First-time user — no Stripe customer linked on Sharetribe yet.
      // Mobile client treats this as "no saved cards" and opens
      // PaymentSheet in standalone mode. After their first save (via
      // the mobile checkout's "Save card" toggle + Sharetribe's
      // `sdk.stripeCustomer.create`), subsequent calls will return a
      // populated session.
      return sendTransit(res, 200, {
        stripeCustomerId: null,
        ephemeralKeySecret: null,
      });
    }

    // Mint a short-lived ephemeral key for this customer. Stripe's
    // PaymentSheet uses the `secret` field to access the customer's
    // saved payment methods directly (without exposing the secret API
    // key to the client).
    const stripeRes = await fetch('https://api.stripe.com/v1/ephemeral_keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Stripe-Version': STRIPE_API_VERSION,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `customer=${encodeURIComponent(stripeCustomerId)}`,
    });

    if (!stripeRes.ok) {
      let stripeError;
      try {
        stripeError = await stripeRes.json();
      } catch {
        stripeError = { message: `HTTP ${stripeRes.status}` };
      }
      console.error('[stripe-customer-session] Stripe ephemeral-key error', {
        status: stripeRes.status,
        stripeCustomerId,
        error: stripeError?.error || stripeError,
      });
      return res
        .status(502)
        .json({
          error: 'Failed to create Stripe ephemeral key',
          details: stripeError,
        })
        .end();
    }

    const ephemeralKey = await stripeRes.json();

    // SENSITIVE — `ephemeralKey.secret` is a short-lived Stripe bearer
    // token. NEVER log this response body. NEVER persist the secret.
    // It is sent over TLS to the mobile client and used once to
    // initialize PaymentSheet, then discarded. If a future logging
    // middleware logs response bodies, this endpoint MUST be on its
    // exclusion list.
    return sendTransit(res, 200, {
      stripeCustomerId,
      ephemeralKeySecret: ephemeralKey.secret,
    });
  } catch (err) {
    console.error('[stripe-customer-session] failed', {
      status: err?.status,
      message: err?.message,
      data: err?.data,
      stack: err?.stack,
    });
    return handleError(res, err);
  }
};

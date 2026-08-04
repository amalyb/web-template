// server/api/meta/complete-registration.js
// Meta Conversions API endpoint for the CompleteRegistration event.
//
// Business trigger: a user has SUCCESSFULLY created a Sherbrt account (fired by
// src/ducks/auth.duck.js after signup + login / IdP confirm). Shares its
// event_id with the browser Pixel CompleteRegistration for deduplication.
//
// Idempotent: sets profile.privateData.metaRegistrationSent after a successful
// send so retries / refreshes do not produce duplicate server events. event_id
// dedup at Meta is the backstop.

const { getTrustedSdk } = require('../../api-util/sdk');
const { sendCapiEvent, buildUserData, readRequestContext } = require('../../api-util/metaCapi');

module.exports = async (req, res) => {
  const body = req.body || {};
  const { eventId, eventSourceUrl, email, phone, firstName, lastName } = body;

  if (!eventId) {
    return res.status(400).json({ error: 'eventId is required' });
  }

  let sdk;
  let userId;
  let alreadySent = false;
  let profile = {};

  // Prefer authoritative data from the logged-in user; fall back to client fields.
  try {
    sdk = await getTrustedSdk(req);
    const resp = await sdk.currentUser.show({
      include: ['profile'],
      'fields.user': ['email', 'profile'],
      'fields.profile': ['firstName', 'lastName', 'protectedData', 'publicData', 'privateData'],
    });
    const cu = resp && resp.data && resp.data.data;
    userId = cu && cu.id && cu.id.uuid;
    const attrs = (cu && cu.attributes) || {};
    const prof = attrs.profile || {};
    const pd = prof.protectedData || {};
    const pub = prof.publicData || {};
    const priv = prof.privateData || {};
    alreadySent = priv.metaRegistrationSent === true;
    profile = {
      email: attrs.email,
      firstName: prof.firstName,
      lastName: prof.lastName,
      phone: pd.phoneNumber,
      city: pd.city || pub.city || (pd.shippingAddress && pd.shippingAddress.city),
      state: pd.state || pub.state || (pd.shippingAddress && pd.shippingAddress.state),
      zip: pd.zip || pd.postalCode || (pd.shippingAddress && pd.shippingAddress.postalCode),
      country: pd.country || pub.country || 'us',
    };
  } catch (e) {
    console.warn('[MetaCAPI][CompleteRegistration] could not load current user; using client fields:', e.message);
  }

  if (alreadySent) {
    console.log('[MetaCAPI][CompleteRegistration] duplicate suppressed for user', userId);
    return res.status(200).json({ status: 'duplicate', eventId });
  }

  const ctx = readRequestContext(req);
  const userData = buildUserData({
    email: profile.email || email,
    phone: profile.phone || phone,
    firstName: profile.firstName || firstName,
    lastName: profile.lastName || lastName,
    city: profile.city,
    state: profile.state,
    zip: profile.zip,
    country: profile.country,
    externalId: userId,
    ...ctx,
  });

  const result = await sendCapiEvent({
    eventName: 'CompleteRegistration',
    eventId,
    eventSourceUrl,
    userData,
    customData: { content_name: 'Lender Signup' },
  });

  // Persist idempotency flag on success (best-effort).
  if (result && result.ok && sdk && userId) {
    try {
      const cur = await sdk.currentUser.show({
        'fields.user': ['profile'],
        'fields.profile': ['privateData'],
      });
      const priv = (cur && cur.data && cur.data.data && cur.data.data.attributes && cur.data.data.attributes.profile && cur.data.data.attributes.profile.privateData) || {};
      await sdk.currentUser.updateProfile({
        privateData: { ...priv, metaRegistrationSent: true, metaRegistrationEventId: eventId },
      });
    } catch (e) {
      console.warn('[MetaCAPI][CompleteRegistration] failed to set idempotency flag:', e.message);
    }
  }

  return res.status(200).json({ status: result && result.ok ? 'sent' : 'error', eventId });
};

// server/api/meta/lender-activated.js
// Meta Conversions API endpoint for the LenderActivated custom event.
//
// Business trigger: a lender publishes their FIRST approved/live listing.
// Fired by src/containers/EditListingPage/EditListingPage.duck.js after a
// successful publishDraft. This endpoint:
//   1. Loads the trusted (logged-in) user.
//   2. Suppresses if profile.privateData.metaLenderActivatedSent is already true
//      (idempotent: one activation per user, ever).
//   3. Verifies the listing is actually state === 'published' and owned by them.
//   4. Sends the CAPI event, then sets the idempotency flag.
//   5. Returns { firstActivation: true } ONLY when it actually sent, so the
//      browser Pixel fires exactly once with the same event_id (dedup).
//
// Does NOT fire for drafts, abandoned/unpublished listings, edits to an already
// published listing, or any subsequent listing.

const { getTrustedSdk } = require('../../api-util/sdk');
const { sendCapiEvent, buildUserData, readRequestContext } = require('../../api-util/metaCapi');

module.exports = async (req, res) => {
  const body = req.body || {};
  const { eventId, listingId, eventSourceUrl } = body;

  if (!eventId) {
    return res.status(400).json({ error: 'eventId is required' });
  }

  let sdk;
  let cu;
  try {
    sdk = await getTrustedSdk(req);
    const resp = await sdk.currentUser.show({
      include: ['profile'],
      'fields.user': ['email', 'profile'],
      'fields.profile': ['firstName', 'lastName', 'protectedData', 'publicData', 'privateData'],
    });
    cu = resp && resp.data && resp.data.data;
  } catch (e) {
    console.warn('[MetaCAPI][LenderActivated] could not load current user:', e.message);
    // Cannot verify or dedup without a trusted user -> do not fire.
    return res.status(200).json({ firstActivation: false, reason: 'no-user' });
  }

  const userId = cu && cu.id && cu.id.uuid;
  const prof = (cu && cu.attributes && cu.attributes.profile) || {};
  const priv = prof.privateData || {};

  if (priv.metaLenderActivatedSent === true) {
    return res
      .status(200)
      .json({ firstActivation: false, alreadySent: true, eventId: priv.metaLenderActivatedEventId || eventId });
  }

  // Verify listing is published and owned by this user.
  let published = false;
  try {
    if (listingId) {
      const lresp = await sdk.ownListings.show({ id: listingId });
      const state = lresp && lresp.data && lresp.data.data && lresp.data.data.attributes && lresp.data.data.attributes.state;
      published = state === 'published';
    }
  } catch (e) {
    console.warn('[MetaCAPI][LenderActivated] listing verification failed:', e.message);
  }
  if (!published) {
    return res.status(200).json({ firstActivation: false, reason: 'not-published' });
  }

  const pd = prof.protectedData || {};
  const pub = prof.publicData || {};
  const ctx = readRequestContext(req);
  const userData = buildUserData({
    email: cu.attributes.email,
    phone: pd.phoneNumber,
    firstName: prof.firstName,
    lastName: prof.lastName,
    city: pd.city || pub.city,
    state: pd.state || pub.state,
    zip: pd.zip || pd.postalCode,
    country: pd.country || pub.country || 'us',
    externalId: userId,
    ...ctx,
  });

  const result = await sendCapiEvent({
    eventName: 'LenderActivated',
    eventId,
    eventSourceUrl,
    userData,
    customData: { content_name: 'First Listing Published' },
  });

  if (result && result.ok) {
    try {
      await sdk.currentUser.updateProfile({
        privateData: {
          ...priv,
          metaLenderActivatedSent: true,
          metaLenderActivatedEventId: eventId,
          metaLenderActivatedAt: new Date().toISOString(),
          metaLenderActivatedListingId: (listingId && listingId.uuid) || listingId,
        },
      });
    } catch (e) {
      console.warn('[MetaCAPI][LenderActivated] failed to set idempotency flag:', e.message);
    }
    return res.status(200).json({ firstActivation: true, eventId });
  }

  // Send failed: do NOT set the flag (allow a later retry) and do NOT tell the
  // browser to fire (keeps browser + server in lockstep for dedup).
  return res.status(200).json({ firstActivation: false, reason: 'send-failed', eventId });
};

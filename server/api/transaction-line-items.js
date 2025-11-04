const { transactionLineItems } = require('../api-util/lineItems');
const { getSdk, handleError, serialize, fetchCommission } = require('../api-util/sdk');
const { constructValidLineItems } = require('../api-util/lineItemHelpers');

// Helper to normalize listingId to string
const toUuidString = id =>
  typeof id === 'string' ? id : (id && (id.uuid || id.id)) || null;

module.exports = async (req, res) => {
  const { isOwnListing, listingId: rawListingId, orderData } = req.body;

  // Add debugging for incoming data
  console.log('[server] orderData:', JSON.stringify(orderData, null, 2));
  console.log('[server] content-type:', req.headers['content-type']);

  // Normalize listingId to string
  const listingId = toUuidString(rawListingId);
  console.log('[server] incoming listingId:', rawListingId, '→', listingId);
  
  if (!listingId) {
    return res.status(400).json({ error: 'listingId missing or invalid' });
  }

  const sdk = getSdk(req, res);

  // Use the normalized string directly - SDK should handle it
  const idParam = listingId;

  try {
    // Get current user ID for shipping estimates
    let currentUserId = null;
    try {
      const currentUserResponse = await sdk.currentUser.show({ id: 'me' });
      currentUserId = currentUserResponse?.data?.data?.id?.uuid || null;
      console.log('[transaction-line-items] Current user ID:', currentUserId);
    } catch (err) {
      console.log('[transaction-line-items] Could not fetch current user (may be logged out):', err.message);
    }

    const listingPromise = () =>
      isOwnListing ? sdk.ownListings.show({ id: idParam }) : sdk.listings.show({ id: idParam });

    const [showListingResponse, fetchAssetsResponse] = await Promise.all([
      listingPromise(),
      fetchCommission(sdk)
    ]);

    const listing = showListingResponse.data.data;
    const commissionAsset = fetchAssetsResponse.data.data[0];

    const { providerCommission, customerCommission } =
      commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

    // Pass SDK and currentUserId for shipping estimation
    const lineItems = await transactionLineItems(
      listing,
      orderData,
      providerCommission,
      customerCommission,
      { currentUserId, sdk }
    );

    // Because we are using returned lineItems directly in this template we need to use the helper function
    // to add some attributes like lineTotal and reversal that Marketplace API also adds to the response.
    const validLineItems = constructValidLineItems(lineItems);

    // Pull dates for the UI (adjust to match your client payload)
    const raw = orderData || {};
    const breakdownData = raw.bookingDates || {
      startDate: raw.bookingStart,
      endDate: raw.bookingEnd,
    };

    // Build the payload the client expects
    const payload = {
      lineItems: validLineItems,
      breakdownData,          // { startDate, endDate }
      bookingDates: breakdownData, // keep both keys if your UI reads either
    };

    res
      .status(200)
      .set('Content-Type', 'application/transit+json')
      .send(serialize(payload))
      .end();
  } catch (e) {
    handleError(res, e);
  }
};

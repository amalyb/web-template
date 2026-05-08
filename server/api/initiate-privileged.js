const { transactionLineItems } = require('../api-util/lineItems');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');
const { normalizePhoneE164 } = require('../util/phone');
// Helper to normalize listingId to string
const toUuidString = id =>
  typeof id === 'string' ? id : (id && (id.uuid || id.id)) || null;

// Lender SMS deferred to confirm-payment (preauthorized state) — see
// server/api-util/lender-booking-sms.js. Avoids spamming lenders on
// abandoned PaymentSheet sessions that die at payment-expired (15min).
// Borrower request-confirmation SMS removed entirely: informational SMS
// for a user-initiated on-screen action — adds noise without value.

console.log('🚦 initiate-privileged endpoint is wired up');

module.exports = (req, res) => {
  console.log('🚀 initiate-privileged endpoint HIT!');
  console.log('📋 Request method:', req.method);
  console.log('📋 Request URL:', req.url);
  
  // STEP 1: Confirm the endpoint is hit
  console.log('🚦 initiate-privileged endpoint is wired up');
  
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body;
  
  // Accept PD from either top-level or the nested Sharetribe pattern
  const topLevelPD = (req.body && req.body.protectedData) || {};
  const nestedPD = bodyParams?.params?.protectedData || {};
  const protectedData = Object.keys(nestedPD).length ? nestedPD : topLevelPD;

  console.log('🔎 initiate body.protectedData is object:', typeof protectedData === 'object');
  try {
    console.log('[initiate] forwarding PD keys:', Object.keys(protectedData));
    console.log('[initiate] customerStreet:', protectedData.customerStreet);
    console.log('[initiate] customerZip:', protectedData.customerZip);
  } catch (_) {
    console.log('[initiate] forwarding PD keys: (unavailable)');
  }
  
  // Normalize listingId to string if present
  if (bodyParams?.params?.listingId) {
    const originalListingId = bodyParams.params.listingId;
    const listingId = toUuidString(bodyParams.params.listingId);
    console.log('[server] incoming listingId:', originalListingId, '→', listingId);
    
    if (!listingId) {
      return res.status(400).json({ error: 'listingId missing or invalid' });
    }
    bodyParams.params.listingId = listingId;
  }
  
  // STEP 2: Log the transition type
  console.log('🔁 Transition received:', bodyParams?.transition);

  // 🔧 FIXED: Remove unused state variables and client SDK usage
  // We'll get listing data and line items inside the trusted SDK chain

  // 🔧 FIXED: Start with trusted SDK and handle everything in one clean chain
  return getTrustedSdk(req)
    .then(async (trustedSdk) => {
      const sdk = trustedSdk; // Single SDK variable throughout
      
      // Get listing data for line items and SMS
      const listingIdParam = bodyParams?.params?.listingId;
      const listingResponse = await sdk.listings.show({ 
        id: listingIdParam,
        include: ['author', 'author.profile']
      });
      const listing = listingResponse.data.data;
      
      // Get commission data
      const commissionResponse = await fetchCommission(sdk);
      const commissionAsset = commissionResponse.data.data[0];
      const { providerCommission, customerCommission } =
        commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

      // Get current user ID for shipping estimates (if available)
      let currentUserId = null;
      try {
        const currentUserResponse = await sdk.currentUser.show({ id: 'me' });
        currentUserId = currentUserResponse?.data?.data?.id?.uuid || null;
        console.log('[initiate-privileged] Current user ID:', currentUserId);
      } catch (err) {
        console.log('[initiate-privileged] Could not fetch current user:', err.message);
      }

      // 10.0 PR-2 step 4: capture the Shippo rate-lock at checkout so the
      // accept flow can purchase the exact same rate (zero-delta). Passed
      // through via mutable `shippingLock`; merged into protectedData below.
      const shippingLock = {};

      // Calculate line items (now async with shipping estimation)
      const lineItems = await transactionLineItems(
        listing,
        { ...orderData, ...bodyParams.params },
        providerCommission,
        customerCommission,
        { currentUserId, sdk, shippingLock }
      );

      // Prepare transaction body
      const { params } = bodyParams;
      
      // Helper function to clean empty strings from protectedData
      const clean = obj => Object.fromEntries(
        Object.entries(obj || {}).filter(([,v]) => v !== '')
      );
      
      // Add booking start date to protectedData as durable fallback
      const startRaw =
        params?.booking?.attributes?.start ||
        params?.bookingStart ||
        bodyParams?.params?.protectedData?.customerBookingStartISO ||
        protectedData?.bookingStartISO;
      
      let bookingStartISO = null;
      if (startRaw) {
        // Handle both Date objects and ISO strings
        if (startRaw instanceof Date) {
          bookingStartISO = startRaw.toISOString();
        } else if (typeof startRaw === 'string') {
          // Validate it's a proper ISO string
          const d = new Date(startRaw);
          if (!isNaN(d.getTime())) {
            bookingStartISO = d.toISOString();
          }
        }
      }
      
      // Use the safely extracted protectedData from req.body and clean empty strings
      const finalProtectedData = clean({ ...(protectedData || {}), bookingStartISO });

      // 10.0 PR-2 step 4: persist the checkout-time rate lock under
      // protectedData.outbound.lockedRate and protectedData.return.lockedRate.
      // Spread existing nested values (if any) so we don't clobber siblings
      // — Sharetribe updateMetadata replaces top-level keys wholesale.
      if (shippingLock.outboundRate?.rateObjectId) {
        finalProtectedData.outbound = {
          ...(finalProtectedData.outbound || {}),
          lockedRate: shippingLock.outboundRate,
        };
        console.log('[initiate] locked outbound rate', {
          rateObjectId: shippingLock.outboundRate.rateObjectId,
          estimatedDays: shippingLock.outboundRate.estimatedDays,
          amountCents: shippingLock.outboundRate.amountCents,
        });
      }
      if (shippingLock.returnRate?.rateObjectId) {
        finalProtectedData.return = {
          ...(finalProtectedData.return || {}),
          lockedRate: shippingLock.returnRate,
        };
        console.log('[initiate] locked return rate', {
          rateObjectId: shippingLock.returnRate.rateObjectId,
          estimatedDays: shippingLock.returnRate.estimatedDays,
          amountCents: shippingLock.returnRate.amountCents,
        });
      }
      
      if (bookingStartISO) {
        console.log('[initiate] Added bookingStartISO to protectedData:', bookingStartISO);
      } else {
        console.log('[initiate] No booking start date found to store in protectedData');
      }

      // 🚫 REMOVED: Do NOT auto-fill customerPhone from profile
      // POLICY: Contact info must be explicitly entered at checkout (client-side only)
      // Profile values are used ONLY as UI prefills, never auto-persisted to PD
      
      // Server-side phone normalization (safety net for E.164)
      if (finalProtectedData.customerPhone) {
        finalProtectedData.customerPhone = normalizePhoneE164(finalProtectedData.customerPhone, 'US');
        console.log('[initiate] Normalized customerPhone to E.164:', finalProtectedData.customerPhone);
      }
      if (finalProtectedData.providerPhone) {
        finalProtectedData.providerPhone = normalizePhoneE164(finalProtectedData.providerPhone, 'US');
      }
      
      console.log('[initiate] forwarding PD keys:', Object.keys(finalProtectedData));
      console.log('[initiate] merged finalProtectedData customerStreet:', finalProtectedData.customerStreet);
      console.log('[initiate] merged finalProtectedData customerZip:', finalProtectedData.customerZip);
      
      const body = {
        ...bodyParams,
        params: {
          ...params,
          protectedData: finalProtectedData, // use safely extracted PD
          lineItems,
        },
      };

      // Initiate transaction
      let apiResponse;
      if (isSpeculative) {
        apiResponse = await sdk.transactions.initiateSpeculative(body, queryParams);
      } else {
        apiResponse = await sdk.transactions.initiate(body, queryParams);
      }

      // 🔧 FIXED: Return the API response to be handled by the final .then()
      return apiResponse;
    })
    .then((apiResponse) => {
      // 🔧 FIXED: Handle the final response to the client
      const { status, statusText, data } = apiResponse;
      
      res
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(
          serialize({
            status,
            statusText,
            data,
          })
        )
        .end();
    })
    .catch(e => {
      console.error('[initiate-privileged] failed', {
        status: e?.status,
        message: e?.message,
        data: e?.data,
        stack: e?.stack,
        transition: bodyParams?.transition,
        listingId: bodyParams?.params?.listingId,
      });

      return handleError(res, e);
    });
};


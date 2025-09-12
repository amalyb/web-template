const { transactionLineItems } = require('../api-util/lineItems');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { maskPhone } = require('../api-util/phone');
const { alreadySent } = require('../api-util/idempotency');
const { attempt, sent, failed } = require('../api-util/metrics');

// Helper to normalize listingId to string
const toUuidString = id =>
  typeof id === 'string' ? id : (id && (id.uuid || id.id)) || null;

// Conditional import of sendSMS to prevent module loading errors
let sendSMS = null;
try {
  const smsModule = require('../api-util/sendSMS');
  sendSMS = smsModule.sendSMS;
} catch (error) {
  console.warn('⚠️ SMS module not available — SMS functionality disabled');
  sendSMS = () => Promise.resolve(); // No-op function
}

console.log('🚦 initiate-privileged endpoint is wired up');

// Helper function to build carrier-friendly lender SMS message
function buildLenderMsg(tx, listingTitle) {
  // Carrier-friendly: short, one link, no emojis
  const lenderInboxUrl = process.env.ROOT_URL || 'https://sherbrt.com/inbox/sales';
  const lenderMsg = `Sherbrt: new booking request for "${listingTitle}". Check your inbox: ${lenderInboxUrl}`;
  return lenderMsg;
}

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
  
  // STEP 3: Check that sendSMS is properly imported
  console.log('📱 sendSMS function available:', !!sendSMS);
  console.log('📱 sendSMS function type:', typeof sendSMS);

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

      // Calculate line items
      const lineItems = transactionLineItems(
        listing,
        { ...orderData, ...bodyParams.params },
        providerCommission,
        customerCommission
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
      
      if (bookingStartISO) {
        console.log('[initiate] Added bookingStartISO to protectedData:', bookingStartISO);
      } else {
        console.log('[initiate] No booking start date found to store in protectedData');
      }

      // 🔁 Borrower phone fallback: if missing in PD, copy from current user's profile
      if (!finalProtectedData.customerPhone) {
        try {
          const me = await sdk.currentUser.show({ include: ['profile'] });
          const prof = me?.data?.data?.attributes?.profile;
          const profilePhone =
            prof?.protectedData?.phone ??
            prof?.protectedData?.phoneNumber ??
            prof?.publicData?.phone ??
            prof?.publicData?.phoneNumber ??
            null;
          if (profilePhone) {
            finalProtectedData.customerPhone = profilePhone;
            console.log('[initiate] filled customerPhone from profile');
          } else {
            console.log('[initiate] no phone found in profile; leaving customerPhone unset');
          }
        } catch (e) {
          console.warn('[initiate] could not read currentUser profile for phone fallback:', e?.message);
        }
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

      // 🔧 FIXED: Use fresh transaction data from the API response
      const tx = apiResponse?.data?.data;  // Flex SDK shape
      
      // STEP 4: Add a forced test log
      console.log('🧪 Inside initiate-privileged — beginning SMS evaluation');
      
      // 🔧 FIXED: Lender notification SMS for booking requests - ensure provider phone only
      if (
        bodyParams?.transition === 'transition/request-payment' &&
        !isSpeculative &&
        tx
      ) {
        try {
          console.log('📨 [SMS][booking-request] Preparing to send lender notification SMS');
          
          // Provider resolution (you already have this pattern)
          const txProviderId = tx?.relationships?.provider?.data?.id || null;
          const listingAuthorId = listing?.relationships?.author?.data?.id || null;
          const providerId = txProviderId || listingAuthorId;

          console.log('[SMS][booking-request] Provider ID resolution:', {
            txProviderId: txProviderId?.uuid || txProviderId,
            listingAuthorId: listingAuthorId?.uuid || listingAuthorId,
            chosenProviderId: providerId?.uuid || providerId,
          });

          if (!providerId) {
            console.warn('[SMS][booking-request] No provider ID from tx/listing; skipping lender SMS');
          } else {
            // 🔑 Integration fetch (operator permissions) — can read profile.protectedData
            const iSdk = getIntegrationSdk();
            const idStr = providerId?.uuid ?? providerId; // Integration SDK expects a string UUID
            const prov = await iSdk.users.show({ id: idStr });
            const prof = prov?.data?.data?.attributes?.profile || null;

            // Inspect what we got (avoid logging full PII)
            console.log('[SMS][booking-request] Provider profile fields present:', {
              hasProtected: !!prof?.protectedData,
              hasPublic: !!prof?.publicData,
            });

            const provPhone =
              prof?.protectedData?.phone ??
              prof?.protectedData?.phoneNumber ??
              prof?.publicData?.phone ??
              prof?.publicData?.phoneNumber ??
              null;

            console.log('[SMS][booking-request] Provider phone (raw, masked):',
              maskPhone(provPhone)
            );

            // Optional: safety — don't accidentally send to borrower's phone
            const borrowerId = tx?.relationships?.customer?.data?.id || null;
            if (borrowerId && (borrowerId?.uuid ?? borrowerId) === (providerId?.uuid ?? providerId)) {
              console.warn('[SMS][booking-request] Provider equals customer; aborting lender SMS');
            } else if (provPhone) {
              // Your sendSMS util should normalize to E.164 and log the final +1… number
              const listingTitle = listing?.attributes?.title || 'your listing';
              
              const key = `${tx?.id?.uuid || 'no-tx'}:transition/request-payment:lender`;
              if (alreadySent(key)) {
                console.log('[SMS] duplicate suppressed (lender):', key);
              } else {
                try {
                  await sendSMS(provPhone, buildLenderMsg(tx, listingTitle), { 
                    role: 'lender',
                    tag: 'booking_request_to_lender_alt',
                    meta: { listingId: listing?.id?.uuid || listing?.id }
                  });
                  console.log(`📱 [SMS][booking-request] Lender notification sent to ${maskPhone(provPhone)}`);
                } catch (e) {
                  console.error('[SMS][booking-request] Lender SMS failed:', e.message);
                }
              }
            } else {
              console.warn('[SMS][booking-request] Provider missing phone; skipping lender SMS');
            }
          }

          // 🔧 FIXED: Fetch customer profile if available (borrower SMS - unchanged)
          let borrowerPhone = null;
          const customerId = tx?.relationships?.customer?.data?.id;
          if (customerId) {
            try {
              const customer = await sdk.users.show({ 
                id: customerId,
                include: ['profile']
              });
              
              const customerProf = customer?.data?.data?.attributes?.profile;
              borrowerPhone = customerProf?.protectedData?.phone
                ?? customerProf?.protectedData?.phoneNumber
                ?? customerProf?.publicData?.phone
                ?? customerProf?.publicData?.phoneNumber
                ?? null;
            } catch (customerErr) {
              console.warn('[SMS][booking-request] Could not fetch customer profile:', customerErr.message);
            }
          }

          // Send customer confirmation SMS
          if (customerId && borrowerPhone) {
            try {
              console.log('📨 [SMS][customer-confirmation] Preparing to send customer confirmation SMS');
              
                              const listingTitle = listing?.attributes?.title || 'your listing';
                // Carrier-friendly borrower message
                const borrowerInboxUrl = process.env.ROOT_URL || 'https://sherbrt.com/inbox/orders';
                const borrowerMsg = `Sherbrt: your booking request for "${listingTitle}" was sent. Track in your inbox: ${borrowerInboxUrl}`;
              
              const key = `${tx?.id?.uuid || 'no-tx'}:transition/request-payment:borrower`;
              if (alreadySent(key)) {
                console.log('[SMS] duplicate suppressed (borrower):', key);
              } else {
                try {
                  await sendSMS(borrowerPhone, borrowerMsg, { 
                    role: 'borrower',
                    tag: 'booking_confirmation_to_borrower',
                    meta: { listingId: listing?.id?.uuid || listing?.id }
                  });
                  console.log(`✅ [SMS][customer-confirmation] Customer confirmation sent to ${maskPhone(borrowerPhone)}`);
                } catch (e) {
                  console.error('[SMS][customer-confirmation] Customer SMS failed:', e.message);
                }
              }
              
            } catch (customerSmsErr) {
              console.error('[SMS][customer-confirmation] Customer SMS failed:', customerSmsErr.message);
            }
          } else {
            console.log('[SMS][customer-confirmation] Skipping customer SMS - missing customerId or phone:', { customerId, borrowerPhone });
          }
        } catch (err) {
          console.error('❌ [SMS][booking-request] Error in SMS logic:', err.message);
        }
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


const { transactionLineItems } = require('../api-util/lineItems');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

// Helper function to normalize listingId to string
const toUuidString = id => (typeof id === 'string' ? id : (id && (id.uuid || id.id)) || null);

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
  const lenderInboxUrl = process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL}/inbox/sales` : '/inbox/sales';
  const lenderMsg =
    `👗🍧 New Sherbrt booking request! ` +
    `Someone wants to borrow your listing "${listingTitle}". ` +
    `Check your inbox to respond: ${lenderInboxUrl}`;
  return lenderMsg;
}

module.exports = (req, res) => {
  console.log('🚀 initiate-privileged endpoint HIT!');
  console.log('📋 Request method:', req.method);
  console.log('📋 Request URL:', req.url);
  
  // STEP 1: Confirm the endpoint is hit
  console.log('🚦 initiate-privileged endpoint is wired up');
  
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body;
  
  // STEP 2: Log the transition type
  console.log('🔁 Transition received:', bodyParams?.transition);
  
  // STEP 3: Check that sendSMS is properly imported
  console.log('📱 sendSMS function available:', !!sendSMS);
  console.log('📱 sendSMS function type:', typeof sendSMS);

  // Protected Data extraction & cleaning
  let protectedData = {};
  
  // Accept PD from either req.body.protectedData or req.body.bodyParams?.params?.protectedData
  const rawPD = req.body.protectedData || req.body.bodyParams?.params?.protectedData;
  if (rawPD && typeof rawPD === 'object') {
    // Filter out empty strings
    protectedData = Object.fromEntries(
      Object.entries(rawPD).filter(([_, value]) => value && value.toString().trim() !== '')
    );
  }

  // Add bookingStartISO into PD if available
  const bookingStart = bodyParams?.params?.booking?.attributes?.start || 
                      bodyParams?.params?.bookingStart || 
                      protectedData?.bookingStartISO;
  
  if (bookingStart) {
    try {
      const bookingDate = new Date(bookingStart);
      if (!isNaN(bookingDate.getTime())) {
        protectedData.bookingStartISO = bookingDate.toISOString();
      }
    } catch (e) {
      console.warn('⚠️ Invalid bookingStart date:', bookingStart);
    }
  }

  // Normalize listingId to string and validate
  const rawListingId = bodyParams?.params?.listingId;
  const listingId = toUuidString(rawListingId);
  if (!listingId) {
    return res.status(400).json({ error: 'Invalid listingId provided' });
  }

  // Log PD keys under __DEV__ only
  if (process.env.NODE_ENV === 'development') {
    console.log('🔐 Protected data keys present:', Object.keys(protectedData));
  }

  // 🔧 FIXED: Remove unused state variables and client SDK usage
  // We'll get listing data and line items inside the trusted SDK chain

  // 🔧 FIXED: Start with trusted SDK and handle everything in one clean chain
  return getTrustedSdk(req)
    .then(async (trustedSdk) => {
      const sdk = trustedSdk; // Single SDK variable throughout
      
      // Get listing data for line items and SMS using normalized listingId
      const listingResponse = await sdk.listings.show({ 
        id: listingId,
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

      // Fallback customerPhone if missing
      if (!protectedData.customerPhone) {
        try {
          const currentUser = await sdk.users.show({ id: 'me' });
          const userProfile = currentUser?.data?.data?.attributes?.profile;
          const userPhone = userProfile?.protectedData?.phone || 
                           userProfile?.protectedData?.phoneNumber ||
                           userProfile?.publicData?.phone ||
                           userProfile?.publicData?.phoneNumber;
          
          if (userPhone) {
            protectedData.customerPhone = userPhone;
            console.log('📱 Added fallback customerPhone from user profile');
          }
        } catch (err) {
          console.warn('⚠️ Could not fetch current user for fallback phone:', err.message);
        }
      }

      // Prepare transaction body with cleaned PD
      const { params } = bodyParams;
      const body = {
        ...bodyParams,
        params: {
          ...params,
          lineItems,
          protectedData,
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
              provPhone ? `***${String(provPhone).slice(-4)}` : null
            );

            // Optional: safety — don't accidentally send to borrower's phone
            const borrowerId = tx?.relationships?.customer?.data?.id || null;
            if (borrowerId && (borrowerId?.uuid ?? borrowerId) === (providerId?.uuid ?? providerId)) {
              console.warn('[SMS][booking-request] Provider equals customer; aborting lender SMS');
            } else if (provPhone) {
              // Your sendSMS util should normalize to E.164 and log the final +1… number
              const listingTitle = listing?.attributes?.title || 'your listing';
              await sendSMS(provPhone, buildLenderMsg(tx, listingTitle));
              console.log('📱 [SMS][booking-request] Lender notification sent');
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
              const borrowerInboxUrl = process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL}/inbox/orders` : '/inbox/orders';
              const borrowerMsg =
                `✅ Request sent! Your booking request for "${listingTitle}" was delivered. ` +
                `Track and reply in your inbox: ${borrowerInboxUrl}`;
              
              await sendSMS(borrowerPhone, borrowerMsg, { role: 'customer' });
              console.log(`✅ [SMS][customer-confirmation] Customer confirmation sent to ${borrowerPhone}`);
              
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


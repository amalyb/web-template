const { transactionLineItems } = require('../api-util/lineItems');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');

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

  // 🔧 FIXED: Remove unused state variables and client SDK usage
  // We'll get listing data and line items inside the trusted SDK chain

  // 🔧 FIXED: Start with trusted SDK and handle everything in one clean chain
  return getTrustedSdk(req)
    .then(async (trustedSdk) => {
      const sdk = trustedSdk; // Single SDK variable throughout
      
      // Get listing data for line items and SMS
      const listingResponse = await sdk.listings.show({ 
        id: bodyParams?.params?.listingId,
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
      const body = {
        ...bodyParams,
        params: {
          ...params,
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
        console.log('📨 [SMS][booking-request] Preparing to send lender notification SMS');
        
        try {
          // 🔧 FIXED: Extract IDs from fresh transaction data with fallback to listing author
          const txProviderId = tx?.relationships?.provider?.data?.id;
          const listingAuthorId = listing?.relationships?.author?.data?.id || null;
          const providerId = txProviderId || listingAuthorId;
          const customerId = tx?.relationships?.customer?.data?.id;
          
          // 🔧 DEBUG: Log provider ID resolution
          console.log('[SMS][booking-request] Provider ID resolution:', {
            txProviderId,
            listingAuthorId,
            chosenProviderId: providerId
          });
          
          if (!providerId) {
            console.warn('[SMS][booking-request] No provider ID found in transaction or listing; not sending SMS');
            return apiResponse; // 🔧 FIXED: Return on all paths
          }
          
          // 🔧 FIXED: Fetch provider profile with proper includes
          const provider = await sdk.users.show({ 
            id: providerId,
            include: ['profile']
          });
          
          const prof = provider?.data?.data?.attributes?.profile;
          if (!prof) {
            console.warn('[SMS][booking-request] Provider profile not found; not sending SMS');
            return apiResponse; // 🔧 FIXED: Return on all paths
          }
          
          // 🔧 DEBUG: Log profile data structure
          console.log('[SMS][booking-request] Provider profile data:', {
            protectedData: prof?.protectedData,
            publicData: prof?.publicData
          });
          
          // 🔧 FIXED: Simplified phone extraction with fallback chain
          const providerPhone = prof?.protectedData?.phone
            ?? prof?.protectedData?.phoneNumber
            ?? prof?.publicData?.phone
            ?? prof?.publicData?.phoneNumber
            ?? null;
          
          // 🔧 DEBUG: Log provider phone (raw) before normalization
          console.log('[SMS][booking-request] Provider phone (raw):', providerPhone);
          
          if (!providerPhone) {
            console.warn('[SMS][booking-request] Provider missing phone; continuing to borrower block');
            // 🔧 FIXED: Don't return early, continue to borrower SMS
          }
          
          // 🔧 FIXED: Fetch customer profile if available
          let borrowerPhone = null;
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
          
          // 🔧 FIXED: Guard against misroute
          if (providerPhone === borrowerPhone) {
            console.error('[SMS][booking-request] Detected borrower phone for lender notification; aborting send');
            return apiResponse; // 🔧 FIXED: Return on all paths
          }
          
          // Send lender SMS only if we have a phone number
          if (providerPhone) {
            const listingTitle = listing?.attributes?.title || 'your listing';
            const lenderMessage = `👗 New Sherbrt booking request! Someone wants to borrow your item "${listingTitle}". Tap your dashboard to respond.`;
            
            try {
              await sendSMS(providerPhone, lenderMessage);
              console.log(`✅ [SMS][booking-request] Lender notification sent to ${providerPhone}`);
            } catch (lenderSmsErr) {
              console.error('[SMS][booking-request] Lender SMS failed:', lenderSmsErr.message);
            }
          } else {
            console.log('[SMS][booking-request] Skipping lender SMS - no phone number available');
          }
          
          // Send customer confirmation SMS
          if (customerId && borrowerPhone) {
            try {
              console.log('📨 [SMS][customer-confirmation] Preparing to send customer confirmation SMS');
              
              const customerMessage = `✅ Your booking request for "${listingTitle}" has been sent! The lender will review and respond soon.`;
              
              await sendSMS(borrowerPhone, customerMessage);
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
      handleError(res, e);
    });
};


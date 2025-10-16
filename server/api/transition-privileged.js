const axios = require('axios');
const { transactionLineItems } = require('../api-util/lineItems');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { upsertProtectedData } = require('../lib/txData');
const { maskPhone } = require('../api-util/phone');
const { computeShipByDate, formatShipBy, getBookingStartISO } = require('../lib/shipping');
const { contactEmailForTx, contactPhoneForTx } = require('../util/contact');
const { normalizePhoneE164 } = require('../util/phone');
const { buildShipLabelLink } = require('../util/url');
const { shortLink } = require('../api-util/shortlink');
const { timestamp } = require('../util/time');
const { getPublicTrackingUrl } = require('../lib/trackingLinks');

// ---- helpers (add once, top-level) ----
const safePick = (obj, keys = []) =>
  Object.fromEntries(keys.map(k => [k, obj && typeof obj === 'object' ? obj[k] : undefined]));

// Helper to check if customer has complete shipping address
const hasCustomerShipAddress = (pd) => {
  return !!(pd?.customerStreet?.trim() && pd?.customerZip?.trim());
};


const maskUrl = (u) => {
  try {
    if (!u) return '';
    const url = new URL(u);
    // keep origin + first 3 path signatures
    const parts = url.pathname.split('/').filter(Boolean).slice(0, 3);
    return `${url.origin}/${parts.join('/')}${parts.length ? '/...' : ''}`;
  } catch {
    return String(u || '').split('?')[0];
  }
};

// Helper function to parse expiry from QR code URL
function parseExpiresParam(url) {
  try {
    const u = new URL(url);
    const raw = u.searchParams.get('Expires');
    if (!raw) return null;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds)) return null;
    return new Date(seconds * 1000).toISOString(); // normalize to ISO
  } catch {
    return null;
  }
}

const logTx = (tx) => ({
  object_id: tx?.object_id,
  status: tx?.status,
  tracking_number: tx?.tracking_number,
  tracking_url_provider: tx?.tracking_url_provider,
  label_url: tx?.label_url,
  qr_code_url: tx?.qr_code_url,
});
// ---------------------------------------

// Conditional import of sendSMS to prevent module loading errors
let sendSMS = null;
try {
  const smsModule = require('../api-util/sendSMS');
  sendSMS = smsModule.sendSMS;
} catch (error) {
  console.warn('⚠️ SMS module not available — SMS functionality disabled');
  sendSMS = () => Promise.resolve(); // No-op function
}

// QR delivery reliability: Redis cache for transaction QR data
const { getRedis } = require('../redis');
const redis = getRedis();

// Log cache mode on startup
console.log('[qr-cache] mode:', redis.status === 'mock' ? 'in-memory' : 'redis');

// Note: Legacy persistWithRetry function has been removed.
// Use upsertProtectedData from server/lib/txData.js instead for all Shippo label persistence.

console.log('🚦 transition-privileged endpoint is wired up');

// Helper function to get borrower phone number with fallbacks
// DEPRECATED: Use contactPhoneForTx from util/contact.js instead
const getBorrowerPhone = (params, tx) => {
  const txPD = tx?.protectedData || tx?.attributes?.protectedData || {};
  const cust = tx?.relationships?.customer?.attributes;
  const profilePhone = cust?.profile?.protectedData?.phone ?? cust?.protectedData?.phone;
  
  // Use PD-first helper
  return contactPhoneForTx(tx, profilePhone);
};

// Helper function to get lender phone number with fallbacks
const getLenderPhone = (params, tx) => {
  const txPD = tx?.protectedData || tx?.attributes?.protectedData || {};
  const prov = tx?.relationships?.provider?.attributes;
  const profilePhone = prov?.profile?.protectedData?.phone ?? prov?.protectedData?.phone;
  
  // Provider phone uses similar PD-first logic
  return txPD.providerPhone && String(txPD.providerPhone).trim()
    ? String(txPD.providerPhone).trim()
    : (profilePhone && String(profilePhone).trim() ? String(profilePhone).trim() : null);
};

// --- Shippo label creation logic extracted to a function ---
async function createShippingLabels({ 
  txId, 
  listing, 
  protectedData, 
  providerPhone, 
  integrationSdk, 
  sendSMS, 
  normalizePhone, 
  selectedRate,
  transaction
}) {
  console.log('🚀 [SHIPPO] Starting label creation for transaction:', txId);
  console.log('📋 [SHIPPO] Using protectedData:', protectedData);
  
  // Extract addresses from protectedData
  const providerAddress = {
    name: protectedData.providerName || 'Provider',
    street1: protectedData.providerStreet,
    street2: protectedData.providerStreet2 || '',
    city: protectedData.providerCity,
    state: protectedData.providerState,
    zip: protectedData.providerZip,
    country: 'US',
    email: protectedData.providerEmail,
    phone: protectedData.providerPhone,
  };
  
  const customerAddress = {
    name: protectedData.customerName || 'Customer',
    street1: protectedData.customerStreet,
    street2: protectedData.customerStreet2 || '',
    city: protectedData.customerCity,
    state: protectedData.customerState,
    zip: protectedData.customerZip,
    country: 'US',
    email: protectedData.customerEmail,
    phone: protectedData.customerPhone,
  };
  
  // Log addresses for debugging
  console.log('🏷️ [SHIPPO] Provider address:', providerAddress);
  console.log('🏷️ [SHIPPO] Customer address:', customerAddress);
  
  // Validate that we have complete address information
  const hasCompleteProviderAddress = providerAddress.street1 && providerAddress.city && providerAddress.state && providerAddress.zip;
  const hasCompleteCustomerAddress = customerAddress.street1 && customerAddress.city && customerAddress.state && customerAddress.zip;
  
  if (!hasCompleteProviderAddress) {
    console.warn('⚠️ [SHIPPO] Incomplete provider address — skipping label creation');
    return { success: false, reason: 'incomplete_provider_address' };
  }
  
  if (!hasCompleteCustomerAddress) {
    console.warn('⚠️ [SHIPPO] Incomplete customer address — skipping label creation');
    return { success: false, reason: 'incomplete_customer_address' };
  }
  
  if (!process.env.SHIPPO_API_TOKEN) {
    console.warn('⚠️ [SHIPPO] SHIPPO_API_TOKEN missing — skipping label creation');
    return { success: false, reason: 'missing_api_token' };
  }
  
  try {
    console.log('📦 [SHIPPO] Creating outbound shipment (provider → customer)...');
    
    // Define the required parcel
    const parcel = {
      length: '12',
      width: '10',
      height: '1',
      distance_unit: 'in',
      weight: '0.75',
      mass_unit: 'lb'
    };

    // Outbound shipment payload
    // Note: QR code will be requested per-carrier at purchase time (USPS only)
    const outboundPayload = {
      address_from: providerAddress,
      address_to: customerAddress,
      parcels: [parcel],
      async: false
    };
    console.log('📦 [SHIPPO] Outbound shipment payload:', JSON.stringify(outboundPayload, null, 2));

    // Create outbound shipment (provider → customer)
    const shipmentRes = await axios.post(
      'https://api.goshippo.com/shipments/',
      outboundPayload,
      {
        headers: {
          'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('📦 [SHIPPO] Outbound shipment created successfully');
    console.log('📦 [SHIPPO] Shipment ID:', shipmentRes.data.object_id);
    
    // Select a shipping rate from the available rates
    const availableRates = shipmentRes.data.rates || [];
    const shipmentData = shipmentRes.data;
    
    console.log('📊 [SHIPPO] Available rates:', availableRates.length);
    
    // Diagnostics if no rates returned
    if (availableRates.length === 0) {
      console.error('❌ [SHIPPO][NO-RATES] No shipping rates available for outbound shipment');
      
      // Log Shippo messages for diagnostics
      if (shipmentData.messages && shipmentData.messages.length > 0) {
        console.error('[SHIPPO][NO-RATES] messages:', JSON.stringify(shipmentData.messages, null, 2));
      }
      
      // Log carrier accounts if available
      if (shipmentData.carrier_accounts && shipmentData.carrier_accounts.length > 0) {
        const carriers = shipmentData.carrier_accounts.map(c => c.carrier);
        console.error('[SHIPPO][NO-RATES] carrier_accounts:', carriers);
      }
      
      // Log addresses being used (masked)
      console.error('[SHIPPO][NO-RATES] address_from:', {
        street1: providerAddress.street1,
        city: providerAddress.city,
        state: providerAddress.state,
        zip: providerAddress.zip,
        country: providerAddress.country
      });
      console.error('[SHIPPO][NO-RATES] address_to:', {
        street1: customerAddress.street1,
        city: customerAddress.city,
        state: customerAddress.state,
        zip: customerAddress.zip,
        country: customerAddress.country
      });
      
      // Log parcel dimensions
      console.error('[SHIPPO][NO-RATES] parcel:', parcel);
      
      return { success: false, reason: 'no_shipping_rates' };
    }
    
    // Rate selection logic: use provider preference from env
    const preferredProviders = (process.env.SHIPPO_PREFERRED_PROVIDERS || 'UPS,USPS')
      .split(',')
      .map(p => p.trim().toUpperCase())
      .filter(Boolean);
    
    const providersAvailable = availableRates.map(r => r.provider).filter((v, i, a) => a.indexOf(v) === i);
    
    console.log('[SHIPPO][RATE-SELECT] providers_available=' + JSON.stringify(providersAvailable) + ' prefs=' + JSON.stringify(preferredProviders));
    
    // Select rate based on preference order
    let selectedRate = null;
    for (const preferredProvider of preferredProviders) {
      selectedRate = availableRates.find(rate => rate.provider.toUpperCase() === preferredProvider);
      if (selectedRate) {
        console.log(`[SHIPPO][RATE-SELECT] chosen=${selectedRate.provider} (matched preference: ${preferredProvider})`);
        break;
      }
    }
    
    // Fallback: use first available if no preference match
    if (!selectedRate) {
      selectedRate = availableRates[0];
      console.log(`[SHIPPO][RATE-SELECT] chosen=${selectedRate.provider} (fallback: no preference match)`);
    }
    
    console.log('📦 [SHIPPO] Selected rate:', {
      provider: selectedRate.provider,
      service: selectedRate.servicelevel || selectedRate.service,
      rate: selectedRate.rate,
      object_id: selectedRate.object_id
    });
    
    // Create the actual label by purchasing the transaction
    console.log('📦 [SHIPPO] Purchasing label for selected rate...');
    
    // Build transaction payload - only request QR code for USPS
    const transactionPayload = {
      rate: selectedRate.object_id,
      async: false,
      label_file_type: 'PNG',
      metadata: JSON.stringify({ txId }) // Include transaction ID for webhook lookup
    };
    
    // Only request QR code for USPS (UPS doesn't support it)
    if (selectedRate.provider.toUpperCase() === 'USPS') {
      transactionPayload.extra = { qr_code_requested: true };
      console.log('📦 [SHIPPO] Requesting QR code for USPS label');
    } else {
      console.log('📦 [SHIPPO] Skipping QR code request for ' + selectedRate.provider + ' (not USPS)');
    }
    
    console.log('📦 [SHIPPO] Added metadata.txId to transaction payload for webhook lookup');
    
    const transactionRes = await axios.post(
      'https://api.goshippo.com/transactions/',
      transactionPayload,
      {
        headers: {
          'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Always assign before any checks to avoid TDZ
    const shippoTx = transactionRes.data;

    // Check if label purchase was successful
    if (!shippoTx || shippoTx.status !== 'SUCCESS') {
      console.error('❌ [SHIPPO] Label purchase failed:', shippoTx?.messages);
      console.error('❌ [SHIPPO] Transaction status:', shippoTx?.status);
      return { success: false, reason: 'label_purchase_failed', status: shippoTx?.status };
    }

    // One-time debug log after label purchase - safe structured logging of key fields
    if (process.env.SHIPPO_DEBUG === 'true') {
      console.log('[SHIPPO][TX]', logTx(shippoTx));
      console.log('[SHIPPO][RATE]', safePick(selectedRate || {}, ['provider', 'servicelevel', 'service', 'object_id']));
    }
    const tx = shippoTx || {};
    const trackingNumber = tx.tracking_number || null;
    const trackingUrl = tx.tracking_url_provider || null;
    const labelUrl = tx.label_url || null;
    const qrUrl = tx.qr_code_url || null;

    const carrier = selectedRate?.provider ?? null;
    const service = selectedRate?.service?.name ?? selectedRate?.servicelevel?.name ?? null;

    const qrPayload = { trackingNumber, trackingUrl, labelUrl, qrUrl, carrier, service };
    
    console.log('[SHIPPO] QR payload built:', {
      hasTrackingNumber: !!trackingNumber,
      hasTrackingUrl: !!trackingUrl,
      hasLabelUrl: !!labelUrl,
      hasQrUrl: !!qrUrl,
      carrier,
      service,
    });

    console.log('📦 [SHIPPO] Label purchased successfully!');
    console.log('📦 [SHIPPO] Transaction ID:', shippoTx.object_id);
    console.log('📦 [SHIPPO] QR payload built:', {
      hasTrackingNumber: !!qrPayload.trackingNumber,
      hasTrackingUrl: !!qrPayload.trackingUrl,
      hasLabelUrl: !!qrPayload.labelUrl,
      hasQrUrl: !!qrPayload.qrUrl,
      carrier: qrPayload.carrier,
      service: qrPayload.service,
    });

    // DEBUG: prove we got here
    console.log('✅ [SHIPPO] Label created successfully for tx:', txId);

    // Calculate ship-by date using hardened centralized helper
    const bookingStartISO = getBookingStartISO(transaction);
    const shipByDate = computeShipByDate(transaction);
    const shipByStr = shipByDate && formatShipBy(shipByDate);

    // Debug so we can see inputs/outputs clearly
    console.log('[label-ready] bookingStartISO:', bookingStartISO);
    console.log('[label-ready] leadDays:', Number(process.env.SHIP_LEAD_DAYS || 2));
    console.log('[label-ready] shipByDate:', shipByDate ? shipByDate.toISOString() : null);
    console.log('[label-ready] shipByStr:', shipByStr);
    
    // ========== STEP 1: SEND SMS TO LENDER (INDEPENDENT OF PERSISTENCE) ==========
    // SMS must happen immediately after Shippo success, before any persistence attempts
    console.log('[SMS][Step-3] Starting lender notification flow...');
    
    try {
      const lenderPhone = normalizePhone(providerPhone); // must return E.164 like +1415...
      
      if (!lenderPhone) {
        console.warn('[SMS][Step-3] No lender phone available, skipping SMS');
      } else {
        // Compute hasQr for branching logic (any carrier)
        const hasQr = Boolean(qrUrl);
        
        // Prefer a short public tracking link (works for USPS/UPS/etc.)
        const publicTrack = getPublicTrackingUrl(carrier, trackingNumber);
        
        // Avoid the shortener for now since Redis is noisy; use the clean public URL directly
        const linkToSend = publicTrack || trackingUrl || labelUrl;
        
        // Get listing title (truncate if too long to keep SMS compact)
        const rawTitle = (listing && (listing.attributes?.title || listing.title)) || 'your item';
        const listingTitle = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;
        
        // Build SMS body based on QR presence (any carrier) - tighter copy with short links
        let smsBody;
        if (hasQr) {
          // QR code present: use "Scan QR" message (more compact)
          const shortQr = qrUrl; // Use QR URL directly (avoid shortLink for now)
          smsBody = shipByStr
            ? `Sherbrt 🍧: Ship "${listingTitle}" by ${shipByStr}. Scan QR: ${shortQr}`
            : `Sherbrt 🍧: Ship "${listingTitle}". Scan QR: ${shortQr}`;
        } else {
          // No QR code: use "Label" message with short public tracking link
          smsBody = shipByStr
            ? `Sherbrt 🍧: Ship "${listingTitle}" by ${shipByStr}. Label: ${linkToSend}`
            : `Sherbrt 🍧: Ship "${listingTitle}". Label: ${linkToSend}`;
        }
        
        // Log before send
        console.log('[TRACKINGLINK] Using short public link:', linkToSend);
        console.log(`[SMS][Step-3] carrier=${carrier} tracking=${trackingNumber || 'none'} hasQr=${hasQr} txId=${txId}`);
        
        // Send SMS
        await sendSMS(
          lenderPhone,
          smsBody,
          {
            role: 'lender',
            transactionId: txId,
            tag: 'label_ready_to_lender',
            meta: { 
              listingId: listing?.id?.uuid || listing?.id,
              strategy: strategyUsed,
              trackingNumber: trackingNumber,
              hasQr: hasQr
            }
          }
        );
        
        // Log success (sendSMS returns SID in production, undefined in DRY_RUN)
        console.log(`[SMS][Step-3] sent to=${lenderPhone.replace(/(\d{2})\d+(\d{4})/, '$1***$2')} txId=${txId}`);
      }
    } catch (smsError) {
      console.error('[SMS][Step-3] ERROR err=' + smsError.message + ' txId=' + txId);
      console.error('[SMS][Step-3] stack:', smsError.stack);
      // Do not rethrow - SMS failure should not block persistence
    }
    
    // ========== STEP 2: PERSIST TO FLEX (INDEPENDENT OF SMS) ==========
    // Persistence happens after SMS, and failures here don't affect SMS delivery
    console.log('[SHIPPO] Attempting to persist label data to Flex protectedData...');
    
    try {
      const patch = {
        outboundTrackingNumber: trackingNumber,
        outboundTrackingUrl: trackingUrl,
        outboundLabelUrl: labelUrl,
        outboundQrUrl: qrUrl || null,
        outboundCarrier: carrier,
        outboundService: service,
        outboundQrExpiry: parseExpiresParam(qrUrl) || null,
        outboundPurchasedAt: timestamp(), // ← respects FORCE_NOW
        outbound: {
          ...protectedData.outbound,
          shipByDate: shipByDate ? shipByDate.toISOString() : null
        }
      };
      const result = await upsertProtectedData(txId, patch);
      if (result && result.success === false) {
        console.warn('⚠️ [PERSIST] Failed to save outbound label (SMS already sent):', result.error);
      } else {
        console.log('✅ [PERSIST] Stored outbound label fields:', Object.keys(patch).join(', '));
        if (shipByDate) {
          console.log('📅 [PERSIST] Set ship-by date:', shipByDate.toISOString());
        }
      }
    } catch (persistError) {
      console.error('❌ [PERSIST] Exception saving outbound label (SMS already sent):', persistError.message);
      // Do not rethrow - persistence failure should not fail the overall flow
    }

    // Parse expiry from QR code URL (keep existing logic)
    const qrExpiry = parseExpiresParam(qrUrl);
    console.log('📦 [SHIPPO] QR code expiry:', qrExpiry || 'unknown');

    // after outbound purchase success:
    console.log('[SHIPPO][TX]', logTx(shippoTx));

    // Create return shipment (customer → provider) if we have return address
    let returnLabelRes = null;
    let returnQrUrl = null;
    let returnTrackingUrl = null;
    
    try {
      if (protectedData.providerStreet && protectedData.providerCity && protectedData.providerState && protectedData.providerZip) {
        console.log('📦 [SHIPPO] Creating return shipment (customer → provider)...');
        
        const returnPayload = {
          address_from: customerAddress,
          address_to: providerAddress,
          parcels: [parcel],
          async: false
        };

        const returnShipmentRes = await axios.post(
          'https://api.goshippo.com/shipments/',
          returnPayload,
          {
            headers: {
              'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('📦 [SHIPPO] Return shipment created successfully');
        console.log('📦 [SHIPPO] Return Shipment ID:', returnShipmentRes.data.object_id);
        
        // Get return rates and select one
        const returnRates = returnShipmentRes.data.rates || [];
        const returnShipmentData = returnShipmentRes.data;
        
        if (returnRates.length === 0) {
          console.warn('⚠️ [SHIPPO] No return rates available');
          if (returnShipmentData.messages && returnShipmentData.messages.length > 0) {
            console.warn('[SHIPPO][NO-RATES][RETURN] messages:', JSON.stringify(returnShipmentData.messages, null, 2));
          }
        }
        
        if (returnRates.length > 0) {
          // Use same provider preference logic for return labels
          const returnProvidersAvailable = returnRates.map(r => r.provider).filter((v, i, a) => a.indexOf(v) === i);
          console.log('[SHIPPO][RATE-SELECT][RETURN] providers_available=' + JSON.stringify(returnProvidersAvailable));
          
          let returnSelectedRate = null;
          for (const preferredProvider of preferredProviders) {
            returnSelectedRate = returnRates.find(rate => rate.provider.toUpperCase() === preferredProvider);
            if (returnSelectedRate) {
              console.log(`[SHIPPO][RATE-SELECT][RETURN] chosen=${returnSelectedRate.provider} (matched preference: ${preferredProvider})`);
              break;
            }
          }
          
          // Fallback to first available
          if (!returnSelectedRate) {
            returnSelectedRate = returnRates[0];
            console.log(`[SHIPPO][RATE-SELECT][RETURN] chosen=${returnSelectedRate.provider} (fallback)`);
          }
          
          console.log('📦 [SHIPPO] Selected return rate:', {
            provider: returnSelectedRate.provider,
            service: returnSelectedRate.servicelevel || returnSelectedRate.service,
            rate: returnSelectedRate.rate,
            object_id: returnSelectedRate.object_id
          });
          
          // Build return transaction payload - only request QR for USPS
          const returnTransactionPayload = {
            rate: returnSelectedRate.object_id,
            async: false,
            label_file_type: 'PNG',
            metadata: JSON.stringify({ txId }) // Include transaction ID for webhook lookup
          };
          
          if (returnSelectedRate.provider.toUpperCase() === 'USPS') {
            returnTransactionPayload.extra = { qr_code_requested: true };
            console.log('📦 [SHIPPO] Requesting QR code for USPS return label');
          } else {
            console.log('📦 [SHIPPO] Skipping QR code request for ' + returnSelectedRate.provider + ' return label');
          }
          
          console.log('📦 [SHIPPO] Added metadata.txId to return transaction payload for webhook lookup');
          
          // Purchase return label
          const returnTransactionRes = await axios.post(
            'https://api.goshippo.com/transactions/',
            returnTransactionPayload,
            {
              headers: {
                'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (returnTransactionRes.data.status === 'SUCCESS') {
            // One-time debug log for return label purchase
            if (process.env.SHIPPO_DEBUG === 'true') {
              console.log('[SHIPPO][RETURN_TX]', logTx(returnTransactionRes.data));
              console.log('[SHIPPO][RETURN_RATE]', safePick(returnSelectedRate || {}, ['provider', 'servicelevel', 'service', 'object_id']));
            }
            
            returnQrUrl = returnTransactionRes.data.qr_code_url;
            returnTrackingUrl = returnTransactionRes.data.tracking_url_provider || returnTransactionRes.data.tracking_url;
            
            console.log('📦 [SHIPPO] Return label purchased successfully!');
            console.log('📦 [SHIPPO] Return Transaction ID:', returnTransactionRes.data.object_id);
            
            // Persist return label details to Flex protectedData
            try {
              const patch = {
                returnTrackingNumber: returnTransactionRes.data.tracking_number || null,
                returnTrackingUrl: returnTrackingUrl,
                returnLabelUrl: returnTransactionRes.data.label_url || null,
                returnQrUrl: returnQrUrl || null,
                returnCarrier: returnSelectedRate?.provider || null,
                returnService: returnSelectedRate?.service?.name ?? returnSelectedRate?.servicelevel?.name ?? null,
                returnQrExpiry: parseExpiresParam(returnQrUrl || '') || null,
                returnPurchasedAt: timestamp(), // ← respects FORCE_NOW
              };
              const result = await upsertProtectedData(txId, patch);
              if (result && result.success === false) {
                console.warn('⚠️ [PERSIST] Failed to save return label:', result.error);
              } else {
                console.log('✅ [PERSIST] Stored return label fields:', Object.keys(patch).join(', '));
              }
            } catch (e) {
              console.error('❌ [PERSIST] Exception saving return label:', e.message);
            }
          } else {
            console.warn('⚠️ [SHIPPO] Return label purchase failed:', returnTransactionRes.data.messages);
          }
        }
      }
    } catch (returnLabelError) {
      console.error('❌ [SHIPPO] Non-critical step failed', {
        where: 'return-label-creation',
        name: returnLabelError?.name,
        message: returnLabelError?.message,
        status: returnLabelError?.response?.status,
        data: safePick(returnLabelError?.response?.data || {}, ['error', 'message', 'code']),
      });
      // Do not rethrow — allow the HTTP handler to finish normally.
    }


    
    // Send borrower SMS notification (lender SMS already sent immediately after outbound label success)
    try {
      // Extract phone numbers from protectedData (more reliable than nested objects)
      const borrowerPhone = protectedData.customerPhone;
      
      // Optional: Send borrower "Label created" message (idempotent)
      if (borrowerPhone && trackingUrl) {
        // Check if we've already sent this notification
        const existingNotification = protectedData.shippingNotification?.labelCreated;
        if (existingNotification?.sent === true) {
          console.log(`📱 Label created SMS already sent to borrower (${maskPhone(borrowerPhone)}) - skipping`);
        } else {
          await sendSMS(
            borrowerPhone,
            `Sherbrt: your item will ship soon. Track at ${trackingUrl}`,
            { 
              role: 'customer',
              transactionId: txId,
              transition: 'transition/accept',
              tag: 'label_created_to_borrower',
              meta: { listingId: listing?.id?.uuid || listing?.id }
            }
          );
          console.log(`📱 SMS sent to borrower (${maskPhone(borrowerPhone)}) for label created with tracking: ${maskUrl(trackingUrl)}`);
          
          // Mark as sent in protectedData
          try {
            const notificationResult = await upsertProtectedData(txId, {
              shippingNotification: {
                labelCreated: { sent: true, sentAt: timestamp() } // ← respects FORCE_NOW
              }
            });
            if (notificationResult && notificationResult.success === false) {
              console.warn('⚠️ [PERSIST] Failed to save notification state:', notificationResult.error);
            } else {
              console.log(`✅ [PERSIST] Updated shippingNotification.labelCreated`);
            }
          } catch (updateError) {
            console.warn(`❌ [PERSIST] Exception saving notification state:`, updateError.message);
          }
        }
      } else if (borrowerPhone) {
        console.log(`📱 Borrower phone found but no tracking URL available - no immediate notification sent`);
      } else {
        console.log(`📱 Borrower phone number not found - no immediate notification sent`);
      }
      
    } catch (smsError) {
      console.error('❌ Failed to send borrower SMS notification:', smsError.message);
      // Don't fail the label creation if SMS fails
    }
    
    return { 
      success: true, 
      outboundLabel: {
        label_url: labelUrl,
        qr_code_url: qrUrl,
        tracking_url_provider: trackingUrl
      }, 
      returnLabel: returnQrUrl ? {
        qr_code_url: returnQrUrl,
        tracking_url_provider: returnTrackingUrl
      } : null
    };
    
  } catch (err) {
    // Check if this is a Shippo API error (actual label creation failure)
    const isShippoError = err?.response?.status || err?.status;
    const isNetworkError = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT';
    
    if (isShippoError || isNetworkError) {
      const details = {
        name: err?.name,
        message: err?.message,
        status: err?.status || err?.response?.status,
        statusText: err?.statusText || err?.response?.statusText,
        data: err?.response?.data ? safePick(err.response.data, ['error', 'message', 'code']) : undefined,
      };
      console.error('[SHIPPO] Label creation failed (Shippo API error)', details);
      return { success: false, reason: 'shippo_api_error', error: err.message };
    } else {
      // This is likely a downstream error (SMS, persistence, etc.) - don't mark label creation as failed
      console.error('[SHIPPO] Downstream operation failed (label creation succeeded)', {
        name: err?.name,
        message: err?.message,
        stack: err?.stack?.split('\n')[0], // Just first line of stack
      });
      return { success: false, reason: 'downstream_error', error: err.message };
    }
  }
}

module.exports = async (req, res) => {
  console.log('🚀 transition-privileged endpoint HIT!');
  console.log('📋 Request method:', req.method);
  console.log('📋 Request URL:', req.url);
  
  // STEP 1: Confirm the endpoint is hit
  console.log('🚦 transition-privileged endpoint is wired up');
  
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body;
  
  // STEP 2: Log the transition type
  console.log('🔁 Transition received:', bodyParams?.transition);
  
  // STEP 3: Check that sendSMS is properly imported
  console.log('📱 sendSMS function available:', !!sendSMS);
  console.log('📱 sendSMS function type:', typeof sendSMS);
  
  // Debug log for full request body
  console.log('🔍 Full request body:', {
    isSpeculative,
    orderData,
    bodyParams,
    queryParams,
    params: bodyParams?.params,
    rawBody: req.body,
    headers: req.headers
  });

  // Log protectedData received from frontend
  if (bodyParams?.params?.protectedData) {
    console.log('🛬 [BACKEND] Received protectedData:', bodyParams.params.protectedData);
  }

  // Properly await the SDK initialization
  const sdk = await getTrustedSdk(req);
  let lineItems = null;

  // Extract uuid from listingId if needed
  const listingId = bodyParams?.params?.listingId?.uuid || bodyParams?.params?.listingId;
  const transactionId = bodyParams?.params?.transactionId?.uuid || bodyParams?.params?.transactionId;
  console.log('🟠 About to call sdk.listings.show with listingId:', listingId);

  // Debug log for listingId and transaction details
  console.log('📋 Request parameters check:', {
    listingId: listingId,
    hasListingId: !!listingId,
    transition: bodyParams?.transition,
    params: bodyParams?.params,
    transactionId: transactionId,
    hasTransactionId: !!transactionId
  });

  // Verify we have the required parameters before making the API call
  // For accept, we only need the transactionId. For other transitions we expect listingId.
  if (!listingId && bodyParams?.transition !== 'transition/accept') {
    console.error('❌ EARLY RETURN: Missing required listingId parameter');
    return res.status(400).json({
      errors: [{
        status: 400,
        code: 'validation-missing-key',
        title: 'Missing required listingId parameter'
      }]
    });
  }

  const listingPromise = () => {
    console.log('📡 Making listing API call with params:', {
      listingId: listingId,
      url: '/v1/api/listings/show'
    });
    return sdk.listings.show({ id: listingId });
  };

  try {
    const [showListingResponse, fetchAssetsResponse] = await Promise.all([listingPromise(), fetchCommission(sdk)]);
    
    console.log('✅ Listing API response:', {
      status: showListingResponse?.status,
      hasData: !!showListingResponse?.data?.data,
      listingId: showListingResponse?.data?.data?.id
    });

    const listing = showListingResponse.data.data;
    const commissionAsset = fetchAssetsResponse.data.data[0];

    const { providerCommission, customerCommission } =
      commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

    // Debug log for orderData
    console.log("📦 orderData for lineItems:", orderData);

    // Only calculate lineItems here if not transition/accept
    let transition = bodyParams?.transition;
    if (transition !== 'transition/accept') {
      if (orderData) {
        lineItems = transactionLineItems(
          listing,
          { ...orderData, ...bodyParams.params },
          providerCommission,
          customerCommission
        );
      } else {
        console.warn("⚠️ No orderData provided for non-accept transition. This may cause issues.");
      }
    } else {
      console.log("ℹ️ Skipping lineItems generation — transition/accept will calculate from booking.");
    }

    // Debug log for lineItems
    console.log('💰 Generated lineItems:', {
      hasLineItems: !!lineItems,
      lineItemsCount: lineItems?.length,
      lineItems,
      params: bodyParams?.params,
      listingId: listing?.id
    });

    // Omit listingId from params (transition/request-payment-after-inquiry does not need it)
    const { listingId: _, ...restParams } = bodyParams?.params || {};

    // Always include protectedData in params if present
    let params = { ...restParams };
    if (orderData && orderData.protectedData) {
      params.protectedData = orderData.protectedData;
    }
    // Always include lineItems if present
    if (lineItems) {
      params.lineItems = lineItems;
    }

    // Set id for transition/request-payment and transition/accept
    let id = null;
    // Defensive check for bodyParams and .transition
    if (bodyParams && (bodyParams.transition === 'transition/request-payment' || bodyParams.transition === 'transition/confirm-payment')) {
      id = transactionId;
      
      // Sanitize incoming protectedData for request-payment to avoid blank strings overwriting existing values
      if (params.protectedData) {
        const cleaned = Object.fromEntries(
          Object.entries(params.protectedData).filter(([, v]) => v != null && String(v).trim() !== '')
        );
        
        // Server-side phone normalization (safety net for E.164)
        if (cleaned.customerPhone) {
          cleaned.customerPhone = normalizePhoneE164(cleaned.customerPhone, 'US');
          console.log('📞 [request-payment] Normalized customerPhone to E.164:', cleaned.customerPhone);
        }
        if (cleaned.providerPhone) {
          cleaned.providerPhone = normalizePhoneE164(cleaned.providerPhone, 'US');
        }
        if (cleaned.customerPhoneShipping) {
          cleaned.customerPhoneShipping = normalizePhoneE164(cleaned.customerPhoneShipping, 'US');
        }
        
        params.protectedData = cleaned;
        console.log('🧹 [request-payment] Sanitized protectedData keys:', Object.keys(cleaned));
      }
    } else if (bodyParams && bodyParams.transition === 'transition/accept') {
      id = transactionId;
      // --- [AI EDIT] Fetch protectedData from transaction and robustly merge with incoming params ---
      const transactionIdUUID =
        (bodyParams?.params?.transactionId?.uuid) ||
        (transactionId?.uuid) ||
        (typeof transactionId === 'string' ? transactionId : null);
      if (bodyParams?.transition === 'transition/accept' && transactionIdUUID) {
        try {
          const transaction = await sdk.transactions.show({
            id: transactionIdUUID,
            include: ['booking'],
          });
          const txProtectedData = transaction?.data?.data?.attributes?.protectedData || {};
          const incomingProtectedData = bodyParams?.params?.protectedData || {};
          
          // Debug logging to understand the data flow
          console.log('🔍 [DEBUG] Transaction protectedData:', txProtectedData);
          console.log('🔍 [DEBUG] Incoming protectedData:', incomingProtectedData);
          console.log('🔍 [DEBUG] Transaction customer relationship:', transaction?.data?.data?.relationships?.customer);
          
          // Remove blank updates from incoming data
          const cleaned = Object.fromEntries(
            Object.entries(incomingProtectedData).filter(([, v]) => v != null && String(v).trim() !== '')
          );
          
          // Now merge: transaction first, then cleaned updates
          const mergedProtectedData = { ...txProtectedData, ...cleaned };
          
          // Explicitly protect customer* fields from being overwritten by blank strings:
          const CUSTOMER_KEYS = [
            'customerName','customerStreet','customerStreet2','customerCity',
            'customerState','customerZip','customerEmail','customerPhone'
          ];
          for (const k of CUSTOMER_KEYS) {
            if ((mergedProtectedData[k] == null || mergedProtectedData[k] === '') && txProtectedData[k]) {
              mergedProtectedData[k] = txProtectedData[k];
            }
          }
          
          console.log('[server accept] merged PD keys:', Object.keys(mergedProtectedData));

          // Set both params.protectedData and top-level fields from mergedProtectedData
          params.protectedData = mergedProtectedData;
          Object.assign(params, mergedProtectedData); // Overwrite top-level fields with merged values
          // Log the final params before validation
          console.log('🟢 Params before validation:', params);
          // Debug log for final merged provider fields
          console.log('✅ [MERGE FIX] Final merged provider fields:', {
            providerStreet: mergedProtectedData.providerStreet,
            providerCity: mergedProtectedData.providerCity,
            providerState: mergedProtectedData.providerState,
            providerZip: mergedProtectedData.providerZip,
            providerEmail: mergedProtectedData.providerEmail,
            providerPhone: mergedProtectedData.providerPhone
          });
        } catch (err) {
          console.error('❌ Failed to fetch or apply protectedData from transaction:', err.message);
        }
      }
    } else if (bodyParams && (bodyParams.transition === 'transition/decline' || bodyParams.transition === 'transition/expire' || bodyParams.transition === 'transition/cancel')) {
      // Use transactionId for transaction-based transitions
      id = transactionId;
      console.log('🔧 Using transactionId for transaction-based transition:', bodyParams.transition);
    } else {
      id = listingId;
    }

    // Log bodyParams.params after protectedData is applied
    console.log('📝 [DEBUG] bodyParams.params after protectedData applied:', bodyParams.params);

    // Defensive log for id
    console.log('🟢 Using id for Flex API call:', id);

    // IMPORTANT: use the merged params object we built above
    const body = {
      id,
      transition: bodyParams?.transition,
      params, // merged / cleaned / validated
    };

    // Log the final body before transition
    console.log('🚀 [DEBUG] Final body sent to Flex API:', JSON.stringify(body, null, 2));
    console.log('📦 [DEBUG] Full body object:', body);
    if (body.params && body.params.protectedData) {
      console.log('🔒 [DEBUG] protectedData in final body:', body.params.protectedData);
    }

    console.log('🔍 [DEBUG] About to start validation logic...');

    // Add error handling around validation logic
    try {
      console.log('🔍 [DEBUG] Starting validation checks...');
      
      const ACCEPT_TRANSITION = 'transition/accept';
      const transition = bodyParams?.transition;
      
      // Validate required provider and customer address fields before making the SDK call
      const requiredProviderFields = [
        'providerStreet',
        'providerCity',
        'providerState',
        'providerZip',
        'providerEmail',
        'providerPhone',
      ];
      // Customer fields are NOT required at accept; they're optional.
      const requiredCustomerFields = [];
      
      console.log('🔍 [DEBUG] Required provider fields:', requiredProviderFields);
      console.log('🔍 [DEBUG] Required customer fields:', requiredCustomerFields);
      console.log('🔍 [DEBUG] Provider field values:', {
        providerStreet: params.providerStreet,
        providerCity: params.providerCity,
        providerState: params.providerState,
        providerZip: params.providerZip,
        providerEmail: params.providerEmail,
        providerPhone: params.providerPhone
      });
      console.log('🔍 [DEBUG] Customer field values:', {
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        customerStreet: params.customerStreet,
        customerCity: params.customerCity,
        customerState: params.customerState,
        customerZip: params.customerZip,
        customerPhone: params.customerPhone
      });
      
      // Validate only PROVIDER fields on accept.
      if (transition === ACCEPT_TRANSITION) {
        console.log('🔍 [DEBUG] Validating provider fields for transition/accept');
        // Check both the flattened params and params.protectedData
        const pd = params?.protectedData || {};
        const missingProvider = requiredProviderFields.filter(
          k => !(params?.[k] ?? pd?.[k])
        );
        if (missingProvider.length) {
          console.error('❌ [server][accept] missing provider fields:', missingProvider);
          return res.status(422).json({
            code: 'transition/accept-missing-provider',
            message: 'Missing provider fields for accept transition.',
            missing: missingProvider,
          });
        }
      }
      
      console.log('✅ Validation completed successfully');
    } catch (validationError) {
      console.error('❌ Validation error:', validationError);
      console.error('❌ Validation error stack:', validationError.stack);
      return res.status(500).json({ error: 'Validation error', details: validationError.message });
    }

    // Perform the actual transition
    let transitionName;
    try {
      console.log('🎯 About to make SDK transition call:', {
        transition: bodyParams?.transition,
        id: id,
        isSpeculative: isSpeculative
      });
      
      // If this is transition/accept, log the transaction state before attempting
      if (bodyParams && bodyParams.transition === 'transition/accept') {
        try {
          const transactionShow = await sdk.transactions.show({ id: id });
          console.log('🔎 Current state:', transactionShow.data.data.attributes.state);
          console.log('🔎 Last transition:', transactionShow.data.data.attributes.lastTransition);
          // Log protectedData from transaction entity
          console.log('🔎 [BACKEND] Transaction protectedData:', transactionShow.data.data.attributes.protectedData);
          // If params.protectedData is missing or empty, fallback to transaction's protectedData
          if (!params.protectedData || Object.values(params.protectedData).every(v => v === '' || v === undefined)) {
            params.protectedData = transactionShow.data.data.attributes.protectedData || {};
            console.log('🔁 [BACKEND] Fallback: Using transaction protectedData for accept:', params.protectedData);
          }
        } catch (showErr) {
          console.error('❌ Failed to fetch transaction before accept:', showErr.message);
        }
      }
      
      console.log('🚀 Making final SDK transition call...');
      const response = isSpeculative
        ? await sdk.transactions.transitionSpeculative(body, queryParams)
        : await sdk.transactions.transition(body, queryParams);
      
      console.log('✅ SDK transition call SUCCESSFUL:', {
        status: response?.status,
        hasData: !!response?.data,
        transition: response?.data?.data?.attributes?.transition
      });
      
      // After successful transition, fetch fully expanded transaction for ship-by calculations
      let expandedTx = response?.data?.data;
      if (bodyParams?.transition === 'transition/accept') {
        try {
          const txId = bodyParams?.params?.transactionId?.uuid || bodyParams?.id || id;
          console.log('🔍 Fetching expanded transaction for ship-by calculations:', txId);
          
          const { data: expandedResponse } = await sdk.transactions.show({ id: txId }, { 
            include: ['booking', 'listing', 'provider', 'customer'], 
            expand: true 
          });
          
          expandedTx = expandedResponse?.data;
          console.log('✅ Expanded transaction fetched successfully for ship-by calculations');
        } catch (expandError) {
          console.warn('⚠️ Failed to fetch expanded transaction, using original response:', expandError.message);
        }
      }
      
      // Set acceptedAt for transition/accept if not already set
      if (bodyParams?.transition === 'transition/accept' && response?.data?.data) {
        const transaction = response.data.data;
        const protectedData = transaction.attributes.protectedData || {};
        const outbound = protectedData.outbound || {};
        
        if (!outbound.acceptedAt) {
          try {
            const txId = transaction.id.uuid || transaction.id;
            const result = await upsertProtectedData(txId, {
              outbound: {
                ...outbound,
                acceptedAt: timestamp() // ← respects FORCE_NOW
              }
            });
            
            if (result && result.success === false) {
              console.error('❌ Failed to set acceptedAt (non-critical):', result.error);
            } else {
              console.log('💾 Set outbound.acceptedAt for transition/accept');
            }
          } catch (updateError) {
            console.error('❌ Failed to set acceptedAt (non-critical):', updateError.message);
            // Do not rethrow - this is a non-essential update
          }
        }
      }
      
      // After booking (request-payment), log the transaction's protectedData
      if (bodyParams && bodyParams.transition === 'transition/request-payment' && response && response.data && response.data.data && response.data.data.attributes) {
        console.log('🧾 Booking complete. Transaction protectedData:', response.data.data.attributes.protectedData);
      }
      
      // Defensive: Only access .transition if response and response.data are defined
      if (
        response &&
        response.data &&
        response.data.data &&
        response.data.data.attributes &&
        typeof response.data.data.attributes.transition !== 'undefined'
      ) {
        transitionName = response.data.data.attributes.transition;
      }
      
      // Debug transitionName
      console.log('🔍 transitionName after response:', transitionName);
      console.log('🔍 bodyParams.transition:', bodyParams?.transition);
      
      // STEP 4: Add a forced test log
      console.log('🧪 Inside transition-privileged — beginning SMS evaluation');
      
      // Dynamic provider SMS for booking requests - replace hardcoded test SMS
      const effectiveTransition = transitionName || bodyParams?.transition;
      console.log('🔍 Using effective transition for SMS:', effectiveTransition);
      
      if (effectiveTransition === 'transition/accept') {
        console.log('📨 Preparing to send SMS for transition/accept');
        
        // Skip SMS on speculative calls
        if (isSpeculative) {
          console.log('⏭️ Skipping SMS - speculative call');
          return;
        }
        
        try {
          // Resolve phone numbers with robust fallbacks
          const pd = params?.protectedData || {};
          const txPD = response?.data?.data?.protectedData || {};
          const tx = response?.data?.data;
          
          const borrowerPhone = getBorrowerPhone(params, tx);
          const lenderPhone = getLenderPhone(params, tx);
          
          console.log('[sms] resolved phones:', { 
            borrowerPhone: maskPhone(borrowerPhone), 
            lenderPhone: maskPhone(lenderPhone) 
          });
          
          // Get listing info for messages
          const listingTitle = listing?.attributes?.title || 'your item';
          const providerName = params?.protectedData?.providerName || 'the lender';
          
          // Build site base for borrower inbox link
          const siteBase = process.env.ROOT_URL || (req ? `${req.protocol}://${req.get('host')}` : null);
          const buyerLink = siteBase ? `${siteBase}/inbox/purchases` : '';
          
          // Borrower acceptance SMS: always try if borrowerPhone exists
          if (borrowerPhone) {
            console.log('[sms] sending borrower_accept ...');
            const borrowerMessage = `🎉 Your Sherbrt request was accepted! 🍧
"${listingTitle}" from ${providerName} is confirmed. 
You'll receive tracking info once it ships! ✈️👗 ${buyerLink}`;
            
            try {
              await sendSMS(borrowerPhone, borrowerMessage, { 
                role: 'customer',
                transactionId: transactionId,
                transition: 'transition/accept',
                tag: 'accept_to_borrower',
                meta: { listingId: listing?.id?.uuid || listing?.id }
              });
              console.log('✅ SMS sent successfully to borrower');
            } catch (err) {
              console.error('❌ Borrower SMS send error:', err.message);
            }
          } else {
            console.warn('[sms] borrower phone not found; skipped borrower accept SMS');
          }
          
          // Lender SMS: only send on accept if explicitly enabled
          if (process.env.SMS_LENDER_ON_ACCEPT === '1') {
            if (lenderPhone) {
              console.log('[sms] sending lender_accept_no_label ...');
              const lenderMessage = `✅ Your Sherbrt item "${listingTitle}" was accepted! Please prepare for shipping.`;
              
              try {
                await sendSMS(lenderPhone, lenderMessage, { 
                  role: 'lender',
                  transactionId: transactionId,
                  transition: 'transition/accept',
                  tag: 'accept_to_lender',
                  meta: { listingId: listing?.id?.uuid || listing?.id }
                });
                console.log('✅ SMS sent successfully to lender');
              } catch (err) {
                console.error('❌ Lender SMS send error:', err.message);
              }
            } else {
              console.warn('[sms] lender phone not found; skipped lender SMS');
            }
          } else {
            console.log('[sms] lender-on-accept suppressed (by flag).');
          }
          
        } catch (smsError) {
          console.error('❌ Failed to send SMS notification:', smsError.message);
          console.error('❌ SMS error stack:', smsError.stack);
          // Don't fail the transaction if SMS fails
        }
      }

      if (effectiveTransition === 'transition/decline') {
        console.log('📨 Preparing to send SMS for transition/decline');
        
        // Skip SMS on speculative calls
        if (isSpeculative) {
          console.log('⏭️ Skipping SMS - speculative call');
          return;
        }
        
        try {
          // Use the helper function to get borrower phone with fallbacks
          const borrowerPhone = getBorrowerPhone(params, response?.data?.data);
          
          // Log the selected phone number and role for debugging
          console.log('📱 Selected borrower phone:', maskPhone(borrowerPhone));
          console.log('📱 SMS role: customer');
          console.log('🔍 Transition: transition/decline');
          
          if (borrowerPhone) {
            const message = `😔 Your Sherbrt request was declined. Don't worry — more fabulous looks are waiting to be borrowed!`;
            
            // Wrap sendSMS in try/catch with logs
            try {
              await sendSMS(borrowerPhone, message, { 
                role: 'customer',
                transactionId: transactionId,
                transition: 'transition/decline',
                tag: 'reject_to_borrower',
                meta: { listingId: listing?.id?.uuid || listing?.id }
              });
              console.log('✅ SMS sent successfully to borrower');
              console.log(`📱 SMS sent to borrower (${maskPhone(borrowerPhone)}) for declined request`);
            } catch (err) {
              console.error('❌ SMS send error:', err.message);
              console.error('❌ SMS error stack:', err.stack);
            }
          } else {
            console.warn('⚠️ Borrower phone number not found - cannot send decline SMS');
            console.warn('⚠️ Check params.protectedData.customerPhone or transaction data');
          }
        } catch (smsError) {
          console.error('❌ Failed to send SMS notification:', smsError.message);
          console.error('❌ SMS error stack:', smsError.stack);
          // Don't fail the transaction if SMS fails
        }
      }
      
      // Shippo label creation - only for transition/accept after successful transition
      if (bodyParams?.transition === 'transition/accept' && !isSpeculative) {
        console.log('🚀 [SHIPPO] Transition successful, triggering Shippo label creation...');
        
        // Use the validated and merged protectedData from params
        const finalProtectedData = params.protectedData || {};
        console.log('📋 [SHIPPO] Final protectedData for label creation:', finalProtectedData);
        
        // Hard guard: Check for required customer address fields before Shippo
        if (!hasCustomerShipAddress(finalProtectedData)) {
          const missingFields = [];
          if (!finalProtectedData.customerStreet?.trim()) missingFields.push('customerStreet');
          if (!finalProtectedData.customerZip?.trim()) missingFields.push('customerZip');
          
          console.log(`[SHIPPO] Missing address fields; aborting label creation and transition: ${missingFields.join(', ')}`);
          return res.status(400).json({ 
            code: 'incomplete_customer_address',
            message: 'Customer address is incomplete for shipping',
            missingFields 
          });
        }
        
        // Trigger Shippo label creation asynchronously (don't await to avoid blocking response)
        createShippingLabels({
          txId: transactionId,
          listing,
          protectedData: finalProtectedData,
          providerPhone: finalProtectedData?.providerPhone,
          integrationSdk: sdk,
          sendSMS,
          normalizePhone: (p) => {
            const digits = (p || '').replace(/\D/g, '');
            if (!digits) return null;
            return digits.startsWith('1') ? `+${digits}` : `+1${digits}`;
          },
          selectedRate: null, // Will be set inside the function
          transaction: expandedTx || response?.data?.data
        })
          .then(result => {
            if (result.success) {
              console.log('✅ [SHIPPO] Label creation completed successfully');
            } else {
              console.warn('⚠️ [SHIPPO] Label creation failed:', result.reason);
            }
          })
          .catch(err => {
            console.error('❌ [SHIPPO] Unexpected error in label creation:', err.message);
          });
      }
      
      // 🔧 FIXED: Lender notification SMS for booking requests - ensure provider phone only
      if (
        bodyParams?.transition === 'transition/request-payment' &&
        !isSpeculative &&
        response?.data?.data
      ) {
        console.log('📨 [SMS][booking-request] Preparing to send lender notification SMS');

        try {
          const transaction = response?.data?.data;
          
          // Helpers for ID and phone resolution
          const asId = v => (v && v.uuid) ? v.uuid : (typeof v === 'string' ? v : null);
          const getPhone = u =>
            u?.attributes?.profile?.protectedData?.phone ??
            u?.attributes?.profile?.protectedData?.phoneNumber ??
            u?.attributes?.profile?.publicData?.phone ??
            u?.attributes?.profile?.publicData?.phoneNumber ?? null;

          // Resolve provider (lender) and customer (borrower) IDs defensively
          const providerId =
            asId(transaction?.provider?.id) ||
            asId(transaction?.relationships?.provider?.data?.id) ||
            asId(listing?.relationships?.author?.data?.id);

          const customerId =
            asId(transaction?.customer?.id) ||
            asId(transaction?.relationships?.customer?.data?.id);

          if (!providerId) {
            console.warn('[SMS][booking-request] No provider ID found; not sending SMS');
            return;
          }

          // Fetch provider user explicitly (never from currentUser or transaction.protectedData)
          const providerRes = await sdk.users.show({ id: providerId });
          const providerUser = providerRes?.data?.data;
          const providerPhone = getPhone(providerUser);

          // Borrower phone only for safety comparison (not as fallback recipient)
          let borrowerPhone = null;
          if (customerId) {
            const customerRes = await sdk.users.show({ id: customerId });
            borrowerPhone = getPhone(customerRes?.data?.data);
          }

          console.log('[SMS][booking-request]', { 
            txId: transaction?.id?.uuid || transaction?.id, 
            providerId, 
            customerId, 
            providerPhone, 
            borrowerPhone 
          });

          if (!providerPhone) {
            console.warn('[SMS][booking-request] Provider missing phone; not sending', { 
              txId: transaction?.id?.uuid || transaction?.id, 
              providerId 
            });
            return;
          }

          if (borrowerPhone && providerPhone === borrowerPhone) {
            console.error('[SMS][booking-request] Borrower phone detected for lender notice; aborting', { 
              txId: transaction?.id?.uuid || transaction?.id 
            });
            return;
          }

          if (sendSMS) {
            const message = `👗🍧 New Sherbrt booking request! Someone wants to borrow your item "${listing?.attributes?.title || 'your listing'}". Tap your dashboard to respond.`;
            
            await sendSMS(providerPhone, message, { 
              role: 'lender',
              transactionId: transaction?.id?.uuid || transaction?.id,
              transition: 'transition/request-payment',
              tag: 'booking_request_to_lender',
              meta: { listingId: listing?.id?.uuid || listing?.id }
            });
            console.log(`✅ [SMS][booking-request] SMS sent to provider ${maskPhone(providerPhone)}`);
          } else {
            console.warn('⚠️ [SMS][booking-request] sendSMS unavailable');
          }
        } catch (err) {
          console.error('❌ [SMS][booking-request] Error in lender notification logic:', err.message);
        }
      }
      
      console.log('✅ Transition completed successfully, returning:', { transition: transitionName });
      return res.status(200).json({ transition: transitionName });
    } catch (err) {
      console.error('❌ SDK transition call FAILED:', {
        error: err,
        errorMessage: err.message,
        errorResponse: err.response?.data,
        errorStatus: err.response?.status,
        errorStatusText: err.response?.statusText,
        fullError: JSON.stringify(err, null, 2)
      });
      return res.status(500).json({ error: 'Transition failed' });
    }
  } catch (e) {
    const errorData = e.response?.data;
    console.error("❌ Flex API error:", errorData || e);
    return res.status(500).json({ 
      error: "Flex API error",
      details: errorData || e.message
    });
  }
};

// Add a top-level handler for unhandled promise rejections to help diagnose Render 'failed service' issues
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Optionally exit the process if desired:
  // process.exit(1);
});


#!/usr/bin/env node

const express = require('express');
const { getTrustedSdk } = require('../api-util/sdk');
const { getTrustedSdk: getIntegrationSdk } = require('../api-util/integrationSdk');
const { upsertProtectedData } = require('../lib/txData');
const { timestamp } = require('../util/time');
const { shortLink } = require('../api-util/shortlink');
const { SMS_TAGS } = require('../lib/sms/tags');
const { toCarrierPhase, isShippedStatus, isDeliveredStatus } = require('../lib/statusMap');
const { getPublicTrackingUrl } = require('../lib/trackingLinks');

// In-memory LRU cache for first-scan idempotency (24h TTL)
// Format: Map<trackingNumber, timestamp>
const firstScanCache = new Map();
const FIRST_SCAN_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Clean up expired entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of firstScanCache.entries()) {
    if (now - timestamp > FIRST_SCAN_TTL) {
      firstScanCache.delete(key);
    }
  }
}, 60 * 60 * 1000); // 1 hour

// Conditional import of sendSMS to prevent module loading errors
let sendSMS = null;
try {
  const smsModule = require('../api-util/sendSMS');
  sendSMS = smsModule.sendSMS;
} catch (error) {
  console.warn('⚠️ SMS module not available — SMS functionality disabled');
  sendSMS = () => Promise.resolve(); // No-op function
}

// Shippo signature verification
function verifyShippoSignature(req, webhookSecret) {
  const shippoSignature = req.headers['x-shippo-signature'];
  if (!shippoSignature) {
    console.log('⚠️ No X-Shippo-Signature header found');
    return false;
  }
  
  if (!webhookSecret) {
    console.log('⚠️ No SHIPPO_WEBHOOK_SECRET configured');
    return false;
  }
  
  // Use the raw body for signature verification
  const rawBody = req.rawBody;
  
  // Shippo uses HMAC SHA256
  const crypto = require('crypto');
  const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');
  
  const isValid = crypto.timingSafeEqual(
    Buffer.from(shippoSignature),
    Buffer.from(signature)
  );
  
  if (process.env.VERBOSE === '1') {
    console.log(`🔐 Shippo signature verification: ${isValid ? 'VALID' : 'INVALID'}`);
    console.log(`🔐 Expected: ${signature}`);
    console.log(`🔐 Received: ${shippoSignature}`);
  }
  
  return isValid;
}

const router = express.Router();

// Middleware to capture raw body for signature verification
router.use('/shippo', express.raw({ type: 'application/json' }), (req, res, next) => {
  // Store raw body for signature verification
  req.rawBody = req.body;
  // Parse JSON for processing
  try {
    req.body = JSON.parse(req.body.toString());
  } catch (error) {
    console.error('❌ Failed to parse JSON body:', error.message);
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  next();
});

// Helper function to normalize phone number to E.164 format
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // If it's already in E.164 format (starts with +), return as is
  if (phone.startsWith('+')) {
    return phone;
  }
  
  // If it's 10 digits, assume US number and add +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // If it's 11 digits and starts with 1, add +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  // For any other format, try to make it work
  if (digits.length >= 10) {
    return `+${digits}`;
  }
  
  console.warn(`📱 Could not normalize phone number: ${phone}`);
  return null;
}

// Helper function to find transaction by tracking number
async function findTransactionByTrackingNumber(sdk, trackingNumber) {
  console.log(`🔍 Searching for transaction with tracking number: ${trackingNumber}`);
  
  try {
    // Query last 100 transactions to find matching tracking number
    const query = {
      limit: 100,
      include: ['customer', 'listing']
    };
    
    const response = await sdk.transactions.query(query);
    const transactions = response.data.data;
    
    console.log(`📊 Searched ${transactions.length} transactions for tracking number`);
    
    // Look for transaction with matching tracking number
    for (const transaction of transactions) {
      const protectedData = transaction.attributes.protectedData || {};
      
      if (protectedData.outboundTrackingNumber === trackingNumber || 
          protectedData.returnTrackingNumber === trackingNumber) {
        console.log(`✅ Found transaction ${transaction.id} with tracking number ${trackingNumber}`);
        return transaction;
      }
    }
    
    console.warn(`⚠️ No transaction found with tracking number: ${trackingNumber}`);
    return null;
    
  } catch (error) {
    console.error(`❌ Error searching for transaction with tracking number:`, error.message);
    return null;
  }
}

// Helper function to get borrower phone number
function getBorrowerPhone(transaction) {
  console.log('📱 Extracting borrower phone number...');
  
  try {
    // Method 1: transaction.customer.profile.protectedData.phone
    if (transaction.relationships?.customer?.data?.attributes?.profile?.protectedData?.phone) {
      const phone = transaction.relationships.customer.data.attributes.profile.protectedData.phone;
      console.log(`📱 Found phone in customer profile: ${phone}`);
      return normalizePhoneNumber(phone);
    }
    
    // Method 2: transaction.protectedData.customerPhone
    if (transaction.attributes?.protectedData?.customerPhone) {
      const phone = transaction.attributes.protectedData.customerPhone;
      console.log(`📱 Found phone in transaction protectedData: ${phone}`);
      return normalizePhoneNumber(phone);
    }
    
    // Method 3: transaction.attributes.metadata.customerPhone
    if (transaction.attributes?.metadata?.customerPhone) {
      const phone = transaction.attributes.metadata.customerPhone;
      console.log(`📱 Found phone in transaction metadata: ${phone}`);
      return normalizePhoneNumber(phone);
    }
    
    console.warn('⚠️ No borrower phone number found in any location');
    return null;
    
  } catch (error) {
    console.error('❌ Error extracting borrower phone:', error.message);
    return null;
  }
}

// Helper function to get lender phone number
function getLenderPhone(transaction) {
  console.log('📱 Extracting lender phone number...');
  
  try {
    // Method 1: transaction.provider.profile.protectedData.phone
    if (transaction.relationships?.provider?.data?.attributes?.profile?.protectedData?.phone) {
      const phone = transaction.relationships.provider.data.attributes.profile.protectedData.phone;
      console.log(`📱 Found lender phone in provider profile: ${phone}`);
      return normalizePhoneNumber(phone);
    }
    
    // Method 2: transaction.protectedData.providerPhone
    if (transaction.attributes?.protectedData?.providerPhone) {
      const phone = transaction.attributes.protectedData.providerPhone;
      console.log(`📱 Found lender phone in transaction protectedData: ${phone}`);
      return normalizePhoneNumber(phone);
    }
    
    // Method 3: transaction.attributes.metadata.providerPhone
    if (transaction.attributes?.metadata?.providerPhone) {
      const phone = transaction.attributes.metadata.providerPhone;
      console.log(`📱 Found lender phone in transaction metadata: ${phone}`);
      return normalizePhoneNumber(phone);
    }
    
    console.warn('⚠️ No lender phone number found in any expected location');
    return null;
  } catch (error) {
    console.error('❌ Error extracting lender phone:', error.message);
    return null;
  }
}

// Main webhook handler logic (extracted for reusability)
async function handleTrackingWebhook(req, res, opts = {}) {
  const { skipSignature = false, isTest = false } = opts;
  
  const eventType = req.body?.event || 'unknown';
  const testPrefix = isTest ? '[TEST] ' : '';
  console.log(`${testPrefix}🚀 Shippo webhook received! event=${eventType}`);
  console.log(`${testPrefix}📋 Request body:`, JSON.stringify(req.body, null, 2));
  
  // Verify Shippo signature (skip if not configured for test environments or if skipSignature is set)
  if (!skipSignature) {
    const webhookSecret = process.env.SHIPPO_WEBHOOK_SECRET;
    if (webhookSecret) {
      if (!verifyShippoSignature(req, webhookSecret)) {
        console.log(`${testPrefix}🚫 Invalid Shippo signature - rejecting request`);
        return res.status(403).json({ error: 'Invalid signature' });
      }
      console.log(`${testPrefix}✅ Shippo signature verified`);
    } else {
      console.log(`${testPrefix}⚠️ SHIPPO_WEBHOOK_SECRET not set - skipping signature verification (test mode)`);
    }
  } else {
    console.log(`${testPrefix}⚠️ Signature verification skipped (test mode)`);
  }
  
  try {
    const payload = req.body;
      
      // Validate payload structure
      if (!payload || !payload.data) {
        console.warn('⚠️ Invalid payload structure - missing data field');
        return res.status(400).json({ error: 'Invalid payload structure' });
      }
      
      const { data, event } = payload;
      
      // Extract tracking information
      const trackingNumber = data.tracking_number;
      const carrier = data.carrier;
      const trackingStatus = data.tracking_status?.status;
      const metadata = data.metadata || {};
      
      console.log(`📦 Tracking Number: ${trackingNumber}`);
      console.log(`🚚 Carrier: ${carrier}`);
      console.log(`📊 Status: ${trackingStatus}`);
      console.log(`🏷️ Metadata:`, metadata);
      
      // Gate by Shippo mode - ignore events whose event.mode doesn't match our SHIPPO_MODE
      const expectedMode = process.env.SHIPPO_MODE; // 'test' or 'live'
      if (expectedMode && event?.mode && event.mode.toLowerCase() !== expectedMode.toLowerCase()) {
        console.warn('[SHIPPO][WEBHOOK] Mode mismatch', { eventMode: event.mode, expectedMode });
        return res.status(200).json({ ok: true }); // ignore silently
      }
      
      console.log(`✅ Shippo mode check passed: event.mode=${event?.mode || 'none'}, expected=${expectedMode || 'any'}`);
      
      // Check if status is DELIVERED or first-scan statuses (TRANSIT, IN_TRANSIT, ACCEPTED, ACCEPTANCE)
      const upperStatus = trackingStatus?.toUpperCase();
      const firstScanStatuses = ['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE'];
      const isDelivery = upperStatus === 'DELIVERED';
      const isFirstScan = firstScanStatuses.includes(upperStatus);
      
      if (!upperStatus || (!isDelivery && !isFirstScan)) {
        console.log(`ℹ️ Status '${trackingStatus}' is not DELIVERED or first-scan status - ignoring webhook`);
        return res.status(200).json({ message: `Status ${trackingStatus} ignored` });
      }
      
      console.log(`✅ Status is ${upperStatus} - processing ${isDelivery ? 'delivery' : 'first scan'} webhook`);
    
    // Find transaction
    let transaction = null;
    let matchStrategy = 'unknown';
    
    // Method 1: Try to find by metadata.transactionId (preferred)
    if (metadata.transactionId) {
      console.log(`🔍 Looking up transaction by metadata.transactionId: ${metadata.transactionId}`);
      try {
        const sdk = await getTrustedSdk();
        const response = await sdk.transactions.show({ id: metadata.transactionId });
        transaction = response.data.data;
        matchStrategy = 'metadata.transactionId';
        console.log(`✅ Found transaction by metadata.transactionId: ${transaction.id}`);
      } catch (error) {
        console.warn(`⚠️ Failed to find transaction by metadata.transactionId: ${error.message}`);
      }
    }
    
    // Method 2: Fallback to searching by tracking number
    if (!transaction && trackingNumber) {
      console.log(`🔍 Falling back to search by tracking number: ${trackingNumber}`);
      try {
        const sdk = await getTrustedSdk();
        transaction = await findTransactionByTrackingNumber(sdk, trackingNumber);
        matchStrategy = 'tracking_number_search';
      } catch (error) {
        console.error(`❌ Error in tracking number search: ${error.message}`);
      }
    }
    
    if (!transaction) {
      console.error('❌ Could not find transaction for this tracking update');
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    console.log(`✅ Transaction found via ${matchStrategy}: ${transaction.id}`);
    
    // Check if this is a return tracking number
    const protectedData = transaction.attributes.protectedData || {};
    const returnData = protectedData.return || {};
    
    // Determine direction: check metadata.direction first, then fall back to tracking number matching
    const isReturnTracking = (metadata.direction === 'return') ||
                            (trackingNumber === protectedData.returnTrackingNumber) ||
                            (trackingNumber === returnData.label?.trackingNumber);
    
    console.log(`🔍 Tracking type: ${isReturnTracking ? 'RETURN' : 'OUTBOUND'} (metadata.direction=${metadata.direction || 'none'})`);
    
    // Handle return tracking - send SMS to lender
    if (isReturnTracking && isFirstScan) {
      console.log('📬 Processing return first scan - sending SMS to lender');
      
      // Check if return first scan SMS already sent
      if (returnData.firstScanAt) {
        console.log('ℹ️ Return first scan SMS already sent - skipping (idempotent)');
        return res.status(200).json({ message: 'Return first scan SMS already sent - idempotent' });
      }
      
      // Get lender phone
      const lenderPhone = getLenderPhone(transaction);
      if (!lenderPhone) {
        console.warn('⚠️ No lender phone number found - cannot send return SMS');
        return res.status(400).json({ error: 'No lender phone number found' });
      }
      
      // Get listing title (truncate if too long)
      const rawTitle = transaction.attributes.listing?.title || 'your item';
      const listingTitle = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;
      
      // Generate public carrier tracking URL (shorter than Shippo URLs)
      const returnCarrier = protectedData.returnCarrier;
      const publicTrackingUrl = getPublicTrackingUrl(returnCarrier, trackingNumber);
      console.log(`[TRACKINGLINK] Using short public link for return: ${publicTrackingUrl} (carrier: ${returnCarrier || 'unknown'})`);
      
      // Use short link for even more compact SMS
      const shortTrackingUrl = await shortLink(publicTrackingUrl);
      const message = `📬 Return in transit: "${listingTitle}". Track: ${shortTrackingUrl}`;
      
      try {
        await sendSMS(lenderPhone, message, {
          role: 'lender',
          transactionId: transaction.id,
          transition: 'webhook/shippo-return-first-scan',
          tag: SMS_TAGS.RETURN_FIRST_SCAN_TO_LENDER,
          meta: { 
            listingId: transaction.attributes.listing?.id?.uuid || transaction.attributes.listing?.id,
            trackingNumber: trackingNumber
          }
        });
        
        // Update transaction with return first scan timestamp
        try {
          const txId = transaction.id.uuid || transaction.id;
          const result = await upsertProtectedData(txId, {
            return: {
              ...returnData,
              firstScanAt: timestamp() // ← respects FORCE_NOW
            }
          }, { source: 'webhook' });
          
          if (result && result.success === false) {
            console.error(`❌ Failed to update transaction with return first scan:`, result.error);
          } else {
            console.log(`💾 Updated transaction with return first scan timestamp`);
          }
        } catch (updateError) {
          console.error(`❌ Failed to update transaction:`, updateError.message);
        }
        
        console.log(`✅ Return first scan SMS sent to lender ${lenderPhone}`);
        return res.status(200).json({ 
          success: true, 
          message: 'Return first scan SMS sent to lender',
          transactionId: transaction.id,
          lenderPhone: lenderPhone
        });
        
      } catch (smsError) {
        console.error(`❌ Failed to send return first scan SMS to lender:`, smsError.message);
        return res.status(500).json({ error: 'Failed to send return first scan SMS to lender' });
      }
    }
    
    // Check if SMS already sent (idempotency) based on event type for outbound
    if (!isReturnTracking) {
      if (isDelivery && protectedData.shippingNotification?.delivered?.sent === true) {
        console.log('ℹ️ Delivery SMS already sent - skipping (idempotent)');
        return res.status(200).json({ message: 'Delivery SMS already sent - idempotent' });
      }
      
      // Check first-scan idempotency: protectedData first, then in-memory cache
      if (isFirstScan) {
        const pdFirstScanSent = protectedData.shippingNotification?.firstScan?.sent === true;
        const cacheKey = `firstscan:${trackingNumber}`;
        const cachedTimestamp = firstScanCache.get(cacheKey);
        const cacheValid = cachedTimestamp && (Date.now() - cachedTimestamp < FIRST_SCAN_TTL);
        
        if (pdFirstScanSent || cacheValid) {
          console.log(`ℹ️ [STEP-4] First scan SMS already sent - skipping (idempotent via ${pdFirstScanSent ? 'protectedData' : 'cache'})`);
          return res.status(200).json({ message: 'First scan SMS already sent - idempotent' });
        }
        
        // Mark as sent in cache immediately to prevent race conditions
        firstScanCache.set(cacheKey, Date.now());
        console.log(`[STEP-4] Marked first-scan in cache for tracking ${trackingNumber}`);
      }
      
      // Get borrower phone number
      const borrowerPhone = getBorrowerPhone(transaction);
      if (!borrowerPhone) {
        console.warn('⚠️ No borrower phone number found - cannot send SMS');
        return res.status(400).json({ error: 'No borrower phone number found' });
      }
      
      console.log(`📱 Borrower phone: ${borrowerPhone}`);
      
      let message, smsType, protectedDataUpdate;
      
      if (isDelivery) {
        // Send delivery SMS
        message = "Your Sherbrt borrow was delivered! Don't forget to take pics and tag @shoponsherbrt while you're slaying in your borrowed fit! 📸✨";
        smsType = 'delivery';
        protectedDataUpdate = {
          ...protectedData,
          lastTrackingStatus: {
            status: trackingStatus,
            substatus: substatus,
            timestamp: timestamp(), // ← respects FORCE_NOW
            event: 'delivered'
          },
          shippingNotification: {
            ...protectedData.shippingNotification,
            delivered: { sent: true, sentAt: timestamp() } // ← respects FORCE_NOW
          }
        };
      } else if (isFirstScan) {
        // Send first scan SMS (Step-4: borrower notification)
        const carrier = protectedData.outboundCarrier;
        const trackingNum = protectedData.outboundTrackingNumber;
        
        if (!trackingNum) {
          console.warn('⚠️ [STEP-4] No tracking number found for first scan notification');
          return res.status(400).json({ error: 'No tracking number found for first scan notification' });
        }
        
        // Generate public carrier tracking URL (shorter than Shippo URLs)
        const publicTrackingUrl = getPublicTrackingUrl(carrier, trackingNum);
        console.log(`[TRACKINGLINK] Using short public link: ${publicTrackingUrl} (carrier: ${carrier || 'unknown'})`);
        
        // Get listing title for personalized message
        const listing = transaction.attributes?.listing || transaction.relationships?.listing?.data;
        const rawTitle = listing?.title || listing?.attributes?.title || 'your item';
        const listingTitle = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;
        
        // Use short link for even more compact SMS
        const shortTrackingUrl = await shortLink(publicTrackingUrl);
        message = `Sherbrt 🍧: 🚚 "${listingTitle}" is on its way! Track: ${shortTrackingUrl}`;
        smsType = 'first scan';
        
        console.log(`[STEP-4] Sending borrower SMS for tracking ${trackingNumber}, txId=${transaction.id}`);
        console.log(`[STEP-4] Message length: ${message.length} chars, shortLink: ${shortTrackingUrl}`);
        protectedDataUpdate = {
          ...protectedData,
          lastTrackingStatus: {
            status: trackingStatus,
            substatus: substatus,
            timestamp: timestamp(), // ← respects FORCE_NOW
            event: 'first_scan'
          },
          shippingNotification: {
            ...protectedData.shippingNotification,
            firstScan: { sent: true, sentAt: timestamp() } // ← respects FORCE_NOW
          }
        };
      }
      
      console.log(`📤 Sending ${smsType} SMS to ${borrowerPhone}: ${message}`);
      
      try {
        await sendSMS(borrowerPhone, message, { 
          role: 'customer',
          transactionId: transaction.id,
          transition: `webhook/shippo-${smsType.replace(' ', '-')}`,
          tag: isDelivery ? SMS_TAGS.DELIVERY_TO_BORROWER : SMS_TAGS.ITEM_SHIPPED_TO_BORROWER,
          meta: { listingId: transaction.attributes.listing?.id?.uuid || transaction.attributes.listing?.id }
        });
        
        if (isFirstScan) {
          console.log(`✅ [STEP-4] Borrower SMS sent for tracking ${trackingNumber}, txId=${transaction.id}`);
        } else {
          console.log(`✅ ${smsType} SMS sent successfully to ${borrowerPhone}`);
        }
        
        // Mark SMS as sent in transaction protectedData
        try {
          const sdk = await getTrustedSdk();
          
          if (isFirstScan) {
            // Use privileged transition for first scan updates
            await sdk.transactions.transition({
              id: transaction.id,
              transition: 'transition/store-shipping-urls',
              params: { protectedData: protectedDataUpdate }
            });
          } else {
            // Use privileged transition for delivery updates (consistent approach)
            await sdk.transactions.transition({
              id: transaction.id,
              transition: 'transition/store-shipping-urls',
              params: { protectedData: protectedDataUpdate }
            });
          }
          
          console.log(`💾 Updated transaction protectedData: ${smsType} SMS sent = true`);
          
        } catch (updateError) {
          console.error(`❌ Failed to update transaction protectedData for ${smsType}:`, updateError.message);
          // Don't fail the webhook if we can't update the flag
        }
        
      } catch (smsError) {
        console.error(`❌ Failed to send ${smsType} SMS to ${borrowerPhone}:`, smsError.message);
        return res.status(500).json({ error: `Failed to send ${smsType} SMS` });
      }
      
      console.log(`🎉 ${smsType} webhook processed successfully!`);
      res.status(200).json({ 
        success: true, 
        message: `${smsType} SMS sent successfully`,
        transactionId: transaction.id,
        matchStrategy,
        borrowerPhone,
        smsType
      });
      
    } // End of if (!isReturnTracking)
    
  } catch (error) {
    console.error('❌ Fatal error in Shippo webhook:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Main webhook handler
router.post('/shippo', async (req, res) => {
  await handleTrackingWebhook(req, res, { skipSignature: false, isTest: false });
});

// Dev-only test route for simulating Shippo tracking webhooks
// POST /__test/shippo/track with JSON payload: { txId, status }
// BYPASSES cookie/session SDKs - uses Integration SDK only
if (process.env.TEST_ENDPOINTS) {
  router.post('/__test/shippo/track', express.json(), async (req, res) => {
    try {
      console.log('[WEBHOOK:TEST] start path=/api/webhooks/__test/shippo/track body=', req.body);
      
      const { txId, status = 'TRANSIT', metadata = {} } = req.body;
      
      if (!txId) {
        return res.status(400).json({ 
          error: 'txId required',
          example: { txId: 'abc123-def456-...', status: 'TRANSIT', metadata: { direction: 'outbound' } }
        });
      }
      
      // Use Integration SDK (bypasses cookies/sessions)
      const integrationSdk = getIntegrationSdk();
      
      // Fetch transaction
      console.log('[WEBHOOK:TEST] Fetching transaction:', txId);
      let transaction;
      try {
        const response = await integrationSdk.transactions.show({ 
          id: txId,
          include: ['customer', 'provider', 'listing']
        });
        transaction = response.data.data;
      } catch (error) {
        console.error('[WEBHOOK:TEST] Failed to fetch transaction:', error.message);
        return res.status(404).json({ error: 'Transaction not found', txId });
      }
      
      const protectedData = transaction.attributes.protectedData || {};
      const direction = metadata.direction || 'outbound';
      const upperStatus = status.toUpperCase();
      
      console.log(`[WEBHOOK:TEST] phase=${upperStatus} direction=${direction}`);
      
      // Skip borrower SMS for return shipments
      if (direction === 'return') {
        console.log('[WEBHOOK:TEST] direction=return, skipping borrower SMS');
        return res.status(200).json({ ok: true, message: 'Return shipment - no borrower SMS' });
      }
      
      // Determine SMS type based on status
      const isShipped = ['ACCEPTED', 'IN_TRANSIT', 'TRANSIT'].includes(upperStatus);
      const isDelivered = upperStatus === 'DELIVERED';
      
      if (!isShipped && !isDelivered) {
        console.log(`[WEBHOOK:TEST] status=${upperStatus} not SHIPPED or DELIVERED, skipping`);
        return res.status(200).json({ ok: true, message: `Status ${upperStatus} ignored` });
      }
      
      // Get borrower phone
      const borrowerPhone = getBorrowerPhone(transaction);
      if (!borrowerPhone) {
        console.warn('[WEBHOOK:TEST] No borrower phone found');
        return res.status(400).json({ error: 'No borrower phone number found' });
      }
      
      let message, tag;
      
      if (isShipped) {
        // Step-4 SMS: Item shipped to borrower
        const carrier = protectedData.outboundCarrier;
        const trackingNum = protectedData.outboundTrackingNumber;
        
        if (!trackingNum) {
          console.warn('[WEBHOOK:TEST] No tracking number found');
          return res.status(400).json({ error: 'No tracking number found' });
        }
        
        // Generate public carrier tracking URL (shorter than Shippo URLs)
        const publicTrackingUrl = getPublicTrackingUrl(carrier, trackingNum);
        console.log(`[TRACKINGLINK] Using short public link: ${publicTrackingUrl} (carrier: ${carrier || 'unknown'})`);
        
        const listing = transaction.attributes?.listing || transaction.relationships?.listing?.data;
        const rawTitle = listing?.title || listing?.attributes?.title || 'your item';
        const listingTitle = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;
        
        const shortTrackingUrl = await shortLink(publicTrackingUrl);
        message = `Sherbrt 🍧: 🚚 "${listingTitle}" is on its way! Track: ${shortTrackingUrl}`;
        tag = SMS_TAGS.ITEM_SHIPPED_TO_BORROWER;
        
        console.log(`[SMS:OUT] tag=item_shipped_to_borrower to=${borrowerPhone} msg="${message}"`);
        
      } else if (isDelivered) {
        // Step-6 SMS: Item delivered to borrower
        message = "Your Sherbrt borrow was delivered! Don't forget to take pics and tag @shoponsherbrt while you're slaying in your borrowed fit! 📸✨";
        tag = SMS_TAGS.DELIVERY_TO_BORROWER;
        
        console.log(`[SMS:OUT] tag=item_delivered_to_borrower to=${borrowerPhone} msg="${message}"`);
      }
      
      // Send SMS
      try {
        await sendSMS(borrowerPhone, message, {
          role: 'customer',
          transactionId: transaction.id,
          transition: `webhook/test-${isShipped ? 'shipped' : 'delivered'}`,
          tag,
          meta: { 
            listingId: transaction.attributes.listing?.id?.uuid || transaction.attributes.listing?.id,
            testWebhook: true
          }
        });
        
        console.log(`[WEBHOOK:TEST] SMS sent successfully to ${borrowerPhone}`);
        
        return res.status(200).json({ 
          ok: true,
          message: `${isShipped ? 'Shipped' : 'Delivered'} SMS sent`,
          transactionId: transaction.id,
          borrowerPhone,
          tag
        });
        
      } catch (smsError) {
        console.error('[WEBHOOK:TEST] Failed to send SMS:', smsError.message);
        return res.status(500).json({ error: 'Failed to send SMS', details: smsError.message });
      }
      
    } catch (err) {
      console.error('[WEBHOOK:TEST] error', err);
      res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
  });
}

module.exports = router;


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
  // EARLY LOGGING: Log ALL webhook attempts, even if they fail later
  // This helps debug cases where webhooks fail before reaching the main handler
  const rawBodyStr = req.body?.toString?.() || String(req.body || '');
  console.log(`[SHIPPO-WEBHOOK-ATTEMPT] 📥 Webhook received: body_length=${rawBodyStr.length} bytes`);
  console.log(`[SHIPPO-WEBHOOK-ATTEMPT] 📥 Headers: x-shippo-signature=${req.headers['x-shippo-signature'] ? 'PRESENT' : 'MISSING'}`);
  
  // Store raw body for signature verification
  req.rawBody = req.body;
  // Parse JSON for processing
  try {
    req.body = JSON.parse(req.body.toString());
    
    // Log parsed data (safe - no sensitive data in tracking number)
    const trackingNumber = req.body?.data?.tracking_number || 'UNKNOWN';
    const eventType = req.body?.event?.type || 'unknown';
    const eventMode = req.body?.event?.mode || 'unknown';
    
    // Safely extract txId from metadata (handle both string and object formats)
    let txIdFromMetadata = 'MISSING';
    try {
      if (req.body?.data?.metadata) {
        const metadata = typeof req.body.data.metadata === 'string' ? 
          JSON.parse(req.body.data.metadata) : 
          req.body.data.metadata;
        txIdFromMetadata = metadata?.transactionId || metadata?.txId || 'MISSING';
      }
    } catch (metaError) {
      // Metadata parsing failed - not critical for early logging
      txIdFromMetadata = 'PARSE_ERROR';
    }
    
    console.log(`[SHIPPO-WEBHOOK-ATTEMPT] ✅ Parsed JSON: event=${eventType}, mode=${eventMode}, tracking=${trackingNumber}, txId=${txIdFromMetadata}`);
  } catch (error) {
    console.error(`[SHIPPO-WEBHOOK-ATTEMPT] ❌ Failed to parse JSON body: ${error.message}`);
    console.error(`[SHIPPO-WEBHOOK-ATTEMPT] ❌ Raw body preview (first 500 chars): ${rawBodyStr.substring(0, 500)}...`);
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
      const statusDetails = data.tracking_status?.status_details || data.tracking_status?.substatus || '';
      const substatus = statusDetails; // For backward compatibility with existing code
      
      // Parse metadata if it's a JSON string (Shippo may send it as string)
      let parsedMetadata = data.metadata || {};
      if (typeof parsedMetadata === 'string') {
        try {
          parsedMetadata = JSON.parse(parsedMetadata);
        } catch (e) {
          console.warn('[ShippoWebhook] Failed to parse metadata as JSON:', e.message);
          parsedMetadata = {};
        }
      }
      
      // Support both transactionId (new) and txId (legacy) keys
      const metadata = parsedMetadata || {};
      const txId = metadata.transactionId || metadata.txId;
      
      // Warn if we're using legacy txId key
      if (metadata.txId && !metadata.transactionId) {
        console.warn('[ShippoWebhook] Legacy txId metadata detected; using txId as transactionId');
      }
      
      // Debug log after metadata parsing
      console.log('[SHIPPO-WEBHOOK] direction=', metadata.direction, 'txId=', txId, 'tracking=', trackingNumber);
      
      // [SHIPPO DELIVERY DEBUG] Structured logging for webhook payload
      console.log(`[SHIPPO DELIVERY DEBUG] 📦 Webhook received:`);
      console.log(`[SHIPPO DELIVERY DEBUG]   tracking_number: ${trackingNumber || 'MISSING'}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   carrier: ${carrier || 'MISSING'}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   tracking_status.status: ${trackingStatus || 'MISSING'}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   tracking_status.status_details: ${statusDetails || 'none'}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   event.type: ${event?.type || 'MISSING'}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   event.mode: ${event?.mode || 'MISSING'}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   metadata.transactionId: ${txId || 'MISSING'}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   metadata.direction: ${metadata.direction || 'none'}`);
      
      console.log(`📦 Tracking Number: ${trackingNumber}`);
      console.log(`🚚 Carrier: ${carrier}`);
      console.log(`📊 Status: ${trackingStatus}`);
      console.log(`📋 Status Details: ${statusDetails || 'none'}`);
      console.log(`🏷️ Metadata:`, metadata);
      
      // Gate by Shippo mode - ignore events whose event.mode doesn't match our SHIPPO_MODE
      const expectedMode = process.env.SHIPPO_MODE; // 'test' or 'live'
      if (expectedMode && event?.mode && event.mode.toLowerCase() !== expectedMode.toLowerCase()) {
        console.warn('[SHIPPO][WEBHOOK] Mode mismatch', { eventMode: event.mode, expectedMode });
        return res.status(200).json({ ok: true }); // ignore silently
      }
      
      console.log(`✅ Shippo mode check passed: event.mode=${event?.mode || 'none'}, expected=${expectedMode || 'any'}`);
      
      // Check if status is DELIVERED or first-scan statuses (TRANSIT, IN_TRANSIT, ACCEPTED, ACCEPTANCE, PRE_TRANSIT with facility scan)
      const upperStatus = trackingStatus?.toUpperCase();
      const upperStatusDetails = (statusDetails || '').toUpperCase();
      
      // Facility scan indicators in status_details (UPS "Processing at UPS Facility", "Origin Scan", etc.)
      const facilityScanIndicators = [
        'PROCESSING AT',
        'ORIGIN SCAN',
        'FACILITY',
        'PICKED UP',
        'ACCEPTED AT',
        'RECEIVED AT'
      ];
      const hasFacilityScan = facilityScanIndicators.some(indicator => 
        upperStatusDetails.includes(indicator)
      );
      
      // Base first-scan statuses
      const firstScanStatuses = ['TRANSIT', 'IN_TRANSIT', 'ACCEPTED', 'ACCEPTANCE'];
      // PRE_TRANSIT counts as first scan if it has a facility scan indicator
      const isPreTransitWithScan = upperStatus === 'PRE_TRANSIT' && hasFacilityScan;
      
      // Use isDeliveredStatus() helper to handle variations like DELIVERED_TO_ACCESS_POINT
      const isDelivery = isDeliveredStatus(trackingStatus);
      const isFirstScan = firstScanStatuses.includes(upperStatus) || isPreTransitWithScan;
      
      // OUT_FOR_DELIVERY is an intermediate status - log it for visibility but don't trigger SMS
      // (first scan SMS should have already been sent earlier in the tracking lifecycle)
      const isOutForDelivery = upperStatus === 'OUT_FOR_DELIVERY' || upperStatus === 'OUT FOR DELIVERY' || upperStatusDetails.includes('OUT FOR DELIVERY');
      
      // [SHIPPO DELIVERY DEBUG] Log delivery detection logic
      console.log(`[SHIPPO DELIVERY DEBUG] 🔍 Delivery detection:`);
      console.log(`[SHIPPO DELIVERY DEBUG]   upperStatus: ${upperStatus || 'MISSING'}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   isDelivery: ${isDelivery}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   isFirstScan: ${isFirstScan}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   isOutForDelivery: ${isOutForDelivery}`);
      console.log(`[SHIPPO DELIVERY DEBUG]   hasFacilityScan: ${hasFacilityScan}`);
      
      // Handle OUT_FOR_DELIVERY status - log for visibility but don't trigger SMS
      if (isOutForDelivery) {
        console.log(`[SHIPPO-WEBHOOK] 📦 Status is OUT_FOR_DELIVERY - logging for visibility but not triggering SMS`);
        console.log(`[SHIPPO-WEBHOOK] direction=${metadata.direction || 'none'}, txId=${txId || 'MISSING'}, tracking=${trackingNumber || 'MISSING'}`);
        // Still try to find transaction and log it for debugging
        if (txId) {
          try {
            const sdk = await getTrustedSdk();
            const response = await sdk.transactions.show({ id: txId });
            const transaction = response.data.data;
            console.log(`[SHIPPO-WEBHOOK] ✅ Found transaction ${transaction.id} for OUT_FOR_DELIVERY status`);
            console.log(`[SHIPPO-WEBHOOK] Transaction state: ${transaction.attributes?.state || 'unknown'}`);
          } catch (error) {
            console.warn(`[SHIPPO-WEBHOOK] ⚠️ Could not find transaction for OUT_FOR_DELIVERY: ${error.message}`);
          }
        }
        return res.status(200).json({ message: 'OUT_FOR_DELIVERY status logged (no SMS - first scan should have already been sent)' });
      }
      
      if (!upperStatus || (!isDelivery && !isFirstScan)) {
        console.log(`[SHIPPO DELIVERY DEBUG] ⚠️ NOT treating as delivered/first-scan:`);
        console.log(`[SHIPPO DELIVERY DEBUG]   Status received: '${trackingStatus}'`);
        console.log(`[SHIPPO DELIVERY DEBUG]   Status details: '${statusDetails || 'none'}'`);
        console.log(`[SHIPPO DELIVERY DEBUG]   Normalized upperStatus: '${upperStatus}'`);
        console.log(`[SHIPPO DELIVERY DEBUG]   isDelivery check result: ${isDelivery}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   isFirstScan check result: ${isFirstScan}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   Reason: Status does not match DELIVERED* pattern or first-scan statuses`);
        console.log(`ℹ️ Status '${trackingStatus}' (details: '${statusDetails || 'none'}') is not DELIVERED or first-scan status - ignoring webhook`);
        if (upperStatus === 'PRE_TRANSIT' && !hasFacilityScan) {
          console.log(`[SHIPPO DELIVERY DEBUG]   PRE_TRANSIT without facility scan indicator - ignoring`);
          console.log(`ℹ️ PRE_TRANSIT status detected but no facility scan indicator found in status_details`);
        }
        // Log if status looks like it might be a delivery variation we're not catching
        if (upperStatus && upperStatus.includes('DELIVER') && !isDelivery) {
          console.warn(`⚠️ [SHIPPO DELIVERY DEBUG] Status contains 'DELIVER' but didn't match delivery detection - please review: '${trackingStatus}'`);
        }
        return res.status(200).json({ message: `Status ${trackingStatus} ignored` });
      }
      
      console.log(`[SHIPPO DELIVERY DEBUG] ✅ Entering ${isDelivery ? 'DELIVERED' : 'FIRST_SCAN'} branch`);
      console.log(`✅ Status is ${upperStatus} - processing ${isDelivery ? 'delivery' : 'first scan'} webhook`);
    
    // Find transaction
    let transaction = null;
    let matchStrategy = 'unknown';
    
    // Method 1: Try to find by transaction ID from metadata (supports both transactionId and txId)
    if (txId) {
      console.log(`🔍 Looking up transaction by metadata transaction ID: ${txId}`);
      try {
        const sdk = await getTrustedSdk();
        const response = await sdk.transactions.show({ id: txId });
        transaction = response.data.data;
        matchStrategy = metadata.transactionId ? 'metadata.transactionId' : 'metadata.txId';
        console.log(`✅ Found transaction by metadata transaction ID: ${transaction.id}`);
      } catch (error) {
        // Enhanced error logging for transaction lookup failures
        const errorStatus = error?.response?.status || error?.status;
        const errorData = error?.response?.data || error?.data;
        const errorCode = errorData?.errors?.[0]?.code;
        const errorTitle = errorData?.errors?.[0]?.title || errorData?.message || error.message;
        
        console.error(`[SHIPPO DELIVERY DEBUG] ❌ Transaction lookup by ID failed:`);
        console.error(`[SHIPPO DELIVERY DEBUG]   transactionId: ${txId}`);
        console.error(`[SHIPPO DELIVERY DEBUG]   error.message: ${error.message}`);
        console.error(`[SHIPPO DELIVERY DEBUG]   HTTP status: ${errorStatus || 'N/A'}`);
        console.error(`[SHIPPO DELIVERY DEBUG]   error.code: ${errorCode || 'N/A'}`);
        console.error(`[SHIPPO DELIVERY DEBUG]   error.title: ${errorTitle || 'N/A'}`);
        
        // Log environment context
        const integClientId = process.env.INTEGRATION_CLIENT_ID;
        const shippoMode = process.env.SHIPPO_MODE || 'NOT SET';
        const baseUrl = process.env.SHARETRIBE_SDK_BASE_URL || 
                        process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL || 
                        'https://flex-api.sharetribe.com (default)';
        
        console.error(`[SHIPPO DELIVERY DEBUG]   environment context:`);
        console.error(`[SHIPPO DELIVERY DEBUG]     SHIPPO_MODE: ${shippoMode}`);
        console.error(`[SHIPPO DELIVERY DEBUG]     Base URL: ${baseUrl}`);
        console.error(`[SHIPPO DELIVERY DEBUG]     INTEGRATION_CLIENT_ID: ${integClientId ? integClientId.substring(0, 8) + '...' + integClientId.substring(integClientId.length - 4) : 'NOT SET'}`);
        
        if (errorStatus === 404) {
          console.error(`[SHIPPO DELIVERY DEBUG]   → HTTP 404: Transaction does not exist in this environment`);
          console.error(`[SHIPPO DELIVERY DEBUG]   → Check: Is transaction ID correct? Is SDK pointing to correct marketplace?`);
        } else if (errorStatus === 401 || errorStatus === 403) {
          console.error(`[SHIPPO DELIVERY DEBUG]   → HTTP ${errorStatus}: Authentication/authorization failed`);
          console.error(`[SHIPPO DELIVERY DEBUG]   → Check: INTEGRATION_CLIENT_ID and INTEGRATION_CLIENT_SECRET are correct`);
        }
        
        if (errorData) {
          console.error(`[SHIPPO DELIVERY DEBUG]   full error response:`, JSON.stringify(errorData, null, 2));
        }
        
        console.warn(`⚠️ Failed to find transaction by metadata transaction ID: ${error.message}`);
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
      console.error(`[SHIPPO DELIVERY DEBUG] ❌ Could not find transaction for this tracking update`);
      console.error(`[SHIPPO DELIVERY DEBUG]   tracking_number: ${trackingNumber || 'MISSING'}`);
      console.error(`[SHIPPO DELIVERY DEBUG]   metadata.transactionId: ${txId || 'MISSING'}`);
      console.error(`[SHIPPO DELIVERY DEBUG]   matchStrategy attempted: ${matchStrategy}`);
      
      // Log environment context for debugging
      const integClientId = process.env.INTEGRATION_CLIENT_ID;
      const shippoMode = process.env.SHIPPO_MODE || 'NOT SET';
      const baseUrl = process.env.SHARETRIBE_SDK_BASE_URL || 
                      process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL || 
                      'https://flex-api.sharetribe.com (default)';
      
      console.error(`[SHIPPO DELIVERY DEBUG]   environment context:`);
      console.error(`[SHIPPO DELIVERY DEBUG]     SHIPPO_MODE: ${shippoMode}`);
      console.error(`[SHIPPO DELIVERY DEBUG]     Base URL: ${baseUrl}`);
      console.error(`[SHIPPO DELIVERY DEBUG]     INTEGRATION_CLIENT_ID: ${integClientId ? integClientId.substring(0, 8) + '...' + integClientId.substring(integClientId.length - 4) : 'NOT SET'}`);
      
      if (txId) {
        console.error(`[SHIPPO DELIVERY DEBUG]   Transaction lookup by ID failed - check if transaction exists: ${txId}`);
        console.error(`[SHIPPO DELIVERY DEBUG]   → Run debug script: node server/scripts/debugShippoDeliveryForTx.js ${txId} ${trackingNumber || ''}`);
      }
      if (trackingNumber) {
        console.error(`[SHIPPO DELIVERY DEBUG]   Tracking number search failed - only searches last 100 transactions`);
        console.error(`[SHIPPO DELIVERY DEBUG]   If transaction is older, ensure metadata.transactionId is included in webhook`);
      }
      console.error('❌ Could not find transaction for this tracking update');
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    console.log(`✅ Transaction found via ${matchStrategy}: ${transaction.id}`);
    
    // [SHIPPO DELIVERY DEBUG] Log transaction match details
    const txIdFromTransaction = transaction.id?.uuid || transaction.id;
    console.log(`[SHIPPO DELIVERY DEBUG] 📋 Transaction matched:`);
    console.log(`[SHIPPO DELIVERY DEBUG]   transactionId: ${txIdFromTransaction}`);
    console.log(`[SHIPPO DELIVERY DEBUG]   matchStrategy: ${matchStrategy}`);
    console.log(`[SHIPPO DELIVERY DEBUG]   transaction.state: ${transaction.attributes?.state || 'MISSING'}`);
    
    // Check if this is a return tracking number
    const protectedData = transaction.attributes.protectedData || {};
    const returnData = protectedData.return || {};
    
    // DIRECTION FILTER: Determine if this is a return scan (borrower → lender) or outbound scan (lender → borrower)
    // We treat events with metadata.direction === 'return' as return scans.
    // Also check if tracking number matches known return tracking number as fallback.
    // IMPORTANT: Payout only triggers on return scans, never on outbound scans.
    // For older labels without direction metadata, assume outbound if not explicitly return.
    const explicitDirection = metadata.direction;
    const isReturnTracking = (explicitDirection === 'return') ||
                            (trackingNumber === protectedData.returnTrackingNumber) ||
                            (trackingNumber === returnData.label?.trackingNumber);
    
    // For older labels without direction metadata, assume outbound if not explicitly return
    const isOutbound = !isReturnTracking;
    
    console.log(`[SHIPPO DELIVERY DEBUG] 🔍 Direction check:`);
    console.log(`[SHIPPO DELIVERY DEBUG]   explicitDirection: ${explicitDirection || 'none (assuming outbound)'}`);
    console.log(`[SHIPPO DELIVERY DEBUG]   isReturnTracking: ${isReturnTracking}`);
    console.log(`[SHIPPO DELIVERY DEBUG]   isOutbound: ${isOutbound}`);
    console.log(`[SHIPPO DELIVERY DEBUG]   matches returnTrackingNumber: ${trackingNumber === protectedData.returnTrackingNumber}`);
    console.log(`🔍 [PAYOUT] Tracking type: ${isReturnTracking ? 'RETURN' : 'OUTBOUND'} (metadata.direction=${metadata.direction || 'none'})`);
    if (isReturnTracking) {
      console.log(`🔍 [PAYOUT] Return scan detected - payout will be triggered if state is 'accepted'`);
    } else {
      console.log(`🔍 [PAYOUT] Outbound scan detected - payout will NOT be triggered`);
    }
    
    // Handle return tracking - send SMS to lender and trigger payout
    // 
    // PAYOUT TRIGGER LOGIC:
    // - Only triggers on RETURN direction scans (borrower → lender)
    // - Only triggers on first scan statuses (TRANSIT, IN_TRANSIT, ACCEPTED, ACCEPTANCE)
    // - Only triggers when transaction is in state 'accepted' (not already delivered/complete)
    // - Idempotent: duplicate webhooks won't create multiple payouts
    //
    // TEST PLAN for return scan → payout flow:
    // 1. Create a booking that reaches state/accepted (provider has accepted, item shipped out)
    // 2. Ensure the transaction has a return tracking number in protectedData.returnTrackingNumber
    // 3. Trigger a Shippo webhook with:
    //    - metadata.direction === 'return' OR tracking number matches returnTrackingNumber
    //    - tracking_status.status === 'TRANSIT' or 'IN_TRANSIT' or 'ACCEPTED' (first scan statuses)
    //    - metadata.transactionId set to the transaction UUID
    // 4. Verify logs show:
    //    - return.firstScanAt is set in protectedData
    //    - [PAYOUT] transition/complete-return is called
    //    - Transaction moves from state 'accepted' to state 'delivered'
    //    - Stripe payout is created (check Stripe dashboard or logs)
    // 5. Verify idempotency: sending the same webhook again should skip payout (already delivered)
    //
    if (isReturnTracking && isFirstScan) {
      console.log('📬 [PAYOUT] Processing return first scan - sending SMS to lender and triggering payout');
      
      // Check if return first scan SMS already sent
      if (returnData.firstScanAt) {
        console.log('ℹ️ [PAYOUT] Return first scan SMS already sent - skipping (idempotent)');
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
        const smsResult = await sendSMS(lenderPhone, message, {
          role: 'lender',
          transactionId: transaction.id,
          transition: 'webhook/shippo-return-first-scan',
          tag: SMS_TAGS.RETURN_FIRST_SCAN_TO_LENDER,
          meta: { 
            listingId: transaction.attributes.listing?.id?.uuid || transaction.attributes.listing?.id,
            trackingNumber: trackingNumber
          }
        });
        
        // Check if SMS was actually sent (not skipped by guards)
        if (smsResult && smsResult.skipped) {
          console.log(`⚠️ [PAYOUT] Return first scan SMS was skipped: ${smsResult.reason} - NOT setting firstScanAt timestamp`);
          return res.status(200).json({ 
            success: false, 
            message: `Return first scan SMS skipped: ${smsResult.reason}`,
            skipped: true,
            reason: smsResult.reason
          });
        }
        
        // Update transaction with return first scan timestamp (only if SMS was actually sent)
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
        
        // Trigger transition/complete-return to move transaction to delivered state and create payout
        // This replaces the automatic time-based payout (booking-end + 2 days)
        try {
          const txId = transaction.id.uuid || transaction.id;
          const currentState = transaction.attributes?.state;
          const lastTransition = transaction.attributes?.lastTransition;
          
          console.log(`🔄 [PAYOUT] Checking if transition/complete-return should be triggered for tx ${txId}`);
          console.log(`🔄 [PAYOUT] Current state: ${currentState}`);
          console.log(`🔄 [PAYOUT] Last transition: ${lastTransition || 'none'}`);
          
          // STATE GUARD 1: Check if transaction is already delivered/complete
          // Prevent payout if already in delivered state or already completed
          if (currentState === 'delivered') {
            console.log(`ℹ️ [PAYOUT] Transaction is already in 'delivered' state - skipping payout (already completed)`);
            // Skip payout trigger but continue to send response
          }
          // STATE GUARD 2: Check if transition/complete-return or transition/complete-replacement already happened
          // This provides additional idempotency protection
          else if (lastTransition === 'transition/complete-return' || lastTransition === 'transition/complete-replacement') {
            console.log(`ℹ️ [PAYOUT] Transaction already completed via '${lastTransition}' - skipping payout (idempotent)`);
            // Skip payout trigger but continue to send response
          }
          // STATE GUARD 3: Only trigger if transaction is in :state/accepted
          // Reject if in earlier states (pending-payment, preauthorized) or other unexpected states
          else if (currentState !== 'accepted') {
            console.log(`ℹ️ [PAYOUT] Transaction is in state '${currentState}' (not 'accepted') - skipping transition/complete-return`);
            console.log(`ℹ️ [PAYOUT] Payout can only be triggered from 'accepted' state`);
            // Skip payout trigger but continue to send response
          }
          // All guards passed - proceed with payout trigger
          else {
            console.log(`✅ [PAYOUT] All state guards passed - triggering transition/complete-return for tx ${txId}`);
            
            const integrationSdk = getIntegrationSdk();
            
            try {
              // Call transition/complete-return with correct Flex transaction ID and transition name
              const transitionResponse = await integrationSdk.transactions.transition({
                id: txId, // Flex transaction ID (not Shippo shipment ID)
                transition: 'transition/complete-return', // Exact match with process.edn
                params: {}
              });
              
              console.log(`✅ [PAYOUT] transition/complete-return succeeded for tx ${txId}`);
              console.log(`✅ [PAYOUT] Transaction moved to state: ${transitionResponse?.data?.data?.attributes?.state || 'unknown'}`);
              
            } catch (transitionError) {
              // IDEMPOTENCY & ERROR HANDLING:
              // Handle 409/400 as non-fatal (already transitioned, wrong state, etc.)
              // Log other errors clearly but don't crash the webhook handler
              const errorStatus = transitionError?.response?.status || transitionError?.status;
              const errorData = transitionError?.response?.data || transitionError?.data;
              const errorCode = errorData?.errors?.[0]?.code;
              const errorTitle = errorData?.errors?.[0]?.title || errorData?.message || transitionError.message;
              
              if (errorStatus === 409 || errorStatus === 400) {
                // 409 = Conflict (already in target state or invalid transition)
                // 400 = Bad Request (invalid transition, wrong state, etc.)
                // These are idempotent cases - treat as success
                console.log(`ℹ️ [PAYOUT] transition/complete-return already applied or invalid (status: ${errorStatus}, code: ${errorCode || 'none'})`);
                console.log(`ℹ️ [PAYOUT] This is expected for duplicate webhooks - treating as idempotent success`);
                console.log(`ℹ️ [PAYOUT] Error details: ${errorTitle}`);
              } else {
                // Real errors (auth, network, 5xx) - log with detail but don't fail webhook
                console.error(`❌ [PAYOUT] Failed to trigger transition/complete-return for tx ${txId}`);
                console.error(`❌ [PAYOUT] Error status: ${errorStatus || 'unknown'}`);
                console.error(`❌ [PAYOUT] Error code: ${errorCode || 'none'}`);
                console.error(`❌ [PAYOUT] Error message: ${transitionError.message}`);
                console.error(`❌ [PAYOUT] Error data:`, JSON.stringify(errorData, null, 2));
                // Don't throw - webhook should still return 200 (SMS was sent successfully)
              }
            }
          }
        } catch (payoutError) {
          // Catch-all for unexpected errors during payout trigger
          // Log but don't fail the webhook - SMS was already sent successfully
          console.error(`❌ [PAYOUT] Unexpected error during payout trigger:`, payoutError.message);
          console.error(`❌ [PAYOUT] Stack:`, payoutError.stack);
          // Don't throw - webhook should still return 200
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
      // [SHIPPO DELIVERY DEBUG] Log idempotency check for delivered
      if (isDelivery) {
        const deliveredSent = protectedData.shippingNotification?.delivered?.sent === true;
        const deliveredSentAt = protectedData.shippingNotification?.delivered?.sentAt;
        console.log(`[SHIPPO DELIVERY DEBUG] 🔒 Idempotency check (DELIVERED):`);
        console.log(`[SHIPPO DELIVERY DEBUG]   shippingNotification.delivered.sent: ${deliveredSent}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   shippingNotification.delivered.sentAt: ${deliveredSentAt || 'NOT SET'}`);
        
        if (deliveredSent) {
          console.log(`[SHIPPO DELIVERY DEBUG] ⚠️ SKIPPING - Delivery SMS already sent (idempotent)`);
          console.log('ℹ️ Delivery SMS already sent - skipping (idempotent)');
          return res.status(200).json({ message: 'Delivery SMS already sent - idempotent' });
        } else {
          console.log(`[SHIPPO DELIVERY DEBUG] ✅ Proceeding - Delivery SMS not yet sent`);
        }
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
      
      // [SHIPPO DELIVERY DEBUG] Log borrower phone lookup
      if (isDelivery) {
        console.log(`[SHIPPO DELIVERY DEBUG] 📱 Borrower phone lookup:`);
        console.log(`[SHIPPO DELIVERY DEBUG]   borrowerPhone: ${borrowerPhone || 'NOT FOUND'}`);
      }
      
      if (!borrowerPhone) {
        console.log(`[SHIPPO DELIVERY DEBUG] ⚠️ SKIPPING - No borrower phone number found`);
        console.log(`[SHIPPO DELIVERY DEBUG]   transactionId: ${txIdFromTransaction}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   Checked locations:`);
        console.log(`[SHIPPO DELIVERY DEBUG]     1. customer.profile.protectedData.phone: ${transaction.relationships?.customer?.data?.attributes?.profile?.protectedData?.phone || 'NOT FOUND'}`);
        console.log(`[SHIPPO DELIVERY DEBUG]     2. protectedData.customerPhone: ${transaction.attributes?.protectedData?.customerPhone || 'NOT FOUND'}`);
        console.log(`[SHIPPO DELIVERY DEBUG]     3. metadata.customerPhone: ${transaction.attributes?.metadata?.customerPhone || 'NOT FOUND'}`);
        console.warn('⚠️ No borrower phone number found - cannot send SMS');
        return res.status(400).json({ error: 'No borrower phone number found' });
      }
      
      console.log(`📱 Borrower phone: ${borrowerPhone}`);
      
      let message, smsType, protectedDataUpdate;
      
      if (isDelivery) {
        // [SHIPPO DELIVERY DEBUG] Log entering delivery SMS branch
        console.log(`[SHIPPO DELIVERY DEBUG] 📤 Preparing delivery SMS:`);
        console.log(`[SHIPPO DELIVERY DEBUG]   transactionId: ${txIdFromTransaction}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   trackingNumber: ${trackingNumber}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   carrier: ${carrier}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   direction: OUTBOUND`);
        
        // Send delivery SMS
        message = "🎁 Your Sherbrt borrow was delivered! 🍧 Don't forget to take pics and tag @shoponsherbrt while you're slaying in your borrowed fit! 📸✨";
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
      
      // [SHIPPO DELIVERY DEBUG] Check SMS configuration before sending
      if (isDelivery) {
        const smsDryRun = process.env.SMS_DRY_RUN === '1' || process.env.SMS_DRY_RUN === 'true';
        const onlyPhone = process.env.ONLY_PHONE;
        const hasTwilioCreds = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
        
        console.log(`[SHIPPO DELIVERY DEBUG] 📤 SMS configuration check:`);
        console.log(`[SHIPPO DELIVERY DEBUG]   SMS_DRY_RUN: ${smsDryRun ? 'ENABLED (SMS will be logged but NOT sent)' : 'DISABLED'}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   ONLY_PHONE: ${onlyPhone || 'NOT SET'}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   Twilio credentials: ${hasTwilioCreds ? 'PRESENT' : 'MISSING (SMS will be skipped)'}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   to: ${borrowerPhone}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   tag: ${SMS_TAGS.DELIVERY_TO_BORROWER}`);
        console.log(`[SHIPPO DELIVERY DEBUG]   message: ${message.substring(0, 50)}...`);
        
        if (smsDryRun) {
          console.warn(`[SHIPPO DELIVERY DEBUG] ⚠️ SMS_DRY_RUN is enabled - SMS will be logged but NOT actually sent`);
        }
        if (onlyPhone && borrowerPhone !== onlyPhone) {
          console.warn(`[SHIPPO DELIVERY DEBUG] ⚠️ ONLY_PHONE is set to ${onlyPhone} but borrower phone is ${borrowerPhone} - SMS will be skipped`);
        }
        if (!hasTwilioCreds) {
          console.warn(`[SHIPPO DELIVERY DEBUG] ⚠️ Twilio credentials missing - SMS will be skipped`);
        }
      }
      
      try {
        
        const smsResult = await sendSMS(borrowerPhone, message, { 
          role: 'customer',
          transactionId: transaction.id,
          transition: `webhook/shippo-${smsType.replace(' ', '-')}`,
          tag: isDelivery ? SMS_TAGS.DELIVERY_TO_BORROWER : SMS_TAGS.ITEM_SHIPPED_TO_BORROWER,
          meta: { listingId: transaction.attributes.listing?.id?.uuid || transaction.attributes.listing?.id }
        });
        
        // [SHIPPO_SMS_DEBUG] Log the full result for delivery SMS debugging
        if (isDelivery) {
          console.log(`[SHIPPO_SMS_DEBUG] delivered SMS result:`, JSON.stringify({
            skipped: smsResult?.skipped || false,
            reason: smsResult?.reason || null,
            sent: smsResult?.sent || false,
            sid: smsResult?.sid || null,
            suppressed: smsResult?.suppressed || false,
            to: borrowerPhone,
            transactionId: transaction.id,
            tag: SMS_TAGS.DELIVERY_TO_BORROWER
          }, null, 2));
        }
        
        // Check if SMS was actually sent (not skipped by guards)
        if (smsResult && smsResult.skipped) {
          console.log(`[SHIPPO DELIVERY DEBUG] ⚠️ SMS was skipped: ${smsResult.reason} - NOT setting idempotency flag`);
          if (isDelivery) {
            console.log(`[SHIPPO DELIVERY DEBUG] ⚠️ Delivery SMS skipped - flag will NOT be set, allowing retry`);
          }
          if (isFirstScan) {
            console.log(`⚠️ [STEP-4] First scan SMS skipped - flag will NOT be set, allowing retry`);
          }
          return res.status(200).json({ 
            success: false, 
            message: `${smsType} SMS skipped: ${smsResult.reason}`,
            skipped: true,
            reason: smsResult.reason
          });
        }
        
        if (isDelivery) {
          console.log(`[SHIPPO DELIVERY DEBUG] ✅ Delivery SMS sent successfully`);
        }
        
        if (isFirstScan) {
          console.log(`✅ [STEP-4] Borrower SMS sent for tracking ${trackingNumber}, txId=${transaction.id}`);
        } else {
          console.log(`✅ ${smsType} SMS sent successfully to ${borrowerPhone}`);
        }
        
        // Mark SMS as sent in transaction protectedData (only if SMS was actually sent)
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
        if (isDelivery) {
          console.log(`[SHIPPO DELIVERY DEBUG] ❌ FAILED to send delivery SMS:`);
          console.log(`[SHIPPO DELIVERY DEBUG]   error: ${smsError.message}`);
          console.log(`[SHIPPO DELIVERY DEBUG]   stack: ${smsError.stack || 'N/A'}`);
        }
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
      
      const { txId, status = 'TRANSIT', status_details = '', metadata = {} } = req.body;
      
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
      // Include PRE_TRANSIT if status_details indicates facility scan
      const upperStatusDetails = (status_details || '').toUpperCase();
      const facilityScanIndicators = ['PROCESSING AT', 'ORIGIN SCAN', 'FACILITY', 'PICKED UP', 'ACCEPTED AT', 'RECEIVED AT'];
      const hasFacilityScan = facilityScanIndicators.some(ind => upperStatusDetails.includes(ind));
      const isPreTransitWithScan = upperStatus === 'PRE_TRANSIT' && hasFacilityScan;
      
      const isShipped = ['ACCEPTED', 'IN_TRANSIT', 'TRANSIT'].includes(upperStatus) || isPreTransitWithScan;
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
        message = "🎁 Your Sherbrt borrow was delivered! 🍧 Don't forget to take pics and tag @shoponsherbrt while you're slaying in your borrowed fit! 📸✨";
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


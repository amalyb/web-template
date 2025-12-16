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

const FLEX_TX_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseShippoMetadata(rawMetadata) {
  if (!rawMetadata) return {};

  if (typeof rawMetadata === 'string') {
    try {
      return JSON.parse(rawMetadata);
    } catch (e) {
      console.warn('[SHIPPO-WEBHOOK][METADATA-PARSE-ERROR]', e.message);
      return {};
    }
  }

  if (typeof rawMetadata === 'object') {
    return rawMetadata;
  }

  return {};
}

function getTransactionIdFromShippoMetadata(metadata = {}) {
  const raw =
    metadata.transactionId ||
    metadata.txId ||
    metadata.transaction_id ||
    metadata.tx_id ||
    null;

  if (!raw) {
    console.warn('[SHIPPO-WEBHOOK][NO-METADATA-TXID]', { metadata });
    return null;
  }

  if (typeof raw === 'object' && raw !== null) {
    if (raw.uuid) {
      return String(raw.uuid);
    }
    if (raw.id) {
      return String(raw.id);
    }
  }

  const txIdStr = String(raw);
  if (!FLEX_TX_ID_REGEX.test(txIdStr)) {
    console.warn('[SHIPPO-WEBHOOK][TXID-FORMAT-INVALID]', { txId: txIdStr });
    return null;
  }

  return txIdStr;
}

// Normalize SHIPPO_MODE values to Shippo's event.mode vocabulary
// Accepts legacy values:
//   - "production" -> "live"
//   - "sandbox" -> "test"
// Returns lowercased string or null if empty
function normalizeShippoMode(mode) {
  if (!mode) return null;
  const value = String(mode).toLowerCase();
  if (value === 'production' || value === 'live') return 'live';
  if (value === 'sandbox' || value === 'test') return 'test';
  return value;
}

function hasReturnFirstScan(tx) {
  const pd = tx?.attributes?.protectedData || {};
  const ret = pd.return || {};
  return !!ret.firstScanAt;
}

function hasReplacementCharged(tx) {
  const pd = tx?.attributes?.protectedData || {};
  const ret = pd.return || {};
  return !!ret.replacementCharged;
}

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
let lastCompareException = null;
let lastCompareLengthsMatch = true;
function safeTimingEqual(aStr, bStr) {
  lastCompareException = null;
  lastCompareLengthsMatch = true;
  try {
    if (!aStr || !bStr) {
      lastCompareLengthsMatch = false;
      return false;
    }
    const bufA = Buffer.from(aStr);
    const bufB = Buffer.from(bStr);
    lastCompareLengthsMatch = bufA.length === bufB.length;
    if (!lastCompareLengthsMatch) return false;
    const crypto = require('crypto');
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (error) {
    lastCompareException = error;
    console.error('[SHIPPO-WEBHOOK][SIGNATURE-COMPARE-ERROR]', error.message);
    return false;
  }
}

/*
Manual signature checks:
- Missing header -> expect 401
- Wrong header -> expect 401
- Wrong-length header (e.g. "short") -> expect 401
- Correct header -> node -e "const crypto=require('crypto'); const body='{}'; const secret=process.env.SHIPPO_WEBHOOK_SECRET || 'secret'; const sig=crypto.createHmac('sha256',secret).update(body).digest('hex'); console.log(sig)" then send header x-shippo-signature=<sig> with body "{}" -> expect 200
*/
function verifyShippoSignature(req, webhookSecret) {
  const crypto = require('crypto');
  const shippoSignature = req.headers['x-shippo-signature'];

  const logInvalidSignature = (reason, computedSignature = '') => {
    const headerPresent = !!shippoSignature;
    const headerLen = shippoSignature ? Buffer.byteLength(shippoSignature) : 0;
    const computedLen = computedSignature ? Buffer.byteLength(computedSignature) : 0;
    console.warn(
      `[SHIPPO-WEBHOOK][SIGNATURE-INVALID] headerPresent=${headerPresent} headerLen=${headerLen} computedLen=${computedLen} reason=${reason}`
    );
  };

  if (!shippoSignature) {
    logInvalidSignature('missing-header');
    console.log('⚠️ No X-Shippo-Signature header found');
    return false;
  }
  
  if (!webhookSecret) {
    logInvalidSignature('missing-secret');
    console.log('⚠️ No SHIPPO_WEBHOOK_SECRET configured');
    return false;
  }
  
  // Use the raw body for signature verification
  const rawBody = req.rawBody;
  
  // Shippo uses HMAC SHA256
  let signature;
  try {
    signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');
  } catch (error) {
    console.error('[SHIPPO-WEBHOOK][SIGNATURE-GENERATE-ERROR]', error.message);
    logInvalidSignature('generate-error');
    return false;
  }
  
  if (!signature) {
    logInvalidSignature('generate-error');
    return false;
  }
  
  const isValid = safeTimingEqual(shippoSignature, signature);
  if (!isValid) {
    const reason = !lastCompareLengthsMatch
      ? 'length-mismatch'
      : lastCompareException
        ? 'compare-exception'
        : 'mismatch';
    logInvalidSignature(reason, signature);
  }
  
  if (process.env.VERBOSE === '1') {
    console.log(`🔐 Shippo signature verification: ${isValid ? 'VALID' : 'INVALID'}`);
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
    // Log parsed data (safe - limited fields only)
    const trackingNumber = req.body?.data?.tracking_number || 'UNKNOWN';
    const eventType = req.body?.event?.type || 'unknown';
    const eventMode = req.body?.event?.mode || 'unknown';
    console.log(`[SHIPPO-WEBHOOK-ATTEMPT] ✅ Parsed JSON: event=${eventType}, mode=${eventMode}, tracking=${trackingNumber}`);
  } catch (error) {
    console.error(`[SHIPPO-WEBHOOK-ATTEMPT] ❌ Failed to parse JSON body: ${error.message}`);
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

  const payload = req.body;
  const eventType = payload?.event?.type || payload?.event || 'unknown';
  const testPrefix = isTest ? '[TEST] ' : '';
  console.log(`${testPrefix}🚀 Shippo webhook received! event=${eventType}`);

  // Verify Shippo signature (skip if not configured for test environments or if skipSignature is set)
  if (!skipSignature) {
    const webhookSecret = process.env.SHIPPO_WEBHOOK_SECRET;
    if (webhookSecret) {
      if (!verifyShippoSignature(req, webhookSecret)) {
        console.log(`${testPrefix}🚫 Invalid Shippo signature - rejecting request`);
        return res.status(401).json({ error: 'Invalid signature' });
      }
      console.log(`${testPrefix}✅ Shippo signature verified`);
    } else {
      console.log(`${testPrefix}⚠️ SHIPPO_WEBHOOK_SECRET not set - skipping signature verification (test mode)`);
    }
  } else {
    console.log(`${testPrefix}⚠️ Signature verification skipped (test mode)`);
  }
  
  try {
      // Validate payload structure
      if (!payload || !payload.data) {
        console.warn('⚠️ Invalid payload structure - missing data field');
        return res.status(400).json({ error: 'Invalid payload structure' });
      }
      
      const { data, event } = payload;
      
      // Extract tracking information
      const trackingNumber = data.tracking_number || data.trackingNumber || null;
      const carrier = data.carrier || null;
      const trackingStatus = data.tracking_status?.status;
      const statusDetails = data.tracking_status?.status_details || data.tracking_status?.substatus || '';
      const substatus = statusDetails; // For backward compatibility with existing code
      
      const metadata = parseShippoMetadata(data.metadata);
      const txIdStr = getTransactionIdFromShippoMetadata(metadata);
      
      console.log('[SHIPPO-WEBHOOK-ATTEMPT]', {
        direction: metadata.direction || 'unknown',
        rawStatus: trackingStatus || null,
        trackingNumber,
        carrier,
        txId: txIdStr || null,
      });
      
      if (!txIdStr) {
        console.warn('[SHIPPO-WEBHOOK][NO-TXID-PARSED]', { metadata });
      }
      
      // Debug log after metadata parsing (safe fields only)
      console.log('[SHIPPO-WEBHOOK]', {
        direction: metadata.direction || 'unknown',
        txId: txIdStr || null,
        trackingNumber: trackingNumber || 'MISSING',
        status: trackingStatus || 'MISSING',
      });
      
      // Gate by Shippo mode - ignore events whose event.mode doesn't match our SHIPPO_MODE
      const expectedModeRaw = process.env.SHIPPO_MODE; // accepts legacy values (production/sandbox)
      const expectedMode = normalizeShippoMode(expectedModeRaw);
      const eventMode = normalizeShippoMode(event?.mode);
      if (expectedMode && eventMode && eventMode !== expectedMode) {
        console.warn('[SHIPPO][WEBHOOK] Mode mismatch', { 
          eventMode: event?.mode, 
          normalizedEventMode: eventMode,
          expectedMode: expectedModeRaw, 
          normalizedExpectedMode: expectedMode 
        });
        return res.status(200).json({ ok: true }); // ignore silently
      }
      
      console.log(`✅ Shippo mode check passed: event.mode=${event?.mode || 'none'} (normalized=${eventMode || 'none'}), expected=${expectedModeRaw || 'any'} (normalized=${expectedMode || 'any'})`);
      
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
        console.log(`[SHIPPO-WEBHOOK] direction=${metadata.direction || 'none'}, txId=${txIdStr || 'MISSING'}, tracking=${trackingNumber || 'MISSING'}`);
        console.log('[SHIPPO-WEBHOOK][NO-ACTION]', {
          txId: txIdStr || null,
          trackingNumber,
          status: trackingStatus || null,
          reason: 'out-for-delivery',
        });
        // Still try to find transaction and log it for debugging
        if (txIdStr) {
          try {
            const sdk = await getTrustedSdk();
            const response = await sdk.transactions.show({ id: txIdStr });
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
        console.log('[SHIPPO-WEBHOOK][NO-ACTION]', {
          txId: txIdStr || null,
          trackingNumber,
          status: trackingStatus || null,
          reason: 'status-not-relevant',
        });
        return res.status(200).json({ message: `Status ${trackingStatus} ignored` });
      }
      
      console.log(`[SHIPPO DELIVERY DEBUG] ✅ Entering ${isDelivery ? 'DELIVERED' : 'FIRST_SCAN'} branch`);
      console.log(`✅ Status is ${upperStatus} - processing ${isDelivery ? 'delivery' : 'first scan'} webhook`);
    
    // Find transaction
    let transaction = null;
    let matchStrategy = 'unknown';
    
    // Method 1: Try to find by transaction ID from metadata (supports both transactionId and txId)
    if (txIdStr) {
      console.log(`🔍 Looking up transaction by metadata transaction ID: ${txIdStr}`);
      try {
        const sdk = await getTrustedSdk();
        const response = await sdk.transactions.show({ id: txIdStr });
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
        console.error(`[SHIPPO DELIVERY DEBUG]   transactionId: ${txIdStr}`);
        console.error(`[SHIPPO DELIVERY DEBUG]   error.message: ${error.message}`);
        console.error(`[SHIPPO DELIVERY DEBUG]   HTTP status: ${errorStatus || 'N/A'}`);
        console.error(`[SHIPPO DELIVERY DEBUG]   error.code: ${errorCode || 'N/A'}`);
        console.error(`[SHIPPO DELIVERY DEBUG]   error.title: ${errorTitle || 'N/A'}`);
        
        // Log environment context
        const integClientId = process.env.INTEGRATION_CLIENT_ID;
        const shippoMode = process.env.SHIPPO_MODE || 'NOT SET';
        const baseUrl = process.env.FLEX_INTEGRATION_BASE_URL ||
                        process.env.SHARETRIBE_SDK_BASE_URL || 
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
      console.error(`[SHIPPO DELIVERY DEBUG]   metadata.transactionId: ${txIdStr || 'MISSING'}`);
      console.error(`[SHIPPO DELIVERY DEBUG]   matchStrategy attempted: ${matchStrategy}`);
      
      // Log environment context for debugging
      const integClientId = process.env.INTEGRATION_CLIENT_ID;
      const shippoMode = process.env.SHIPPO_MODE || 'NOT SET';
      const baseUrl = process.env.FLEX_INTEGRATION_BASE_URL ||
                      process.env.SHARETRIBE_SDK_BASE_URL || 
                      process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL || 
                      'https://flex-api.sharetribe.com (default)';
      
      console.error(`[SHIPPO DELIVERY DEBUG]   environment context:`);
      console.error(`[SHIPPO DELIVERY DEBUG]     SHIPPO_MODE: ${shippoMode}`);
      console.error(`[SHIPPO DELIVERY DEBUG]     Base URL: ${baseUrl}`);
      console.error(`[SHIPPO DELIVERY DEBUG]     INTEGRATION_CLIENT_ID: ${integClientId ? integClientId.substring(0, 8) + '...' + integClientId.substring(integClientId.length - 4) : 'NOT SET'}`);
      
      if (txIdStr) {
        console.error(`[SHIPPO DELIVERY DEBUG]   Transaction lookup by ID failed - check if transaction exists: ${txIdStr}`);
        console.error(`[SHIPPO DELIVERY DEBUG]   → Run debug script: node server/scripts/debugShippoDeliveryForTx.js ${txIdStr} ${trackingNumber || ''}`);
      }
      if (trackingNumber) {
        console.error(`[SHIPPO DELIVERY DEBUG]   Tracking number search failed - only searches last 100 transactions`);
        console.error(`[SHIPPO DELIVERY DEBUG]   If transaction is older, ensure metadata.transactionId is included in webhook`);
      }
      console.error('❌ Could not find transaction for this tracking update');
      console.warn('[SHIPPO-WEBHOOK][TX-NOT-FOUND]', { txId: txIdStr || null, metadata });
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
    
    console.log('[SHIPPO-WEBHOOK-ATTEMPT]', {
      direction: isReturnTracking ? 'return' : 'outbound',
      rawStatus: trackingStatus || null,
      trackingNumber,
      carrier,
      txId: txIdStr || null,
    });
    
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

    if (isReturnTracking && isFirstScan) {
      console.log('📬 [PAYOUT] Processing return first scan - sending SMS to lender and triggering payout');
      
      const alreadyHasScan = hasReturnFirstScan(transaction);
      let scanRecorded = alreadyHasScan;
      let updatedTransaction = transaction;
      
      if (!alreadyHasScan) {
        const lenderPhone = getLenderPhone(transaction);
        if (!lenderPhone) {
          console.warn('⚠️ No lender phone number found - cannot send return SMS');
          console.log('[SHIPPO-WEBHOOK][NO-ACTION]', {
            txId: txIdFromTransaction,
            trackingNumber,
            status: trackingStatus || null,
            reason: 'missing-lender-phone',
          });
          return res.status(400).json({ error: 'No lender phone number found' });
        }
        
        const rawTitle = transaction.attributes.listing?.title || 'your item';
        const listingTitle = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;
        const returnCarrier = protectedData.returnCarrier;
        const publicTrackingUrl = getPublicTrackingUrl(returnCarrier, trackingNumber);
        console.log(`[TRACKINGLINK] Using short public link for return: ${publicTrackingUrl} (carrier: ${returnCarrier || 'unknown'})`);
        
        const shortTrackingUrl = await shortLink(publicTrackingUrl);
        const message = `📬 Return in transit: "${listingTitle}". Track: ${shortTrackingUrl}`;
        
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
        
        if (smsResult && smsResult.skipped) {
          console.log(`⚠️ [PAYOUT] Return first scan SMS was skipped: ${smsResult.reason} - NOT setting firstScanAt timestamp`);
          console.log('ℹ️ [PAYOUT] Skipping payout trigger because SMS was skipped and scan not recorded');
          return res.status(200).json({ 
            success: false, 
            message: `Return first scan SMS skipped: ${smsResult.reason}`,
            skipped: true,
            reason: smsResult.reason
          });
        }
        
        try {
          const txId = transaction.id.uuid || transaction.id;
          const result = await upsertProtectedData(txId, {
            return: {
              ...(returnData || {}),
              firstScanAt: timestamp()
            }
          }, { source: 'webhook' });
          
          if (result && result.success === false) {
            console.error(`❌ Failed to update transaction with return first scan:`, result.error);
          } else {
            console.log(`💾 Updated transaction with return first scan timestamp`);
            updatedTransaction = {
              ...(transaction || {}),
              attributes: {
                ...(transaction?.attributes || {}),
                protectedData: {
                  ...(protectedData || {}),
                  return: {
                    ...(returnData || {}),
                    firstScanAt: transaction?.attributes?.protectedData?.return?.firstScanAt || timestamp()
                  }
                }
              }
            };
            scanRecorded = hasReturnFirstScan(updatedTransaction);
          }
        } catch (updateError) {
          console.error(`❌ Failed to update transaction:`, updateError.message);
        }
        
        if (!scanRecorded) {
          console.log('⚠️ [PAYOUT] Return scan timestamp missing after update - skipping payout trigger');
          return res.status(200).json({
            success: false,
            message: 'Return scan not recorded; payout not triggered'
          });
        }
        
        console.log(`✅ Return first scan SMS sent to lender ${lenderPhone}`);
      } else {
        console.log('ℹ️ [PAYOUT] Return scan already recorded - skipping lender SMS but evaluating payout guard');
      }

      transaction = updatedTransaction || transaction;

      if (!hasReturnFirstScan(transaction)) {
        console.log('⚠️ [PAYOUT] Guard: return scan missing - refusing payout trigger');
        console.log('[SHIPPO-WEBHOOK][NO-ACTION]', {
          txId: txIdFromTransaction,
          trackingNumber,
          status: trackingStatus || null,
          reason: 'missing-first-scan',
        });
        return res.status(200).json({
          success: false,
          message: 'Return scan missing; payout not triggered'
        });
      }

      try {
        const txId = transaction.id.uuid || transaction.id;
        const currentState = transaction.attributes?.state;
        const lastTransition = transaction.attributes?.lastTransition;
        const replacementAlreadyCharged = hasReplacementCharged(transaction);
        
        console.log(`🔄 [PAYOUT] Checking if transition/complete-return should be triggered for tx ${txId}`);
        console.log(`🔄 [PAYOUT] Current state: ${currentState}`);
        console.log(`🔄 [PAYOUT] Last transition: ${lastTransition || 'none'}`);
        console.log(`🔄 [PAYOUT] replacementCharged flag: ${replacementAlreadyCharged}`);
        
        if (currentState === 'delivered') {
          console.log(`ℹ️ [PAYOUT] Transaction is already in 'delivered' state - skipping payout (already completed)`);
          console.log('[SHIPPO-WEBHOOK][NO-ACTION]', {
            txId: txId,
            trackingNumber,
            status: trackingStatus || null,
            reason: 'already-delivered',
          });
        } else if (lastTransition === 'transition/complete-return' || lastTransition === 'transition/complete-replacement') {
          console.log(`ℹ️ [PAYOUT] Transaction already completed via '${lastTransition}' - skipping payout (idempotent)`);
          console.log('[SHIPPO-WEBHOOK][NO-ACTION]', {
            txId: txId,
            trackingNumber,
            status: trackingStatus || null,
            reason: 'already-completed',
          });
        } else if (currentState !== 'accepted') {
          console.log(`ℹ️ [PAYOUT] Transaction is in state '${currentState}' (not 'accepted') - skipping transition/complete-return`);
          console.log(`ℹ️ [PAYOUT] Payout can only be triggered from 'accepted' state`);
          console.log('[SHIPPO-WEBHOOK][NO-ACTION]', {
            txId: txId,
            trackingNumber,
            status: trackingStatus || null,
            reason: 'state-not-accepted',
          });
        } else {
          console.log(`✅ [PAYOUT] All state guards passed - triggering transition/complete-return for tx ${txId}`);
          
          const integrationSdk = getIntegrationSdk();
          
          try {
            console.log('[SHIPPO-WEBHOOK][COMPLETE-RETURN]', {
              txId: txId,
              trackingNumber,
              status: trackingStatus || null,
            });
            const transitionResponse = await integrationSdk.transactions.transition({
              id: txId,
              transition: 'transition/complete-return',
              params: {}
            });
            
            console.log(`✅ [PAYOUT] transition/complete-return succeeded for tx ${txId}`);
            console.log(`✅ [PAYOUT] Transaction moved to state: ${transitionResponse?.data?.data?.attributes?.state || 'unknown'}`);
            
          } catch (transitionError) {
            const errorStatus = transitionError?.response?.status || transitionError?.status;
            const errorData = transitionError?.response?.data || transitionError?.data;
            const errorCode = errorData?.errors?.[0]?.code;
            const errorTitle = errorData?.errors?.[0]?.title || errorData?.message || transitionError.message;
            
            if (errorStatus === 409 || errorStatus === 400) {
              console.log(`ℹ️ [PAYOUT] transition/complete-return already applied or invalid (status: ${errorStatus}, code: ${errorCode || 'none'})`);
              console.log(`ℹ️ [PAYOUT] This is expected for duplicate webhooks - treating as idempotent success`);
              console.log(`ℹ️ [PAYOUT] Error details: ${errorTitle}`);
            } else {
              console.error(`❌ [PAYOUT] Failed to trigger transition/complete-return for tx ${txId}`);
              console.error(`❌ [PAYOUT] Error status: ${errorStatus || 'unknown'}`);
              console.error(`❌ [PAYOUT] Error code: ${errorCode || 'none'}`);
              console.error(`❌ [PAYOUT] Error message: ${transitionError.message}`);
              console.error(`❌ [PAYOUT] Error data:`, JSON.stringify(errorData, null, 2));
            }
          }
        }
      } catch (payoutError) {
        console.error(`❌ [PAYOUT] Unexpected error during payout trigger:`, payoutError.message);
        console.error(`❌ [PAYOUT] Stack:`, payoutError.stack);
      }
      
      return res.status(200).json({ 
        success: true, 
        message: alreadyHasScan 
          ? 'Return scan already recorded; payout guard evaluated'
          : 'Return first scan recorded; payout guard evaluated',
        transactionId: transaction.id
      });
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
          ...(protectedData || {}),
          lastTrackingStatus: {
            status: trackingStatus,
            substatus: substatus,
            timestamp: timestamp(), // ← respects FORCE_NOW
            event: 'delivered'
          },
          shippingNotification: {
            ...(protectedData?.shippingNotification || {}),
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
          ...(protectedData || {}),
          lastTrackingStatus: {
            status: trackingStatus,
            substatus: substatus,
            timestamp: timestamp(), // ← respects FORCE_NOW
            event: 'first_scan'
          },
          shippingNotification: {
            ...(protectedData?.shippingNotification || {}),
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

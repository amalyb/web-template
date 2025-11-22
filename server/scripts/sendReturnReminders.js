#!/usr/bin/env node
require('dotenv').config();

let sendSMS = null;
try {
  const smsModule = require('../api-util/sendSMS');
  sendSMS = smsModule.sendSMS;
} catch (error) {
  console.warn('⚠️ SMS module not available — SMS functionality disabled');
  sendSMS = () => Promise.resolve();
}

// ✅ Use the correct SDK helper for scripts (Integration SDK preferred, no user token needed)
const getFlexSdk = require('../util/getFlexSdk');
const { shortLink } = require('../api-util/shortlink');

// Helper to mask secrets for logging
function maskSecret(value, keepLast = 6) {
  if (!value || typeof value !== 'string') return '(empty or not a string)';
  if (value.length <= keepLast) return '***';
  return value.slice(0, -keepLast).replace(/./g, '*') + value.slice(-keepLast);
}

// Helper to check for hidden whitespace/BOM
function checkForHiddenChars(value) {
  if (!value) return { hasWhitespace: false, hasBOM: false, issues: [] };
  const issues = [];
  if (/\s/.test(value)) issues.push('contains whitespace');
  if (value.charCodeAt(0) === 0xFEFF) issues.push('has BOM');
  if (/\n/.test(value)) issues.push('contains newline');
  if (/\r/.test(value)) issues.push('contains carriage return');
  if (/\t/.test(value)) issues.push('contains tab');
  return {
    hasWhitespace: /\s/.test(value),
    hasBOM: value.charCodeAt(0) === 0xFEFF,
    issues: issues.length > 0 ? issues : ['none']
  };
}

// Create SDK instance for scripts using centralized helper
// This uses Integration SDK (preferred) or Marketplace SDK (fallback)
// No user token required - perfect for backend automation
async function getScriptSdk() {
  // ===== DIAGNOSTIC: Log SDK initialization details =====
  console.log('\n[FLEX-400-DIAG] ===== SDK INITIALIZATION DIAGNOSTICS =====');
  
  const INTEGRATION_ID = process.env.INTEGRATION_CLIENT_ID;
  const INTEGRATION_SECRET = process.env.INTEGRATION_CLIENT_SECRET;
  const MARKETPLACE_ID = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
  const MARKETPLACE_SECRET = process.env.SHARETRIBE_SDK_CLIENT_SECRET;
  const BASE_URL = process.env.SHARETRIBE_SDK_BASE_URL || process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL;
  
  // Log which credentials are present
  if (INTEGRATION_ID && INTEGRATION_SECRET) {
    console.log(`[FLEX-400-DIAG] Using Integration SDK (preferred for scripts)`);
    console.log(`[FLEX-400-DIAG] Integration Client ID: ${maskSecret(INTEGRATION_ID)}`);
    console.log(`[FLEX-400-DIAG] Integration Secret present: YES`);
  } else if (MARKETPLACE_ID && MARKETPLACE_SECRET) {
    console.log(`[FLEX-400-DIAG] Using Marketplace SDK (fallback)`);
    console.log(`[FLEX-400-DIAG] Marketplace Client ID: ${maskSecret(MARKETPLACE_ID)}`);
    console.log(`[FLEX-400-DIAG] Marketplace Secret present: YES`);
  } else {
    console.error(`[FLEX-400-DIAG] ❌ Missing credentials!`);
    console.error(`[FLEX-400-DIAG] Need either:`);
    console.error(`[FLEX-400-DIAG]   - INTEGRATION_CLIENT_ID + INTEGRATION_CLIENT_SECRET (preferred), or`);
    console.error(`[FLEX-400-DIAG]   - REACT_APP_SHARETRIBE_SDK_CLIENT_ID + SHARETRIBE_SDK_CLIENT_SECRET`);
  }
  
  console.log(`[FLEX-400-DIAG] BASE_URL: ${BASE_URL || '(will use default: https://flex-api.sharetribe.com)'}`);
  
  // Use centralized SDK factory (handles Integration vs Marketplace automatically)
  // This does NOT call exchangeToken() - Integration SDK doesn't need it,
  // and Marketplace SDK with clientSecret can work without user token exchange
  const sdk = getFlexSdk();
  
  // ===== DIAGNOSTIC: Test query to verify SDK works =====
  let testQuerySuccess = false;
  let testQueryError = null;
  
  try {
    console.log('[FLEX-400-DIAG] Running test query: sdk.transactions.query({ per_page: 1 })...');
    const testResult = await sdk.transactions.query({ per_page: 1 });
    testQuerySuccess = true;
    console.log(`[FLEX-400-DIAG] ✅ Test query succeeded. Found ${testResult?.data?.data?.length || 0} transactions`);
  } catch (err) {
    testQuerySuccess = false;
    testQueryError = err;
    console.error('[FLEX-400-DIAG] ❌ Test query FAILED');
    console.error(`[FLEX-400-DIAG] Test query error message: ${err?.message || '(no message)'}`);
    if (err.response) {
      console.error(`[FLEX-400-DIAG] Test query response status: ${err.response.status}`);
      console.error(`[FLEX-400-DIAG] Test query response data: ${JSON.stringify(err.response.data, null, 2)}`);
    }
    if (err.stack) {
      console.error(`[FLEX-400-DIAG] Test query stack trace:\n${err.stack}`);
    }
    // Don't throw here - let the actual query attempt happen so we can see the full error
  }
  
  // Store diagnostics for summary
  global.__flex400Diagnostics = {
    exchangeTokenSuccess: true, // Integration SDK doesn't use exchangeToken
    exchangeTokenError: null,
    testQuerySuccess,
    testQueryError,
    clientIdMasked: INTEGRATION_ID ? maskSecret(INTEGRATION_ID) : maskSecret(MARKETPLACE_ID),
    clientSecretPresent: !!(INTEGRATION_SECRET || MARKETPLACE_SECRET),
    baseUrl: BASE_URL,
    marketplaceId: process.env.REACT_APP_SHARETRIBE_MARKETPLACE_ID,
    usingIntegrationSdk: !!(INTEGRATION_ID && INTEGRATION_SECRET),
  };
  
  return sdk;
}

// ---- CLI flags / env guards ----
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const getOpt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const DRY = has('--dry-run') || process.env.SMS_DRY_RUN === '1';
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const LIMIT = parseInt(getOpt('--limit', process.env.LIMIT || '0'), 10) || 0;
const ONLY_PHONE = process.env.ONLY_PHONE; // e.g. +15551234567 for targeted test

if (DRY) {
  const realSend = sendSMS;
  sendSMS = async (to, body, opts = {}) => {
    const { tag, meta } = opts;
    const metaJson = meta ? JSON.stringify(meta) : '{}';
    const bodyJson = JSON.stringify(body);
    console.log(`[SMS:OUT] tag=${tag || 'none'} to=${to} meta=${metaJson} body=${bodyJson} dry-run=true`);
    if (VERBOSE) console.log('opts:', opts);
    return { dryRun: true };
  };
}

function yyyymmdd(d) {
  // Always use UTC for consistent date handling
  return new Date(d).toISOString().split('T')[0];
}

async function sendReturnReminders() {
  console.log('🚀 Starting return reminder SMS script...');
  
  // ===== DIAGNOSTIC: Verify environment variables =====
  console.log('\n[FLEX-400-DIAG] ===== ENVIRONMENT VARIABLE VERIFICATION =====');
  const envVarsToCheck = [
    'REACT_APP_SHARETRIBE_SDK_CLIENT_ID',
    'SHARETRIBE_SDK_CLIENT_SECRET',
    'REACT_APP_SHARETRIBE_SDK_BASE_URL',
    'REACT_APP_SHARETRIBE_MARKETPLACE_ID',
    'PUBLIC_BASE_URL',
    'SITE_URL',
  ];
  
  const envCheckResults = {};
  for (const varName of envVarsToCheck) {
    const value = process.env[varName];
    const isMissing = !value;
    const hasWhitespace = value ? /\s/.test(value) : false;
    const hasNewline = value ? /\n/.test(value) : false;
    const charCheck = checkForHiddenChars(value);
    
    envCheckResults[varName] = {
      present: !isMissing,
      masked: maskSecret(value),
      hasWhitespace,
      hasNewline,
      hiddenCharIssues: charCheck.issues,
    };
    
    console.log(`[FLEX-400-DIAG] ${varName}:`);
    console.log(`[FLEX-400-DIAG]   Present: ${!isMissing ? 'YES' : 'NO'}`);
    if (!isMissing) {
      console.log(`[FLEX-400-DIAG]   Masked value: ${maskSecret(value)}`);
      console.log(`[FLEX-400-DIAG]   Has whitespace: ${hasWhitespace}`);
      console.log(`[FLEX-400-DIAG]   Has newline: ${hasNewline}`);
      console.log(`[FLEX-400-DIAG]   Hidden char issues: ${charCheck.issues.join(', ')}`);
    }
  }
  
  // Store env check results for summary
  global.__flex400EnvCheck = envCheckResults;
  
  // ===== DIAGNOSTIC: Log raw SDK-related env vars (filtered) =====
  console.log('\n[FLEX-400-DIAG] ===== RAW ENVIRONMENT VARIABLES (SDK-RELATED ONLY) =====');
  const sdkEnvVars = {
    REACT_APP_SHARETRIBE_SDK_CLIENT_ID: process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID,
    SHARETRIBE_SDK_CLIENT_SECRET: process.env.SHARETRIBE_SDK_CLIENT_SECRET,
    REACT_APP_SHARETRIBE_SDK_BASE_URL: process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL,
    REACT_APP_SHARETRIBE_MARKETPLACE_ID: process.env.REACT_APP_SHARETRIBE_MARKETPLACE_ID,
  };
  console.log('[FLEX-400-DIAG] Raw SDK env vars (masked):');
  for (const [key, value] of Object.entries(sdkEnvVars)) {
    console.log(`[FLEX-400-DIAG]   ${key}: ${value ? maskSecret(value) : '(not set)'}`);
    if (value) {
      // Show JSON stringified version to reveal hidden chars
      const jsonStr = JSON.stringify(value);
      if (jsonStr !== `"${value}"`) {
        console.log(`[FLEX-400-DIAG]     JSON.stringify reveals: ${jsonStr}`);
      }
    }
  }
  
  try {
    const sdk = await getScriptSdk();
    console.log('✅ SDK initialized');

    // today/tomorrow window (allow overrides for testing)
    const now = Date.now();
    const nowISO = new Date(now).toISOString();
    const today = process.env.FORCE_TODAY || yyyymmdd(now);
    const tomorrow = process.env.FORCE_TOMORROW || yyyymmdd(now + 24 * 60 * 60 * 1000);
    const tMinus1 = yyyymmdd(new Date(today).getTime() - 24 * 60 * 60 * 1000);
    console.log(`[RETURN-REMINDER-DEBUG] 📅 Current time: ${nowISO} (UTC)`);
    console.log(`[RETURN-REMINDER-DEBUG] 📅 Window: t-1=${tMinus1}, today=${today}, tomorrow=${tomorrow}`);

    // Query transactions for T-1, today, and tomorrow
    const query = {
      state: 'delivered',
      include: ['customer', 'listing'],
      per_page: 100, // use snake_case like our other scripts
    };

    // ===== DIAGNOSTIC: Log actual query attempt =====
    console.log('\n[FLEX-400-DIAG] ===== EXECUTING ACTUAL QUERY =====');
    console.log(`[FLEX-400-DIAG] Query: ${JSON.stringify(query, null, 2)}`);
    
    let actualQuerySuccess = false;
    let actualQueryError = null;
    let res = null;
    
    try {
      res = await sdk.transactions.query(query);
      actualQuerySuccess = true;
      console.log(`[FLEX-400-DIAG] ✅ Actual query succeeded. Found ${res?.data?.data?.length || 0} transactions`);
    } catch (err) {
      actualQuerySuccess = false;
      actualQueryError = err;
      console.error('[FLEX-400-DIAG] ❌ Actual query FAILED');
      console.error(`[FLEX-400-DIAG] Actual query error message: ${err?.message || '(no message)'}`);
      if (err.response) {
        console.error(`[FLEX-400-DIAG] Actual query response status: ${err.response.status}`);
        console.error(`[FLEX-400-DIAG] Actual query response data: ${JSON.stringify(err.response.data, null, 2)}`);
      }
      if (err.stack) {
        console.error(`[FLEX-400-DIAG] Actual query stack trace:\n${err.stack}`);
      }
      throw err; // Re-throw to maintain existing error behavior
    }
    
    // Store actual query results for summary
    global.__flex400ActualQuery = {
      success: actualQuerySuccess,
      error: actualQueryError,
    };
    const txs = res?.data?.data || [];
    const included = new Map();
    for (const inc of res?.data?.included || []) {
      // key like "user/UUID"
      const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
      included.set(key, inc);
    }

    console.log(`📊 Found ${txs.length} candidate transactions`);

    let sent = 0, failed = 0, processed = 0;

    for (const tx of txs) {
      processed++;

      const deliveryEnd = tx?.attributes?.deliveryEnd;
      const deliveryEndRaw = deliveryEnd;
      const deliveryEndNormalized = deliveryEnd ? yyyymmdd(deliveryEnd) : null;
      const bookingEnd = tx?.attributes?.booking?.end;
      const bookingEndNormalized = bookingEnd ? yyyymmdd(bookingEnd) : null;
      
      // [RETURN-REMINDER-DEBUG] Log transaction details for debugging
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || tx?.id || '(no id)'} deliveryEndRaw=${deliveryEndRaw} deliveryEndNormalized=${deliveryEndNormalized} bookingEnd=${bookingEnd} bookingEndNormalized=${bookingEndNormalized} today=${today} tomorrow=${tomorrow} tMinus1=${tMinus1}`);
      
      // Check both raw and normalized deliveryEnd
      const matchesWindow = deliveryEnd === tMinus1 || deliveryEnd === today || deliveryEnd === tomorrow ||
                            deliveryEndNormalized === tMinus1 || deliveryEndNormalized === today || deliveryEndNormalized === tomorrow;
      
      if (!matchesWindow) {
        console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} SKIPPED - deliveryEnd (${deliveryEndRaw}) does not match window [${tMinus1}, ${today}, ${tomorrow}]`);
        continue;
      }
      
      // Determine which reminder window this transaction falls into
      let reminderType = null;
      if (deliveryEnd === tMinus1 || deliveryEndNormalized === tMinus1) {
        reminderType = 'T-1';
      } else if (deliveryEnd === today || deliveryEndNormalized === today) {
        reminderType = 'TODAY';
      } else if (deliveryEnd === tomorrow || deliveryEndNormalized === tomorrow) {
        reminderType = 'TOMORROW';
      }
      
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} MATCHES window - reminderType=${reminderType} deliveryEnd=${deliveryEndRaw}`);

      // resolve customer from included
      const custRef = tx?.relationships?.customer?.data;
      const custKey = custRef ? `${custRef.type}/${custRef.id?.uuid || custRef.id}` : null;
      const customer = custKey ? included.get(custKey) : null;

      const borrowerPhone =
        customer?.attributes?.profile?.protectedData?.phone ||
        customer?.attributes?.profile?.protectedData?.phoneNumber ||
        null;

      if (!borrowerPhone) {
        console.warn(`[RETURN-REMINDER-DEBUG] ⚠️ No borrower phone for tx ${tx?.id?.uuid || '(no id)'} - SKIPPING`);
        continue;
      }
      
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} borrowerPhone=${borrowerPhone ? borrowerPhone.replace(/\d(?=\d{4})/g, '*') : 'MISSING'}`);

      if (ONLY_PHONE && borrowerPhone !== ONLY_PHONE) {
        if (VERBOSE) console.log(`↩️ Skipping ${borrowerPhone} (ONLY_PHONE=${ONLY_PHONE})`);
        continue;
      }

      // choose message based on delivery end date
      let message;
      let tag;
      const pd = tx?.attributes?.protectedData || {};
      const returnData = pd.return || {};
      
      // Use normalized date for comparison if raw doesn't match
      const effectiveDeliveryEnd = (deliveryEnd === tMinus1 || deliveryEndNormalized === tMinus1) ? tMinus1 :
                                   (deliveryEnd === today || deliveryEndNormalized === today) ? today :
                                   (deliveryEnd === tomorrow || deliveryEndNormalized === tomorrow) ? tomorrow : null;
      
      console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} effectiveDeliveryEnd=${effectiveDeliveryEnd} reminderType=${reminderType}`);
      
      if (effectiveDeliveryEnd === tMinus1) {
        // T-1 day: Send QR/label (use real label if available)
        // Check for return label in priority order: QR URL (preferred), then label URL
        let returnLabelUrl = pd.returnQrUrl ||  // Preferred: USPS QR code URL
                            pd.returnLabelUrl || // Fallback: PDF label URL
                            returnData.label?.url || 
                            pd.returnLabel || 
                            pd.shippingLabelUrl || 
                            pd.returnShippingLabel;
        
        // If no return label exists, log warning (label should have been created during accept transition)
        if (!returnLabelUrl && !returnData.tMinus1SentAt) {
          console.warn(`[RETURN-REMINDER-DEBUG] [return-reminders] ⚠️ No return label found for tx ${tx?.id?.uuid || '(no id)'} - label should have been created during accept transition - SKIPPING`);
          // Note: Creating a real Shippo label here would require addresses, parcel info, etc.
          // For now, skip sending T-1 reminder if no label exists (better than sending placeholder)
          continue;
        }
        
        // Log whether we're using QR or label URL
        const labelType = pd.returnQrUrl ? 'QR' : 'label';
        const labelSource = pd.returnQrUrl ? 'returnQrUrl' : 
                           pd.returnLabelUrl ? 'returnLabelUrl' : 
                           returnData.label?.url ? 'returnData.label.url' : 'other';
        console.log(`[return-reminders] Using ${labelType} URL from ${labelSource} for tx ${tx?.id?.uuid || '(no id)'}`);
        
        const shortUrl = await shortLink(returnLabelUrl);
        console.log('[SMS] shortlink', { type: 'return', short: shortUrl, original: returnLabelUrl });
        message = `📦 It's almost return time! Here's your QR to ship back tomorrow: ${shortUrl} Thanks for sharing style 💌`;
        tag = 'return_tminus1_to_borrower';
        
      } else if (effectiveDeliveryEnd === today) {
        // Today: Ship back
        // Check if package already scanned - skip reminder if so
        if (
          returnData.firstScanAt ||
          returnData.status === 'accepted' ||
          returnData.status === 'in_transit'
        ) {
          console.log(`[return-reminders] 🚚 Package already scanned for tx ${tx?.id?.uuid || '(no id)'} - skipping day-of reminder`);
          continue;
        }
        
        const returnLabelUrl = returnData.label?.url ||
                              pd.returnLabelUrl || 
                              pd.returnLabel || 
                              pd.shippingLabelUrl || 
                              pd.returnShippingLabel;

        if (returnLabelUrl) {
          const shortUrl = await shortLink(returnLabelUrl);
          console.log('[SMS] shortlink', { type: 'return', short: shortUrl, original: returnLabelUrl });
          message = `📦 Today's the day! Ship your Sherbrt item back. Return label: ${shortUrl}`;
          tag = 'return_reminder_today';
        } else {
          message = `📦 Today's the day! Ship your Sherbrt item back. Check your dashboard for return instructions.`;
          tag = 'return_reminder_today_no_label';
        }
        
      } else {
        // Tomorrow: Due tomorrow
        message = `⏳ Your Sherbrt return is due tomorrow—please ship it back and submit pics & feedback.`;
        tag = 'return_reminder_tomorrow';
      }

      if (VERBOSE) {
        console.log(`📬 To ${borrowerPhone} (tx ${tx?.id?.uuid || ''}) → ${message}`);
      }

      try {
        const smsResult = await sendSMS(borrowerPhone, message, { 
          role: 'borrower', 
          kind: 'return-reminder',
          tag: tag,
          meta: { transactionId: tx?.id?.uuid || tx?.id }
        });
        
        // Only mark T-1 as sent for idempotency if SMS was actually sent
        if (!smsResult?.skipped) {
          console.log(`[RETURN-REMINDER-DEBUG] tx=${tx?.id?.uuid || '(no id)'} SMS sent successfully - tag=${tag}`);
          if (effectiveDeliveryEnd === tMinus1) {
            try {
              await sdk.transactions.update({
                id: tx.id,
                attributes: {
                  protectedData: {
                    ...pd,
                    return: {
                      ...returnData,
                      tMinus1SentAt: new Date().toISOString()
                    }
                  }
                }
              });
              console.log(`💾 Marked T-1 SMS as sent for tx ${tx?.id?.uuid || '(no id)'}`);
            } catch (updateError) {
              console.error(`❌ Failed to mark T-1 as sent:`, updateError.message);
            }
          }
          
          sent++;
        } else {
          console.log(`[RETURN-REMINDER-DEBUG] ⏭️ SMS skipped (${smsResult.reason}) - NOT marking T-1 as sent for tx ${tx?.id?.uuid || '(no id)'}`);
        }
      } catch (e) {
        console.error(`❌ SMS failed to ${borrowerPhone}:`, e?.message || e);
        failed++;
      }

      if (LIMIT && sent >= LIMIT) {
        console.log(`⏹️ Limit reached (${LIMIT}). Stopping.`);
        break;
      }
    }

    console.log(`\n📊 Done. Sent=${sent} Failed=${failed} Processed=${processed}`);
    if (DRY) console.log('🧪 DRY-RUN mode: no real SMS were sent.');
    
    // ===== DIAGNOSTIC: Generate summary =====
    console.log('\n[FLEX-400-DIAG] ===== FLEX-400-DIAGNOSTIC SUMMARY =====');
    const diag = global.__flex400Diagnostics || {};
    const envCheck = global.__flex400EnvCheck || {};
    const actualQuery = global.__flex400ActualQuery || {};
    
    console.log(`[FLEX-400-DIAG] 1. SDK Type: ${diag.usingIntegrationSdk ? 'Integration SDK (no token exchange needed)' : 'Marketplace SDK'}`);
    console.log(`[FLEX-400-DIAG]    Note: Integration SDK does not use exchangeToken() - authentication handled automatically`);
    
    console.log(`[FLEX-400-DIAG] 2. Test query success: ${diag.testQuerySuccess ? 'YES' : 'NO'}`);
    if (!diag.testQuerySuccess && diag.testQueryError) {
      console.log(`[FLEX-400-DIAG]    Error: ${diag.testQueryError?.message || '(no message)'}`);
      if (diag.testQueryError?.response) {
        console.log(`[FLEX-400-DIAG]    Status: ${diag.testQueryError.response.status}`);
        console.log(`[FLEX-400-DIAG]    Data: ${JSON.stringify(diag.testQueryError.response.data, null, 2)}`);
      }
    }
    
    console.log(`[FLEX-400-DIAG] 3. Actual query success: ${actualQuery.success ? 'YES' : 'NO'}`);
    if (!actualQuery.success && actualQuery.error) {
      console.log(`[FLEX-400-DIAG]    Error: ${actualQuery.error?.message || '(no message)'}`);
      if (actualQuery.error?.response) {
        console.log(`[FLEX-400-DIAG]    Status: ${actualQuery.error.response.status}`);
        console.log(`[FLEX-400-DIAG]    Data: ${JSON.stringify(actualQuery.error.response.data, null, 2)}`);
      }
    }
    
    console.log(`[FLEX-400-DIAG] 4. Environment variables:`);
    for (const [varName, check] of Object.entries(envCheck)) {
      if (!check.present) {
        console.log(`[FLEX-400-DIAG]    ${varName}: MISSING`);
      } else if (check.hasWhitespace || check.hasNewline || check.hiddenCharIssues.length > 1) {
        console.log(`[FLEX-400-DIAG]    ${varName}: MALFORMED (${check.hiddenCharIssues.join(', ')})`);
      }
    }
    
    console.log(`[FLEX-400-DIAG] 5. SDK Configuration:`);
    console.log(`[FLEX-400-DIAG]    Client ID: ${diag.clientIdMasked || '(not logged)'}`);
    console.log(`[FLEX-400-DIAG]    Client Secret present: ${diag.clientSecretPresent ? 'YES' : 'NO'}`);
    console.log(`[FLEX-400-DIAG]    BASE_URL: ${diag.baseUrl || '(not set, using default)'}`);
    console.log(`[FLEX-400-DIAG]    Marketplace ID: ${diag.marketplaceId || '(not set)'}`);
    
    // Determine root cause
    console.log(`[FLEX-400-DIAG] 6. Root Cause Analysis:`);
    if (!diag.testQuerySuccess) {
      console.log(`[FLEX-400-DIAG]    → Issue: Test query failed (bad credentials, network, or permissions)`);
      if (diag.testQueryError?.response?.status === 400) {
        console.log(`[FLEX-400-DIAG]    → Flex returned 400, likely:`);
        console.log(`[FLEX-400-DIAG]       - Wrong clientId/clientSecret pair`);
        console.log(`[FLEX-400-DIAG]       - Missing or invalid baseUrl`);
        console.log(`[FLEX-400-DIAG]       - Using Marketplace credentials instead of Integration credentials`);
      }
    } else if (!actualQuery.success) {
      console.log(`[FLEX-400-DIAG]    → Issue: Test query OK, but actual query failed (query-specific problem)`);
      if (actualQuery.error?.response?.status === 400) {
        console.log(`[FLEX-400-DIAG]    → Flex returned 400 on actual query, check query parameters`);
      }
    } else {
      console.log(`[FLEX-400-DIAG]    → All queries succeeded - no Flex 400 error detected`);
    }
    
    console.log('[FLEX-400-DIAG] ===== END DIAGNOSTIC SUMMARY =====\n');
    
  } catch (err) {
    console.error('\n❌ Fatal error:', err?.message || err);
    if (err.response) {
      console.error('🔎 Flex API response status:', err.response.status);
      console.error('🔎 Flex API response data:', JSON.stringify(err.response.data, null, 2));
      console.error('🔎 Flex API response headers:', JSON.stringify(err.response.headers || {}, null, 2));
    }
    if (err.stack) {
      console.error('🔎 Stack trace:', err.stack);
    }
    
    // Provide helpful guidance based on error type
    if (err.response?.status === 400) {
      console.error('\n💡 Troubleshooting 400 error:');
      console.error('   1. Check that INTEGRATION_CLIENT_ID + INTEGRATION_CLIENT_SECRET are set (preferred)');
      console.error('   2. Or verify REACT_APP_SHARETRIBE_SDK_CLIENT_ID + SHARETRIBE_SDK_CLIENT_SECRET are correct');
      console.error('   3. Ensure BASE_URL is correct (default: https://flex-api.sharetribe.com)');
      console.error('   4. Verify credentials match your Flex marketplace (Integration vs Marketplace API)');
    }
    
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  if (argv.includes('--daemon')) {
    // Run as daemon with internal scheduling
    console.log('🔄 Starting return reminders daemon (every 15 minutes)');
    setInterval(async () => {
      try {
        await sendReturnReminders();
      } catch (error) {
        console.error('❌ Daemon error:', error.message);
      }
    }, 15 * 60 * 1000); // 15 minutes
    
    // Run immediately
    sendReturnReminders();
  } else {
    sendReturnReminders()
      .then(() => {
        console.log('🎉 Return reminder script completed successfully');
        process.exit(0);
      })
      .catch((error) => {
        console.error('💥 Return reminder script failed:', error.message);
        process.exit(1);
      });
  }
}

module.exports = { sendReturnReminders }; 
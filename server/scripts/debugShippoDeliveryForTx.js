#!/usr/bin/env node
/**
 * Debug script for investigating missing "item shipped" and "item delivered" SMS
 * 
 * Usage:
 *   node server/scripts/debugShippoDeliveryForTx.js <transactionId> [trackingNumber]
 * 
 * Example:
 *   node server/scripts/debugShippoDeliveryForTx.js 692f518d-3c5d-472a-a3d4-4167c90c3ad9 1Z8BF618YN81406063
 * 
 * This script:
 * 1. Tests transaction lookup by ID (same as webhook handler)
 * 2. Tests transaction lookup by tracking number (fallback path)
 * 3. Logs full error details if lookup fails
 * 4. Verifies borrower phone number
 * 5. Checks SMS configuration flags
 */

require('dotenv').config();
const { getTrustedSdk } = require('../api-util/integrationSdk');

// Import the same helper used in webhook handler
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

async function main() {
  const txId = process.argv[2];
  const trackingNumber = process.argv[3];
  
  if (!txId) {
    console.error('❌ Usage: node server/scripts/debugShippoDeliveryForTx.js <transactionId> [trackingNumber]');
    console.error('   Example: node server/scripts/debugShippoDeliveryForTx.js 692f518d-3c5d-472a-a3d4-4167c90c3ad9 1Z8BF618YN81406063');
    process.exit(1);
  }
  
  console.log('═'.repeat(80));
  console.log('🔍 [SHIPPO DELIVERY DEBUG] Transaction Lookup Debug');
  console.log('═'.repeat(80));
  console.log(`  Transaction ID: ${txId}`);
  console.log(`  Tracking Number: ${trackingNumber || 'NOT PROVIDED'}`);
  console.log('');
  
  // Log environment configuration
  console.log('📋 [ENV CONFIG] Integration SDK Configuration:');
  const integClientId = process.env.INTEGRATION_CLIENT_ID;
  const integClientSecret = process.env.INTEGRATION_CLIENT_SECRET;
  const baseUrl = process.env.SHARETRIBE_SDK_BASE_URL || 
                  process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL || 
                  'https://flex-api.sharetribe.com (default)';
  const shippoMode = process.env.SHIPPO_MODE || 'NOT SET';
  const smsEnabled = process.env.SMS_ENABLED || 'NOT SET';
  const smsDryRun = process.env.SMS_DRY_RUN || 'NOT SET';
  
  console.log(`  INTEGRATION_CLIENT_ID: ${integClientId ? integClientId.substring(0, 8) + '...' + integClientId.substring(integClientId.length - 4) : 'NOT SET'}`);
  console.log(`  INTEGRATION_CLIENT_SECRET: ${integClientSecret ? '***SET***' : 'NOT SET'}`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log(`  SHIPPO_MODE: ${shippoMode}`);
  console.log(`  SMS_ENABLED: ${smsEnabled}`);
  console.log(`  SMS_DRY_RUN: ${smsDryRun}`);
  console.log('');
  
  try {
    const sdk = getTrustedSdk();
    
    // Test 1: Lookup by transaction ID (primary method)
    console.log('─'.repeat(80));
    console.log('TEST 1: Lookup by Transaction ID (Primary Method)');
    console.log('─'.repeat(80));
    console.log(`🔍 Looking up transaction by ID: ${txId}`);
    
    let transaction = null;
    let lookupError = null;
    
    try {
      const response = await sdk.transactions.show({ 
        id: txId,
        include: ['customer', 'provider', 'listing']
      });
      transaction = response.data.data;
      console.log(`✅ SUCCESS: Found transaction by ID`);
      console.log(`   Transaction ID: ${transaction.id?.uuid || transaction.id}`);
      console.log(`   State: ${transaction.attributes?.state || 'N/A'}`);
      console.log(`   Last Transition: ${transaction.attributes?.lastTransition || 'N/A'}`);
    } catch (error) {
      lookupError = error;
      console.error(`❌ FAILED: Transaction lookup by ID failed`);
      console.error(`   Error message: ${error.message}`);
      
      // Log full error details
      if (error.response) {
        console.error(`   HTTP Status: ${error.response.status}`);
        console.error(`   Status Text: ${error.response.statusText}`);
        console.error(`   Response Data:`, JSON.stringify(error.response.data, null, 2));
      }
      if (error.request) {
        console.error(`   Request URL: ${error.request?.path || 'N/A'}`);
      }
      console.error(`   Error Code: ${error.code || 'N/A'}`);
      console.error(`   Stack: ${error.stack}`);
    }
    
    // Test 2: Lookup by tracking number (fallback method)
    if (!transaction && trackingNumber) {
      console.log('');
      console.log('─'.repeat(80));
      console.log('TEST 2: Lookup by Tracking Number (Fallback Method)');
      console.log('─'.repeat(80));
      
      try {
        transaction = await findTransactionByTrackingNumber(sdk, trackingNumber);
        if (transaction) {
          console.log(`✅ SUCCESS: Found transaction by tracking number`);
          console.log(`   Transaction ID: ${transaction.id?.uuid || transaction.id}`);
        } else {
          console.log(`❌ FAILED: No transaction found with tracking number ${trackingNumber}`);
          console.log(`   Note: This search only checks the last 100 transactions`);
        }
      } catch (error) {
        console.error(`❌ ERROR: Tracking number search failed`);
        console.error(`   Error: ${error.message}`);
        if (error.response) {
          console.error(`   HTTP Status: ${error.response.status}`);
          console.error(`   Response Data:`, JSON.stringify(error.response.data, null, 2));
        }
      }
    } else if (!trackingNumber) {
      console.log('');
      console.log('⚠️  Tracking number not provided - skipping fallback lookup test');
    }
    
    // If transaction found, analyze it
    if (transaction) {
      console.log('');
      console.log('─'.repeat(80));
      console.log('TRANSACTION ANALYSIS');
      console.log('─'.repeat(80));
      
      const protectedData = transaction.attributes.protectedData || {};
      const metadata = transaction.attributes.metadata || {};
      
      console.log('\n📦 Tracking Data:');
      console.log(`  Outbound Tracking: ${protectedData.outboundTrackingNumber || 'NOT SET'}`);
      console.log(`  Return Tracking: ${protectedData.returnTrackingNumber || 'NOT SET'}`);
      console.log(`  Outbound Carrier: ${protectedData.outboundCarrier || 'NOT SET'}`);
      
      console.log('\n📬 SMS Notification Flags:');
      const shippingNotification = protectedData.shippingNotification || {};
      console.log(`  First Scan Sent: ${shippingNotification.firstScan?.sent || false}`);
      console.log(`  First Scan Sent At: ${shippingNotification.firstScan?.sentAt || 'NOT SET'}`);
      console.log(`  Delivered Sent: ${shippingNotification.delivered?.sent || false}`);
      console.log(`  Delivered Sent At: ${shippingNotification.delivered?.sentAt || 'NOT SET'}`);
      
      console.log('\n📱 Borrower Phone Lookup:');
      // Try all the same lookup paths as webhook handler
      const customer = transaction.relationships?.customer?.data;
      const customerPhone1 = customer?.attributes?.profile?.protectedData?.phone;
      const customerPhone2 = protectedData.customerPhone;
      const customerPhone3 = metadata.customerPhone;
      
      console.log(`  1. customer.profile.protectedData.phone: ${customerPhone1 || 'NOT FOUND'}`);
      console.log(`  2. protectedData.customerPhone: ${customerPhone2 || 'NOT FOUND'}`);
      console.log(`  3. metadata.customerPhone: ${customerPhone3 || 'NOT FOUND'}`);
      
      const borrowerPhone = customerPhone1 || customerPhone2 || customerPhone3;
      console.log(`  → Final borrower phone: ${borrowerPhone || 'NOT FOUND'}`);
      
      if (!borrowerPhone) {
        console.log(`  ⚠️  WARNING: No borrower phone found - SMS cannot be sent`);
      }
      
      console.log('\n🔍 SMS Configuration Check:');
      const hasTwilioCreds = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
      console.log(`  SMS_ENABLED: ${smsEnabled}`);
      console.log(`  SMS_DRY_RUN: ${smsDryRun} ${smsDryRun === '0' || smsDryRun === 'false' ? '(SMS WILL BE SENT)' : '(SMS WILL BE SKIPPED)'}`);
      console.log(`  Twilio Credentials: ${hasTwilioCreds ? 'PRESENT' : 'MISSING'}`);
      console.log(`  Borrower Phone: ${borrowerPhone || 'MISSING'}`);
      
      if (borrowerPhone && hasTwilioCreds && (smsDryRun === '0' || smsDryRun === 'false' || !smsDryRun)) {
        console.log(`  ✅ SMS should be sent if webhook is received`);
      } else {
        console.log(`  ⚠️  SMS will be skipped due to:`);
        if (!borrowerPhone) console.log(`     - Missing borrower phone`);
        if (!hasTwilioCreds) console.log(`     - Missing Twilio credentials`);
        if (smsDryRun !== '0' && smsDryRun !== 'false' && smsDryRun !== 'NOT SET') console.log(`     - SMS_DRY_RUN is enabled`);
      }
    } else {
      console.log('');
      console.log('─'.repeat(80));
      console.log('❌ TRANSACTION NOT FOUND');
      console.log('─'.repeat(80));
      console.log('Possible reasons:');
      console.log('  1. Transaction ID is incorrect');
      console.log('  2. Integration SDK is pointing to wrong environment (test vs live)');
      console.log('  3. Integration SDK credentials are incorrect');
      console.log('  4. Transaction exists in different marketplace');
      console.log('  5. Transaction was deleted');
      console.log('');
      if (lookupError?.response?.status === 404) {
        console.log('  → HTTP 404 indicates transaction does not exist in this environment');
      } else if (lookupError?.response?.status === 401 || lookupError?.response?.status === 403) {
        console.log('  → HTTP 401/403 indicates authentication/authorization issue');
        console.log('  → Check INTEGRATION_CLIENT_ID and INTEGRATION_CLIENT_SECRET');
      }
    }
    
    console.log('');
    console.log('═'.repeat(80));
    console.log('✅ Debug complete');
    console.log('═'.repeat(80));
    
  } catch (error) {
    console.error('❌ [SHIPPO DELIVERY DEBUG] Fatal Error:', error.message);
    console.error('   Stack:', error.stack);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Status Text:', error.response.statusText);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();

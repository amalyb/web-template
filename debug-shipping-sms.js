#!/usr/bin/env node
/**
 * Forensic Analysis Script for Missing Shipping SMS
 * 
 * Transaction ID: 6912605f-7d45-4f12-a382-5e135aee0829
 * Tracking Number: 1ZB8F618YN86050063
 * 
 * This script performs end-to-end forensic analysis to determine why
 * SMS notifications were not sent for this transaction.
 */

require('dotenv').config();
const { getIntegrationSdk } = require('./server/api-util/integrationSdk');

const TX_ID = '6912605f-7d45-4f12-a382-5e135aee0829';
const TRACKING_NUMBER = '1ZB8F618YN86050063';

async function main() {
  console.log('═'.repeat(80));
  console.log('🔍 SHIPPING SMS FORENSIC ANALYSIS');
  console.log('═'.repeat(80));
  console.log(`Transaction ID: ${TX_ID}`);
  console.log(`Tracking Number: ${TRACKING_NUMBER}`);
  console.log(`Transaction URL: https://sherbrt.com/sale/${TX_ID}`);
  console.log('');

  try {
    const sdk = getIntegrationSdk();
    
    // Step 1: Fetch transaction with all relationships
    console.log('📋 STEP 1: Fetching transaction data...');
    console.log('─'.repeat(80));
    
    let txResponse;
    try {
      txResponse = await sdk.transactions.show({
        id: TX_ID,
        include: ['customer', 'provider', 'listing']
      });
    } catch (error) {
      console.error('❌ Error fetching transaction:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
    
    const transaction = txResponse.data.data;
    const included = txResponse.data.included || [];
    
    console.log(`✅ Transaction found: ${transaction.id}`);
    console.log(`   State: ${transaction.attributes.state}`);
    console.log(`   Process: ${transaction.attributes.processName}`);
    console.log('');

    // Step 2: Analyze metadata and protectedData
    console.log('📋 STEP 2: Analyzing transaction metadata and protectedData...');
    console.log('─'.repeat(80));
    
    const metadata = transaction.attributes.metadata || {};
    const protectedData = transaction.attributes.protectedData || {};
    
    console.log('Metadata keys:', Object.keys(metadata));
    console.log('ProtectedData keys:', Object.keys(protectedData));
    console.log('');

    // Check for tracking number storage
    console.log('🔍 Tracking Number Analysis:');
    console.log(`   outboundTrackingNumber: ${protectedData.outboundTrackingNumber || 'NOT SET'}`);
    console.log(`   returnTrackingNumber: ${protectedData.returnTrackingNumber || 'NOT SET'}`);
    console.log(`   Expected tracking: ${TRACKING_NUMBER}`);
    
    const hasTrackingMatch = 
      protectedData.outboundTrackingNumber === TRACKING_NUMBER ||
      protectedData.returnTrackingNumber === TRACKING_NUMBER;
    
    console.log(`   ✅ Tracking number match: ${hasTrackingMatch ? 'YES' : 'NO'}`);
    console.log('');

    // Check for Shippo shipment ID
    console.log('🔍 Shippo Shipment Analysis:');
    console.log(`   shippoShipmentId: ${protectedData.shippoShipmentId || 'NOT SET'}`);
    console.log(`   outboundCarrier: ${protectedData.outboundCarrier || 'NOT SET'}`);
    console.log(`   returnCarrier: ${protectedData.returnCarrier || 'NOT SET'}`);
    console.log('');

    // Check shipping notification flags
    console.log('🔍 SMS Notification Status:');
    const shippingNotification = protectedData.shippingNotification || {};
    const firstScan = shippingNotification.firstScan || {};
    const delivered = shippingNotification.delivered || {};
    
    console.log(`   First Scan SMS sent: ${firstScan.sent === true ? 'YES' : 'NO'}`);
    if (firstScan.sentAt) {
      console.log(`   First Scan sent at: ${firstScan.sentAt}`);
    }
    console.log(`   Delivery SMS sent: ${delivered.sent === true ? 'YES' : 'NO'}`);
    if (delivered.sentAt) {
      console.log(`   Delivery sent at: ${delivered.sentAt}`);
    }
    console.log('');

    // Step 3: Analyze borrower phone number
    console.log('📋 STEP 3: Analyzing borrower phone number...');
    console.log('─'.repeat(80));
    
    const customerId = transaction.relationships?.customer?.data?.id?.uuid || 
                      transaction.relationships?.customer?.data?.id;
    const customer = included.find(u => 
      u.type === 'user' && 
      (u.id?.uuid === customerId || u.id === customerId)
    );
    
    console.log(`Customer ID: ${customerId}`);
    console.log(`Customer found: ${customer ? 'YES' : 'NO'}`);
    
    if (customer) {
      const customerPhone1 = customer.attributes?.profile?.protectedData?.phone;
      const customerPhone2 = protectedData.customerPhone;
      const customerPhone3 = metadata.customerPhone;
      
      console.log(`   Phone (customer.profile.protectedData.phone): ${customerPhone1 || 'NOT SET'}`);
      console.log(`   Phone (transaction.protectedData.customerPhone): ${customerPhone2 || 'NOT SET'}`);
      console.log(`   Phone (transaction.metadata.customerPhone): ${customerPhone3 || 'NOT SET'}`);
      
      const hasPhone = !!(customerPhone1 || customerPhone2 || customerPhone3);
      console.log(`   ✅ Borrower phone available: ${hasPhone ? 'YES' : 'NO'}`);
    } else {
      console.log('   ⚠️ Customer relationship not found in included data');
    }
    console.log('');

    // Step 4: Check environment variables (read-only)
    console.log('📋 STEP 4: Checking environment variables...');
    console.log('─'.repeat(80));
    
    console.log('SMS Configuration:');
    console.log(`   SMS_DRY_RUN: ${process.env.SMS_DRY_RUN || 'NOT SET'} ${process.env.SMS_DRY_RUN === '1' ? '⚠️ (SMS DISABLED)' : ''}`);
    console.log(`   ONLY_PHONE: ${process.env.ONLY_PHONE || 'NOT SET'}`);
    console.log(`   TWILIO_ACCOUNT_SID: ${process.env.TWILIO_ACCOUNT_SID ? 'SET' : 'NOT SET'}`);
    console.log(`   TWILIO_AUTH_TOKEN: ${process.env.TWILIO_AUTH_TOKEN ? 'SET' : 'NOT SET'}`);
    console.log(`   TWILIO_MESSAGING_SERVICE_SID: ${process.env.TWILIO_MESSAGING_SERVICE_SID || 'NOT SET'}`);
    console.log(`   TWILIO_PHONE_NUMBER: ${process.env.TWILIO_PHONE_NUMBER || 'NOT SET'}`);
    console.log('');
    
    console.log('Shippo Configuration:');
    console.log(`   SHIPPO_MODE: ${process.env.SHIPPO_MODE || 'NOT SET'}`);
    console.log(`   SHIPPO_WEBHOOK_SECRET: ${process.env.SHIPPO_WEBHOOK_SECRET ? 'SET' : 'NOT SET'}`);
    console.log(`   SHIPPO_API_TOKEN: ${process.env.SHIPPO_API_TOKEN ? 'SET' : 'NOT SET'}`);
    console.log('');

    // Step 5: Check for metadata.transactionId linkage
    console.log('📋 STEP 5: Checking Shippo metadata linkage...');
    console.log('─'.repeat(80));
    
    // Note: We can't directly query Shippo API from here, but we can check
    // if the transaction has any metadata that would link it to Shippo
    console.log('Transaction metadata:', JSON.stringify(metadata, null, 2));
    console.log('');
    
    // Check if there's any indication that metadata.transactionId was set
    // when the label was created
    const hasShippoMetadata = !!(metadata.shippoLabelId || metadata.shippoShipmentId);
    console.log(`   Has Shippo metadata on transaction: ${hasShippoMetadata ? 'YES' : 'NO'}`);
    console.log('');

    // Step 6: Summary and root cause analysis
    console.log('═'.repeat(80));
    console.log('📊 ROOT CAUSE ANALYSIS');
    console.log('═'.repeat(80));
    
    const issues = [];
    const warnings = [];
    
    // Check 1: Tracking number stored
    if (!hasTrackingMatch) {
      issues.push(`Tracking number ${TRACKING_NUMBER} is NOT stored on transaction`);
    }
    
    // Check 2: Borrower phone
    const borrowerPhone = customer?.attributes?.profile?.protectedData?.phone ||
                         protectedData.customerPhone ||
                         metadata.customerPhone;
    if (!borrowerPhone) {
      issues.push('Borrower phone number not found in any expected location');
    }
    
    // Check 3: SMS guards
    if (process.env.SMS_DRY_RUN === '1') {
      issues.push('SMS_DRY_RUN is set to 1 - SMS sending is disabled');
    }
    
    if (process.env.ONLY_PHONE && borrowerPhone) {
      const onlyPhoneNormalized = normalizePhone(process.env.ONLY_PHONE);
      const borrowerPhoneNormalized = normalizePhone(borrowerPhone);
      if (onlyPhoneNormalized !== borrowerPhoneNormalized) {
        issues.push(`ONLY_PHONE filter is active and borrower phone doesn't match`);
      }
    }
    
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      issues.push('Twilio credentials missing - SMS cannot be sent');
    }
    
    // Check 4: Shippo webhook configuration
    if (!process.env.SHIPPO_WEBHOOK_SECRET) {
      warnings.push('SHIPPO_WEBHOOK_SECRET not set - webhook signature verification may fail');
    }
    
    if (process.env.SHIPPO_MODE) {
      console.log(`   ⚠️ SHIPPO_MODE is set to '${process.env.SHIPPO_MODE}' - webhooks will be filtered`);
    }
    
    // Check 5: SMS already sent flags
    if (firstScan.sent === true) {
      warnings.push(`First scan SMS was already marked as sent at ${firstScan.sentAt}`);
    }
    
    if (delivered.sent === true) {
      warnings.push(`Delivery SMS was already marked as sent at ${delivered.sentAt}`);
    }
    
    // Output findings
    if (issues.length === 0 && warnings.length === 0) {
      console.log('✅ No obvious issues found in transaction data');
      console.log('   → Check server logs for webhook events');
      console.log('   → Verify Shippo webhook URL configuration');
      console.log('   → Check if webhook events were received');
    } else {
      if (issues.length > 0) {
        console.log('❌ CRITICAL ISSUES:');
        issues.forEach((issue, i) => {
          console.log(`   ${i + 1}. ${issue}`);
        });
        console.log('');
      }
      
      if (warnings.length > 0) {
        console.log('⚠️ WARNINGS:');
        warnings.forEach((warning, i) => {
          console.log(`   ${i + 1}. ${warning}`);
        });
        console.log('');
      }
    }
    
    // Recommendations
    console.log('💡 RECOMMENDATIONS:');
    console.log('─'.repeat(80));
    
    if (!hasTrackingMatch) {
      console.log('1. Ensure labels are created with metadata.transactionId set');
      console.log('2. Ensure outboundTrackingNumber is saved to transaction.protectedData');
    }
    
    if (!borrowerPhone) {
      console.log('3. Verify borrower phone is stored in transaction or customer profile');
    }
    
    if (process.env.SMS_DRY_RUN === '1') {
      console.log('4. Disable SMS_DRY_RUN in production to enable SMS sending');
    }
    
    console.log('5. Check Shippo dashboard webhook logs for tracking number:', TRACKING_NUMBER);
    console.log('6. Check server logs for webhook POST requests to /api/webhooks/shippo');
    console.log('7. Verify webhook URL in Shippo dashboard: https://sherbrt.com/api/webhooks/shippo');
    
    console.log('');
    console.log('═'.repeat(80));
    
  } catch (error) {
    console.error('❌ Error during analysis:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

main().catch(console.error);


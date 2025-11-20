#!/usr/bin/env node
/**
 * Debug script for investigating missing "item delivered" SMS for a specific transaction
 * 
 * Usage:
 *   node server/scripts/debugShippoDeliveryForTx.js <transactionId>
 * 
 * Example:
 *   node server/scripts/debugShippoDeliveryForTx.js 691d0411-e7ea-422a-aa5d-918cfab181be
 * 
 * This script fetches the transaction and logs:
 * - Transaction ID and Order ID
 * - Shippo shipment ID (if stored)
 * - Shippo tracking number
 * - All protectedData.shipping fields
 * - shippingNotification flags (delivered, firstScan, labelCreated)
 * - Borrower phone number (all lookup paths)
 */

require('dotenv').config();
const { getTrustedSdk } = require('../api-util/integrationSdk');

async function main() {
  const txId = process.argv[2];
  
  if (!txId) {
    console.error('❌ Usage: node server/scripts/debugShippoDeliveryForTx.js <transactionId>');
    console.error('   Example: node server/scripts/debugShippoDeliveryForTx.js 691d0411-e7ea-422a-aa5d-918cfab181be');
    process.exit(1);
  }
  
  try {
    console.log('🔍 [SHIPPO DELIVERY DEBUG] Fetching transaction:', txId);
    console.log('─'.repeat(80));
    
    const sdk = getTrustedSdk();
    const response = await sdk.transactions.show({
      id: txId,
      include: ['customer', 'provider', 'listing']
    }, { expand: true });
    
    const transaction = response.data.data;
    const protectedData = transaction.attributes.protectedData || {};
    const metadata = transaction.attributes.metadata || {};
    
    console.log('\n📦 [SHIPPO DELIVERY DEBUG] Transaction Details:');
    console.log('  Transaction ID:', transaction.id?.uuid || transaction.id);
    console.log('  Order ID:', transaction.id?.uuid || transaction.id, '(same as transaction ID)');
    console.log('  State:', transaction.attributes?.state || 'N/A');
    console.log('  Last Transition:', transaction.attributes?.lastTransition || 'N/A');
    
    console.log('\n📦 [SHIPPO DELIVERY DEBUG] Shippo Shipment/Tracking Data:');
    console.log('  Shippo Shipment ID:', protectedData.shippoShipmentId || protectedData.outbound?.shippoShipmentId || 'NOT SET');
    console.log('  Shippo Tracking Number:', protectedData.outboundTrackingNumber || protectedData.outbound?.trackingNumber || 'NOT SET');
    console.log('  Tracking Number (outbound):', protectedData.outboundTrackingNumber || 'NOT SET');
    console.log('  Tracking Number (return):', protectedData.returnTrackingNumber || 'NOT SET');
    
    console.log('\n📦 [SHIPPO DELIVERY DEBUG] Outbound Shipping Data:');
    console.log('  outboundTrackingNumber:', protectedData.outboundTrackingNumber || 'NOT SET');
    console.log('  outboundCarrier:', protectedData.outboundCarrier || 'NOT SET');
    console.log('  outboundTrackingUrl:', protectedData.outboundTrackingUrl || 'NOT SET');
    console.log('  outboundLabelUrl:', protectedData.outboundLabelUrl || 'NOT SET');
    console.log('  outboundService:', protectedData.outboundService || 'NOT SET');
    console.log('  outboundPurchasedAt:', protectedData.outboundPurchasedAt || 'NOT SET');
    
    // Check nested outbound object
    if (protectedData.outbound) {
      console.log('\n📦 [SHIPPO DELIVERY DEBUG] Nested outbound object:');
      console.log('  outbound.trackingNumber:', protectedData.outbound.trackingNumber || 'NOT SET');
      console.log('  outbound.carrier:', protectedData.outbound.carrier || 'NOT SET');
      console.log('  outbound.shippoShipmentId:', protectedData.outbound.shippoShipmentId || 'NOT SET');
    }
    
    console.log('\n📦 [SHIPPO DELIVERY DEBUG] Return Shipping Data:');
    console.log('  returnTrackingNumber:', protectedData.returnTrackingNumber || 'NOT SET');
    console.log('  returnCarrier:', protectedData.returnCarrier || 'NOT SET');
    
    console.log('\n📬 [SHIPPO DELIVERY DEBUG] Shipping Notification Flags:');
    const shippingNotification = protectedData.shippingNotification || {};
    
    console.log('  labelCreated:');
    console.log('    sent:', shippingNotification.labelCreated?.sent || false);
    console.log('    sentAt:', shippingNotification.labelCreated?.sentAt || 'NOT SET');
    
    console.log('  firstScan:');
    console.log('    sent:', shippingNotification.firstScan?.sent || false);
    console.log('    sentAt:', shippingNotification.firstScan?.sentAt || 'NOT SET');
    
    console.log('  delivered:');
    console.log('    sent:', shippingNotification.delivered?.sent || false);
    console.log('    sentAt:', shippingNotification.delivered?.sentAt || 'NOT SET');
    
    console.log('\n📊 [SHIPPO DELIVERY DEBUG] Last Tracking Status:');
    const lastTrackingStatus = protectedData.lastTrackingStatus || {};
    console.log('  status:', lastTrackingStatus.status || 'NOT SET');
    console.log('  substatus:', lastTrackingStatus.substatus || 'NOT SET');
    console.log('  timestamp:', lastTrackingStatus.timestamp || 'NOT SET');
    console.log('  event:', lastTrackingStatus.event || 'NOT SET');
    
    console.log('\n📱 [SHIPPO DELIVERY DEBUG] Borrower Contact Info (all lookup paths):');
    const customer = response.data.included?.find(i => 
      (i.type === 'user' || i.type === 'profile') && 
      (i.id?.uuid === transaction.relationships?.customer?.data?.id?.uuid ||
       i.id === transaction.relationships?.customer?.data?.id)
    );
    
    console.log('  1. customer.profile.protectedData.phone:', 
      customer?.attributes?.profile?.protectedData?.phone || 'NOT FOUND');
    console.log('  2. protectedData.customerPhone:', 
      protectedData.customerPhone || 'NOT FOUND');
    console.log('  3. metadata.customerPhone:', 
      metadata.customerPhone || 'NOT FOUND');
    
    const borrowerPhone = customer?.attributes?.profile?.protectedData?.phone || 
                         protectedData.customerPhone ||
                         metadata.customerPhone ||
                         'NOT FOUND';
    const borrowerEmail = customer?.attributes?.profile?.protectedData?.email ||
                         customer?.attributes?.email ||
                         'NOT FOUND';
    console.log('\n  → Final borrower phone:', borrowerPhone);
    console.log('  → Borrower email:', borrowerEmail);
    
    console.log('\n🔍 [SHIPPO DELIVERY DEBUG] Analysis:');
    const deliveredSent = shippingNotification.delivered?.sent === true;
    const hasOutboundTracking = !!protectedData.outboundTrackingNumber;
    const hasBorrowerPhone = borrowerPhone !== 'NOT FOUND';
    
    console.log('  ✓ Has outbound tracking number:', hasOutboundTracking);
    console.log('  ✓ Has borrower phone:', hasBorrowerPhone);
    console.log('  ✓ Delivered SMS flag set:', deliveredSent);
    
    if (deliveredSent) {
      console.log('\n  ⚠️  DELIVERED FLAG ALREADY SET - SMS should have been sent');
      console.log('  ⚠️  Possible reasons for missing SMS:');
      console.log('     - SMS sending failed (check Twilio logs)');
      console.log('     - Phone number invalid/missing');
      console.log('     - SMS feature flags disabled (SMS_DRY_RUN, ONLY_PHONE)');
      console.log('     - Twilio credentials missing');
    } else {
      console.log('\n  ⚠️  DELIVERED FLAG NOT SET - SMS was never sent');
      console.log('  ⚠️  Possible reasons:');
      console.log('     - Webhook never received (check Shippo dashboard)');
      console.log('     - Webhook received but status not DELIVERED');
      console.log('     - Webhook received but transaction not matched');
      console.log('     - Webhook received but idempotency check failed');
      console.log('     - Webhook received but mode mismatch (SHIPPO_MODE filter)');
      console.log('     - Webhook received but borrower phone missing');
    }
    
    // Output key values for use in other scripts
    console.log('\n📋 [SHIPPO DELIVERY DEBUG] Key Values for Next Steps:');
    console.log('  Tracking Number:', protectedData.outboundTrackingNumber || 'MISSING');
    console.log('  Carrier:', protectedData.outboundCarrier || 'MISSING');
    console.log('  Borrower Phone:', borrowerPhone);
    
    console.log('\n' + '─'.repeat(80));
    console.log('✅ [SHIPPO DELIVERY DEBUG] Debug complete');
    console.log('\n💡 Next step: Use tracking number and carrier to fetch Shippo tracking status:');
    console.log(`   node server/scripts/fetchShippoTracking.js ${protectedData.outboundCarrier || 'CARRIER'} ${protectedData.outboundTrackingNumber || 'TRACKING_NUMBER'}`);
    
  } catch (error) {
    console.error('❌ [SHIPPO DELIVERY DEBUG] Error:', error.message);
    console.error('   Stack:', error.stack);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Status Text:', error.response.statusText);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.request) {
      console.error('   Request:', error.request);
    }
    process.exit(1);
  }
}

main();


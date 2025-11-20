#!/usr/bin/env node
/**
 * Debug script for investigating missing "item delivered" SMS/email notifications
 * 
 * Usage:
 *   node server/scripts/debugShippoDelivery.js
 * 
 * This script fetches transaction 691d0411-e7ea-422a-aa5d-918cfab181be and logs:
 * - Shipping/tracking data from protectedData
 * - shippingNotification flags (delivered, firstScan, labelCreated)
 * - Outbound tracking number and carrier
 * - Whether delivered flags are already set
 * 
 * Expected output:
 * - Transaction details
 * - protectedData.shippingNotification structure
 * - Outbound tracking information
 * - Delivery notification status
 */

require('dotenv').config();
const { getTrustedSdk } = require('../api-util/integrationSdk');

const TARGET_TXID = '691d0411-e7ea-422a-aa5d-918cfab181be';

async function main() {
  try {
    console.log('🔍 [SHIPPO DELIVERY DEBUG] Fetching transaction:', TARGET_TXID);
    console.log('─'.repeat(80));
    
    const sdk = getTrustedSdk();
    const response = await sdk.transactions.show({
      id: TARGET_TXID,
      include: ['customer', 'provider', 'listing']
    }, { expand: true });
    
    const transaction = response.data.data;
    const protectedData = transaction.attributes.protectedData || {};
    
    console.log('\n📦 [SHIPPO DELIVERY DEBUG] Transaction Details:');
    console.log('  Transaction ID:', transaction.id?.uuid || transaction.id);
    console.log('  State:', transaction.attributes?.state || 'N/A');
    console.log('  Last Transition:', transaction.attributes?.lastTransition || 'N/A');
    
    console.log('\n📦 [SHIPPO DELIVERY DEBUG] Outbound Shipping Data:');
    console.log('  outboundTrackingNumber:', protectedData.outboundTrackingNumber || 'NOT SET');
    console.log('  outboundCarrier:', protectedData.outboundCarrier || 'NOT SET');
    console.log('  outboundTrackingUrl:', protectedData.outboundTrackingUrl || 'NOT SET');
    console.log('  outboundService:', protectedData.outboundService || 'NOT SET');
    console.log('  outboundPurchasedAt:', protectedData.outboundPurchasedAt || 'NOT SET');
    
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
    
    console.log('\n📱 [SHIPPO DELIVERY DEBUG] Borrower Contact Info:');
    const customer = response.data.included?.find(i => i.type === 'user' && 
      i.id?.uuid === transaction.relationships?.customer?.data?.id?.uuid);
    const borrowerPhone = customer?.attributes?.profile?.protectedData?.phone || 
                         protectedData.customerPhone ||
                         'NOT FOUND';
    const borrowerEmail = customer?.attributes?.profile?.protectedData?.email ||
                          customer?.attributes?.email ||
                          'NOT FOUND';
    console.log('  Phone:', borrowerPhone);
    console.log('  Email:', borrowerEmail);
    
    console.log('\n🔍 [SHIPPO DELIVERY DEBUG] Analysis:');
    const deliveredSent = shippingNotification.delivered?.sent === true;
    const hasOutboundTracking = !!protectedData.outboundTrackingNumber;
    
    console.log('  ✓ Has outbound tracking number:', hasOutboundTracking);
    console.log('  ✓ Delivered SMS flag set:', deliveredSent);
    
    if (deliveredSent) {
      console.log('  ⚠️  DELIVERED FLAG ALREADY SET - SMS should have been sent');
      console.log('  ⚠️  Possible reasons for missing SMS:');
      console.log('     - SMS sending failed (check Twilio logs)');
      console.log('     - Phone number invalid/missing');
      console.log('     - SMS feature flags disabled');
    } else {
      console.log('  ⚠️  DELIVERED FLAG NOT SET - SMS was never sent');
      console.log('  ⚠️  Possible reasons:');
      console.log('     - Webhook never received (check Shippo dashboard)');
      console.log('     - Webhook received but status not DELIVERED');
      console.log('     - Webhook received but transaction not matched');
      console.log('     - Webhook received but idempotency check failed');
      console.log('     - Webhook received but mode mismatch (SHIPPO_MODE filter)');
    }
    
    console.log('\n' + '─'.repeat(80));
    console.log('✅ [SHIPPO DELIVERY DEBUG] Debug complete');
    
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


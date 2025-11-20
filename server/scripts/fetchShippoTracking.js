#!/usr/bin/env node
/**
 * Fetch real tracking status from Shippo API for debugging
 * 
 * Usage:
 *   node server/scripts/fetchShippoTracking.js <carrier> <trackingNumber>
 * 
 * Example:
 *   node server/scripts/fetchShippoTracking.js ups 1Z999AA10123456784
 * 
 * This script:
 * - Uses SHIPPO_API_KEY from environment
 * - Calls Shippo's tracking API: GET /tracks/{carrier}/{trackingNumber}
 * - Logs tracking_status.status, substatus, and full tracking_status object
 * 
 * DEBUGGING ONLY - Do not use in production code paths
 */

require('dotenv').config();

async function main() {
  const carrier = process.argv[2];
  const trackingNumber = process.argv[3];
  
  if (!carrier || !trackingNumber) {
    console.error('❌ Usage: node server/scripts/fetchShippoTracking.js <carrier> <trackingNumber>');
    console.error('   Example: node server/scripts/fetchShippoTracking.js ups 1Z999AA10123456784');
    process.exit(1);
  }
  
  const apiKey = process.env.SHIPPO_API_KEY;
  if (!apiKey) {
    console.error('❌ SHIPPO_API_KEY not set in environment');
    console.error('   Set SHIPPO_API_KEY in .env or environment variables');
    process.exit(1);
  }
  
  try {
    console.log('🔍 [SHIPPO TRACKING DEBUG] Fetching tracking status from Shippo API');
    console.log('─'.repeat(80));
    console.log('  Carrier:', carrier);
    console.log('  Tracking Number:', trackingNumber);
    console.log('  API Key:', apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 4));
    
    // Shippo API endpoint: GET https://api.goshippo.com/tracks/{carrier}/{trackingNumber}
    const url = `https://api.goshippo.com/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`;
    
    console.log('\n📡 [SHIPPO TRACKING DEBUG] API Request:');
    console.log('  URL:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `ShippoToken ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [SHIPPO TRACKING DEBUG] API Error:');
      console.error('  Status:', response.status);
      console.error('  Status Text:', response.statusText);
      console.error('  Response:', errorText);
      process.exit(1);
    }
    
    const data = await response.json();
    
    console.log('\n✅ [SHIPPO TRACKING DEBUG] API Response:');
    console.log('─'.repeat(80));
    
    const trackingStatus = data.tracking_status || {};
    const status = trackingStatus.status;
    const substatus = trackingStatus.substatus || {};
    
    console.log('\n📊 [SHIPPO TRACKING DEBUG] Tracking Status Summary:');
    console.log('  tracking_status.status:', status || 'MISSING');
    console.log('  tracking_status.substatus.code:', substatus.code || 'none');
    console.log('  tracking_status.substatus.text:', substatus.text || 'none');
    
    console.log('\n📋 [SHIPPO TRACKING DEBUG] Full tracking_status object:');
    console.log(JSON.stringify(trackingStatus, null, 2));
    
    console.log('\n🔍 [SHIPPO TRACKING DEBUG] Delivery Detection Check:');
    const upperStatus = (status || '').toUpperCase();
    const isDelivered = upperStatus === 'DELIVERED' || upperStatus.startsWith('DELIVERED');
    console.log('  Status (uppercase):', upperStatus);
    console.log('  isDeliveredStatus() would return:', isDelivered);
    console.log('  Matches our code condition:', isDelivered ? 'YES ✅' : 'NO ❌');
    
    if (!isDelivered) {
      console.log('\n  ⚠️  Status is NOT DELIVERED - this explains why SMS was not sent');
      console.log('  ⚠️  Our webhook handler only processes DELIVERED statuses');
    } else {
      console.log('\n  ✅ Status is DELIVERED - webhook should have triggered SMS');
      console.log('  ⚠️  If SMS was not sent, check:');
      console.log('     - Transaction lookup (metadata.transactionId or tracking number search)');
      console.log('     - Idempotency flag (shippingNotification.delivered.sent)');
      console.log('     - Borrower phone number');
      console.log('     - SMS configuration (SMS_DRY_RUN, ONLY_PHONE, Twilio credentials)');
    }
    
    console.log('\n📦 [SHIPPO TRACKING DEBUG] Full API Response (for webhook replay):');
    console.log(JSON.stringify(data, null, 2));
    
    console.log('\n' + '─'.repeat(80));
    console.log('✅ [SHIPPO TRACKING DEBUG] Fetch complete');
    console.log('\n💡 Next step: Use this data to create a webhook replay:');
    console.log('   Save the tracking_status to server/scripts/sample-shippo-delivered.json');
    console.log('   Then run: node server/scripts/replayShippoWebhook.js');
    
  } catch (error) {
    console.error('❌ [SHIPPO TRACKING DEBUG] Error:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

main();


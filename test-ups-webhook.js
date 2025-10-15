#!/usr/bin/env node

/**
 * Test script for UPS "accepted / in-transit" webhook simulation
 * 
 * This script sends a webhook POST to simulate a UPS tracking update
 * for Step 4 (borrower SMS when package is in transit)
 */

const https = require('https');

const WEBHOOK_URL = 'https://web-template-1.onrender.com/api/webhooks/shippo';

// Webhook payload for UPS "accepted / in-transit"
const payload = {
  event: 'track_updated',
  data: {
    tracking_number: '1ZXXXXXXXXXXXXXXXX',
    carrier: 'ups',
    tracking_status: {
      status: 'TRANSIT',
      status_details: 'Origin Scan',
      status_date: '2025-10-20T18:15:00Z'
    }
  }
};

console.log('🚀 Sending UPS webhook simulation...');
console.log('📋 Payload:', JSON.stringify(payload, null, 2));

const payloadString = JSON.stringify(payload);

const url = new URL(WEBHOOK_URL);
const options = {
  hostname: url.hostname,
  port: url.port || 443,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payloadString)
  }
};

const req = https.request(options, (res) => {
  console.log(`\n📡 Response status: ${res.statusCode}`);
  console.log('📡 Response headers:', res.headers);

  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('\n📥 Response body:', data);
    
    try {
      const parsed = JSON.parse(data);
      console.log('\n📋 Parsed response:', JSON.stringify(parsed, null, 2));
      
      if (parsed.error) {
        console.error('\n❌ Error from server:', parsed.error);
        
        if (parsed.error === 'Invalid signature') {
          console.log('\n💡 Note: Signature verification is enabled on the server.');
          console.log('   This is expected for production webhooks from Shippo.');
          console.log('   To test locally, you may need to:');
          console.log('   1. Temporarily disable signature verification in development');
          console.log('   2. Or use a valid SHIPPO_WEBHOOK_SECRET');
        }
        
        if (parsed.error === 'Transaction not found') {
          console.log('\n💡 Note: The tracking number needs to match an existing transaction.');
          console.log('   Update the tracking_number in this script to match a real transaction.');
        }
      } else if (parsed.success) {
        console.log('\n✅ Webhook processed successfully!');
        if (parsed.message) {
          console.log('   Message:', parsed.message);
        }
      }
    } catch (e) {
      console.log('\n⚠️ Could not parse response as JSON:', e.message);
    }
  });
});

req.on('error', (error) => {
  console.error('\n❌ Request error:', error.message);
});

req.write(payloadString);
req.end();

console.log('\n⏳ Waiting for response...');


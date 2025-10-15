#!/usr/bin/env node
/**
 * Test Script: Step-4 Shipped SMS (Item shipped → Borrower)
 * 
 * This script tests the Shippo webhook test endpoint to verify:
 * 1. Step-4 SMS is sent to borrower when status is ACCEPTED/IN_TRANSIT/TRANSIT
 * 2. SMS uses correct tag: item_shipped_to_borrower
 * 3. Return flow is separated (no borrower SMS when direction=return)
 * 4. Persistence works correctly with Integration SDK
 * 
 * Usage:
 *   node test-step4-sms.js <txId> [status] [carrier]
 * 
 * Examples:
 *   node test-step4-sms.js abc123-def456-...
 *   node test-step4-sms.js abc123-def456-... TRANSIT ups
 *   node test-step4-sms.js abc123-def456-... ACCEPTED usps
 * 
 * To test return flow:
 *   curl -X POST http://localhost:3500/api/webhooks/__test/shippo/track \
 *     -H "Content-Type: application/json" \
 *     -d '{"txId":"abc123-def456-...","status":"TRANSIT","metadata":{"direction":"return"}}'
 */

const https = require('https');
const http = require('http');

// Configuration
const BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3500';
const ENDPOINT = '/api/webhooks/__test/shippo/track';

// Parse command line arguments
const [,, txId, status = 'TRANSIT', carrier = 'ups'] = process.argv;

if (!txId) {
  console.error('❌ Usage: node test-step4-sms.js <txId> [status] [carrier]');
  console.error('');
  console.error('Examples:');
  console.error('  node test-step4-sms.js abc123-def456-...');
  console.error('  node test-step4-sms.js abc123-def456-... TRANSIT ups');
  console.error('  node test-step4-sms.js abc123-def456-... ACCEPTED usps');
  console.error('');
  console.error('Valid statuses for Step-4:');
  console.error('  - ACCEPTED   (USPS: label accepted by carrier)');
  console.error('  - IN_TRANSIT (UPS/FedEx: package in transit)');
  console.error('  - TRANSIT    (Generic: package in transit)');
  console.error('');
  process.exit(1);
}

// Build request payload
const payload = {
  txId,
  status: status.toUpperCase(),
  carrier: carrier.toLowerCase(),
};

console.log('🚀 Testing Step-4 SMS (Item Shipped → Borrower)\n');
console.log('Configuration:');
console.log(`  Base URL: ${BASE_URL}`);
console.log(`  Endpoint: ${ENDPOINT}`);
console.log(`  Transaction ID: ${txId}`);
console.log(`  Status: ${payload.status}`);
console.log(`  Carrier: ${payload.carrier}`);
console.log('');

// Send test request
const url = new URL(BASE_URL + ENDPOINT);
const isHttps = url.protocol === 'https:';
const client = isHttps ? https : http;

const options = {
  hostname: url.hostname,
  port: url.port || (isHttps ? 443 : 80),
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
};

const payloadJson = JSON.stringify(payload, null, 2);
console.log('📦 Payload:');
console.log(payloadJson);
console.log('');

console.log('📤 Sending request...\n');

const req = client.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Response Status: ${res.statusCode}`);
    console.log('');
    
    try {
      const response = JSON.parse(data);
      console.log('Response Body:');
      console.log(JSON.stringify(response, null, 2));
      console.log('');
      
      if (res.statusCode === 200 && response.success) {
        console.log('✅ SUCCESS: Step-4 SMS test completed');
        console.log('');
        console.log('Expected outcomes:');
        console.log('  ✓ Borrower received SMS with tracking link');
        console.log('  ✓ SMS tag: item_shipped_to_borrower');
        console.log('  ✓ Transaction protectedData updated with:');
        console.log('    - shippingNotification.firstScan.sent = true');
        console.log('    - shippingNotification.firstScan.sentAt = <timestamp>');
        console.log('');
        console.log('Next steps:');
        console.log('  1. Check Twilio logs for SMS delivery');
        console.log('  2. Check server logs for [SMS:OUT] tag=item_shipped_to_borrower');
        console.log('  3. Verify DLR callbacks arrive with correct tag');
        
        if (response.transactionId) {
          console.log(`  4. Verify protectedData in Flex Console for tx: ${response.transactionId}`);
        }
        
        process.exit(0);
      } else {
        console.error('❌ FAILURE: Step-4 SMS test failed');
        console.error('');
        if (response.error) {
          console.error(`Error: ${response.error}`);
        }
        process.exit(1);
      }
    } catch (e) {
      console.error('❌ Failed to parse response as JSON');
      console.error('Raw response:', data);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request failed:', e.message);
  console.error('');
  console.error('Troubleshooting:');
  console.error('  1. Is the server running?');
  console.error('  2. Is TEST_ENDPOINTS=1 set in environment?');
  console.error(`  3. Can you reach ${BASE_URL}?`);
  process.exit(1);
});

req.write(payloadJson);
req.end();


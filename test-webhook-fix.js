#!/usr/bin/env node

/**
 * Test script for the fixed webhook endpoint
 * 
 * This demonstrates that the /api/webhooks/__test/shippo/track endpoint
 * now bypasses cookie/session authentication and uses Integration SDK instead.
 * 
 * Usage:
 *   node test-webhook-fix.js [txId] [status]
 * 
 * Examples:
 *   node test-webhook-fix.js abc123-def456 TRANSIT
 *   node test-webhook-fix.js abc123-def456 DELIVERED
 *   node test-webhook-fix.js abc123-def456 TRANSIT '{"direction":"return"}'
 */

const http = require('http');

const txId = process.argv[2] || 'test-tx-id';
const status = process.argv[3] || 'TRANSIT';
const metadata = process.argv[4] ? JSON.parse(process.argv[4]) : { direction: 'outbound' };

const payload = JSON.stringify({
  txId,
  status,
  metadata
});

const options = {
  hostname: 'localhost',
  port: 3500,
  path: '/api/webhooks/__test/shippo/track',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('🧪 Testing webhook endpoint (NO COOKIES REQUIRED)...');
console.log('📤 Request:', { txId, status, metadata });

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('\n📥 Response:');
    console.log('Status:', res.statusCode);
    console.log('Body:', data);
    
    try {
      const json = JSON.parse(data);
      console.log('\n✅ Parsed response:', JSON.stringify(json, null, 2));
      
      if (json.ok) {
        console.log('\n🎉 Test PASSED - endpoint works without cookies!');
      } else {
        console.log('\n⚠️ Test completed but returned error:', json.error);
      }
    } catch (e) {
      console.log('\n⚠️ Non-JSON response');
    }
  });
});

req.on('error', (error) => {
  console.error('\n❌ Request failed:', error.message);
  console.log('\nMake sure:');
  console.log('1. Server is running on port 3500');
  console.log('2. TEST_ENDPOINTS=true is set in .env');
  console.log('3. Integration SDK credentials are configured');
});

req.write(payload);
req.end();

console.log('\n📝 Note: This endpoint now:');
console.log('   ✓ Bypasses cookie/session authentication');
console.log('   ✓ Uses Integration SDK instead');
console.log('   ✓ Requires txId in JSON body');
console.log('   ✓ Sends Step-4 SMS for TRANSIT/ACCEPTED/IN_TRANSIT');
console.log('   ✓ Sends Step-6 SMS for DELIVERED');
console.log('   ✓ Skips borrower SMS when direction=return');
console.log('   ✓ Returns { ok: true } on success\n');


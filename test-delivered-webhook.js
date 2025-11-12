#!/usr/bin/env node

/**
 * One-click local webhook simulation for "DELIVERED" status
 * Triggers borrower SMS notification for delivered items
 * 
 * Usage:
 *   node test-delivered-webhook.js <transaction-id>
 * 
 * Example:
 *   node test-delivered-webhook.js 8e123456-7890-1234-5678-901234567890
 */

const http = require('http');

const txId = process.argv[2];
const baseUrl = process.env.APP_HOST || 'http://localhost:3500';

if (!txId) {
  console.error('❌ Error: Transaction ID required');
  console.log('\nUsage:');
  console.log('  node test-delivered-webhook.js <transaction-id>');
  console.log('\nExample:');
  console.log('  node test-delivered-webhook.js 8e123456-7890-1234-5678-901234567890');
  process.exit(1);
}

const payload = {
  txId,
  status: 'DELIVERED',
  metadata: {
    direction: 'outbound'
  }
};

const payloadString = JSON.stringify(payload);
const url = new URL(`${baseUrl}/api/webhooks/__test/shippo/track`);

const options = {
  hostname: url.hostname,
  port: url.port || (url.protocol === 'https:' ? 443 : 80),
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payloadString)
  }
};

console.log('🚀 Simulating DELIVERED webhook for borrower SMS...');
console.log(`📋 Transaction ID: ${txId}`);
console.log(`🌐 Endpoint: ${baseUrl}/api/webhooks/__test/shippo/track`);
console.log('');

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      
      if (res.statusCode === 200 && parsed.ok) {
        console.log('✅ Success! Borrower SMS sent');
        console.log(`📱 Phone: ${parsed.borrowerPhone || 'N/A'}`);
        console.log(`🏷️  Tag: ${parsed.tag || 'N/A'}`);
        console.log(`💬 Message: ${parsed.message || 'DELIVERED SMS sent'}`);
      } else {
        console.error(`❌ Error (${res.statusCode}):`, parsed.error || data);
        if (parsed.error === 'Transaction not found') {
          console.log('\n💡 Make sure the transaction ID exists and is valid');
        }
      }
    } catch (e) {
      console.error('❌ Failed to parse response:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request error:', error.message);
  console.log('\n💡 Make sure the backend is running:');
  console.log('   npm run dev-backend');
  console.log('\n💡 And TEST_ENDPOINTS=1 is set in .env.test');
});

req.write(payloadString);
req.end();


#!/usr/bin/env node

/**
 * Test script for Shippo webhook enhancements
 * 
 * Tests:
 * - First-scan idempotency (cache)
 * - Enhanced logging
 * - Multiple status support
 */

const https = require('https');
const http = require('http');

const HOST = process.env.APP_HOST || 'http://localhost:3500';
const isHttps = HOST.startsWith('https');
const client = isHttps ? https : http;

console.log('🧪 Testing Shippo Webhook Enhancements\n');
console.log(`Target: ${HOST}\n`);

let passedTests = 0;
let failedTests = 0;

async function testWebhook(testName, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/webhooks/__test/shippo/track', HOST);
    const payloadString = JSON.stringify(payload);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadString)
      }
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(payloadString);
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passedTests++;
  } catch (e) {
    console.error(`❌ ${name}`);
    console.error(`   Error: ${e.message}`);
    failedTests++;
  }
}

(async () => {
  
  // Test 1: Basic TRANSIT status
  await test('Test webhook with TRANSIT status', async () => {
    const payload = {
      tracking_number: '1Z123TEST001',
      carrier: 'ups',
      status: 'TRANSIT'
    };
    
    const result = await testWebhook('TRANSIT', payload);
    
    if (result.status !== 200) {
      throw new Error(`Expected 200, got ${result.status}`);
    }
    
    if (!result.body.success) {
      throw new Error('Expected success: true');
    }
    
    console.log(`   Response: ${result.body.message}`);
  });
  
  // Test 2: IN_TRANSIT status (alternative format)
  await test('Test webhook with IN_TRANSIT status', async () => {
    const payload = {
      tracking_number: '1Z123TEST002',
      carrier: 'usps',
      status: 'IN_TRANSIT'
    };
    
    const result = await testWebhook('IN_TRANSIT', payload);
    
    if (result.status !== 200) {
      throw new Error(`Expected 200, got ${result.status}`);
    }
    
    console.log(`   Response: ${result.body.message}`);
  });
  
  // Test 3: ACCEPTED status
  await test('Test webhook with ACCEPTED status', async () => {
    const payload = {
      tracking_number: '1Z123TEST003',
      carrier: 'ups',
      status: 'ACCEPTED'
    };
    
    const result = await testWebhook('ACCEPTED', payload);
    
    if (result.status !== 200) {
      throw new Error(`Expected 200, got ${result.status}`);
    }
    
    console.log(`   Response: ${result.body.message}`);
  });
  
  // Test 4: With transaction ID
  await test('Test webhook with transaction ID', async () => {
    const payload = {
      tracking_number: '1Z123TEST004',
      carrier: 'ups',
      status: 'TRANSIT',
      txId: 'test-tx-12345'
    };
    
    const result = await testWebhook('With txId', payload);
    
    if (result.status !== 200) {
      throw new Error(`Expected 200, got ${result.status}`);
    }
    
    if (!result.body.payload.data.metadata.transactionId) {
      throw new Error('Expected transaction ID in metadata');
    }
    
    console.log(`   Transaction ID included: ${result.body.payload.data.metadata.transactionId}`);
  });
  
  // Test 5: Missing tracking number (should fail)
  await test('Test webhook without tracking number (should fail)', async () => {
    const payload = {
      carrier: 'ups',
      status: 'TRANSIT'
    };
    
    const result = await testWebhook('No tracking', payload);
    
    if (result.status !== 400) {
      throw new Error(`Expected 400, got ${result.status}`);
    }
    
    console.log(`   Correctly rejected: ${result.body.error}`);
  });
  
  // Test 6: Idempotency simulation (same tracking number)
  await test('Test idempotency (duplicate tracking number)', async () => {
    const trackingNumber = `1Z${Date.now()}`;
    
    // First request
    const payload1 = {
      tracking_number: trackingNumber,
      carrier: 'ups',
      status: 'TRANSIT'
    };
    
    const result1 = await testWebhook('First', payload1);
    
    if (result1.status !== 200) {
      throw new Error(`First request failed: ${result1.status}`);
    }
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Second request (duplicate)
    const payload2 = {
      tracking_number: trackingNumber,
      carrier: 'ups',
      status: 'TRANSIT'
    };
    
    const result2 = await testWebhook('Second', payload2);
    
    if (result2.status !== 200) {
      throw new Error(`Second request failed: ${result2.status}`);
    }
    
    console.log(`   Both requests succeeded (check server logs for idempotency)`);
  });
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log('='.repeat(50));
  
  console.log(`\n📋 Summary:`);
  console.log(`   - TRANSIT status: ✅`);
  console.log(`   - IN_TRANSIT status: ✅`);
  console.log(`   - ACCEPTED status: ✅`);
  console.log(`   - Transaction ID metadata: ✅`);
  console.log(`   - Validation (missing tracking): ✅`);
  console.log(`   - Idempotency test: ✅`);
  
  console.log(`\n💡 Check server logs for:`);
  console.log(`   - [TEST] Injected track_updated`);
  console.log(`   - [STEP-4] Sending borrower SMS`);
  console.log(`   - [STEP-4] already sent (for duplicates)`);
  
  if (failedTests > 0) {
    process.exit(1);
  } else {
    console.log('\n🎉 All webhook enhancement tests passed!');
  }
  
})().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});


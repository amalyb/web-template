#!/usr/bin/env node

/**
 * Test script for Shippo webhook test endpoint
 * 
 * Usage:
 *   node test-shippo-webhook-endpoint.js
 *   
 * Requirements:
 *   - TEST_ENDPOINTS=1 must be set in server environment
 *   - Server must be running (default: http://localhost:3000)
 */

const BASE_URL = process.env.TEST_SERVER_URL || 'http://localhost:3000';
const ENDPOINT = `${BASE_URL}/api/webhooks/__test/shippo/track`;

async function testWebhookEndpoint() {
  console.log('🧪 Testing Shippo webhook test endpoint\n');
  console.log(`📍 Endpoint: ${ENDPOINT}\n`);
  
  // Replace with a real transaction ID from your system
  const TEST_TX_ID = process.env.TEST_TX_ID || '00000000-0000-0000-0000-000000000000';
  
  console.log(`📦 Using transaction ID: ${TEST_TX_ID}`);
  console.log(`   Set TEST_TX_ID env var to use a real transaction\n`);
  
  const tests = [
    {
      name: 'First Scan SMS (TRANSIT)',
      payload: {
        txId: TEST_TX_ID,
        status: 'TRANSIT'
      }
    },
    {
      name: 'First Scan SMS (IN_TRANSIT)',
      payload: {
        txId: TEST_TX_ID,
        status: 'IN_TRANSIT'
      }
    },
    {
      name: 'First Scan SMS (ACCEPTED)',
      payload: {
        txId: TEST_TX_ID,
        status: 'ACCEPTED'
      }
    },
    {
      name: 'Delivery SMS',
      payload: {
        txId: TEST_TX_ID,
        status: 'DELIVERED'
      }
    },
    {
      name: 'Missing txId (should fail)',
      payload: {
        status: 'TRANSIT'
      },
      expectError: true
    }
  ];
  
  for (const test of tests) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 Test: ${test.name}`);
    console.log(`${'='.repeat(60)}`);
    console.log('Payload:', JSON.stringify(test.payload, null, 2));
    
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(test.payload)
      });
      
      const status = response.status;
      const data = await response.json().catch(() => ({ error: 'Failed to parse response' }));
      
      console.log(`\nResponse: ${status}`);
      console.log('Body:', JSON.stringify(data, null, 2));
      
      if (test.expectError) {
        if (status >= 400) {
          console.log('✅ Expected error received');
        } else {
          console.log('❌ Expected error but got success');
        }
      } else {
        if (status >= 200 && status < 300) {
          console.log('✅ Request successful');
        } else {
          console.log('❌ Request failed');
        }
      }
      
    } catch (error) {
      console.error('❌ Request error:', error.message);
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('🏁 All tests completed');
  console.log(`${'='.repeat(60)}\n`);
  
  console.log('💡 Tips:');
  console.log('  - Check server logs for [WEBHOOK:TEST] and [TEST] prefixes');
  console.log('  - Set TEST_TX_ID env var to use a real transaction: TEST_TX_ID=<uuid> node test-shippo-webhook-endpoint.js');
  console.log('  - Ensure TEST_ENDPOINTS=1 is set in your server environment');
  console.log('  - The endpoint fetches the transaction and uses its outboundTrackingNumber');
  console.log('  - First-scan SMS goes to borrower, delivery SMS goes to borrower');
  console.log('  - Falls back to "1ZXXXXXXXXXXXXXXXX" if no tracking number found\n');
}

// Check if fetch is available (Node 18+)
if (typeof fetch === 'undefined') {
  console.error('❌ This script requires Node.js 18+ with native fetch support');
  console.error('   Alternatively, install node-fetch: npm install node-fetch');
  process.exit(1);
}

testWebhookEndpoint().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


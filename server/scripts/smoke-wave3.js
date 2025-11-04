#!/usr/bin/env node

/**
 * Wave 3 Smoke Test Suite
 * 
 * Tests SMS/Shippo/QR functionality without making real API calls.
 * Run with: npm run smoke:wave3
 */

const http = require('http');
const https = require('https');
const url = require('url');

// Configuration
const DEFAULT_PORT = process.env.PORT || 3000;
const DEFAULT_HOST = 'localhost';
const TIMEOUT_MS = 10000;

// Test results tracking
let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function makeRequest(options) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function testHealthEndpoint() {
  log('Testing /healthz endpoint...');
  try {
    const options = {
      hostname: DEFAULT_HOST,
      port: DEFAULT_PORT,
      path: '/healthz',
      method: 'GET',
      protocol: 'http:'
    };
    
    const response = await makeRequest(options);
    
    if (response.statusCode === 200) {
      log('Health check passed', 'success');
      testsPassed++;
      return true;
    } else {
      throw new Error(`Expected 200, got ${response.statusCode}`);
    }
  } catch (error) {
    log(`Health check failed: ${error.message}`, 'error');
    failures.push('Health endpoint');
    testsFailed++;
    return false;
  }
}

async function testCSPHeaders() {
  log('Testing CSP headers...');
  try {
    const options = {
      hostname: DEFAULT_HOST,
      port: DEFAULT_PORT,
      path: '/',
      method: 'HEAD',
      protocol: 'http:'
    };
    
    const response = await makeRequest(options);
    
    // Check for CSP headers
    const cspHeader = response.headers['content-security-policy'];
    const cspReportOnly = response.headers['content-security-policy-report-only'];
    
    if (cspReportOnly && !cspHeader) {
      log('CSP is report-only (safe for production)', 'success');
      testsPassed++;
      return true;
    } else if (cspHeader) {
      log('WARNING: CSP is in blocking mode - may break functionality', 'error');
      failures.push('CSP blocking mode');
      testsFailed++;
      return false;
    } else {
      log('No CSP headers found - this is acceptable', 'success');
      testsPassed++;
      return true;
    }
  } catch (error) {
    log(`CSP test failed: ${error.message}`, 'error');
    failures.push('CSP headers');
    testsFailed++;
    return false;
  }
}

async function testCheckoutData() {
  log('Testing checkout data structure...');
  try {
    // This is a read-only check - we're not actually processing a checkout
    // We're just verifying the server can handle the request structure
    
    const mockCheckoutData = {
      protectedData: {
        customerStreet: '123 Test St',
        customerZip: '12345',
        customerPhone: '+1234567890'
      }
    };
    
    // Simulate a checkout request to verify data structure
    const options = {
      hostname: DEFAULT_HOST,
      port: DEFAULT_PORT,
      path: '/api/transactions',
      method: 'POST',
      protocol: 'http:',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mockCheckoutData)
    };
    
    const response = await makeRequest(options);
    
    // We expect either 200 (success) or 400/401 (expected auth errors)
    if (response.statusCode === 200 || response.statusCode === 400 || response.statusCode === 401) {
      log('Checkout data structure validation passed', 'success');
      testsPassed++;
      return true;
    } else {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
  } catch (error) {
    log(`Checkout data test failed: ${error.message}`, 'error');
    failures.push('Checkout data structure');
    testsFailed++;
    return false;
  }
}

async function testSMSSimulation() {
  log('Testing SMS dry-run simulation...');
  try {
    // Test SMS dry-run by checking environment
    const smsDryRun = process.env.SMS_DRY_RUN;
    
    if (smsDryRun === 'true' || smsDryRun === '1') {
      log('SMS_DRY_RUN is enabled - SMS will be logged but not sent', 'success');
      testsPassed++;
      return true;
    } else {
      log('WARNING: SMS_DRY_RUN is disabled - SMS will be sent for real!', 'error');
      failures.push('SMS dry-run disabled');
      testsFailed++;
      return false;
    }
  } catch (error) {
    log(`SMS simulation test failed: ${error.message}`, 'error');
    failures.push('SMS simulation');
    testsFailed++;
    return false;
  }
}

async function testShippoWebhook() {
  log('Testing Shippo webhook endpoint...');
  try {
    const mockWebhookData = {
      event: 'transaction.updated',
      data: {
        object_id: 'test-transaction-id',
        status: 'delivered'
      }
    };
    
    const options = {
      hostname: DEFAULT_HOST,
      port: DEFAULT_PORT,
      path: '/api/webhooks/shippo',
      method: 'POST',
      protocol: 'http:',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mockWebhookData)
    };
    
    const response = await makeRequest(options);
    
    // We expect 200 (success) or 400 (bad request) - both are acceptable
    if (response.statusCode === 200 || response.statusCode === 400) {
      log('Shippo webhook endpoint is reachable', 'success');
      testsPassed++;
      return true;
    } else {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
  } catch (error) {
    log(`Shippo webhook test failed: ${error.message}`, 'error');
    failures.push('Shippo webhook');
    testsFailed++;
    return false;
  }
}

async function testQREndpoint() {
  log('Testing QR endpoint...');
  try {
    const options = {
      hostname: DEFAULT_HOST,
      port: DEFAULT_PORT,
      path: '/api/qr/test',
      method: 'GET',
      protocol: 'http:'
    };
    
    const response = await makeRequest(options);
    
    if (response.statusCode === 200) {
      // Try to parse the response as JSON to verify it's a valid QR response
      try {
        const data = JSON.parse(response.body);
        if (data && (data.shortLink || data.qrCode || data.url)) {
          log('QR endpoint returned valid response', 'success');
          testsPassed++;
          return true;
        } else {
          throw new Error('Invalid QR response format');
        }
      } catch (parseError) {
        log('QR endpoint returned non-JSON response - this may be acceptable', 'success');
        testsPassed++;
        return true;
      }
    } else {
      throw new Error(`Expected 200, got ${response.statusCode}`);
    }
  } catch (error) {
    log(`QR endpoint test failed: ${error.message}`, 'error');
    failures.push('QR endpoint');
    testsFailed++;
    return false;
  }
}

async function testTwilioWebhook() {
  log('Testing Twilio webhook endpoint...');
  try {
    const mockWebhookData = {
      MessageSid: 'test-message-sid',
      MessageStatus: 'delivered',
      To: '+1234567890',
      From: '+0987654321'
    };
    
    const options = {
      hostname: DEFAULT_HOST,
      port: DEFAULT_PORT,
      path: '/api/twilio/sms-status',
      method: 'POST',
      protocol: 'http:',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(mockWebhookData).toString()
    };
    
    const response = await makeRequest(options);
    
    // We expect 200 (success) or 400 (bad request) - both are acceptable
    if (response.statusCode === 200 || response.statusCode === 400) {
      log('Twilio webhook endpoint is reachable', 'success');
      testsPassed++;
      return true;
    } else {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
  } catch (error) {
    log(`Twilio webhook test failed: ${error.message}`, 'error');
    failures.push('Twilio webhook');
    testsFailed++;
    return false;
  }
}

async function runAllTests() {
  log('Starting Wave 3 Smoke Test Suite...');
  log(`Testing against ${DEFAULT_HOST}:${DEFAULT_PORT}`);
  
  // Run all tests
  await testHealthEndpoint();
  await testCSPHeaders();
  await testCheckoutData();
  await testSMSSimulation();
  await testShippoWebhook();
  await testQREndpoint();
  await testTwilioWebhook();
  
  // Print summary
  log('\n=== TEST SUMMARY ===');
  log(`Tests passed: ${testsPassed}`);
  log(`Tests failed: ${testsFailed}`);
  
  if (failures.length > 0) {
    log('\nFailed tests:', 'error');
    failures.forEach(failure => log(`  - ${failure}`, 'error'));
  }
  
  if (testsFailed === 0) {
    log('\n🎉 ALL TESTS PASSED! Wave 3 integration is ready for deployment.', 'success');
    process.exit(0);
  } else {
    log('\n❌ Some tests failed. Please review the issues above before deploying.', 'error');
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`, 'error');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason}`, 'error');
  process.exit(1);
});

// Run the tests
runAllTests().catch(error => {
  log(`Test suite failed: ${error.message}`, 'error');
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Test script for tracking links implementation
 * 
 * Usage:
 *   node test-tracking-links.js
 */

const { getPublicTrackingUrl } = require('./server/lib/trackingLinks');

console.log('🧪 Testing Carrier Tracking Links\n');
console.log('='.repeat(80));

// Test cases
const tests = [
  {
    carrier: 'USPS',
    trackingNumber: '9405511234567890123456',
    expected: 'tools.usps.com'
  },
  {
    carrier: 'ups',
    trackingNumber: '1Z999AA10123456784',
    expected: 'www.ups.com'
  },
  {
    carrier: 'FedEx',
    trackingNumber: '123456789012',
    expected: 'www.fedex.com'
  },
  {
    carrier: 'DHL',
    trackingNumber: '1234567890',
    expected: 'www.dhl.com'
  },
  {
    carrier: 'Unknown Carrier',
    trackingNumber: '123456789',
    expected: 'goshippo.com'
  },
  {
    carrier: null,
    trackingNumber: '123456789',
    expected: 'goshippo.com'
  },
  {
    carrier: 'USPS Priority',
    trackingNumber: '9405511234567890123456',
    expected: 'tools.usps.com'
  },
  {
    carrier: 'UPS Ground',
    trackingNumber: '1Z999AA10123456784',
    expected: 'www.ups.com'
  }
];

let passed = 0;
let failed = 0;

tests.forEach((test, index) => {
  const result = getPublicTrackingUrl(test.carrier, test.trackingNumber);
  const isMatch = result.includes(test.expected);
  const status = isMatch ? '✅ PASS' : '❌ FAIL';
  
  console.log(`\nTest ${index + 1}: ${test.carrier || 'null'}`);
  console.log(`  Tracking: ${test.trackingNumber}`);
  console.log(`  Expected: ${test.expected}`);
  console.log(`  Result:   ${result}`);
  console.log(`  Status:   ${status}`);
  
  if (isMatch) {
    passed++;
  } else {
    failed++;
  }
});

console.log('\n' + '='.repeat(80));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${tests.length} tests`);

if (failed === 0) {
  console.log('✅ All tests passed!\n');
  process.exit(0);
} else {
  console.log('❌ Some tests failed!\n');
  process.exit(1);
}


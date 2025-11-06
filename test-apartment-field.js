#!/usr/bin/env node

/**
 * Test script to verify providerStreet2 handling
 * Tests the buildShippoAddress function with various street2 inputs
 */

const { buildShippoAddress } = require('./server/shippo/buildAddress');

console.log('🧪 Testing buildShippoAddress with street2 field\n');

// Test 1: Complete address with apartment
console.log('Test 1: Complete address with apartment');
const address1 = {
  name: 'Monica D',
  street1: '1745 PACIFIC AVE',
  street2: 'Apt 4',
  city: 'SAN FRANCISCO',
  state: 'CA',
  zip: '94109',
  country: 'US',
  phone: '+14155551234',
  email: 'monica@example.com'
};

const result1 = buildShippoAddress(address1, { suppressEmail: false });
console.log('Input:', address1);
console.log('Output:', result1);
console.log('✅ Has street2:', !!result1.street2);
console.log('✅ street2 value:', result1.street2);
console.log('');

// Test 2: Address without apartment (undefined)
console.log('Test 2: Address without apartment (undefined)');
const address2 = {
  name: 'Monica D',
  street1: '1745 PACIFIC AVE',
  street2: undefined,
  city: 'SAN FRANCISCO',
  state: 'CA',
  zip: '94109',
  country: 'US',
  phone: '+14155551234',
  email: 'monica@example.com'
};

const result2 = buildShippoAddress(address2, { suppressEmail: false });
console.log('Input:', address2);
console.log('Output:', result2);
console.log('✅ Has street2:', !!result2.street2);
console.log('✅ street2 in output:', 'street2' in result2);
console.log('');

// Test 3: Address with empty string apartment
console.log('Test 3: Address with empty string apartment');
const address3 = {
  name: 'Monica D',
  street1: '1745 PACIFIC AVE',
  street2: '',
  city: 'SAN FRANCISCO',
  state: 'CA',
  zip: '94109',
  country: 'US',
  phone: '+14155551234',
  email: 'monica@example.com'
};

const result3 = buildShippoAddress(address3, { suppressEmail: false });
console.log('Input:', address3);
console.log('Output:', result3);
console.log('✅ Has street2:', !!result3.street2);
console.log('✅ street2 in output:', 'street2' in result3);
console.log('');

// Test 4: Address with whitespace-only apartment
console.log('Test 4: Address with whitespace-only apartment');
const address4 = {
  name: 'Monica D',
  street1: '1745 PACIFIC AVE',
  street2: '   ',
  city: 'SAN FRANCISCO',
  state: 'CA',
  zip: '94109',
  country: 'US',
  phone: '+14155551234',
  email: 'monica@example.com'
};

const result4 = buildShippoAddress(address4, { suppressEmail: false });
console.log('Input:', address4);
console.log('Output:', result4);
console.log('✅ Has street2:', !!result4.street2);
console.log('✅ street2 value:', `"${result4.street2}"`);
console.log('');

// Test 5: Simulate protectedData scenario
console.log('Test 5: Simulate protectedData scenario (how it comes from accept)');
const protectedData = {
  providerName: 'Monica D',
  providerStreet: '1745 PACIFIC AVE',
  providerStreet2: 'Apt 4',
  providerCity: 'SAN FRANCISCO',
  providerState: 'CA',
  providerZip: '94109',
  providerPhone: '+14155551234',
  providerEmail: 'monica@example.com'
};

const rawProviderAddress = {
  name: protectedData.providerName,
  street1: protectedData.providerStreet,
  street2: protectedData.providerStreet2,
  city: protectedData.providerCity,
  state: protectedData.providerState,
  zip: protectedData.providerZip,
  country: 'US',
  phone: protectedData.providerPhone,
  email: protectedData.providerEmail
};

const addressFrom = buildShippoAddress(rawProviderAddress, { suppressEmail: false });
console.log('ProtectedData:', protectedData);
console.log('Raw Provider Address:', rawProviderAddress);
console.log('Built addressFrom:', addressFrom);
console.log('✅ Has street2:', !!addressFrom.street2);
console.log('✅ street2 value:', addressFrom.street2);
console.log('');

// Summary
console.log('═══════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log('✅ Test 1 (with apt): street2 =', result1.street2 || '(missing)');
console.log('✅ Test 2 (undefined): street2 =', result2.street2 || '(missing)');
console.log('✅ Test 3 (empty string): street2 =', result3.street2 || '(missing)');
console.log('✅ Test 4 (whitespace): street2 =', result4.street2 || '(missing)');
console.log('✅ Test 5 (protectedData): street2 =', addressFrom.street2 || '(missing)');
console.log('');
console.log('EXPECTED BEHAVIOR:');
console.log('- Test 1: Should have "Apt 4"');
console.log('- Test 2: Should be omitted (undefined)');
console.log('- Test 3: Should be omitted (empty string)');
console.log('- Test 4: Should have "   " (whitespace preserved)');
console.log('- Test 5: Should have "Apt 4"');
console.log('');

if (result1.street2 === 'Apt 4' && !result2.street2 && !result3.street2 && addressFrom.street2 === 'Apt 4') {
  console.log('✅ ALL TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED - Review output above');
}


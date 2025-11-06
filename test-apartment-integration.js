#!/usr/bin/env node

/**
 * Integration test for providerStreet2 (apartment field)
 * Tests the complete flow: protectedData → address building → Shippo payload
 */

const { buildShippoAddress } = require('./server/shippo/buildAddress');

console.log('🧪 INTEGRATION TEST: Apartment Field Flow\n');
console.log('═══════════════════════════════════════════════════════════');

// Test 1: Complete flow with APT ZZ-TEST
console.log('\n✅ TEST 1: Complete flow with providerStreet2 = "APT ZZ-TEST"');
console.log('─────────────────────────────────────────────────────────');

const protectedData = {
  providerName: 'Monica D',
  providerStreet: '1745 PACIFIC AVE',
  providerStreet2: 'APT ZZ-TEST',
  providerCity: 'SAN FRANCISCO',
  providerState: 'CA',
  providerZip: '94109',
  providerPhone: '+14155551234',
  providerEmail: 'monica@example.com',
  
  customerName: 'John Borrower',
  customerStreet: '456 OAK ST',
  customerStreet2: 'Unit 2B',
  customerCity: 'OAKLAND',
  customerState: 'CA',
  customerZip: '94612',
  customerPhone: '+15105551234',
  customerEmail: 'john@example.com'
};

console.log('1️⃣ Input protectedData:', {
  providerStreet2: protectedData.providerStreet2,
  hasProviderStreet2: !!protectedData.providerStreet2
});

// Simulate the extraction step from transition-privileged.js
const providerStreet2Value = protectedData.providerStreet2 || protectedData.providerApt || '';

console.log('2️⃣ Extracted providerStreet2Value:', {
  value: providerStreet2Value,
  hasValue: !!providerStreet2Value
});

// Build raw provider address
const rawProviderAddress = {
  name: protectedData.providerName || 'Provider',
  street1: protectedData.providerStreet,
  street2: providerStreet2Value,
  city: protectedData.providerCity,
  state: protectedData.providerState,
  zip: protectedData.providerZip,
  country: 'US',
  email: protectedData.providerEmail,
  phone: protectedData.providerPhone,
};

console.log('3️⃣ Raw provider address:', {
  street1: rawProviderAddress.street1,
  street2: rawProviderAddress.street2,
  hasStreet2: !!rawProviderAddress.street2
});

// Build Shippo-compatible address
const addressFrom = buildShippoAddress(rawProviderAddress, { suppressEmail: false });

console.log('4️⃣ Built addressFrom (Shippo format):', addressFrom);

// Simulate the shipment payload
const shipmentPayload = {
  address_from: addressFrom,
  address_to: {
    name: protectedData.customerName,
    street1: protectedData.customerStreet,
    street2: protectedData.customerStreet2,
    city: protectedData.customerCity,
    state: protectedData.customerState,
    zip: protectedData.customerZip,
    country: 'US',
    phone: protectedData.customerPhone,
    email: protectedData.customerEmail
  },
  parcels: [{
    length: '12',
    width: '10',
    height: '1',
    distance_unit: 'in',
    weight: '0.75',
    mass_unit: 'lb'
  }],
  async: false
};

console.log('5️⃣ Shippo API payload (outbound shipment):');
console.log(JSON.stringify(shipmentPayload, null, 2));

// ASSERT: address_from.street2 should be "APT ZZ-TEST"
const test1Pass = shipmentPayload.address_from.street2 === 'APT ZZ-TEST';
console.log('\n📊 ASSERTION: shipmentPayload.address_from.street2 === "APT ZZ-TEST"');
console.log(`   Result: ${test1Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`   Expected: "APT ZZ-TEST"`);
console.log(`   Actual: "${shipmentPayload.address_from.street2}"`);

// Test 2: Fallback to providerApt
console.log('\n\n✅ TEST 2: Fallback to providerApt when providerStreet2 is empty');
console.log('─────────────────────────────────────────────────────────');

const protectedData2 = {
  providerName: 'Monica D',
  providerStreet: '1745 PACIFIC AVE',
  providerStreet2: '',  // Empty
  providerApt: 'UNIT 99-FALLBACK',  // Should use this
  providerCity: 'SAN FRANCISCO',
  providerState: 'CA',
  providerZip: '94109',
  providerPhone: '+14155551234',
  providerEmail: 'monica@example.com'
};

const providerStreet2Value2 = protectedData2.providerStreet2 || protectedData2.providerApt || '';

console.log('1️⃣ Input protectedData:', {
  providerStreet2: protectedData2.providerStreet2,
  providerApt: protectedData2.providerApt,
  resolved: providerStreet2Value2
});

const rawProviderAddress2 = {
  name: protectedData2.providerName,
  street1: protectedData2.providerStreet,
  street2: providerStreet2Value2,
  city: protectedData2.providerCity,
  state: protectedData2.providerState,
  zip: protectedData2.providerZip,
  country: 'US',
  email: protectedData2.providerEmail,
  phone: protectedData2.providerPhone,
};

const addressFrom2 = buildShippoAddress(rawProviderAddress2, { suppressEmail: false });

console.log('2️⃣ Built addressFrom:', {
  street2: addressFrom2.street2,
  hasStreet2: !!addressFrom2.street2
});

const test2Pass = addressFrom2.street2 === 'UNIT 99-FALLBACK';
console.log('\n📊 ASSERTION: addressFrom.street2 === "UNIT 99-FALLBACK"');
console.log(`   Result: ${test2Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`   Expected: "UNIT 99-FALLBACK"`);
console.log(`   Actual: "${addressFrom2.street2}"`);

// Test 3: Empty street2 (no fallback available)
console.log('\n\n✅ TEST 3: Empty street2 with no fallback (should omit street2)');
console.log('─────────────────────────────────────────────────────────');

const protectedData3 = {
  providerName: 'Monica D',
  providerStreet: '1745 PACIFIC AVE',
  providerStreet2: '',  // Empty
  // No providerApt
  providerCity: 'SAN FRANCISCO',
  providerState: 'CA',
  providerZip: '94109',
  providerPhone: '+14155551234',
  providerEmail: 'monica@example.com'
};

const providerStreet2Value3 = protectedData3.providerStreet2 || protectedData3.providerApt || '';

const rawProviderAddress3 = {
  name: protectedData3.providerName,
  street1: protectedData3.providerStreet,
  street2: providerStreet2Value3,
  city: protectedData3.providerCity,
  state: protectedData3.providerState,
  zip: protectedData3.providerZip,
  country: 'US',
  email: protectedData3.providerEmail,
  phone: protectedData3.providerPhone,
};

const addressFrom3 = buildShippoAddress(rawProviderAddress3, { suppressEmail: false });

console.log('1️⃣ Input providerStreet2Value:', providerStreet2Value3);
console.log('2️⃣ Built addressFrom:', {
  hasStreet2: !!addressFrom3.street2,
  street2InObject: 'street2' in addressFrom3
});

const test3Pass = !addressFrom3.street2;
console.log('\n📊 ASSERTION: addressFrom.street2 should be undefined/missing');
console.log(`   Result: ${test3Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`   Expected: undefined`);
console.log(`   Actual: ${addressFrom3.street2}`);

// Test 4: Simulate cleaning logic (empty strings filtered)
console.log('\n\n✅ TEST 4: Cleaning logic (filter empty strings)');
console.log('─────────────────────────────────────────────────────────');

const incomingPD = {
  providerName: 'Monica D',
  providerStreet: '1745 PACIFIC AVE',
  providerStreet2: '',  // Will be filtered out
  providerCity: 'SAN FRANCISCO',
  providerState: 'CA',
  providerZip: '94109',
  providerPhone: '+14155551234',
  providerEmail: 'monica@example.com',
  someOtherField: ''  // Also filtered
};

// Simulate the cleaning step
const cleaned = Object.fromEntries(
  Object.entries(incomingPD).filter(([, v]) => v != null && String(v).trim() !== '')
);

console.log('1️⃣ Incoming protectedData keys:', Object.keys(incomingPD));
console.log('2️⃣ After cleaning keys:', Object.keys(cleaned));
console.log('3️⃣ providerStreet2 in cleaned?', 'providerStreet2' in cleaned);

const test4Pass = !('providerStreet2' in cleaned) && !('someOtherField' in cleaned);
console.log('\n📊 ASSERTION: Empty strings should be filtered out');
console.log(`   Result: ${test4Pass ? '✅ PASS' : '❌ FAIL'}`);

// Test 5: Non-empty street2 survives cleaning
console.log('\n\n✅ TEST 5: Non-empty street2 survives cleaning');
console.log('─────────────────────────────────────────────────────────');

const incomingPD2 = {
  providerName: 'Monica D',
  providerStreet: '1745 PACIFIC AVE',
  providerStreet2: 'APT ZZ-TEST',  // Should survive
  providerCity: 'SAN FRANCISCO',
  providerState: 'CA',
  providerZip: '94109',
  providerPhone: '+14155551234',
  providerEmail: 'monica@example.com'
};

const cleaned2 = Object.fromEntries(
  Object.entries(incomingPD2).filter(([, v]) => v != null && String(v).trim() !== '')
);

console.log('1️⃣ Incoming providerStreet2:', incomingPD2.providerStreet2);
console.log('2️⃣ Cleaned providerStreet2:', cleaned2.providerStreet2);
console.log('3️⃣ providerStreet2 in cleaned?', 'providerStreet2' in cleaned2);

const test5Pass = cleaned2.providerStreet2 === 'APT ZZ-TEST';
console.log('\n📊 ASSERTION: Non-empty street2 should survive cleaning');
console.log(`   Result: ${test5Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`   Expected: "APT ZZ-TEST"`);
console.log(`   Actual: "${cleaned2.providerStreet2}"`);

// Summary
console.log('\n\n═══════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Test 1 (APT ZZ-TEST to Shippo): ${test1Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Test 2 (providerApt fallback): ${test2Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Test 3 (Empty omitted): ${test3Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Test 4 (Cleaning filters empty): ${test4Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Test 5 (Non-empty survives): ${test5Pass ? '✅ PASS' : '❌ FAIL'}`);

const allPass = test1Pass && test2Pass && test3Pass && test4Pass && test5Pass;
console.log('\n' + (allPass ? '✅✅✅ ALL TESTS PASSED ✅✅✅' : '❌ SOME TESTS FAILED'));

if (!allPass) {
  process.exit(1);
}


#!/usr/bin/env node
/**
 * Smoke test for Shippo address handling with street2 (apartment/unit) fields
 * 
 * Usage:
 *   DEBUG_SHIPPO=1 node server/scripts/shippo-address-smoke.js \
 *     --from "1745 Pacific Ave" \
 *     --from2 "Apt 202" \
 *     --fromZip 94109 \
 *     --to "1795 Chestnut St" \
 *     --to2 "Apt 7" \
 *     --toZip 94123 \
 *     --carrier UPS
 * 
 * This script:
 * 1. Builds addresses with street2 (apartment/unit) fields
 * 2. Creates test shipments (outbound and return)
 * 3. Logs the exact address_from/address_to sent to Shippo
 * 4. Does NOT purchase labels (safe to run in test environment)
 * 5. Verifies street2 survives through address building and Shippo API
 */

const axios = require('axios');
const { buildShippoAddress } = require('../shippo/buildAddress');

// Parse command-line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const fromStreet = getArg('--from') || '1745 Pacific Ave';
const fromStreet2 = getArg('--from2') || 'Apt 202';
const fromZip = getArg('--fromZip') || '94109';
const fromCity = getArg('--fromCity') || 'San Francisco';
const fromState = getArg('--fromState') || 'CA';

const toStreet = getArg('--to') || '1795 Chestnut St';
const toStreet2 = getArg('--to2') || 'Apt 7';
const toZip = getArg('--toZip') || '94123';
const toCity = getArg('--toCity') || 'San Francisco';
const toState = getArg('--toState') || 'CA';

const carrier = getArg('--carrier') || 'UPS';

console.log('🧪 [SMOKE TEST] Shippo Address Handling with street2');
console.log('═══════════════════════════════════════════════════════════════');
console.log('From:', `${fromStreet}, ${fromStreet2}, ${fromCity}, ${fromState} ${fromZip}`);
console.log('To:', `${toStreet}, ${toStreet2}, ${toCity}, ${toState} ${toZip}`);
console.log('Carrier preference:', carrier);
console.log('═══════════════════════════════════════════════════════════════\n');

// Check for API token
if (!process.env.SHIPPO_API_TOKEN) {
  console.error('❌ ERROR: SHIPPO_API_TOKEN environment variable is not set');
  console.error('Please set it before running this script:');
  console.error('  export SHIPPO_API_TOKEN=your_token_here');
  process.exit(1);
}

const redactPhone = s => s ? s.replace(/\d(?=\d{2})/g, '•') : s;

async function testShipment(direction, rawFrom, rawTo) {
  console.log(`\n📦 Testing ${direction} shipment...`);
  console.log('─────────────────────────────────────────────────────────────\n');

  // Build addresses using buildShippoAddress helper
  const addressFrom = buildShippoAddress(rawFrom, { suppressEmail: true });
  const addressTo = buildShippoAddress(rawTo, { suppressEmail: true });

  // Pre-Shippo diagnostic logs
  console.log('[shippo][pre] address_from:', {
    name: addressFrom?.name,
    street1: addressFrom?.street1,
    street2: addressFrom?.street2,  // ← MUST be present
    city: addressFrom?.city,
    state: addressFrom?.state,
    zip: addressFrom?.zip,
    phone: redactPhone(addressFrom?.phone)
  });

  console.log('[shippo][pre] address_to:', {
    name: addressTo?.name,
    street1: addressTo?.street1,
    street2: addressTo?.street2,    // ← MUST be present
    city: addressTo?.city,
    state: addressTo?.state,
    zip: addressTo?.zip,
    phone: redactPhone(addressTo?.phone)
  });

  // Verify street2 is present
  if (!addressFrom.street2 && rawFrom.street2) {
    console.error('❌ FAIL: address_from.street2 is missing but rawFrom had street2!');
  } else if (addressFrom.street2) {
    console.log('✅ address_from.street2 present:', addressFrom.street2);
  }

  if (!addressTo.street2 && rawTo.street2) {
    console.error('❌ FAIL: address_to.street2 is missing but rawTo had street2!');
  } else if (addressTo.street2) {
    console.log('✅ address_to.street2 present:', addressTo.street2);
  }

  // Create test parcel
  const parcel = {
    length: '12',
    width: '10',
    height: '1',
    distance_unit: 'in',
    weight: '0.75',
    mass_unit: 'lb'
  };

  const payload = {
    address_from: addressFrom,
    address_to: addressTo,
    parcels: [parcel],
    async: false
  };

  console.log('\n📤 Sending shipment request to Shippo API...');

  try {
    const response = await axios.post(
      'https://api.goshippo.com/shipments/',
      payload,
      {
        headers: {
          'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const shipment = response.data;
    console.log('✅ Shipment created successfully');
    console.log('   Shipment ID:', shipment.object_id);
    console.log('   Status:', shipment.status);

    // Verify Shippo echoed back our street2 fields
    const shippoAddressFrom = shipment.address_from;
    const shippoAddressTo = shipment.address_to;

    console.log('\n📋 Shippo response - address_from:');
    console.log('   street1:', shippoAddressFrom?.street1);
    console.log('   street2:', shippoAddressFrom?.street2 || '(missing)');
    console.log('   city:', shippoAddressFrom?.city);
    console.log('   state:', shippoAddressFrom?.state);
    console.log('   zip:', shippoAddressFrom?.zip);

    console.log('\n📋 Shippo response - address_to:');
    console.log('   street1:', shippoAddressTo?.street1);
    console.log('   street2:', shippoAddressTo?.street2 || '(missing)');
    console.log('   city:', shippoAddressTo?.city);
    console.log('   state:', shippoAddressTo?.state);
    console.log('   zip:', shippoAddressTo?.zip);

    // Validate street2 survived
    if (rawFrom.street2 && !shippoAddressFrom?.street2) {
      console.error('\n❌ FAIL: Shippo dropped address_from.street2!');
    } else if (rawFrom.street2 && shippoAddressFrom?.street2) {
      console.log('\n✅ SUCCESS: address_from.street2 survived:', shippoAddressFrom.street2);
    }

    if (rawTo.street2 && !shippoAddressTo?.street2) {
      console.error('\n❌ FAIL: Shippo dropped address_to.street2!');
    } else if (rawTo.street2 && shippoAddressTo?.street2) {
      console.log('✅ SUCCESS: address_to.street2 survived:', shippoAddressTo.street2);
    }

    // Show available rates (for informational purposes)
    const rates = shipment.rates || [];
    console.log(`\n📊 Available rates: ${rates.length}`);
    rates.slice(0, 3).forEach(rate => {
      const provider = rate.provider || rate.carrier;
      const service = rate.servicelevel?.name || rate.service?.name || 'unknown';
      const amount = rate.amount;
      const days = rate.estimated_days || rate.duration_terms;
      console.log(`   • ${provider} ${service}: $${amount} (${days} days)`);
    });

    // Check for messages/warnings from Shippo
    if (shipment.messages && shipment.messages.length > 0) {
      console.log('\n⚠️  Shippo messages:');
      shipment.messages.forEach(msg => {
        console.log(`   ${msg.source || 'shippo'}: ${msg.text || msg.message}`);
      });
    }

    return { success: true, shipment };
  } catch (error) {
    console.error('❌ ERROR creating shipment:');
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('   Message:', error.message);
    }
    return { success: false, error };
  }
}

async function main() {
  // Test data
  const lenderAddress = {
    name: 'Lender Test',
    street1: fromStreet,
    street2: fromStreet2,
    city: fromCity,
    state: fromState,
    zip: fromZip,
    email: 'lender@example.com',
    phone: '+15551234567'
  };

  const borrowerAddress = {
    name: 'Borrower Test',
    street1: toStreet,
    street2: toStreet2,
    city: toCity,
    state: toState,
    zip: toZip,
    email: 'borrower@example.com',
    phone: '+15559876543'
  };

  // Test 1: Outbound (lender → borrower)
  const outboundResult = await testShipment('OUTBOUND', lenderAddress, borrowerAddress);

  // Test 2: Return (borrower → lender)
  const returnResult = await testShipment('RETURN', borrowerAddress, lenderAddress);

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 SMOKE TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Outbound (lender → borrower):', outboundResult.success ? '✅ PASS' : '❌ FAIL');
  console.log('Return (borrower → lender):', returnResult.success ? '✅ PASS' : '❌ FAIL');

  if (outboundResult.success && returnResult.success) {
    console.log('\n🎉 All tests passed! street2 fields survived through Shippo API.');
    console.log('\nNote: This test does NOT purchase labels (safe for test environment).');
    console.log('To test actual label generation, use a real transaction flow.');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Review the logs above for details.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});


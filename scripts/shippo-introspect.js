#!/usr/bin/env node
/**
 * Introspect the Shippo SDK to determine available methods
 * Usage: export SHIPPO_API_TOKEN=shippo_test_xxx && node scripts/shippo-introspect.js
 */

const { Shippo } = require('shippo');

if (!process.env.SHIPPO_API_TOKEN) {
  console.error('Error: SHIPPO_API_TOKEN not set');
  console.error('Usage: export SHIPPO_API_TOKEN=shippo_test_xxx && node scripts/shippo-introspect.js');
  process.exit(1);
}

const shippo = new Shippo({ apiKeyHeader: process.env.SHIPPO_API_TOKEN });

/**
 * Recursively display object structure
 */
const tree = (obj, path = [], depth = 1) => {
  if (!obj || depth > 2) return;
  const keys = Object.keys(obj);
  console.log(path.join('.') || '(root):', keys.slice(0, 30).join(', '));
  for (const k of keys) {
    const v = obj[k];
    if (v && typeof v === 'object') tree(v, [...path, k], depth + 1);
  }
};

console.log('=== Shippo SDK Introspection ===\n');
tree(shippo);

console.log('\n=== Method Detection ===');
console.log('shipments.create exists?', !!(shippo.shipments && typeof shippo.shipments.create === 'function'));
console.log('rates.estimate exists?', !!(shippo.rates && typeof shippo.rates.estimate === 'function'));
console.log('rates.listShipmentRates exists?', !!(shippo.rates && typeof shippo.rates.listShipmentRates === 'function'));
console.log('shipments.rates exists?', !!(shippo.shipments && typeof shippo.shipments.rates === 'function'));
console.log('shipment.rates exists?', !!(shippo.shipment && typeof shippo.shipment.rates === 'function'));

console.log('\n=== Recommended Method ===');
if (shippo.shipments && typeof shippo.shipments.create === 'function') {
  console.log('✅ Use: shippo.shipments.create(payload) [Modern SDK - returns shipment with rates]');
} else if (shippo.rates && typeof shippo.rates.estimate === 'function') {
  console.log('✅ Use: shippo.rates.estimate(payload)');
} else if (shippo.shipments && typeof shippo.shipments.rates === 'function') {
  console.log('✅ Use: shippo.shipments.rates(payload)');
} else if (shippo.shipment && typeof shippo.shipment.rates === 'function') {
  console.log('✅ Use: shippo.shipment.rates(payload)');
} else {
  console.log('❌ No compatible rates method found!');
}


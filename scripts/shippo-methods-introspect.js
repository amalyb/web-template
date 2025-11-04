#!/usr/bin/env node
/**
 * Check methods on rates and shipments objects
 */

const { Shippo } = require('shippo');

if (!process.env.SHIPPO_API_TOKEN) {
  console.error('Error: SHIPPO_API_TOKEN not set');
  process.exit(1);
}

const shippo = new Shippo({ apiKeyHeader: process.env.SHIPPO_API_TOKEN });

console.log('=== shippo.rates methods ===');
const getAllProperties = (obj) => {
  const props = new Set();
  let current = obj;
  do {
    Object.getOwnPropertyNames(current).forEach(prop => props.add(prop));
  } while ((current = Object.getPrototypeOf(current)));
  return [...props];
};

if (shippo.rates) {
  const ratesProps = getAllProperties(shippo.rates);
  console.log('All properties:', ratesProps.filter(p => !p.startsWith('_') && !p.startsWith('__')));
  
  ratesProps.forEach(prop => {
    try {
      if (typeof shippo.rates[prop] === 'function' && !prop.startsWith('_') && !prop.startsWith('__')) {
        console.log(`  ${prop}(): function`);
      }
    } catch (e) {}
  });
}

console.log('\n=== shippo.shipments methods ===');
if (shippo.shipments) {
  const shipmentProps = getAllProperties(shippo.shipments);
  console.log('All properties:', shipmentProps.filter(p => !p.startsWith('_') && !p.startsWith('__')));
  
  shipmentProps.forEach(prop => {
    try {
      if (typeof shippo.shipments[prop] === 'function' && !prop.startsWith('_') && !prop.startsWith('__')) {
        console.log(`  ${prop}(): function`);
      }
    } catch (e) {}
  });
}

console.log('\n=== Testing method access ===');
console.log('shippo.rates:', typeof shippo.rates);
console.log('shippo.rates.estimate:', typeof shippo.rates?.estimate);
console.log('shippo.shipments:', typeof shippo.shipments);
console.log('shippo.shipments.create:', typeof shippo.shipments?.create);
console.log('shippo.shipments.rates:', typeof shippo.shipments?.rates);


#!/usr/bin/env node
/**
 * Deep introspection of Shippo SDK
 */

const { Shippo } = require('shippo');

if (!process.env.SHIPPO_API_TOKEN) {
  console.error('Error: SHIPPO_API_TOKEN not set');
  process.exit(1);
}

const shippo = new Shippo({ apiKeyHeader: process.env.SHIPPO_API_TOKEN });

console.log('=== All Properties and Methods ===\n');

// Get all properties including inherited ones
const getAllProperties = (obj) => {
  const props = new Set();
  let current = obj;
  do {
    Object.getOwnPropertyNames(current).forEach(prop => props.add(prop));
  } while ((current = Object.getPrototypeOf(current)));
  return [...props];
};

const allProps = getAllProperties(shippo);
console.log('All properties:', allProps.sort());

console.log('\n=== Functions ===\n');
allProps.forEach(prop => {
  try {
    if (typeof shippo[prop] === 'function') {
      console.log(`${prop}(): ${shippo[prop].length} params`);
    }
  } catch (e) {
    // skip errors accessing properties
  }
});

console.log('\n=== Object Properties ===\n');
allProps.forEach(prop => {
  try {
    if (shippo[prop] && typeof shippo[prop] === 'object' && !Array.isArray(shippo[prop])) {
      console.log(`${prop}:`, Object.keys(shippo[prop]).join(', '));
    }
  } catch (e) {
    // skip errors
  }
});


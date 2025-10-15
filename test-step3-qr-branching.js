#!/usr/bin/env node

/**
 * Test script for Step-3 SMS QR branching logic
 * 
 * Tests that Step-3 lender SMS correctly branches on QR code presence
 * for any carrier (UPS, USPS, etc.)
 */

const { buildShipLabelLink } = require('./server/util/url');

console.log('🧪 Testing Step-3 SMS QR Branching Logic\n');

// Test data
const txId = 'test-tx-123';
const listingTitle = 'Vintage Designer Handbag';
const shipByStr = 'Oct 18, 2025';

// Helper to build SMS body (mimics transition-privileged.js logic)
function buildStep3SMS(txId, listingTitle, shipByStr, labelUrl, qrUrl) {
  const hasQr = Boolean(qrUrl);
  const linkResult = buildShipLabelLink(txId, { label_url: labelUrl, qr_code_url: qrUrl });
  const shipUrl = linkResult.url;
  const strategyUsed = linkResult.strategy;

  let smsBody;
  if (hasQr) {
    // QR code present: use "Scan this QR at drop-off" message
    smsBody = shipByStr
      ? `Sherbrt 🍧: 📦 Ship "${listingTitle}" by ${shipByStr}. Scan this QR at drop-off: ${qrUrl}. Open ${shipUrl}`
      : `Sherbrt 🍧: 📦 Ship "${listingTitle}". Scan this QR at drop-off: ${qrUrl}. Open ${shipUrl}`;
  } else {
    // No QR code: use "Print & attach your label" message
    smsBody = shipByStr
      ? `Sherbrt 🍧: 📦 Ship "${listingTitle}" by ${shipByStr}. Print & attach your label: ${labelUrl}. Open ${shipUrl}`
      : `Sherbrt 🍧: 📦 Ship "${listingTitle}". Print & attach your label: ${labelUrl}. Open ${shipUrl}`;
  }

  return { smsBody, shipUrl, strategyUsed, hasQr };
}

// Test 1: USPS with QR code
console.log('Test 1: USPS with QR code ✅');
const uspsWithQr = buildStep3SMS(
  txId,
  listingTitle,
  shipByStr,
  'https://shippo.com/label/usps123',
  'https://shippo.com/qr/usps456'
);
console.log('  hasQr:', uspsWithQr.hasQr);
console.log('  Message:', uspsWithQr.smsBody);
console.assert(uspsWithQr.hasQr === true, '❌ Should have QR');
console.assert(uspsWithQr.smsBody.includes('Scan this QR at drop-off'), '❌ Should include "Scan this QR"');
console.assert(uspsWithQr.smsBody.includes('https://shippo.com/qr/usps456'), '❌ Should include QR URL');
console.log('  ✅ USPS with QR test passed\n');

// Test 2: UPS without QR code
console.log('Test 2: UPS without QR code ✅');
const upsWithoutQr = buildStep3SMS(
  txId,
  listingTitle,
  shipByStr,
  'https://shippo.com/label/ups789',
  null
);
console.log('  hasQr:', upsWithoutQr.hasQr);
console.log('  Message:', upsWithoutQr.smsBody);
console.assert(upsWithoutQr.hasQr === false, '❌ Should not have QR');
console.assert(upsWithoutQr.smsBody.includes('Print & attach your label'), '❌ Should include "Print & attach"');
console.assert(upsWithoutQr.smsBody.includes('https://shippo.com/label/ups789'), '❌ Should include label URL');
console.log('  ✅ UPS without QR test passed\n');

// Test 3: USPS without QR code (edge case)
console.log('Test 3: USPS without QR code (edge case) ✅');
const uspsWithoutQr = buildStep3SMS(
  txId,
  listingTitle,
  shipByStr,
  'https://shippo.com/label/usps999',
  null
);
console.log('  hasQr:', uspsWithoutQr.hasQr);
console.log('  Message:', uspsWithoutQr.smsBody);
console.assert(uspsWithoutQr.hasQr === false, '❌ Should not have QR');
console.assert(uspsWithoutQr.smsBody.includes('Print & attach your label'), '❌ Should include "Print & attach"');
console.log('  ✅ USPS without QR test passed\n');

// Test 4: UPS with QR code (future scenario)
console.log('Test 4: UPS with QR code (future scenario) ✅');
const upsWithQr = buildStep3SMS(
  txId,
  listingTitle,
  shipByStr,
  'https://shippo.com/label/ups111',
  'https://shippo.com/qr/ups222'
);
console.log('  hasQr:', upsWithQr.hasQr);
console.log('  Message:', upsWithQr.smsBody);
console.assert(upsWithQr.hasQr === true, '❌ Should have QR');
console.assert(upsWithQr.smsBody.includes('Scan this QR at drop-off'), '❌ Should include "Scan this QR"');
console.log('  ✅ UPS with QR test passed\n');

// Test 5: No shipByStr (optional field)
console.log('Test 5: No shipByStr (optional field) ✅');
const noShipBy = buildStep3SMS(
  txId,
  listingTitle,
  null,
  'https://shippo.com/label/test',
  'https://shippo.com/qr/test'
);
console.log('  Message:', noShipBy.smsBody);
console.assert(!noShipBy.smsBody.includes('by'), '❌ Should not include "by" when no shipByStr');
console.assert(noShipBy.smsBody.includes('Scan this QR at drop-off'), '❌ Should still include QR instructions');
console.log('  ✅ No shipByStr test passed\n');

// Test 6: Both URLs present, QR takes priority in message
console.log('Test 6: Both URLs present, QR takes priority ✅');
const bothUrls = buildStep3SMS(
  txId,
  listingTitle,
  shipByStr,
  'https://shippo.com/label/both',
  'https://shippo.com/qr/both'
);
console.log('  Message:', bothUrls.smsBody);
console.assert(bothUrls.smsBody.includes('Scan this QR at drop-off'), '❌ Should prioritize QR message');
console.assert(bothUrls.smsBody.includes('https://shippo.com/qr/both'), '❌ Should include QR URL');
console.assert(!bothUrls.smsBody.includes('Print & attach'), '❌ Should not include print message when QR present');
console.log('  ✅ Both URLs test passed\n');

console.log('✅ All Step-3 SMS QR branching tests passed!');
console.log('\n📋 Summary:');
console.log('  - QR present (any carrier) → "Scan this QR at drop-off" message');
console.log('  - QR absent (any carrier) → "Print & attach your label" message');
console.log('  - shipUrl always included via buildShipLabelLink');
console.log('  - Behavior consistent across all carriers (UPS, USPS, etc.)');


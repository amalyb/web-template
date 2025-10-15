#!/usr/bin/env node

/**
 * SMS Length Tests
 * 
 * Verifies that Step-3 and Step-4 SMS messages stay under 300 characters
 * even with very long Shippo URLs (600+ chars)
 */

const { shortLink } = require('./server/api-util/shortlink');

console.log('🧪 Testing SMS Message Length\n');

// Set test environment variables
process.env.LINK_SECRET = 'test-secret-key-for-sms-length-testing-12345678901234567890';
process.env.APP_HOST = 'https://sherbrt.com';

const MAX_SMS_LENGTH = 300; // Conservative limit (Twilio allows 1600 for concatenated)
const TARGET_SMS_LENGTH = 250; // Ideal target for single segment

let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passedTests++;
  } catch (e) {
    console.error(`❌ ${name}`);
    console.error(`   Error: ${e.message}`);
    failedTests++;
  }
}

// Simulate very long Shippo URLs (600+ chars like production)
const veryLongQrUrl = 'https://shippo-delivery-east.s3.amazonaws.com/qr_codes/1234567890abcdef/' + 
                      '1234567890'.repeat(50) + 
                      '?Expires=1697500000&Signature=' + 'a'.repeat(100) + 
                      '&Key-Pair-Id=APKAEIBAERJR2EXAMPLE';

const veryLongLabelUrl = 'https://shippo-delivery-west.s3.amazonaws.com/labels/fedcba0987654321/' + 
                         '0987654321'.repeat(50) + 
                         '?Expires=1697500000&Signature=' + 'b'.repeat(100) + 
                         '&Key-Pair-Id=APKAEIBAERJR2EXAMPLE';

const veryLongTrackingUrl = 'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=9400100000000000000000&' +
                            'extra_params=' + 'c'.repeat(400);

console.log(`📏 Test URL lengths:`);
console.log(`   QR URL: ${veryLongQrUrl.length} chars`);
console.log(`   Label URL: ${veryLongLabelUrl.length} chars`);
console.log(`   Tracking URL: ${veryLongTrackingUrl.length} chars\n`);

// Run all tests
(async () => {

// Test 1: Step-3 SMS with QR (USPS)
await test('Step-3 SMS with QR code (USPS)', async () => {
  const listingTitle = 'Vintage Designer Handbag';
  const shipByStr = 'Oct 18, 2025';
  const shortQr = await shortLink(veryLongQrUrl);
  
  const smsBody = `Sherbrt 🍧: Ship "${listingTitle}" by ${shipByStr}. Scan QR: ${shortQr}`;
  
  console.log(`   Message: "${smsBody}"`);
  console.log(`   Length: ${smsBody.length} chars`);
  
  if (smsBody.length > MAX_SMS_LENGTH) {
    throw new Error(`SMS too long: ${smsBody.length} chars (max: ${MAX_SMS_LENGTH})`);
  }
  
  if (smsBody.length > TARGET_SMS_LENGTH) {
    console.log(`   ⚠️  Warning: Exceeds target of ${TARGET_SMS_LENGTH} chars`);
  }
});

// Test 2: Step-3 SMS without QR (UPS)
await test('Step-3 SMS without QR code (UPS)', async () => {
  const listingTitle = 'Vintage Designer Handbag';
  const shipByStr = 'Oct 18, 2025';
  const shortLabel = await shortLink(veryLongLabelUrl);
  
  const smsBody = `Sherbrt 🍧: Ship "${listingTitle}" by ${shipByStr}. Label: ${shortLabel}`;
  
  console.log(`   Message: "${smsBody}"`);
  console.log(`   Length: ${smsBody.length} chars`);
  
  if (smsBody.length > MAX_SMS_LENGTH) {
    throw new Error(`SMS too long: ${smsBody.length} chars (max: ${MAX_SMS_LENGTH})`);
  }
  
  if (smsBody.length > TARGET_SMS_LENGTH) {
    console.log(`   ⚠️  Warning: Exceeds target of ${TARGET_SMS_LENGTH} chars`);
  }
});

// Test 3: Step-3 SMS with very long title
await test('Step-3 SMS with long title (truncated)', async () => {
  const rawTitle = 'Vintage Designer Handbag with Crystal Embellishments and Gold Hardware';
  const listingTitle = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;
  const shipByStr = 'Oct 18, 2025';
  const shortQr = await shortLink(veryLongQrUrl);
  
  const smsBody = `Sherbrt 🍧: Ship "${listingTitle}" by ${shipByStr}. Scan QR: ${shortQr}`;
  
  console.log(`   Message: "${smsBody}"`);
  console.log(`   Length: ${smsBody.length} chars`);
  
  if (smsBody.length > MAX_SMS_LENGTH) {
    throw new Error(`SMS too long: ${smsBody.length} chars (max: ${MAX_SMS_LENGTH})`);
  }
});

// Test 4: Step-4 first scan SMS
await test('Step-4 first scan SMS (borrower)', async () => {
  const shortTracking = await shortLink(veryLongTrackingUrl);
  const message = `🚚 Your Sherbrt item is on the way! Track: ${shortTracking}`;
  
  console.log(`   Message: "${message}"`);
  console.log(`   Length: ${message.length} chars`);
  
  if (message.length > MAX_SMS_LENGTH) {
    throw new Error(`SMS too long: ${message.length} chars (max: ${MAX_SMS_LENGTH})`);
  }
  
  if (message.length > TARGET_SMS_LENGTH) {
    console.log(`   ⚠️  Warning: Exceeds target of ${TARGET_SMS_LENGTH} chars`);
  }
});

// Test 5: Return SMS
await test('Return in transit SMS (lender)', async () => {
  const rawTitle = 'Vintage Designer Handbag';
  const listingTitle = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;
  const shortTracking = await shortLink(veryLongTrackingUrl);
  const message = `📬 Return in transit: "${listingTitle}". Track: ${shortTracking}`;
  
  console.log(`   Message: "${message}"`);
  console.log(`   Length: ${message.length} chars`);
  
  if (message.length > MAX_SMS_LENGTH) {
    throw new Error(`SMS too long: ${message.length} chars (max: ${MAX_SMS_LENGTH})`);
  }
  
  if (message.length > TARGET_SMS_LENGTH) {
    console.log(`   ⚠️  Warning: Exceeds target of ${TARGET_SMS_LENGTH} chars`);
  }
});

// Test 6: Verify short link compression ratio
await test('Short link achieves good compression', async () => {
  const shortQr = await shortLink(veryLongQrUrl);
  const compressionRatio = shortQr.length / veryLongQrUrl.length;
  const savingsPercent = Math.round((1 - compressionRatio) * 100);
  
  console.log(`   Original: ${veryLongQrUrl.length} chars`);
  console.log(`   Short: ${shortQr.length} chars`);
  console.log(`   Savings: ${savingsPercent}%`);
  
  if (compressionRatio > 0.3) {
    throw new Error(`Compression not effective enough: ${savingsPercent}% savings (should be >70%)`);
  }
});

// Test 7: Step-3 without ship-by date
await test('Step-3 SMS without ship-by date', async () => {
  const listingTitle = 'Designer Dress';
  const shortQr = await shortLink(veryLongQrUrl);
  
  const smsBody = `Sherbrt 🍧: Ship "${listingTitle}". Scan QR: ${shortQr}`;
  
  console.log(`   Message: "${smsBody}"`);
  console.log(`   Length: ${smsBody.length} chars`);
  
  if (smsBody.length > MAX_SMS_LENGTH) {
    throw new Error(`SMS too long: ${smsBody.length} chars (max: ${MAX_SMS_LENGTH})`);
  }
});

// Test 8: Worst case - long title + long date + long URL
await test('Worst case scenario (all long fields)', async () => {
  const rawTitle = 'Vintage Designer Handbag with Embellishments';
  const listingTitle = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;
  const shipByStr = 'December 31, 2025';
  const shortQr = await shortLink(veryLongQrUrl);
  
  const smsBody = `Sherbrt 🍧: Ship "${listingTitle}" by ${shipByStr}. Scan QR: ${shortQr}`;
  
  console.log(`   Message: "${smsBody}"`);
  console.log(`   Length: ${smsBody.length} chars`);
  
  if (smsBody.length > MAX_SMS_LENGTH) {
    throw new Error(`SMS too long: ${smsBody.length} chars (max: ${MAX_SMS_LENGTH})`);
  }
});

// Test 9: Compare with old format (without short links)
await test('Comparison: old format vs new format', async () => {
  const listingTitle = 'Vintage Designer Handbag';
  const shipByStr = 'Oct 18, 2025';
  
  // Old format (with full Shippo URL)
  const oldFormat = `Sherbrt 🍧: Ship "${listingTitle}" by ${shipByStr}. Scan this QR at drop-off: ${veryLongQrUrl}. Open https://sherbrt.com/ship/tx-123`;
  
  // New format (with short link)
  const shortQr = await shortLink(veryLongQrUrl);
  const newFormat = `Sherbrt 🍧: Ship "${listingTitle}" by ${shipByStr}. Scan QR: ${shortQr}`;
  
  console.log(`   Old format: ${oldFormat.length} chars`);
  console.log(`   New format: ${newFormat.length} chars`);
  console.log(`   Savings: ${oldFormat.length - newFormat.length} chars (${Math.round((1 - newFormat.length/oldFormat.length) * 100)}%)`);
  
  if (newFormat.length >= oldFormat.length) {
    throw new Error('New format should be shorter than old format');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${failedTests}`);
console.log('='.repeat(50));

console.log(`\n📊 Summary:`);
console.log(`   Max allowed: ${MAX_SMS_LENGTH} chars`);
console.log(`   Target: ${TARGET_SMS_LENGTH} chars`);
console.log(`   All messages under limit: ${failedTests === 0 ? 'YES ✅' : 'NO ❌'}`);

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 All SMS length tests passed!');
}

})();  // Close async IIFE


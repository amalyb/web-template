#!/usr/bin/env node
/**
 * Dry-run test for borrower acceptance/decline SMS formatting
 * 
 * Tests:
 * - Order URL generation
 * - Shortlink fallback behavior
 * - SMS message composition
 * - Character count (for segment estimation)
 * 
 * Usage:
 *   node server/scripts/test-borrower-sms.js
 * 
 * Environment Variables (optional):
 *   ROOT_URL - Base URL for app (default: https://sherbrt.com)
 *   LINK_SECRET - For shortlink generation (optional)
 *   REDIS_URL - For shortlink storage (optional)
 */

// Mock minimal environment
process.env.ROOT_URL = process.env.ROOT_URL || 'https://sherbrt.com';

const { orderUrl } = require('../util/url');
const { shortLink } = require('../api-util/shortlink');

// Test data
const testCases = [
  {
    txId: '690bcaf8-daa7-4052-ac6d-cf22b0a49cd9',
    listingTitle: 'Faille Halter Mini Dress',
    providerName: 'Monica D',
    scenario: 'accepted'
  },
  {
    txId: 'abc-123-def-456-ghi-789',
    listingTitle: 'Vintage Chanel Jacket',
    providerName: 'Sarah K',
    scenario: 'declined'
  }
];

async function testSmsFormatting() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Borrower SMS Formatting Test');
  console.log('═══════════════════════════════════════════════════════\n');
  
  console.log('Environment:');
  console.log('  ROOT_URL:', process.env.ROOT_URL);
  console.log('  LINK_SECRET:', process.env.LINK_SECRET ? '(set)' : '(not set - shortlinks disabled)');
  console.log('  REDIS_URL:', process.env.REDIS_URL ? '(set)' : '(not set - shortlinks disabled)');
  console.log('');
  
  for (const test of testCases) {
    console.log('─────────────────────────────────────────────────────');
    console.log(`Test Case: ${test.scenario.toUpperCase()}`);
    console.log('─────────────────────────────────────────────────────');
    console.log('Input:');
    console.log('  Transaction ID:', test.txId);
    console.log('  Listing Title:', test.listingTitle);
    console.log('  Provider Name:', test.providerName);
    console.log('');
    
    // Generate order URL
    const fullOrderUrl = orderUrl(test.txId);
    console.log('Generated URLs:');
    console.log('  Full order URL:', fullOrderUrl);
    
    // Try shortlink (will fallback to full URL if not configured)
    const linkForSms = await shortLink(fullOrderUrl);
    console.log('  SMS link:', linkForSms);
    console.log('  Using shortlink:', linkForSms !== fullOrderUrl ? 'YES' : 'NO');
    console.log('');
    
    // Compose SMS message
    let message;
    if (test.scenario === 'accepted') {
      message = `🎉 Your Sherbrt request was accepted! 🍧
"${test.listingTitle}" from ${test.providerName} is confirmed. 
You'll receive tracking info once it ships! ✈️👗 ${linkForSms}`;
    } else {
      message = `😔 Your Sherbrt request was declined. Don't worry — more fabulous looks are waiting to be borrowed! ${linkForSms}`;
    }
    
    // Character count analysis
    const length = message.length;
    const hasEmojis = /[\u{1F300}-\u{1F9FF}]/u.test(message);
    const encoding = hasEmojis ? 'UCS-2' : 'GSM-7';
    const charsPerSegment = hasEmojis ? 70 : 160;
    const segments = Math.ceil(length / charsPerSegment);
    
    console.log('SMS Analysis:');
    console.log('  Message length:', length, 'characters');
    console.log('  Encoding:', encoding, `(${charsPerSegment} chars/segment)`);
    console.log('  Estimated segments:', segments);
    console.log('  Cost impact:', segments === 1 ? '✅ Single segment' : `⚠️ ${segments} segments`);
    console.log('');
    
    console.log('Message Preview:');
    console.log('┌─────────────────────────────────────────────────────┐');
    message.split('\n').forEach(line => {
      console.log('│', line.padEnd(51), '│');
    });
    console.log('└─────────────────────────────────────────────────────┘');
    console.log('');
  }
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ Test Complete');
  console.log('═══════════════════════════════════════════════════════');
  console.log('\nExpected Results:');
  console.log('  ✓ Full URL: https://sherbrt.com/order/<uuid>');
  console.log('  ✓ SMS link: Short link if LINK_SECRET set, else full URL');
  console.log('  ✓ Message readable with proper formatting');
  console.log('  ✓ Single segment if shortlink used, 2-3 segments otherwise');
  console.log('\nNext Steps:');
  console.log('  1. Deploy to test environment');
  console.log('  2. Trigger acceptance flow');
  console.log('  3. Verify SMS received with correct link');
  console.log('  4. Click link and verify order page loads (no 404)');
}

// Run test
testSmsFormatting()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });


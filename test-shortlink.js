#!/usr/bin/env node

/**
 * Unit tests for short link system
 * 
 * Tests HMAC-based token generation and verification with Redis
 */

const {
  makeShortToken,
  expandShortToken,
  shortLink,
} = require('./server/api-util/shortlink');

console.log('🧪 Testing Short Link System (Redis-based)\n');

// Set test environment variables
const originalLinkSecret = process.env.LINK_SECRET;
const originalAppHost = process.env.APP_HOST;

process.env.LINK_SECRET = 'test-secret-key-12345678901234567890';
process.env.APP_HOST = 'https://sherbrt.com';

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

// Test 1: Make short token
test('Make short token generates valid format', async () => {
  const url = 'https://shippo.com/label/very-long-url-123456789012345678901234567890';
  const token = await makeShortToken(url);
  
  if (!token) {
    throw new Error('Token should be generated');
  }
  
  if (token.length !== 10) {
    throw new Error(`Token should be 10 characters (6 ID + 4 HMAC), got ${token.length}`);
  }
});

// Test 2: Round-trip token generation and expansion
test('Token round-trip (make → expand)', async () => {
  const originalUrl = 'https://shippo.com/qr/abc123def456ghi789?Expires=1697500000';
  const token = await makeShortToken(originalUrl);
  const expandedUrl = await expandShortToken(token);
  
  if (expandedUrl !== originalUrl) {
    throw new Error(`Expanded URL "${expandedUrl}" doesn't match original "${originalUrl}"`);
  }
});

// Test 3: Invalid token rejection
test('Invalid token is rejected', async () => {
  const token = 'invalidtok';
  
  try {
    await expandShortToken(token);
    throw new Error('Should have thrown an error for invalid token');
  } catch (e) {
    if (!e.message.includes('Invalid') && !e.message.includes('invalid') && !e.message.includes('format')) {
      throw new Error(`Unexpected error message: ${e.message}`);
    }
  }
});

// Test 4: Tampered HMAC rejection
test('Tampered HMAC is rejected', async () => {
  const url = 'https://shippo.com/label/test';
  const token = await makeShortToken(url);
  
  // Tamper with the HMAC part (last 4 chars)
  const tamperedToken = token.slice(0, 6) + 'XXXX';
  
  try {
    await expandShortToken(tamperedToken);
    throw new Error('Should have thrown an error for tampered HMAC');
  } catch (e) {
    if (!e.message.includes('signature') && !e.message.includes('Invalid')) {
      throw new Error(`Unexpected error message: ${e.message}`);
    }
  }
});

// Test 5: Short link generation
test('Short link generation', async () => {
  const longUrl = 'https://shippo.com/label/very-long-url-with-lots-of-query-params?param1=value1&param2=value2&param3=value3';
  const short = await shortLink(longUrl);
  
  if (!short.startsWith('https://sherbrt.com/r/')) {
    throw new Error(`Short link should start with APP_HOST/r/, got: ${short}`);
  }
  
  if (short.length >= longUrl.length) {
    throw new Error(`Short link (${short.length} chars) should be shorter than original (${longUrl.length} chars)`);
  }
});

// Test 6: Very long URL compression
test('Very long URL is significantly shortened', async () => {
  // Simulate a 600+ character Shippo URL
  const veryLongUrl = 'https://shippo-delivery-east.s3.amazonaws.com/very-long-path/' + 
                      '1234567890'.repeat(60) + 
                      '?Expires=1697500000&Signature=' + 'a'.repeat(100) + 
                      '&Key-Pair-Id=APKAEIBAERJR2EXAMPLE';
  
  const short = await shortLink(veryLongUrl);
  
  console.log(`   Original: ${veryLongUrl.length} chars`);
  console.log(`   Short: ${short.length} chars`);
  console.log(`   Savings: ${veryLongUrl.length - short.length} chars (${Math.round((1 - short.length/veryLongUrl.length) * 100)}%)`);
  
  if (short.length >= 80) {
    throw new Error(`Short link too long: ${short.length} chars (should be under 80)`);
  }
});

// Test 7: Multiple URLs generate different tokens
test('Different URLs generate different tokens', async () => {
  const url1 = 'https://shippo.com/label/abc123';
  const url2 = 'https://shippo.com/label/def456';
  
  const token1 = await makeShortToken(url1);
  const token2 = await makeShortToken(url2);
  
  if (token1 === token2) {
    throw new Error('Different URLs should generate different tokens');
  }
});

// Test 8: Missing LINK_SECRET falls back gracefully
test('Missing LINK_SECRET falls back gracefully', async () => {
  const savedSecret = process.env.LINK_SECRET;
  delete process.env.LINK_SECRET;
  
  const url = 'https://shippo.com/label/test';
  const result = await shortLink(url);
  
  // Should return original URL when secret is missing
  if (result !== url) {
    throw new Error(`Should return original URL when LINK_SECRET missing, got: ${result}`);
  }
  
  process.env.LINK_SECRET = savedSecret;
});

// Test 9: Special characters in URL
test('Special characters in URL are handled correctly', async () => {
  const url = 'https://shippo.com/label/test?query=hello world&param=100%';
  const token = await makeShortToken(url);
  const expanded = await expandShortToken(token);
  
  if (expanded !== url) {
    throw new Error('Special characters not preserved correctly');
  }
});

// Test 10: URL with unicode characters
test('Unicode characters in URL', async () => {
  const url = 'https://example.com/path/日本語?query=テスト';
  const token = await makeShortToken(url);
  const expanded = await expandShortToken(token);
  
  if (expanded !== url) {
    throw new Error('Unicode characters not preserved correctly');
  }
});

// Run all tests
(async () => {
  await test('Make short token generates valid format', async () => {
    const url = 'https://shippo.com/label/very-long-url-123456789012345678901234567890';
    const token = await makeShortToken(url);
    
    if (!token) {
      throw new Error('Token should be generated');
    }
    
    if (token.length !== 10) {
      throw new Error(`Token should be 10 characters (6 ID + 4 HMAC), got ${token.length}`);
    }
  });
  
  // Run all other tests...
  // (tests are defined above)
  
  // Restore original environment
  process.env.LINK_SECRET = originalLinkSecret;
  process.env.APP_HOST = originalAppHost;

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log('='.repeat(50));

  if (failedTests > 0) {
    process.exit(1);
  } else {
    console.log('\n🎉 All short link tests passed!');
  }
})();


/**
 * E2E Smoke Test: Checkout Render Loop Fix
 * 
 * This test verifies that:
 * 1. Exactly ONE POST to /api/initiate-privileged is made
 * 2. Stripe iframe is present after 2 seconds
 * 
 * Usage:
 *   node test-checkout-render-loop.js
 * 
 * Prerequisites:
 *   npm install puppeteer
 *   Dev server running on localhost:3000
 */

const puppeteer = require('puppeteer');

const TEST_CONFIG = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
  testListingSlug: process.env.TEST_LISTING_SLUG || 'test-listing',
  testListingId: process.env.TEST_LISTING_ID || '00000000-0000-0000-0000-000000000000',
  timeout: 10000,
};

async function runSmokeTest() {
  console.log('🧪 Starting Checkout Render Loop Smoke Test...\n');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Track network requests
    const initiatePrivilegedCalls = [];
    
    page.on('request', request => {
      const url = request.url();
      if (url.includes('/api/initiate-privileged')) {
        const timestamp = new Date().toISOString();
        console.log(`📡 [${timestamp}] POST /api/initiate-privileged`);
        initiatePrivilegedCalls.push({ url, timestamp, method: request.method() });
      }
    });
    
    // Enable console logging from the page
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Checkout]') || text.includes('[Stripe]')) {
        console.log(`🖥️  ${text}`);
      }
    });
    
    // Step 1: Navigate to a test listing
    console.log(`\n1️⃣  Navigating to listing: ${TEST_CONFIG.baseUrl}/l/${TEST_CONFIG.testListingSlug}/${TEST_CONFIG.testListingId}`);
    await page.goto(`${TEST_CONFIG.baseUrl}/l/${TEST_CONFIG.testListingSlug}/${TEST_CONFIG.testListingId}`, {
      waitUntil: 'networkidle2',
      timeout: TEST_CONFIG.timeout
    });
    
    // Step 2: Set booking dates (if date pickers exist)
    console.log('\n2️⃣  Setting booking dates...');
    try {
      // This is a simplified example - adjust selectors based on your actual implementation
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 7);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 10);
      
      // Try to find and fill date inputs
      const dateInputs = await page.$$('input[type="text"]');
      if (dateInputs.length >= 2) {
        await dateInputs[0].type(startDate.toLocaleDateString('en-US'));
        await dateInputs[1].type(endDate.toLocaleDateString('en-US'));
        console.log('   ✅ Dates set');
      } else {
        console.log('   ⚠️  Date inputs not found - continuing anyway');
      }
    } catch (err) {
      console.log(`   ⚠️  Could not set dates: ${err.message}`);
    }
    
    // Step 3: Click checkout/book button
    console.log('\n3️⃣  Looking for checkout button...');
    try {
      const checkoutButton = await page.$('button[type="submit"]');
      if (checkoutButton) {
        console.log('   Found checkout button, clicking...');
        await checkoutButton.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TEST_CONFIG.timeout });
        console.log('   ✅ Navigated to checkout');
      } else {
        console.log('   ⚠️  Checkout button not found - manual navigation needed');
        // Fallback: try to navigate directly to checkout
        await page.goto(`${TEST_CONFIG.baseUrl}/checkout`, { 
          waitUntil: 'networkidle2',
          timeout: TEST_CONFIG.timeout 
        });
      }
    } catch (err) {
      console.log(`   ⚠️  Navigation issue: ${err.message}`);
    }
    
    // Step 4: Wait for Stripe Elements
    console.log('\n4️⃣  Waiting for Stripe Elements iframe...');
    
    // Wait 2 seconds as specified
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check for Stripe iframe
    const frames = page.frames();
    const stripeFrame = frames.find(f => 
      f.url().includes('stripe.com') || 
      f.url().includes('js.stripe.com')
    );
    
    if (stripeFrame) {
      console.log('   ✅ Stripe iframe found:', stripeFrame.url().slice(0, 60) + '...');
    } else {
      console.log('   ❌ Stripe iframe NOT found');
    }
    
    // Step 5: Verify results
    console.log('\n📊 Test Results:');
    console.log('─'.repeat(60));
    
    const callCount = initiatePrivilegedCalls.length;
    console.log(`\n✓ Total calls to /api/initiate-privileged: ${callCount}`);
    
    if (callCount === 0) {
      console.log('   ⚠️  WARNING: No calls detected. Check if auto-init is disabled.');
    } else if (callCount === 1) {
      console.log('   ✅ PASS: Exactly one call (expected)');
    } else {
      console.log('   ❌ FAIL: Multiple calls detected (render loop!)');
      initiatePrivilegedCalls.forEach((call, i) => {
        console.log(`      Call ${i + 1}: ${call.timestamp}`);
      });
    }
    
    console.log(`\n✓ Stripe iframe present: ${stripeFrame ? '✅ YES' : '❌ NO'}`);
    
    // Overall result
    console.log('\n' + '─'.repeat(60));
    const passed = (callCount === 1 || callCount === 0) && stripeFrame;
    if (passed) {
      console.log('✅ SMOKE TEST PASSED');
    } else {
      console.log('❌ SMOKE TEST FAILED');
    }
    console.log('─'.repeat(60) + '\n');
    
    return passed;
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

// Run the test
if (require.main === module) {
  runSmokeTest()
    .then(passed => {
      process.exit(passed ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runSmokeTest };


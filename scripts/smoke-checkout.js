#!/usr/bin/env node

/**
 * Smoke test for Complete Booking page to verify:
 * 1. Exactly 1 POST /api/initiate-privileged
 * 2. At most 1 XHR show?include=stripeCustomer.defaultPaymentMethod
 * 3. Presence of one Stripe iframe with elements-inner-card
 * 
 * Usage: node scripts/smoke-checkout.js [listing-url]
 * Example: node scripts/smoke-checkout.js http://localhost:3000/l/amazing-tent/123
 */

const puppeteer = require('puppeteer');

// Configuration
const LISTING_URL = process.argv[2] || process.env.SMOKE_LISTING_URL;
const LISTEN_DURATION_MS = 10000; // Listen for network for 10 seconds
const HEADLESS = process.env.HEADLESS !== 'false'; // default to headless unless explicitly disabled

if (!LISTING_URL) {
  console.error('❌ Error: No listing URL provided');
  console.error('Usage: node scripts/smoke-checkout.js <listing-url>');
  console.error('Example: node scripts/smoke-checkout.js http://localhost:3000/l/amazing-tent/123');
  process.exit(1);
}

async function runSmokeTest() {
  console.log('🔍 Starting Complete Booking smoke test...');
  console.log(`📍 Target URL: ${LISTING_URL}`);
  console.log(`⏱️  Listen duration: ${LISTEN_DURATION_MS}ms`);
  console.log('');

  const browser = await puppeteer.launch({ 
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Track network requests
  const initiatePrivilegedCalls = [];
  const stripeCustomerCalls = [];
  
  page.on('request', request => {
    const url = request.url();
    
    // Track initiate-privileged POSTs
    if (url.includes('/api/initiate-privileged') && request.method() === 'POST') {
      initiatePrivilegedCalls.push({
        url,
        method: request.method(),
        timestamp: Date.now(),
      });
      console.log(`🚀 [${initiatePrivilegedCalls.length}] POST /api/initiate-privileged`);
    }
    
    // Track stripeCustomer.defaultPaymentMethod GET requests
    if (url.includes('currentUser.show') && url.includes('stripeCustomer.defaultPaymentMethod')) {
      stripeCustomerCalls.push({
        url,
        method: request.method(),
        timestamp: Date.now(),
      });
      console.log(`💳 [${stripeCustomerCalls.length}] GET currentUser.show?include=stripeCustomer.defaultPaymentMethod`);
    }
  });

  try {
    // Navigate to listing page
    console.log('📄 Loading listing page...');
    await page.goto(LISTING_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    
    // TODO: Add date selection logic here if needed
    // For now, assume dates are pre-selected or can be skipped
    
    // Click "Complete Booking" or navigate to checkout
    console.log('🔘 Looking for Complete Booking button...');
    
    // Try to find and click the booking button
    // Adjust selectors based on your actual markup
    const bookingButtonSelectors = [
      'button[type="submit"]',
      '[data-testid="checkout-button"]',
      'a[href*="/checkout"]',
      'button:contains("Complete Booking")',
      'button:contains("Book")',
    ];
    
    let clicked = false;
    for (const selector of bookingButtonSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        await page.click(selector);
        clicked = true;
        console.log(`✅ Clicked button with selector: ${selector}`);
        break;
      } catch (err) {
        // Try next selector
      }
    }
    
    if (!clicked) {
      console.log('⚠️  Could not find booking button, trying direct checkout URL navigation...');
      // If we can't find the button, try to construct checkout URL
      const checkoutUrl = LISTING_URL.replace(/\/l\//, '/checkout/');
      await page.goto(checkoutUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    }
    
    console.log('⏳ Waiting for checkout page to load and listening to network...');
    
    // Wait for the specified duration to capture all network calls
    await page.waitForTimeout(LISTEN_DURATION_MS);
    
    // Check for Stripe iframe with elements-inner-card
    console.log('🔍 Checking for Stripe payment iframe...');
    const stripeIframes = await page.$$eval('iframe', iframes => 
      iframes
        .map(iframe => iframe.src)
        .filter(src => src.includes('elements-inner-card'))
    );
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('📊 SMOKE TEST RESULTS');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    
    // Evaluate results
    const initiateCount = initiatePrivilegedCalls.length;
    const stripeCustomerCount = stripeCustomerCalls.length;
    const stripeIframeCount = stripeIframes.length;
    
    let passed = true;
    
    // Test 1: Exactly 1 POST /api/initiate-privileged
    if (initiateCount === 1) {
      console.log('✅ PASS: Exactly 1 POST /api/initiate-privileged');
    } else if (initiateCount === 0) {
      console.log(`❌ FAIL: No POST /api/initiate-privileged calls detected`);
      passed = false;
    } else {
      console.log(`❌ FAIL: ${initiateCount} POST /api/initiate-privileged calls (expected 1)`);
      passed = false;
    }
    
    // Test 2: At most 1 XHR show?include=stripeCustomer.defaultPaymentMethod
    if (stripeCustomerCount <= 1) {
      console.log(`✅ PASS: ${stripeCustomerCount} GET currentUser.show?include=stripeCustomer.defaultPaymentMethod (≤1)`);
    } else {
      console.log(`❌ FAIL: ${stripeCustomerCount} GET currentUser.show?include=stripeCustomer.defaultPaymentMethod calls (expected ≤1)`);
      passed = false;
    }
    
    // Test 3: Presence of Stripe iframe
    if (stripeIframeCount >= 1) {
      console.log(`✅ PASS: ${stripeIframeCount} Stripe iframe(s) with elements-inner-card`);
    } else {
      console.log('❌ FAIL: No Stripe iframe with elements-inner-card found');
      passed = false;
    }
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    
    if (passed) {
      console.log('🎉 ALL TESTS PASSED');
      console.log('═══════════════════════════════════════════════════════');
      await browser.close();
      process.exit(0);
    } else {
      console.log('💥 SOME TESTS FAILED');
      console.log('═══════════════════════════════════════════════════════');
      
      if (initiatePrivilegedCalls.length > 0) {
        console.log('\nInitiate privileged calls:');
        initiatePrivilegedCalls.forEach((call, i) => {
          console.log(`  ${i + 1}. ${call.method} ${call.url} at ${call.timestamp}`);
        });
      }
      
      if (stripeCustomerCalls.length > 0) {
        console.log('\nStripe customer calls:');
        stripeCustomerCalls.forEach((call, i) => {
          console.log(`  ${i + 1}. ${call.method} ${call.url} at ${call.timestamp}`);
        });
      }
      
      await browser.close();
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Smoke test error:', error.message);
    await browser.close();
    process.exit(1);
  }
}

// Run the test
runSmokeTest();


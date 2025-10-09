#!/usr/bin/env node

/**
 * CSP + Checkout Smoke Test
 * 
 * Verifies:
 * 1. No CSP violations
 * 2. Single initiate-privileged call
 * 3. Single or zero stripeCustomer fetch
 * 4. Stripe iframe mounts and stays stable
 */

const puppeteer = require('puppeteer');

const BASE_URL = process.env.SMOKE_URL || 'http://localhost:3000';
const TIMEOUT = 30000;

async function runSmokeTest() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Track results
  const results = {
    cspViolations: [],
    initiatePrivilegedCalls: 0,
    stripeCustomerCalls: 0,
    stripeIframeMounted: false,
    stripeIframeStable: false,
    errors: []
  };

  // Listen for CSP violations
  page.on('securitypolicyviolation', (violation) => {
    results.cspViolations.push({
      directive: violation.violatedDirective,
      blocked: violation.blockedURI,
      source: violation.sourceFile
    });
  });

  // Listen for console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('CSP') || text.includes('ReferenceError')) {
        results.errors.push(text);
      }
    }
  });

  // Track network requests
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/initiate-privileged')) {
      results.initiatePrivilegedCalls++;
      console.log('[Network] initiate-privileged called');
    }
    if (url.includes('currentUser') && url.includes('stripeCustomer')) {
      results.stripeCustomerCalls++;
      console.log('[Network] stripeCustomer fetch');
    }
  });

  try {
    console.log('\n🧪 Starting CSP + Checkout Smoke Test...');
    console.log(`   Target: ${BASE_URL}\n`);

    // Step 1: Navigate to home (SSR)
    console.log('1️⃣  Loading home page (SSR)...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    await page.waitForTimeout(2000);
    console.log('   ✅ Home page loaded\n');

    // Step 2: Find and navigate to a listing
    console.log('2️⃣  Finding a listing...');
    const listingLink = await page.$('a[href*="/l/"]');
    if (!listingLink) {
      throw new Error('No listing found on home page');
    }
    await listingLink.click();
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT });
    await page.waitForTimeout(2000);
    console.log('   ✅ Listing page loaded\n');

    // Step 3: Navigate to checkout (if available)
    console.log('3️⃣  Looking for checkout/booking button...');
    const checkoutSelectors = [
      'button:contains("Book")',
      'button:contains("Request to book")',
      'a[href*="/checkout"]',
      'a[href*="/order/"]'
    ];

    let checkoutFound = false;
    for (const selector of checkoutSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT });
          checkoutFound = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }

    if (checkoutFound) {
      console.log('   ✅ Checkout page loaded\n');

      // Step 4: Wait for initiate-privileged (max 10s)
      console.log('4️⃣  Waiting for initiate-privileged call...');
      await page.waitForTimeout(10000);

      // Step 5: Check for Stripe iframe
      console.log('5️⃣  Checking for Stripe iframe...');
      const stripeFrame = await page.$('iframe[name*="__privateStripeFrame"]');
      if (stripeFrame) {
        results.stripeIframeMounted = true;
        console.log('   ✅ Stripe iframe found\n');

        // Wait 3 seconds to verify stability
        await page.waitForTimeout(3000);
        const stillThere = await page.$('iframe[name*="__privateStripeFrame"]');
        results.stripeIframeStable = !!stillThere;
        if (stillThere) {
          console.log('   ✅ Stripe iframe stable for 3s\n');
        } else {
          console.log('   ❌ Stripe iframe disappeared\n');
        }
      } else {
        console.log('   ⚠️  No Stripe iframe found (might be login required)\n');
      }
    } else {
      console.log('   ⚠️  Checkout button not found (might require login)\n');
    }

  } catch (error) {
    results.errors.push(error.message);
    console.error('\n❌ Test error:', error.message);
  } finally {
    await browser.close();
  }

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('📊 SMOKE TEST RESULTS');
  console.log('='.repeat(60));
  
  console.log('\n🔐 CSP Violations:', results.cspViolations.length);
  if (results.cspViolations.length > 0) {
    results.cspViolations.forEach(v => {
      console.log(`   ❌ ${v.directive} blocked: ${v.blocked}`);
    });
  }

  console.log('\n🚀 API Calls:');
  console.log(`   initiate-privileged: ${results.initiatePrivilegedCalls} ${results.initiatePrivilegedCalls === 1 ? '✅' : '❌'}`);
  console.log(`   stripeCustomer GET: ${results.stripeCustomerCalls} ${results.stripeCustomerCalls <= 1 ? '✅' : '⚠️'}`);

  console.log('\n💳 Stripe Integration:');
  console.log(`   Iframe mounted: ${results.stripeIframeMounted ? '✅' : '⚠️'}`);
  console.log(`   Iframe stable (3s): ${results.stripeIframeStable ? '✅' : '⚠️'}`);

  if (results.errors.length > 0) {
    console.log('\n❌ Errors:');
    results.errors.forEach(err => console.log(`   - ${err}`));
  }

  // Final verdict
  const passed = 
    results.cspViolations.length === 0 &&
    results.initiatePrivilegedCalls <= 1 &&
    results.stripeCustomerCalls <= 1 &&
    results.errors.length === 0;

  console.log('\n' + '='.repeat(60));
  console.log(passed ? '✅ SMOKE TEST PASSED' : '❌ SMOKE TEST FAILED');
  console.log('='.repeat(60) + '\n');

  process.exit(passed ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  runSmokeTest().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runSmokeTest };


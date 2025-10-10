#!/usr/bin/env node

/**
 * Smoke test: Verify that code-split chunks are served with correct MIME types
 * and content, not rewritten to index.html
 * 
 * Usage:
 *   node scripts/smoke-chunk-integrity.js
 *   
 * Environment:
 *   BASE_URL - Server URL to test (default: http://localhost:3000)
 * 
 * Exit codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const buildDir = path.join(__dirname, '..', 'build');

console.log('🔍 Chunk Integrity Smoke Test');
console.log('━'.repeat(60));
console.log(`Base URL: ${BASE_URL}`);
console.log(`Build dir: ${buildDir}`);
console.log('');

/**
 * Fetch a URL and return response details
 */
async function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body.slice(0, 500), // First 500 chars for inspection
          bodyLength: body.length,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Test a chunk URL
 */
async function testChunk(chunkPath, chunkName) {
  const url = `${BASE_URL}${chunkPath}`;
  console.log(`Testing: ${chunkName}`);
  console.log(`  URL: ${url}`);
  
  try {
    const res = await fetchUrl(url);
    
    // Check 1: HTTP 200
    if (res.status !== 200) {
      console.log(`  ❌ FAIL: Expected status 200, got ${res.status}`);
      return false;
    }
    console.log(`  ✅ Status: ${res.status}`);
    
    // Check 2: Content-Type must contain 'javascript' for .js files
    const contentType = res.headers['content-type'] || '';
    const isJS = chunkPath.endsWith('.js');
    const isCSS = chunkPath.endsWith('.css');
    
    if (isJS && !contentType.includes('javascript')) {
      console.log(`  ❌ FAIL: Expected Content-Type with 'javascript', got '${contentType}'`);
      return false;
    }
    
    if (isCSS && !contentType.includes('css')) {
      console.log(`  ❌ FAIL: Expected Content-Type with 'css', got '${contentType}'`);
      return false;
    }
    console.log(`  ✅ Content-Type: ${contentType}`);
    
    // Check 3: Body must NOT start with HTML (<!DOCTYPE or <html)
    if (res.body.trim().startsWith('<!DOCTYPE') || res.body.trim().startsWith('<html')) {
      console.log(`  ❌ FAIL: Response body is HTML, not JavaScript!`);
      console.log(`  Body preview: ${res.body.slice(0, 100)}`);
      return false;
    }
    
    // Check 4: For JS files, body should start with typical minified JS patterns
    if (isJS) {
      const startsWithValidJS = 
        res.body.trim().startsWith('(') ||
        res.body.trim().startsWith('{') ||
        res.body.trim().startsWith('[') ||
        res.body.trim().startsWith('!function') ||
        res.body.trim().startsWith('(function') ||
        res.body.trim().startsWith('/*') ||
        res.body.trim().startsWith('//') ||
        /^["']use strict["'];/.test(res.body.trim());
      
      if (!startsWithValidJS) {
        console.log(`  ⚠️  WARNING: Response doesn't look like JavaScript`);
        console.log(`  Body preview: ${res.body.slice(0, 100)}`);
        // Don't fail on this, just warn
      } else {
        console.log(`  ✅ Body starts with valid JS pattern`);
      }
    }
    
    // Check 5: Cache headers for /static/** should be immutable
    if (chunkPath.startsWith('/static/')) {
      const cacheControl = res.headers['cache-control'] || '';
      if (!cacheControl.includes('immutable') && !cacheControl.includes('max-age')) {
        console.log(`  ⚠️  WARNING: /static/** should have long-lived cache headers`);
        console.log(`  Cache-Control: ${cacheControl}`);
      } else {
        console.log(`  ✅ Cache-Control: ${cacheControl}`);
      }
    }
    
    console.log('');
    return true;
  } catch (err) {
    console.log(`  ❌ FAIL: ${err.message}`);
    console.log('');
    return false;
  }
}

/**
 * Test that a non-existent chunk returns 404, not index.html
 */
async function testNonExistentChunk() {
  const fakePath = '/static/js/FakeNonExistent.99999999.chunk.js';
  const url = `${BASE_URL}${fakePath}`;
  console.log(`Testing: Non-existent chunk (should 404)`);
  console.log(`  URL: ${url}`);
  
  try {
    const res = await fetchUrl(url);
    
    // Should be 404
    if (res.status === 404) {
      console.log(`  ✅ Status: 404 (correct)`);
      
      // Should NOT return HTML
      if (res.body.trim().startsWith('<!DOCTYPE') || res.body.trim().startsWith('<html')) {
        console.log(`  ❌ FAIL: 404 response is HTML (index.html fallback)!`);
        console.log(`  This is the bug we're trying to fix.`);
        return false;
      } else {
        console.log(`  ✅ 404 response is not HTML`);
        console.log('');
        return true;
      }
    } else {
      console.log(`  ❌ FAIL: Expected 404, got ${res.status}`);
      console.log('');
      return false;
    }
  } catch (err) {
    console.log(`  ❌ FAIL: ${err.message}`);
    console.log('');
    return false;
  }
}

/**
 * Main test runner
 */
async function main() {
  // Load asset manifest to find real chunks
  const manifestPath = path.join(buildDir, 'asset-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ asset-manifest.json not found at ${manifestPath}`);
    console.error('   Run "npm run build" first.');
    process.exit(1);
  }
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  
  // Pick some representative chunks to test
  const chunksToTest = [
    { name: 'Main JS bundle', path: manifest.files['main.js'] },
    { name: 'CheckoutPage JS chunk', path: manifest.files['CheckoutPage.js'] },
    { name: 'AuthenticationPage JS chunk', path: manifest.files['AuthenticationPage.js'] },
    { name: 'Main CSS bundle', path: manifest.files['main.css'] },
  ].filter(c => c.path); // Filter out any undefined
  
  console.log(`Found ${chunksToTest.length} chunks to test\n`);
  
  const results = [];
  
  // Test real chunks
  for (const chunk of chunksToTest) {
    const passed = await testChunk(chunk.path, chunk.name);
    results.push({ name: chunk.name, passed });
  }
  
  // Test non-existent chunk (404 behavior)
  const notFoundPassed = await testNonExistentChunk();
  results.push({ name: 'Non-existent chunk (404 test)', passed: notFoundPassed });
  
  // Summary
  console.log('━'.repeat(60));
  console.log('SUMMARY');
  console.log('━'.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.name}`);
  });
  
  console.log('');
  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('');
  
  if (failed > 0) {
    console.error('❌ CHUNK INTEGRITY CHECK FAILED');
    process.exit(1);
  } else {
    console.log('✅ ALL CHECKS PASSED');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});


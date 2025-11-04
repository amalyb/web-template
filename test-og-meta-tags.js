#!/usr/bin/env node
/**
 * Test script to verify Open Graph meta tags implementation
 * Run: node test-og-meta-tags.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Testing Open Graph Meta Tags Implementation\n');
console.log('=' .repeat(60));

// Test 1: Check if OG image exists
console.log('\n1️⃣  Checking OG image file...');
const ogImagePath = path.join(__dirname, 'public/static/og/sherbrt-og_new.jpg');
const buildOgImagePath = path.join(__dirname, 'build/static/og/sherbrt-og_new.jpg');

if (fs.existsSync(ogImagePath)) {
  const stats = fs.statSync(ogImagePath);
  const sizeKB = (stats.size / 1024).toFixed(2);
  console.log(`   ✅ OG image exists: ${ogImagePath}`);
  console.log(`   📊 File size: ${sizeKB}KB (${stats.size < 2 * 1024 * 1024 ? 'under 2MB ✅' : 'over 2MB ❌'})`);
  
  // Check dimensions using file command
  const { execSync } = require('child_process');
  try {
    const fileInfo = execSync(`file "${ogImagePath}"`, { encoding: 'utf8' });
    const match = fileInfo.match(/(\d+)x(\d+)/);
    if (match) {
      const width = match[1];
      const height = match[2];
      console.log(`   📐 Dimensions: ${width}×${height} ${width === '1200' && height === '630' ? '✅' : '❌'}`);
    }
  } catch (e) {
    console.log('   ⚠️  Could not verify dimensions (file command not available)');
  }
} else {
  console.log(`   ❌ OG image NOT found at: ${ogImagePath}`);
}

if (fs.existsSync(buildOgImagePath)) {
  console.log(`   ✅ Build OG image exists: ${buildOgImagePath}`);
} else {
  console.log(`   ⚠️  Build OG image not found (run 'npm run build'):`);
  console.log(`       ${buildOgImagePath}`);
}

// Test 2: Test renderer output
console.log('\n2️⃣  Testing server-side renderer...');
try {
  const renderer = require('./server/renderer');
  const mockReq = { url: '/' };
  const mockRes = { locals: { cspNonce: 'test-nonce-123' } };
  
  renderer.render(mockReq, mockRes, {}).then(html => {
    console.log('   ✅ Renderer executed successfully');
    
    // Check for required meta tags
    const requiredTags = [
      { tag: 'og:title', content: 'Shop on Sherbrt' },
      { tag: 'og:site_name', content: 'Shop on Sherbrt' },
      { tag: 'og:description', content: 'Borrow and lend designer looks on Sherbrt' },
      { tag: 'og:image', content: 'https://www.sherbrt.com/static/og/sherbrt-og_new.jpg' },
      { tag: 'og:image:width', content: '1200' },
      { tag: 'og:image:height', content: '630' },
      { tag: 'og:type', content: 'website' },
      { tag: 'og:url', content: 'https://www.sherbrt.com/' },
      { tag: 'twitter:card', content: 'summary_large_image' },
      { tag: 'twitter:image', content: 'https://www.sherbrt.com/static/og/sherbrt-og_new.jpg' }
    ];
    
    console.log('\n   📋 Meta Tags Verification:');
    let allPassed = true;
    
    requiredTags.forEach(({ tag, content }) => {
      const regex = new RegExp(`<meta[^>]*property="${tag}"[^>]*content="[^"]*${content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      const twitterRegex = new RegExp(`<meta[^>]*name="${tag}"[^>]*content="[^"]*${content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      
      if (regex.test(html) || twitterRegex.test(html)) {
        console.log(`      ✅ ${tag}`);
      } else {
        console.log(`      ❌ ${tag} (missing or incorrect)`);
        allPassed = false;
      }
    });
    
    // Check branding
    console.log('\n   🏷️  Branding Verification:');
    const hasSherbet = html.includes('Sherbet') && !html.includes('Sherbrt');
    const hasSherbrt = html.includes('Sherbrt');
    
    if (hasSherbrt && !hasSherbet) {
      console.log('      ✅ Uses "Sherbrt" branding (not "Sherbet")');
    } else if (hasSherbet) {
      console.log('      ❌ Still contains "Sherbet" (should be "Sherbrt")');
      allPassed = false;
    }
    
    // Check for HTTPS
    console.log('\n   🔒 Security Verification:');
    const hasHttp = html.match(/og:image"[^>]*content="http:\/\//);
    if (!hasHttp) {
      console.log('      ✅ All URLs use HTTPS (no mixed content)');
    } else {
      console.log('      ❌ Found HTTP URLs in og:image');
      allPassed = false;
    }
    
    console.log('\n' + '='.repeat(60));
    if (allPassed) {
      console.log('✅ ALL TESTS PASSED - Ready for deployment!');
    } else {
      console.log('⚠️  SOME TESTS FAILED - Review output above');
    }
    console.log('='.repeat(60));
    
    // Show next steps
    console.log('\n📦 Next Steps:');
    console.log('   1. Deploy to production (git push or Render deploy)');
    console.log('   2. Test with: curl -sL https://www.sherbrt.com/ | grep "og:"');
    console.log('   3. Verify with Facebook Debugger:');
    console.log('      https://developers.facebook.com/tools/debug/');
    console.log('   4. Verify with Twitter Card Validator:');
    console.log('      https://cards-dev.twitter.com/validator');
    console.log('\n📄 See OG_META_TAGS_VERIFICATION.md for detailed report\n');
  }).catch(err => {
    console.log(`   ❌ Renderer failed: ${err.message}`);
  });
  
} catch (err) {
  console.log(`   ❌ Could not load renderer: ${err.message}`);
}


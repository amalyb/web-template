#!/usr/bin/env node
/**
 * Flex API Diagnostic Script
 * 
 * Usage:
 *   source .env.test
 *   node server/scripts/flex-diagnose.js
 * 
 * This script performs comprehensive diagnostics on Sharetribe Flex API configuration:
 * 1. Environment variable audit (sanitized)
 * 2. Marketplace SDK probe (listings.query)
 * 3. Integration API direct auth probe (POST /v1/auth/token)
 * 4. Integration SDK probe (transactions.query)
 * 5. Root cause diagnosis
 */

const axios = require('axios');

// Utility functions for masking secrets
const mask = (v, prefix = 6, suffix = 4) => {
  if (!v) return '(not set)';
  if (v.length <= prefix + suffix) return v.slice(0, 2) + '…';
  return v.slice(0, prefix) + '…' + v.slice(-suffix);
};

const maskToken = (token) => {
  if (!token) return '(not set)';
  return token.slice(0, 8) + '…';
};

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const { red, green, yellow, blue, cyan, reset, bright } = colors;

// Section headers
const header = (title) => console.log(`\n${bright}${cyan}${'═'.repeat(70)}${reset}`);
const section = (title) => console.log(`${bright}${blue}${title}${reset}`);
const pass = (msg) => console.log(`${green}✓ PASS${reset} ${msg}`);
const fail = (msg) => console.log(`${red}✗ FAIL${reset} ${msg}`);
const warn = (msg) => console.log(`${yellow}⚠ WARN${reset} ${msg}`);
const info = (msg) => console.log(`${cyan}ℹ INFO${reset} ${msg}`);

// Exit codes
let exitCode = 0;

async function main() {
  console.log(`${bright}🔍 Sharetribe Flex API Diagnostic Tool${reset}`);
  console.log(`${cyan}Starting comprehensive diagnostics...${reset}\n`);

  // ============================================================================
  // STEP 1: Environment Variable Audit
  // ============================================================================
  header();
  section('1️⃣  ENVIRONMENT VARIABLE AUDIT');
  header();

  const env = {
    REACT_APP_SHARETRIBE_SDK_CLIENT_ID: process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID,
    SHARETRIBE_SDK_CLIENT_SECRET: process.env.SHARETRIBE_SDK_CLIENT_SECRET,
    INTEGRATION_CLIENT_ID: process.env.INTEGRATION_CLIENT_ID,
    INTEGRATION_CLIENT_SECRET: process.env.INTEGRATION_CLIENT_SECRET,
    SHARETRIBE_SDK_BASE_URL: process.env.SHARETRIBE_SDK_BASE_URL,
    REACT_APP_SHARETRIBE_SDK_BASE_URL: process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL,
    REACT_APP_MARKETPLACE_NAME: process.env.REACT_APP_MARKETPLACE_NAME,
  };

  const baseUrl = env.SHARETRIBE_SDK_BASE_URL || env.REACT_APP_SHARETRIBE_SDK_BASE_URL || 'https://flex-api.sharetribe.com';
  const expectedBaseUrl = 'https://flex-api.sharetribe.com';

  // Sanitized display
  console.log('');
  console.log(`${bright}Marketplace SDK Credentials:${reset}`);
  console.log(`  REACT_APP_SHARETRIBE_SDK_CLIENT_ID: ${mask(env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID)}`);
  console.log(`  SHARETRIBE_SDK_CLIENT_SECRET:       length=${env.SHARETRIBE_SDK_CLIENT_SECRET?.length || 0}`);
  
  console.log('');
  console.log(`${bright}Integration SDK Credentials:${reset}`);
  console.log(`  INTEGRATION_CLIENT_ID:              ${mask(env.INTEGRATION_CLIENT_ID)}`);
  console.log(`  INTEGRATION_CLIENT_SECRET:          length=${env.INTEGRATION_CLIENT_SECRET?.length || 0}`);
  
  console.log('');
  console.log(`${bright}Configuration:${reset}`);
  console.log(`  Base URL:                           ${baseUrl}`);
  console.log(`  Marketplace Name:                   ${env.REACT_APP_MARKETPLACE_NAME || '(not set)'}`);
  
  // Validation checks
  console.log('');
  console.log(`${bright}Validation Results:${reset}`);
  
  let checks = 0, passed = 0;

  // Check marketplace client ID format
  checks++;
  if (env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID && env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID.length > 10) {
    pass(`Marketplace client ID format (${mask(env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID)})`);
    passed++;
  } else {
    fail('Marketplace client ID missing or invalid');
    exitCode = 1;
  }

  // Check marketplace client secret
  checks++;
  if (env.SHARETRIBE_SDK_CLIENT_SECRET && env.SHARETRIBE_SDK_CLIENT_SECRET.length > 20) {
    pass(`Marketplace client secret (length=${env.SHARETRIBE_SDK_CLIENT_SECRET.length})`);
    passed++;
  } else {
    fail('Marketplace client secret missing or too short');
    exitCode = 1;
  }

  // Check integration client ID format
  checks++;
  if (env.INTEGRATION_CLIENT_ID) {
    if (env.INTEGRATION_CLIENT_ID.startsWith('flex-integration-api-client-')) {
      pass(`Integration client ID format (${mask(env.INTEGRATION_CLIENT_ID)})`);
      passed++;
    } else {
      fail(`Integration client ID must start with 'flex-integration-api-client-' (got: ${mask(env.INTEGRATION_CLIENT_ID, 10, 4)})`);
      exitCode = 1;
    }
  } else {
    warn('Integration client ID not set (optional but recommended for scripts)');
  }

  // Check integration client secret
  checks++;
  if (env.INTEGRATION_CLIENT_SECRET) {
    if (env.INTEGRATION_CLIENT_SECRET.length > 20) {
      pass(`Integration client secret (length=${env.INTEGRATION_CLIENT_SECRET.length})`);
      passed++;
    } else {
      fail('Integration client secret too short');
      exitCode = 1;
    }
  } else {
    warn('Integration client secret not set');
  }

  // Check base URL
  checks++;
  if (baseUrl === expectedBaseUrl) {
    pass(`Base URL correct: ${baseUrl}`);
    passed++;
  } else if (baseUrl.includes('/v1')) {
    fail(`Base URL must NOT include /v1 (got: ${baseUrl})`);
    info('SDK handles API versioning automatically');
    exitCode = 1;
  } else {
    warn(`Base URL non-standard: ${baseUrl} (expected: ${expectedBaseUrl})`);
  }

  // Check marketplace name
  checks++;
  if (env.REACT_APP_MARKETPLACE_NAME) {
    pass(`Marketplace name: "${env.REACT_APP_MARKETPLACE_NAME}"`);
    passed++;
  } else {
    warn('Marketplace name not set');
  }

  console.log('');
  console.log(`${bright}Environment Score: ${passed}/${checks} checks passed${reset}`);

  // ============================================================================
  // STEP 2: Marketplace SDK Probe
  // ============================================================================
  header();
  section('2️⃣  MARKETPLACE SDK PROBE');
  header();

  try {
    console.log('');
    info('Initializing Marketplace SDK...');
    const sharetribeSdk = require('sharetribe-flex-sdk');
    const marketplaceSdk = sharetribeSdk.createInstance({
      clientId: env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID,
      clientSecret: env.SHARETRIBE_SDK_CLIENT_SECRET,
      baseUrl: baseUrl,
      tokenStore: sharetribeSdk.tokenStore.memoryStore(),
    });

    info('Querying listings (perPage: 1)...');
    const listingsRes = await marketplaceSdk.listings.query({ perPage: 1 });
    
    const count = listingsRes.data.data.length;
    const meta = listingsRes.data.meta;
    
    pass(`Marketplace SDK query successful`);
    console.log(`  Listings returned: ${count}`);
    console.log(`  Total listings:    ${meta?.totalItems || 'unknown'}`);
    console.log(`  Per page:          ${meta?.perPage || 'unknown'}`);
    
  } catch (error) {
    fail('Marketplace SDK query failed');
    console.log(`  Status:  ${error.response?.status || 'unknown'}`);
    console.log(`  Message: ${error.message}`);
    
    if (error.response?.data) {
      console.log(`  Response:`, JSON.stringify(error.response.data, null, 2));
    }
    
    exitCode = 1;
  }

  // ============================================================================
  // STEP 3: Integration API Direct Auth Probe
  // ============================================================================
  header();
  section('3️⃣  INTEGRATION API DIRECT AUTH PROBE');
  header();

  if (!env.INTEGRATION_CLIENT_ID || !env.INTEGRATION_CLIENT_SECRET) {
    warn('Skipping Integration API probe (credentials not set)');
  } else {
    try {
      console.log('');
      info('Requesting Integration API token...');
      info(`Endpoint: ${baseUrl}/v1/auth/token`);
      info(`Grant type: client_credentials`);
      info(`Scope: integ`);
      
      const formData = new URLSearchParams();
      formData.append('grant_type', 'client_credentials');
      formData.append('client_id', env.INTEGRATION_CLIENT_ID);
      formData.append('client_secret', env.INTEGRATION_CLIENT_SECRET);
      formData.append('scope', 'integ');

      const authRes = await axios.post(`${baseUrl}/v1/auth/token`, formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      pass('Integration API auth successful');
      console.log(`  HTTP Status:    ${authRes.status}`);
      console.log(`  Access Token:   ${maskToken(authRes.data.access_token)}`);
      console.log(`  Token Type:     ${authRes.data.token_type || 'unknown'}`);
      console.log(`  Expires In:     ${authRes.data.expires_in || 'unknown'}s`);
      console.log(`  Scope:          ${authRes.data.scope || 'unknown'}`);
      
    } catch (error) {
      fail('Integration API auth failed');
      console.log(`  HTTP Status: ${error.response?.status || 'unknown'}`);
      console.log(`  Message:     ${error.message}`);
      
      if (error.response?.data) {
        console.log(`  Response:`, JSON.stringify(error.response.data, null, 2));
      }
      
      if (error.response?.status === 401 || error.response?.status === 403) {
        console.log('');
        warn('Authentication failed - check credentials in Flex Console:');
        console.log('  1. Go to Flex Console → Build → Integrations');
        console.log('  2. Verify Integration API client exists and is active');
        console.log('  3. Regenerate credentials if needed');
      }
      
      exitCode = 1;
    }
  }

  // ============================================================================
  // STEP 4: Integration SDK Probe
  // ============================================================================
  header();
  section('4️⃣  INTEGRATION SDK PROBE');
  header();

  if (!env.INTEGRATION_CLIENT_ID || !env.INTEGRATION_CLIENT_SECRET) {
    warn('Skipping Integration SDK probe (credentials not set)');
  } else {
    try {
      console.log('');
      info('Initializing Integration SDK...');
      const integrationSdk = require('sharetribe-flex-integration-sdk');
      const integSdk = integrationSdk.createInstance({
        clientId: env.INTEGRATION_CLIENT_ID,
        clientSecret: env.INTEGRATION_CLIENT_SECRET,
        baseUrl: baseUrl,
        tokenStore: integrationSdk.tokenStore.memoryStore(),
      });

      info('Querying transactions (perPage: 1)...');
      const txRes = await integSdk.transactions.query({ perPage: 1 });
      
      const count = txRes.data.data.length;
      const meta = txRes.data.meta;
      
      pass('Integration SDK query successful');
      console.log(`  Transactions returned: ${count}`);
      console.log(`  Total transactions:    ${meta?.totalItems || 'unknown'}`);
      console.log(`  Per page:              ${meta?.perPage || 'unknown'}`);
      
    } catch (error) {
      fail('Integration SDK query failed');
      console.log(`  Status:  ${error.response?.status || 'unknown'}`);
      console.log(`  Message: ${error.message}`);
      
      if (error.response?.data) {
        console.log(`  Response:`, JSON.stringify(error.response.data, null, 2));
        
        // Detailed error analysis
        const data = error.response.data;
        if (data.errors) {
          console.log('');
          console.log(`  ${bright}Error Details:${reset}`);
          data.errors.forEach((err, i) => {
            console.log(`    [${i}] ${err.title || 'Error'}`);
            if (err.detail) console.log(`        ${err.detail}`);
            if (err.source?.parameter) console.log(`        Parameter: ${err.source.parameter}`);
            if (err.code) console.log(`        Code: ${err.code}`);
          });
        }
      }
      
      exitCode = 1;
    }
  }

  // ============================================================================
  // STEP 5: Root Cause Diagnosis
  // ============================================================================
  header();
  section('5️⃣  DIAGNOSIS & RECOMMENDATIONS');
  header();

  console.log('');
  if (exitCode === 0) {
    pass('All probes successful! ✨');
    console.log('');
    console.log('Your Flex SDK configuration is working correctly.');
    console.log('If you\'re still seeing 400 errors in reminder scripts:');
    console.log('  1. Check transaction state matches transition requirements');
    console.log('  2. Verify transition names in process.edn match your code');
    console.log('  3. Ensure process is active in Flex Console');
    console.log('  4. Check transition parameters match process.edn exactly');
  } else {
    fail('Diagnostics revealed issues');
    console.log('');
    console.log(`${bright}Common Root Causes:${reset}`);
    console.log('');
    
    if (baseUrl.includes('/v1')) {
      console.log(`${red}1. BASE URL INCLUDES /v1${reset}`);
      console.log('   ❌ Wrong:   https://flex-api.sharetribe.com/v1');
      console.log('   ✅ Correct: https://flex-api.sharetribe.com');
      console.log('   Fix: Remove /v1 from SHARETRIBE_SDK_BASE_URL in .env.test');
      console.log('');
    }
    
    if (!env.INTEGRATION_CLIENT_ID?.startsWith('flex-integration-api-client-')) {
      console.log(`${red}2. INTEGRATION CLIENT ID FORMAT${reset}`);
      console.log('   Integration client IDs must start with: flex-integration-api-client-');
      console.log('   Check Flex Console → Build → Integrations');
      console.log('');
    }
    
    console.log(`${yellow}3. PARAMETER NAMING (per_page vs perPage)${reset}`);
    console.log('   Marketplace SDK: Use snake_case (per_page, created_at)');
    console.log('   Integration SDK: Use camelCase (perPage, createdAt)');
    console.log('');
    
    console.log(`${yellow}4. PERMISSIONS & PROCESS STATE${reset}`);
    console.log('   - Ensure Integration API client has operator/admin privileges');
    console.log('   - Check process is active in Flex Console');
    console.log('   - Verify transition names match process.edn exactly');
    console.log('   - Confirm transaction state allows the transition');
    console.log('');
    
    console.log(`${yellow}5. TRANSITION PARAMETERS${reset}`);
    console.log('   - Check required parameters in process.edn');
    console.log('   - Ensure parameter types match (amount should be Money type)');
    console.log('   - Verify protectedData structure if using metadata');
    console.log('');
  }

  header();
  console.log('');
  
  process.exit(exitCode);
}

// Run diagnostics
main().catch(err => {
  console.error(`\n${red}${bright}FATAL ERROR:${reset}`);
  console.error(err.stack);
  process.exit(1);
});


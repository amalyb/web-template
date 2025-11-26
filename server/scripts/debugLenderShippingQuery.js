#!/usr/bin/env node
/**
 * Debug script for Lender Shipping Reminders query
 * 
 * Runs ONLY the Flex query used to find "transactions that need lender shipping reminders"
 * Useful for debugging 403 errors and verifying SDK configuration.
 * 
 * Usage:
 *   npm run debug:lender-shipping-query
 * 
 * Environment Variables:
 *   Same as sendShippingReminders.js:
 *   - INTEGRATION_CLIENT_ID (preferred)
 *   - INTEGRATION_CLIENT_SECRET (preferred)
 *   - REACT_APP_SHARETRIBE_SDK_BASE_URL (optional)
 */
require('dotenv').config();

// Use the same SDK helper as sendShippingReminders.js
const getFlexSdk = require('../util/getFlexSdk');

async function debugLenderShippingQuery() {
  console.log('[debug] Starting lender shipping query debug...');
  
  try {
    // Initialize SDK using centralized helper (same as sendShippingReminders.js)
    const sdk = getFlexSdk();
    
    // Log Integration SDK configuration (non-secret)
    const integrationClientId = process.env.INTEGRATION_CLIENT_ID || 'MISSING';
    const integrationBaseUrl =
      process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL ||
      process.env.SHARETRIBE_SDK_BASE_URL ||
      process.env.FLEX_INTEGRATION_API_BASE_URL ||
      'MISSING';
    
    console.log('[debug] Integration env summary', {
      hasClientId: !!integrationClientId && integrationClientId !== 'MISSING',
      integrationClientIdPrefix: integrationClientId !== 'MISSING' ? integrationClientId.slice(0, 6) : null,
      integrationBaseUrl,
    });
    
    console.log('[debug] SDK initialized');
    
    // Same query as sendShippingReminders.js
    const query = {
      state: 'accepted',
      include: ['listing', 'provider', 'customer'],
      'fields.listing': 'title',
      'fields.provider': 'profile',
      'fields.customer': 'profile',
      per_page: 100
    };
    
    console.log('[debug] Executing query:', JSON.stringify(query, null, 2));
    
    try {
      const response = await sdk.transactions.query(query);
      const transactions = response?.data?.data || [];
      const included = new Map();
      for (const inc of response?.data?.included || []) {
        const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
        included.set(key, inc);
      }
      
      console.log(`\n[debug] ✅ Query succeeded!`);
      console.log(`[debug] Found ${transactions.length} accepted transactions`);
      
      // Log details of first few transactions
      const sampleSize = Math.min(5, transactions.length);
      console.log(`\n[debug] Sample transactions (first ${sampleSize}):`);
      
      for (let i = 0; i < sampleSize; i++) {
        const tx = transactions[i];
        const txId = tx?.id?.uuid || tx?.id;
        const state = tx?.attributes?.state;
        const protectedData = tx?.attributes?.protectedData || {};
        const outbound = protectedData.outbound || {};
        
        // Get provider info
        const providerRef = tx?.relationships?.provider?.data;
        const providerKey = providerRef ? `${providerRef.type}/${providerRef.id?.uuid || providerRef.id}` : null;
        const provider = providerKey ? included.get(providerKey) : null;
        const providerPhone = provider?.attributes?.profile?.protectedData?.phone ||
                             provider?.attributes?.profile?.protectedData?.phoneNumber ||
                             null;
        
        // Get listing info
        const listingRef = tx?.relationships?.listing?.data;
        const listingKey = listingRef ? `${listingRef.type}/${listingRef.id?.uuid || listingRef.id}` : null;
        const listing = listingKey ? included.get(listingKey) : null;
        const listingTitle = listing?.attributes?.title || 'unknown';
        
        console.log(`\n  [${i + 1}] Transaction ${txId}:`);
        console.log(`      State: ${state}`);
        console.log(`      Listing: ${listingTitle}`);
        console.log(`      Provider phone: ${providerPhone ? providerPhone.replace(/\d(?=\d{4})/g, '*') : 'MISSING'}`);
        console.log(`      Has outbound label: ${!!(outbound.labelUrl || outbound.qrCodeUrl || protectedData.outboundLabelUrl)}`);
        console.log(`      Has outbound tracking: ${!!(protectedData.outboundTrackingNumber || outbound.trackingNumber)}`);
      }
      
      if (transactions.length > sampleSize) {
        console.log(`\n[debug] ... and ${transactions.length - sampleSize} more transactions`);
      }
      
      console.log(`\n[debug] ✅ Debug complete - query is working!`);
      process.exit(0);
      
    } catch (queryError) {
      // Detailed error logging (same as sendShippingReminders.js)
      console.error('\n[debug] ❌ Query failed with error:');
      console.error('[debug] Flex query failed', {
        status: queryError.response && queryError.response.status,
        data: queryError.response && queryError.response.data,
        headers: queryError.response && queryError.response.headers && {
          'x-sharetribe-request-id': queryError.response.headers['x-sharetribe-request-id'],
        },
        message: queryError.message,
        code: queryError.code,
      });
      
      if (queryError.response) {
        console.error('\n[debug] Full error response:');
        console.error(JSON.stringify(queryError.response.data, null, 2));
      }
      
      throw queryError;
    }
    
  } catch (err) {
    // Detailed error logging
    console.error('\n[debug] ❌ Fatal error:');
    console.error('[debug] Flex query failed', {
      status: err.response && err.response.status,
      data: err.response && err.response.data,
      headers: err.response && err.response.headers && {
        'x-sharetribe-request-id': err.response.headers['x-sharetribe-request-id'],
      },
      message: err.message,
      code: err.code,
    });
    
    if (err.stack) {
      console.error('\n[debug] Stack trace:');
      console.error(err.stack);
    }
    
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  debugLenderShippingQuery()
    .then(() => {
      console.log('[debug] Script completed successfully');
    })
    .catch((error) => {
      console.error('[debug] Script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { debugLenderShippingQuery };

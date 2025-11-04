#!/usr/bin/env node
/**
 * Quick probe to test shipping estimate directly
 * Usage: node scripts/probe-shipping.js 94109 10014
 * 
 * Set DEBUG_SHIPPING_VERBOSE=1 to see detailed logs
 */

const { estimateRoundTrip } = require('../server/lib/shipping');

(async () => {
  const [lenderZip, borrowerZip] = process.argv.slice(2);
  
  if (!lenderZip || !borrowerZip) {
    console.error('Usage: node scripts/probe-shipping.js <lenderZip> <borrowerZip>');
    console.error('Example: node scripts/probe-shipping.js 94109 10014');
    process.exit(1);
  }

  console.log('[probe] Testing shipping estimate');
  console.log('[probe] Lender ZIP:', lenderZip);
  console.log('[probe] Borrower ZIP:', borrowerZip);
  console.log('[probe] DEBUG_SHIPPING_VERBOSE:', process.env.DEBUG_SHIPPING_VERBOSE === '1' ? 'ON' : 'OFF');
  console.log('[probe] SHIPPO_API_TOKEN:', process.env.SHIPPO_API_TOKEN ? 'SET' : 'NOT SET');
  console.log('');

  try {
    const est = await estimateRoundTrip({ 
      lenderZip, 
      borrowerZip, 
      parcel: null 
    });

    console.log('');
    console.log('[probe] ========== RESULT ==========');
    if (est) {
      console.log('[probe] ✅ SUCCESS');
      console.log('[probe] Amount:', `$${(est.amountCents / 100).toFixed(2)}`);
      console.log('[probe] Amount (cents):', est.amountCents);
      console.log('[probe] Currency:', est.currency);
      console.log('[probe] Debug:', est.debug);
    } else {
      console.log('[probe] ❌ FAILED - returned null');
      console.log('[probe] This will cause "calculated at checkout" fallback');
    }
    console.log('[probe] ================================');
    
    process.exit(est ? 0 : 1);
  } catch (err) {
    console.error('');
    console.error('[probe] ❌ ERROR:', err.message);
    console.error('[probe] Stack:', err.stack);
    process.exit(1);
  }
})();


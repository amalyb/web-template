#!/usr/bin/env node
/**
 * Replay a Shippo webhook to local dev server for testing
 * 
 * Usage:
 *   node server/scripts/replayShippoWebhook.js <payloadFile>
 * 
 * Example:
 *   node server/scripts/replayShippoWebhook.js server/scripts/sample-shippo-delivered.json
 * 
 * This script:
 * - Reads a JSON payload file (webhook structure)
 * - Sends POST to local dev server at /api/webhooks/shippo
 * - Bypasses signature verification (for local testing)
 * 
 * DEBUGGING ONLY - Do not use in production
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function main() {
  const payloadFile = process.argv[2];
  
  if (!payloadFile) {
    console.error('❌ Usage: node server/scripts/replayShippoWebhook.js <payloadFile>');
    console.error('   Example: node server/scripts/replayShippoWebhook.js server/scripts/sample-shippo-delivered.json');
    process.exit(1);
  }
  
  const fullPath = path.resolve(payloadFile);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ File not found: ${fullPath}`);
    process.exit(1);
  }
  
  try {
    console.log('🔍 [SHIPPO WEBHOOK REPLAY] Reading payload from:', fullPath);
    const payloadContent = fs.readFileSync(fullPath, 'utf8');
    const payload = JSON.parse(payloadContent);
    
    console.log('─'.repeat(80));
    console.log('📋 [SHIPPO WEBHOOK REPLAY] Payload Summary:');
    console.log('  tracking_number:', payload.data?.tracking_number || 'MISSING');
    console.log('  carrier:', payload.data?.carrier || 'MISSING');
    console.log('  tracking_status.status:', payload.data?.tracking_status?.status || 'MISSING');
    console.log('  metadata.transactionId:', payload.data?.metadata?.transactionId || payload.data?.metadata?.txId || 'MISSING');
    
    const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const webhookUrl = `${baseUrl}/api/webhooks/shippo`;
    
    console.log('\n📡 [SHIPPO WEBHOOK REPLAY] Sending webhook to:', webhookUrl);
    console.log('  Note: Signature verification will be skipped in dev mode');
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Note: We're not including X-Shippo-Signature header for local testing
        // The webhook handler will skip verification if SHIPPO_WEBHOOK_SECRET is not set
      },
      body: JSON.stringify(payload)
    });
    
    const responseText = await response.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch (e) {
      // Response is not JSON
    }
    
    console.log('\n✅ [SHIPPO WEBHOOK REPLAY] Response:');
    console.log('  Status:', response.status);
    console.log('  Status Text:', response.statusText);
    if (responseJson) {
      console.log('  Body:', JSON.stringify(responseJson, null, 2));
    } else {
      console.log('  Body:', responseText);
    }
    
    if (response.ok) {
      console.log('\n✅ [SHIPPO WEBHOOK REPLAY] Webhook processed successfully');
      console.log('  Check server logs for [SHIPPO DELIVERY DEBUG] messages');
    } else {
      console.log('\n❌ [SHIPPO WEBHOOK REPLAY] Webhook failed');
      console.log('  Check server logs for error details');
    }
    
    console.log('\n' + '─'.repeat(80));
    console.log('✅ [SHIPPO WEBHOOK REPLAY] Replay complete');
    
  } catch (error) {
    console.error('❌ [SHIPPO WEBHOOK REPLAY] Error:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

main();


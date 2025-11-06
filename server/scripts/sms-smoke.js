#!/usr/bin/env node

/**
 * SMS Smoke Test
 * 
 * Validates that SMS sending is properly configured and working.
 * 
 * Usage:
 *   DEBUG_SMS=1 node server/scripts/sms-smoke.js "Test message at $(date)"
 * 
 * Exit codes:
 *   0 - Success (SMS sent)
 *   1 - Configuration error (missing env vars)
 *   2 - SMS send failed (Twilio error)
 */

const path = require('path');

// Ensure we load from the correct location
const sendSMSModule = require('../api-util/sendSMS');
const sendSMS = sendSMSModule.sendSMS || sendSMSModule;

// --- Configuration Check ---
function checkConfig() {
  const errors = [];
  const warnings = [];
  
  if (!process.env.TWILIO_ACCOUNT_SID) {
    errors.push('TWILIO_ACCOUNT_SID is not set');
  } else if (!process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
    warnings.push(`TWILIO_ACCOUNT_SID doesn't start with 'AC' - may be invalid`);
  }
  
  if (!process.env.TWILIO_AUTH_TOKEN) {
    errors.push('TWILIO_AUTH_TOKEN is not set');
  }
  
  if (!process.env.TWILIO_MESSAGING_SERVICE_SID && !process.env.TWILIO_PHONE_NUMBER) {
    errors.push('Neither TWILIO_MESSAGING_SERVICE_SID nor TWILIO_PHONE_NUMBER is set');
  }
  
  if (process.env.SMS_DRY_RUN === '1') {
    warnings.push('SMS_DRY_RUN=1 - messages will NOT actually be sent');
  }
  
  return { errors, warnings };
}

// --- Main ---
async function main() {
  console.log('🧪 SMS Smoke Test\n');
  
  // Get test phone number and message from args
  const testPhone = process.env.TEST_PHONE || process.argv[2];
  const testMessage = process.argv[3] || process.argv[2] || 'Sherbrt SMS test';
  
  if (!testPhone || !testPhone.match(/\+?\d{10,15}/)) {
    console.error('❌ ERROR: Invalid or missing phone number');
    console.error('Usage: node server/scripts/sms-smoke.js "+15551234567" "Test message"');
    console.error('   Or: TEST_PHONE=+15551234567 node server/scripts/sms-smoke.js "Test message"');
    process.exit(1);
  }
  
  // Check configuration
  console.log('📋 Configuration Check:');
  const { errors, warnings } = checkConfig();
  
  console.log('  TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? '✅ Set' : '❌ Missing');
  console.log('  TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? '✅ Set' : '❌ Missing');
  console.log('  TWILIO_MESSAGING_SERVICE_SID:', process.env.TWILIO_MESSAGING_SERVICE_SID ? '✅ Set' : '⚠️  Not set');
  console.log('  TWILIO_PHONE_NUMBER:', process.env.TWILIO_PHONE_NUMBER ? '✅ Set' : '⚠️  Not set');
  console.log('  SMS_DRY_RUN:', process.env.SMS_DRY_RUN || 'not set');
  console.log('  DEBUG_SMS:', process.env.DEBUG_SMS || 'not set');
  console.log('');
  
  if (warnings.length > 0) {
    console.log('⚠️  Warnings:');
    warnings.forEach(w => console.log(`  - ${w}`));
    console.log('');
  }
  
  if (errors.length > 0) {
    console.error('❌ Configuration Errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    console.error('\n💡 Fix: Set the missing environment variables in your Render dashboard');
    console.error('   or in your local .env file for testing\n');
    process.exit(1);
  }
  
  // Attempt to send SMS
  console.log('📤 Sending test SMS...');
  console.log(`  To: ${testPhone}`);
  console.log(`  Message: "${testMessage}"\n`);
  
  try {
    const result = await sendSMS(testPhone, testMessage, {
      role: 'customer',
      transactionId: 'smoke-test',
      transition: 'test',
      tag: 'smoke_test',
      meta: { source: 'smoke-test-script' }
    });
    
    if (process.env.SMS_DRY_RUN === '1') {
      console.log('✅ DRY_RUN mode: SMS would have been sent');
      console.log('   Remove SMS_DRY_RUN=1 to actually send messages\n');
      process.exit(0);
    }
    
    if (result && result.suppressed) {
      console.log('⚠️  SMS was suppressed:', result.reason);
      console.log('   This may be expected depending on your configuration\n');
      process.exit(0);
    }
    
    if (result && result.sid) {
      console.log('✅ SUCCESS: SMS sent!');
      console.log(`  Twilio SID: ${result.sid}`);
      console.log(`  Status: ${result.status || 'queued'}`);
      console.log(`  Price: ${result.price || 'pending'} ${result.priceUnit || ''}`);
      console.log('\n💡 Check Twilio console for delivery status:');
      console.log(`   https://console.twilio.com/us1/monitor/logs/sms/${result.sid}\n`);
      process.exit(0);
    } else {
      console.log('⚠️  SMS function returned without error, but no SID received');
      console.log('   Result:', JSON.stringify(result, null, 2));
      console.log('   This may indicate SMS was skipped due to filters\n');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('❌ FAILED: SMS send error\n');
    console.error('Error details:');
    console.error('  Code:', error.code || 'unknown');
    console.error('  Status:', error.status || 'unknown');
    console.error('  Message:', error.message);
    
    if (error.moreInfo) {
      console.error('  More info:', error.moreInfo);
    }
    
    console.error('\n💡 Common issues:');
    console.error('  - 20003: Authentication failed - check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    console.error('  - 21608: Phone number is not verified (trial accounts)');
    console.error('  - 21211: Invalid phone number format (must be E.164: +1XXXXXXXXXX)');
    console.error('  - 20404: Phone number not found - check TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID');
    console.error('  - 401: Unauthorized - credentials may be incorrect or expired\n');
    
    if (error.code === 20003 || error.status === 401) {
      console.error('❌ Authentication failed - verify your Twilio credentials are correct\n');
    }
    
    process.exit(2);
  }
}

// Run it
main().catch(err => {
  console.error('❌ Unexpected error:', err);
  process.exit(2);
});


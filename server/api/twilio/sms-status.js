// server/api/twilio/sms-status.js
const express = require('express');
const { maskPhone } = require('../../api-util/phone');

// Twilio signature verification
function verifyTwilioSignature(req, authToken) {
  const twilioSignature = req.headers['x-twilio-signature'];
  if (!twilioSignature) {
    console.log('⚠️ No X-Twilio-Signature header found');
    return false;
  }
  
  if (!authToken) {
    console.log('⚠️ No TWILIO_AUTH_TOKEN configured');
    return false;
  }
  
  // Build the URL with query parameters
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('host');
  const fullUrl = `${protocol}://${host}${req.originalUrl}`;
  
  // Twilio's signature verification
  const crypto = require('crypto');
  const data = Object.keys(req.body)
    .sort()
    .map(key => `${key}=${req.body[key]}`)
    .join('');
  
  const signature = crypto
    .createHmac('sha1', authToken)
    .update(fullUrl + data)
    .digest('base64');
  
  const isValid = crypto.timingSafeEqual(
    Buffer.from(twilioSignature),
    Buffer.from(signature)
  );
  
  if (process.env.VERBOSE === '1') {
    console.log(`🔐 Twilio signature verification: ${isValid ? 'VALID' : 'INVALID'}`);
    console.log(`🔐 Expected: ${signature}`);
    console.log(`🔐 Received: ${twilioSignature}`);
  }
  
  return isValid;
}

module.exports = async (req, res) => {
  // Verify Twilio signature
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken && !verifyTwilioSignature(req, authToken)) {
    console.log('🚫 Invalid Twilio signature - rejecting request');
    return res.status(403).json({ error: 'Invalid signature' });
  }
  
  const { MessageSid, MessageStatus, ErrorCode, To } = req.body || {};
  
  // Enhanced delivery receipt logging
  const status = MessageStatus || 'unknown';
  const error = ErrorCode || '';
  const phone = To || 'unknown';
  
  console.log(`[DLR] ${phone} ${MessageSid} -> ${status} ${error}`);
  
  // Log specific error conditions
  if (status === 'delivered') {
    console.log(`✅ [DLR] Message delivered successfully to ${phone}`);
  } else if (status === 'undelivered' || status === 'failed') {
    if (error === '30007') {
      console.log(`🚫 [DLR] Carrier filtered message to ${phone} (content issue)`);
    } else if (error === '21610') {
      console.log(`🚫 [DLR] Recipient opted out: ${phone} must text START to resume`);
    } else {
      console.log(`❌ [DLR] Message failed to ${phone}: ${status} (${error})`);
    }
  }
  
  res.sendStatus(204);
};

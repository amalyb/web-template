#!/usr/bin/env node
/**
 * Resend delivery SMS to borrower for a specific transaction.
 *
 * Usage:
 *   node server/scripts/resendDeliverySms.js <txId>
 *
 * Options:
 *   FORCE_RESEND=1   Send even if shippingNotification.delivered.sent is already true
 */

require('dotenv').config();

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { SMS_TAGS } = require('../lib/sms/tags');
const { timestamp } = require('../util/time');
const sendSMS = require('../api-util/sendSMS').sendSMS;

function normalizePhoneNumber(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function getBorrowerPhone(tx) {
  // Priority order matches webhook handler
  const phoneFromProfile =
    tx.relationships?.customer?.data?.attributes?.profile?.protectedData?.phone;
  const phoneFromPd = tx.attributes?.protectedData?.customerPhone;
  const phoneFromMetadata = tx.attributes?.metadata?.customerPhone;

  return (
    normalizePhoneNumber(phoneFromProfile) ||
    normalizePhoneNumber(phoneFromPd) ||
    normalizePhoneNumber(phoneFromMetadata) ||
    null
  );
}

async function main() {
  const txId = process.argv[2];
  if (!txId) {
    console.error('Usage: node server/scripts/resendDeliverySms.js <txId>');
    process.exit(1);
  }

  const forceResend = process.env.FORCE_RESEND === '1';
  const integrationSdk = getIntegrationSdk();

  console.log('[RESEND-DELIVERY] Fetching transaction', txId);
  let tx;
  try {
    const res = await integrationSdk.transactions.show({
      id: txId,
      include: ['customer', 'listing'],
    });
    tx = res.data.data;
  } catch (error) {
    console.error('[RESEND-DELIVERY] Failed to fetch transaction:', error.message);
    process.exit(1);
  }

  const protectedData = tx.attributes?.protectedData || {};
  const deliveredSent = protectedData.shippingNotification?.delivered?.sent === true;
  if (deliveredSent && !forceResend) {
    console.log('[RESEND-DELIVERY] Delivery SMS already marked as sent. Set FORCE_RESEND=1 to override.');
    process.exit(0);
  }

  const borrowerPhone = getBorrowerPhone(tx);
  if (!borrowerPhone) {
    console.error('[RESEND-DELIVERY] No borrower phone found on transaction');
    process.exit(1);
  }

  const message =
    "🎁 Your Sherbrt borrow was delivered! 🍧 Don't forget to take pics and tag @shoponsherbrt while you're slaying in your borrowed fit! 📸✨";

  console.log('[RESEND-DELIVERY] Sending SMS to borrower', { to: borrowerPhone, txId });

  let smsResult;
  try {
    smsResult = await sendSMS(borrowerPhone, message, {
      role: 'customer',
      transactionId: tx.id,
      transition: 'script/resend-delivery-sms',
      tag: SMS_TAGS.DELIVERY_TO_BORROWER,
      meta: { listingId: tx.attributes?.listing?.id?.uuid || tx.attributes?.listing?.id },
    });
  } catch (err) {
    console.error('[RESEND-DELIVERY] Failed to send SMS:', err.message);
    process.exit(1);
  }

  if (smsResult?.skipped || smsResult?.suppressed) {
    console.log('[RESEND-DELIVERY] SMS skipped/suppressed', {
      reason: smsResult.reason || 'unknown',
    });
    process.exit(0);
  }

  if (smsResult?.sid) {
    console.log('[RESEND-DELIVERY] Twilio SID:', smsResult.sid);
  } else {
    console.log('[RESEND-DELIVERY] SMS send result:', smsResult);
  }

  // Mark as sent for idempotency when SMS actually went out
  try {
    const pdUpdate = {
      ...(protectedData || {}),
      lastTrackingStatus: {
        ...(protectedData.lastTrackingStatus || {}),
        status: 'DELIVERED',
        event: 'manual_resend',
        timestamp: timestamp(),
      },
      shippingNotification: {
        ...(protectedData.shippingNotification || {}),
        delivered: { sent: true, sentAt: timestamp() },
      },
    };

    await integrationSdk.transactions.transition({
      id: tx.id,
      transition: 'transition/store-shipping-urls',
      params: { protectedData: pdUpdate },
    });

    console.log('[RESEND-DELIVERY] Marked delivery SMS as sent in protectedData');
  } catch (updateError) {
    console.warn('[RESEND-DELIVERY] Failed to update protectedData:', updateError.message);
  }
}

main().catch(err => {
  console.error('[RESEND-DELIVERY] Unhandled error:', err);
  process.exit(1);
});


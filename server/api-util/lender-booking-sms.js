// Lender booking-request SMS dispatch.
//
// Extracted from server/api/initiate-privileged.js (May 8, 2026 dogfood):
// previously fired on transition/request-payment (pending-payment), which
// notified lenders the moment a borrower tapped Pay — even if the Stripe
// PaymentSheet was abandoned and the tx died at payment-expired (15min).
// Now invoked from server/scripts/processConfirmPaymentEvents.js, a cron
// poller that watches the Sharetribe Integration API events stream for
// transition/confirm-payment (preauthorized state). Sharetribe Flex has no
// webhooks; polling is the established repo pattern (see
// sendShippingReminders.js / sendLenderRequestReminders.js).
//
// Idempotency: the cron runs every 2 min with a 5-min overlap window, so
// any given transaction's confirm-payment event is observed multiple
// times. Redis key `lenderBookingSms:{txId}:sent` (7d TTL) is set only
// after a successful Twilio dispatch, so duplicates from window overlap
// or worker restarts are suppressed at the per-transaction granularity.

const { getIntegrationSdk } = require('./integrationSdk');
const { maskPhone } = require('./phone');
const { calculateTotalForProvider } = require('./lineItemHelpers');
const { formatMoneyServerSide } = require('./lenderEarnings');
const { shortLink } = require('./shortlink');
const { saleUrl } = require('../util/url');
const { getRedis } = require('../redis');

const SENT_TTL_SEC = 7 * 24 * 60 * 60;
const redisSentKey = txId => `lenderBookingSms:${txId}:sent`;

let sendSMS = null;
try {
  const smsModule = require('./sendSMS');
  sendSMS = smsModule.sendSMS;
} catch (error) {
  console.warn('⚠️ SMS module not available — SMS functionality disabled');
  sendSMS = () => Promise.resolve();
}

// 10.0 PR-4: operator-approved copy surfaces the 24h acceptance window at
// first contact, matching the v5 process.edn expire clause. Note the
// comma (not period) after the title — technical comma-splice but the
// approved template (April 23, 2026).
//
// Example final composed message:
//   Sherbrt 🍧: Monica wants to borrow your "Faille Halter Mini Dress",
//   You'll earn $48 💸🤑. You have 24hrs to accept: https://sherbrt.com/r/abc
async function buildLenderMsg(listingTitle, borrowerFirstName, payoutTotal, shortUrl) {
  const firstName = borrowerFirstName || 'Someone';
  const title = listingTitle || 'your listing';
  const formattedPayout = payoutTotal ? formatMoneyServerSide(payoutTotal) : null;

  let message = `Sherbrt 🍧: ${firstName} wants to borrow your "${title}"`;
  if (formattedPayout) {
    message += `, You'll earn ${formattedPayout} 💸🤑`;
  }
  message += `. You have 24hrs to accept: ${shortUrl}`;
  return message;
}

async function sendLenderBookingRequestSMS({ tx, listing, lineItems, sdk }) {
  console.log('📨 [SMS][booking-request] Preparing to send lender notification SMS');

  const txProviderId = tx?.relationships?.provider?.data?.id || null;
  const listingAuthorId = listing?.relationships?.author?.data?.id || null;
  const providerId = txProviderId || listingAuthorId;

  console.log('[SMS][booking-request] Provider ID resolution:', {
    txProviderId: txProviderId?.uuid || txProviderId,
    listingAuthorId: listingAuthorId?.uuid || listingAuthorId,
    chosenProviderId: providerId?.uuid || providerId,
  });

  if (!providerId) {
    console.warn('[SMS][booking-request] No provider ID from tx/listing; skipping lender SMS');
    return;
  }

  const iSdk = getIntegrationSdk();
  const idStr = providerId?.uuid ?? providerId;
  const prov = await iSdk.users.show({ id: idStr });
  const prof = prov?.data?.data?.attributes?.profile || null;

  console.log('[SMS][booking-request] Provider profile fields present:', {
    hasProtected: !!prof?.protectedData,
    hasPublic: !!prof?.publicData,
  });

  const provPhone =
    prof?.protectedData?.phone ??
    prof?.protectedData?.phoneNumber ??
    prof?.publicData?.phone ??
    prof?.publicData?.phoneNumber ??
    null;

  console.log('[SMS][booking-request] Provider phone (raw, masked):', maskPhone(provPhone));

  const borrowerId = tx?.relationships?.customer?.data?.id || null;
  if (borrowerId && (borrowerId?.uuid ?? borrowerId) === (providerId?.uuid ?? providerId)) {
    console.warn('[SMS][booking-request] Provider equals customer; aborting lender SMS');
    return;
  }
  if (!provPhone) {
    console.warn('[SMS][booking-request] Provider missing phone; skipping lender SMS');
    return;
  }

  let borrowerFirstName = null;
  if (borrowerId) {
    try {
      borrowerFirstName =
        tx?.relationships?.customer?.data?.attributes?.profile?.firstName ||
        tx?.relationships?.customer?.data?.attributes?.profile?.publicData?.firstName ||
        tx?.relationships?.customer?.data?.attributes?.profile?.protectedData?.firstName ||
        null;

      if (!borrowerFirstName) {
        const customer = await sdk.users.show({ id: borrowerId, include: ['profile'] });
        const customerProf = customer?.data?.data?.attributes?.profile;
        borrowerFirstName =
          customerProf?.firstName ||
          customerProf?.publicData?.firstName ||
          customerProf?.protectedData?.firstName ||
          null;
      }
    } catch (customerErr) {
      console.warn(
        '[SMS][booking-request] Could not fetch borrower profile for first name:',
        customerErr.message
      );
    }
  }

  if (!borrowerFirstName) {
    const txPD = tx?.attributes?.protectedData || {};
    const rawName = txPD?.customerName || null;
    if (typeof rawName === 'string' && rawName.trim()) {
      borrowerFirstName = rawName.trim().split(/\s+/)[0];
      console.log(
        '[SMS][booking-request] Extracted first name from customerName:',
        borrowerFirstName
      );
    }
  }

  let payoutTotal = null;
  try {
    const effectiveLineItems =
      Array.isArray(lineItems) && lineItems.length > 0 ? lineItems : tx?.attributes?.lineItems;
    if (effectiveLineItems && effectiveLineItems.length > 0) {
      payoutTotal = calculateTotalForProvider(effectiveLineItems);
      console.log('[SMS][booking-request] Calculated payout total:', payoutTotal);
    }
  } catch (payoutErr) {
    console.warn('[SMS][booking-request] Could not calculate payout:', payoutErr.message);
  }

  const txId = tx?.id?.uuid || tx?.id;
  const targetPath = `/sale/${txId}`;
  const fullSaleUrl = txId
    ? saleUrl(txId)
    : process.env.WEB_APP_URL || process.env.ROOT_URL || 'https://www.sherbrt.com';
  let shortUrl = fullSaleUrl;
  try {
    shortUrl = await shortLink(fullSaleUrl);
  } catch (shortLinkErr) {
    console.warn(
      '[SMS][booking-request] Could not generate short link, using full URL:',
      shortLinkErr.message
    );
  }

  console.log(
    '[SMS][booking-request][DEBUG] Lender link target:',
    targetPath,
    'shortUrl:',
    shortUrl
  );

  const listingTitle = listing?.attributes?.title || 'your listing';
  const formattedPayout = payoutTotal ? formatMoneyServerSide(payoutTotal) : null;
  console.log('[SMS][booking-request][DEBUG] SMS values:', {
    borrowerFirstName: borrowerFirstName || 'Someone (fallback)',
    listingTitle,
    formattedPayout: formattedPayout || 'N/A',
    shortUrl,
  });

  const txIdStr = tx?.id?.uuid || tx?.id;
  if (!txIdStr) {
    console.warn('[SMS][booking-request] Missing tx id; skipping lender SMS');
    return;
  }

  const redis = getRedis();
  const sentKey = redisSentKey(txIdStr);
  try {
    if (await redis.get(sentKey)) {
      console.log('[SMS][booking-request] duplicate suppressed (already sent):', sentKey);
      return;
    }
  } catch (redisErr) {
    console.warn('[SMS][booking-request] Redis check failed; proceeding without dedup:', redisErr.message);
  }

  try {
    const lenderMsg = await buildLenderMsg(listingTitle, borrowerFirstName, payoutTotal, shortUrl);
    await sendSMS(provPhone, lenderMsg, {
      role: 'lender',
      tag: 'booking_request_to_lender_alt',
      meta: { listingId: listing?.id?.uuid || listing?.id },
    });
    console.log(`📱 [SMS][booking-request] Lender notification sent to ${maskPhone(provPhone)}`);
    try {
      await redis.set(sentKey, new Date().toISOString(), 'EX', SENT_TTL_SEC);
    } catch (redisErr) {
      console.warn('[SMS][booking-request] Failed to persist dedup key:', redisErr.message);
    }
  } catch (e) {
    console.error('[SMS][booking-request] Lender SMS failed:', e.message);
  }
}

module.exports = { sendLenderBookingRequestSMS };

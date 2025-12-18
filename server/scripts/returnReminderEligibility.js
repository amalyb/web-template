#!/usr/bin/env node
/**
 * Return Reminder Eligibility Debugger
 *
 * Usage:
 *   node server/scripts/returnReminderEligibility.js <transaction-id> [--verbose]
 *
 * Prints a structured eligibility report for the return reminder cron logic.
 */
require('dotenv').config();

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const { getFirstChargeableLateDate } = require('../lib/businessDays');
const getFlexSdk = require('../util/getFlexSdk');

const TZ = 'America/Los_Angeles';
const argv = process.argv.slice(2);
const txId = argv[0];
const VERBOSE = argv.includes('--verbose');

if (!txId) {
  console.error('Usage: node server/scripts/returnReminderEligibility.js <transaction-id> [--verbose]');
  process.exit(1);
}

const maskPhone = (p) => (p ? p.replace(/\d(?=\d{4})/g, '*') : 'N/A');
const ymd = (d) => (d ? dayjs(d).tz(TZ).format('YYYY-MM-DD') : null);
const fmt = (d) => (d ? dayjs(d).tz(TZ).format() : 'N/A');

async function run() {
  const sdk = getFlexSdk();
  console.log('✅ SDK initialized (return reminder eligibility)');

  const now = dayjs().tz(TZ);
  const today = process.env.FORCE_TODAY || now.format('YYYY-MM-DD');
  const tomorrow = process.env.FORCE_TOMORROW || now.add(1, 'day').format('YYYY-MM-DD');
  const tMinus1 = dayjs(today).tz(TZ).subtract(1, 'day').format('YYYY-MM-DD');

  console.log('\n=== CURRENT TIME ===');
  console.log(`nowPT: ${now.format()}`);
  console.log(`t-1: ${tMinus1} | today: ${today} | tomorrow: ${tomorrow}`);

  console.log('\n=== FETCH ===');
  const res = await sdk.transactions.show({ id: txId, include: ['customer', 'listing'] });
  const tx = res?.data?.data;
  const included = new Map();
  for (const inc of res?.data?.included || []) {
    const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
    included.set(key, inc);
  }

  if (!tx) {
    console.error('❌ Transaction not found');
    process.exit(1);
  }

  const state = tx?.attributes?.state;
  const lastTransition = tx?.attributes?.lastTransition || 'unknown';
  const booking = tx?.attributes?.booking || {};
  const bookingStart = booking.start;
  const bookingEnd = booking.end;
  const deliveryEnd = tx?.attributes?.deliveryEnd || booking.end || null;
  const deliveryEndRaw = deliveryEnd;
  const deliveryEndNormalized = ymd(deliveryEnd);
  const firstChargeableLateDate = deliveryEndNormalized ? getFirstChargeableLateDate(deliveryEndNormalized) : null;

  console.log('\n=== TRANSACTION ===');
  console.log(`id: ${tx?.id?.uuid || tx?.id}`);
  console.log(`state: ${state}`);
  console.log(`lastTransition: ${lastTransition}`);
  console.log(`booking.start: ${bookingStart || 'N/A'} | PT: ${fmt(bookingStart)}`);
  console.log(`booking.end:   ${bookingEnd || 'N/A'} | PT: ${fmt(bookingEnd)}`);
  console.log(`deliveryEnd (raw): ${deliveryEndRaw || 'N/A'}`);
  console.log(`deliveryEnd (PT ymd): ${deliveryEndNormalized || 'N/A'}`);
  console.log(`firstChargeableLateDate: ${firstChargeableLateDate || 'N/A'}`);

  // Resolve customer + phone (checkout protectedData wins over profile)
  const custRef = tx?.relationships?.customer?.data;
  const custKey = custRef ? `${custRef.type}/${custRef.id?.uuid || custRef.id}` : null;
  const customer = custKey ? included.get(custKey) : null;
  const pd = tx?.attributes?.protectedData || {};
  const checkoutPhone =
    pd.customerPhone ||
    pd.phone ||
    pd.customer_phone ||
    pd?.checkoutDetails?.customerPhone ||
    pd?.checkoutDetails?.phone;
  const profilePhone =
    customer?.attributes?.profile?.protectedData?.phone ||
    customer?.attributes?.profile?.protectedData?.phoneNumber;
  const borrowerPhone = (checkoutPhone || profilePhone || '').trim();

  console.log('\n=== BORROWER PHONE ===');
  console.log(`checkout phone: ${checkoutPhone || 'N/A'}`);
  console.log(`profile phone:  ${profilePhone || 'N/A'}`);
  console.log(`selected:       ${borrowerPhone ? maskPhone(borrowerPhone) : 'MISSING'}`);

  const returnData = pd.return || {};
  console.log('\n=== RETURN DATA ===');
  console.log(`tMinus1SentAt: ${returnData.tMinus1SentAt || 'NOT SET'}`);
  console.log(`todayReminderSentAt: ${returnData.todayReminderSentAt || 'NOT SET'}`);
  console.log(`tomorrowReminderSentAt: ${returnData.tomorrowReminderSentAt || 'NOT SET'}`);
  console.log(`firstScanAt: ${returnData.firstScanAt || 'NOT SET'}`);
  console.log(`status: ${returnData.status || 'NOT SET'}`);
  console.log(`label?: ${returnData.label?.url || pd.returnQrUrl || pd.returnLabelUrl || 'MISSING'}`);

  console.log('\n=== ENV FLAGS ===');
  console.log(`SMS_DRY_RUN=${process.env.SMS_DRY_RUN || 'unset'}`);
  console.log(`ONLY_PHONE=${process.env.ONLY_PHONE || 'unset'}`);
  console.log(`TWILIO_ACCOUNT_SID=${process.env.TWILIO_ACCOUNT_SID ? 'set' : 'MISSING'}`);
  console.log(`TWILIO_AUTH_TOKEN=${process.env.TWILIO_AUTH_TOKEN ? 'set' : 'MISSING'}`);
  console.log(`TWILIO_MESSAGING_SERVICE_SID=${process.env.TWILIO_MESSAGING_SERVICE_SID ? 'set' : 'MISSING'}`);

  const reasons = [];

  if (state !== 'delivered') {
    reasons.push(`state=${state} (expected delivered)`);
  }

  const matchesTMinus1 = deliveryEndNormalized === tMinus1 || deliveryEndRaw === tMinus1;
  const matchesToday = deliveryEndNormalized === today || deliveryEndRaw === today;
  const matchesTomorrowChargeable = firstChargeableLateDate === today;
  const matchesCalendarTomorrow = deliveryEndNormalized === tomorrow || deliveryEndRaw === tomorrow;
  const matchesWindow = matchesTMinus1 || matchesToday || matchesTomorrowChargeable || matchesCalendarTomorrow;

  let reminderType = null;
  if (matchesTMinus1) reminderType = 'T-1';
  else if (matchesToday) reminderType = 'TODAY';
  else if (matchesTomorrowChargeable) reminderType = 'TOMORROW_CHARGEABLE';
  else if (matchesCalendarTomorrow) reminderType = 'TOMORROW';

  if (!matchesWindow) {
    reasons.push(`outside window (t-1/today/tomorrow/first-chargeable)`);
  }

  if (!borrowerPhone) {
    reasons.push('missing borrower phone');
  }

  if (process.env.ONLY_PHONE && borrowerPhone && borrowerPhone.trim() !== process.env.ONLY_PHONE.trim()) {
    reasons.push('ONLY_PHONE filter excludes borrower');
  }

  if (process.env.SMS_DRY_RUN === '1') {
    reasons.push('SMS_DRY_RUN=1 (would skip real send)');
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    reasons.push('Twilio credentials missing');
  }

  if (reminderType === 'T-1') {
    const hasLabel =
      pd.returnQrUrl ||
      pd.returnLabelUrl ||
      returnData.label?.url ||
      pd.returnLabel ||
      pd.shippingLabelUrl ||
      pd.returnShippingLabel;
    if (!hasLabel && !returnData.tMinus1SentAt) {
      reasons.push('no return label/QR for T-1');
    }
    if (returnData.tMinus1SentAt) reasons.push('tMinus1SentAt already set');
  }

  if (reminderType === 'TODAY') {
    if (returnData.todayReminderSentAt) reasons.push('todayReminderSentAt already set');
    if (
      returnData.firstScanAt ||
      returnData.status === 'accepted' ||
      returnData.status === 'in_transit'
    ) {
      reasons.push('package already scanned/status shipped (skip TODAY)');
    }
  }

  if (reminderType === 'TOMORROW_CHARGEABLE' || reminderType === 'TOMORROW') {
    if (returnData.tomorrowReminderSentAt) reasons.push('tomorrowReminderSentAt already set');
  }

  const eligible = reasons.length === 0;

  console.log('\n=== DECISION ===');
  console.log(`reminderType: ${reminderType || 'none'}`);
  if (VERBOSE) {
    console.log(`matches: T-1=${matchesTMinus1} TODAY=${matchesToday} CHARGEABLE=${matchesTomorrowChargeable} CAL_TOMORROW=${matchesCalendarTomorrow}`);
  }
  if (eligible) {
    console.log('ELIGIBLE = YES');
  } else {
    console.log(`ELIGIBLE = NO — reasons: ${reasons.join('; ')}`);
  }
}

run().catch((err) => {
  console.error('❌ Eligibility script failed:', err.message);
  if (err.response) {
    console.error('response status:', err.response.status);
    console.error('response data:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});

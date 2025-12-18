#!/usr/bin/env node
/**
 * Return Reminder Scope Report (last N days)
 *
 * Usage:
 *   node server/scripts/reportReturnReminderScope.js --days 14
 *
 * Produces CSV-like lines:
 * date,type,total,marked_sent,eligible_not_sent,top_reasons
 */
require('dotenv').config();

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const getFlexSdk = require('../util/getFlexSdk');
const { getFirstChargeableLateDate } = require('../lib/businessDays');

const TZ = 'America/Los_Angeles';
const argv = process.argv.slice(2);
const daysIdx = argv.indexOf('--days');
const DAYS = daysIdx >= 0 ? parseInt(argv[daysIdx + 1], 10) || 14 : 14;
const VERBOSE = argv.includes('--verbose');

const startDate = dayjs().tz(TZ).startOf('day').subtract(DAYS - 1, 'day');
const endDate = dayjs().tz(TZ).startOf('day');

const maskPhone = (p) => (p ? p.replace(/\d(?=\d{4})/g, '*') : 'N/A');
const ymd = (d) => (d ? dayjs(d).tz(TZ).format('YYYY-MM-DD') : null);

function buildPhone(tx, includedMap) {
  const pd = tx?.attributes?.protectedData || {};
  const custRef = tx?.relationships?.customer?.data;
  const custKey = custRef ? `${custRef.type}/${custRef.id?.uuid || custRef.id}` : null;
  const customer = custKey ? includedMap.get(custKey) : null;
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
  return { borrowerPhone, checkoutPhone, profilePhone };
}

function deriveReminders(due) {
  if (!due) return [];
  const dueYmd = ymd(due);
  if (!dueYmd) return [];
  return [
    { type: 'T-1', triggerDate: dayjs(dueYmd).tz(TZ).subtract(1, 'day').format('YYYY-MM-DD') },
    { type: 'TODAY', triggerDate: dueYmd },
    { type: 'TOMORROW_CHARGEABLE', triggerDate: getFirstChargeableLateDate(dueYmd) },
    { type: 'TOMORROW', triggerDate: dayjs(dueYmd).tz(TZ).add(1, 'day').format('YYYY-MM-DD') }, // legacy
  ];
}

function evaluateEligibility(tx, includedMap, reminderType) {
  const reasons = [];
  const state = tx?.attributes?.state;
  if (state !== 'delivered') reasons.push(`state=${state}`);

  const { borrowerPhone } = buildPhone(tx, includedMap);
  if (!borrowerPhone) reasons.push('missing borrower phone');
  if (process.env.ONLY_PHONE && borrowerPhone && borrowerPhone.trim() !== process.env.ONLY_PHONE.trim()) {
    reasons.push('ONLY_PHONE filter excludes borrower');
  }
  if (process.env.SMS_DRY_RUN === '1') reasons.push('SMS_DRY_RUN=1');
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    reasons.push('Twilio credentials missing');
  }

  const pd = tx?.attributes?.protectedData || {};
  const returnData = pd.return || {};
  if (reminderType === 'T-1') {
    const hasLabel =
      pd.returnQrUrl ||
      pd.returnLabelUrl ||
      returnData.label?.url ||
      pd.returnLabel ||
      pd.shippingLabelUrl ||
      pd.returnShippingLabel;
    if (!hasLabel && !returnData.tMinus1SentAt) reasons.push('no return label/QR for T-1');
    if (returnData.tMinus1SentAt) reasons.push('tMinus1SentAt already set');
  }
  if (reminderType === 'TODAY') {
    if (returnData.todayReminderSentAt) reasons.push('todayReminderSentAt already set');
    if (
      returnData.firstScanAt ||
      returnData.status === 'accepted' ||
      returnData.status === 'in_transit'
    ) {
      reasons.push('package already scanned/status shipped');
    }
  }
  if (reminderType === 'TOMORROW_CHARGEABLE' || reminderType === 'TOMORROW') {
    if (returnData.tomorrowReminderSentAt) reasons.push('tomorrowReminderSentAt already set');
  }
  return reasons;
}

async function fetchDeliveredTransactions() {
  const sdk = getFlexSdk();
  const perPage = 100;
  let page = 1;
  const results = [];
  let hasMore = true;

  while (hasMore) {
    const query = {
      state: 'delivered',
      include: ['customer'],
      per_page: perPage,
      page,
    };
    const res = await sdk.transactions.query(query);
    const txs = res?.data?.data || [];
    const included = new Map();
    for (const inc of res?.data?.included || []) {
      const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
      included.set(key, inc);
    }
    results.push({ txs, included });
    hasMore = txs.length === perPage;
    page += 1;
    if (page > 50) {
      console.warn('⚠️ Pagination safety stop at 50 pages');
      break;
    }
  }

  return results;
}

async function run() {
  console.log(`📈 Return reminder scope report for last ${DAYS} days (${startDate.format('YYYY-MM-DD')} → ${endDate.format('YYYY-MM-DD')})`);
  const pages = await fetchDeliveredTransactions();
  console.log(`Fetched ${pages.length} page(s) of delivered transactions`);

  const stats = new Map(); // key `${date}|${type}` => { total, sent, eligibleNotSent, reasons: Map }

  const withinWindow = (d) => {
    const dj = dayjs(d).tz(TZ).startOf('day');
    return !dj.isBefore(startDate) && !dj.isAfter(endDate);
  };

  for (const { txs, included } of pages) {
    for (const tx of txs) {
      const pd = tx?.attributes?.protectedData || {};
      const returnData = pd.return || {};
      const due = tx?.attributes?.deliveryEnd || tx?.attributes?.booking?.end;
      const reminders = deriveReminders(due);
      for (const { type, triggerDate } of reminders) {
        if (!withinWindow(triggerDate)) continue;
        const key = `${triggerDate}|${type}`;
        if (!stats.has(key)) {
          stats.set(key, { total: 0, sent: 0, eligibleNotSent: 0, reasons: new Map() });
        }
        const rec = stats.get(key);
        rec.total += 1;

        const sentFlag =
          (type === 'T-1' && returnData.tMinus1SentAt) ||
          (type === 'TODAY' && returnData.todayReminderSentAt) ||
          ((type === 'TOMORROW_CHARGEABLE' || type === 'TOMORROW') && returnData.tomorrowReminderSentAt);
        if (sentFlag) {
          rec.sent += 1;
          continue;
        }

        const reasons = evaluateEligibility(tx, included, type);
        if (reasons.length === 0) {
          rec.eligibleNotSent += 1;
        }
        for (const r of reasons) {
          rec.reasons.set(r, (rec.reasons.get(r) || 0) + 1);
        }
      }
    }
  }

  console.log('\nDATE,TYPE,TOTAL,MARKED_SENT,ELIGIBLE_NOT_SENT,TOP_REASONS');
  const sortedKeys = Array.from(stats.keys()).sort();
  for (const key of sortedKeys) {
    const [date, type] = key.split('|');
    const rec = stats.get(key);
    const reasonsSorted = Array.from(rec.reasons.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => `${reason}:${count}`)
      .join('|') || 'none';
    console.log(`${date},${type},${rec.total},${rec.sent},${rec.eligibleNotSent},${reasonsSorted}`);
  }

  if (VERBOSE) {
    console.log('\nDetailed reasons per bucket:');
    for (const key of sortedKeys) {
      const [date, type] = key.split('|');
      const rec = stats.get(key);
      console.log(`\n${date} ${type}`);
      for (const [reason, count] of rec.reasons.entries()) {
        console.log(`  - ${reason}: ${count}`);
      }
    }
  }
}

run().catch((err) => {
  console.error('❌ Scope report failed:', err.message);
  if (err.response) {
    console.error('response status:', err.response.status);
    console.error('response data:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});

#!/usr/bin/env node
require('dotenv').config();

let sendSMS = null;
try {
  const smsModule = require('../api-util/sendSMS');
  sendSMS = smsModule.sendSMS;
} catch (error) {
  console.warn('⚠️ SMS module not available — SMS functionality disabled');
  sendSMS = () => Promise.resolve();
}

// ✅ Use the correct SDK helper
const { getTrustedSdk } = require('../api-util/sdk');

// ---- CLI flags / env guards ----
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const getOpt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const DRY = has('--dry-run') || process.env.SMS_DRY_RUN === '1';
const VERBOSE = has('--verbose') || process.env.VERBOSE === '1';
const LIMIT = parseInt(getOpt('--limit', process.env.LIMIT || '0'), 10) || 0;
const ONLY_PHONE = process.env.ONLY_PHONE; // e.g. +15551234567 for targeted test

if (DRY) {
  const realSend = sendSMS;
  sendSMS = async (to, body, meta) => {
    console.log(`🧪 [DRY-RUN] Would send to ${to}: ${body}`);
    if (VERBOSE) console.log('meta:', meta);
    return { dryRun: true };
  };
}

function yyyymmdd(d) {
  return new Date(d).toISOString().split('T')[0];
}

async function sendReturnReminders() {
  console.log('🚀 Starting return reminder SMS script...');
  try {
    const sdk = await getTrustedSdk();
    console.log('✅ SDK initialized');

    // today/tomorrow window (allow overrides for testing)
    const today = process.env.FORCE_TODAY || yyyymmdd(Date.now());
    const tomorrow = process.env.FORCE_TOMORROW || yyyymmdd(Date.now() + 24 * 60 * 60 * 1000);
    console.log(`📅 Window: today=${today}, tomorrow=${tomorrow}`);

    // Query transactions; adjust query shape to your backend if needed
    const query = {
      state: 'delivered',
      deliveryEnd: [today, tomorrow],
      include: ['customer', 'listing'],
      perPage: 50,
    };

    const res = await sdk.transactions.query(query);
    const txs = res?.data?.data || [];
    const included = new Map();
    for (const inc of res?.data?.included || []) {
      // key like "user/UUID"
      const key = `${inc.type}/${inc.id?.uuid || inc.id}`;
      included.set(key, inc);
    }

    console.log(`📊 Found ${txs.length} candidate transactions`);

    let sent = 0, failed = 0, processed = 0;

    for (const tx of txs) {
      processed++;

      const deliveryEnd = tx?.attributes?.deliveryEnd;
      if (deliveryEnd !== today && deliveryEnd !== tomorrow) continue;

      // resolve customer from included
      const custRef = tx?.relationships?.customer?.data;
      const custKey = custRef ? `${custRef.type}/${custRef.id?.uuid || custRef.id}` : null;
      const customer = custKey ? included.get(custKey) : null;

      const borrowerPhone =
        customer?.attributes?.profile?.protectedData?.phone ||
        customer?.attributes?.profile?.protectedData?.phoneNumber ||
        null;

      if (!borrowerPhone) {
        console.warn(`⚠️ No borrower phone for tx ${tx?.id?.uuid || '(no id)'}`);
        continue;
      }

      if (ONLY_PHONE && borrowerPhone !== ONLY_PHONE) {
        if (VERBOSE) console.log(`↩️ Skipping ${borrowerPhone} (ONLY_PHONE=${ONLY_PHONE})`);
        continue;
      }

      // choose message
      let message;
      if (deliveryEnd === today) {
        // Try possible protectedData fields for return label URL:
        const pd = tx?.attributes?.protectedData || {};
        const returnLabelUrl =
          pd.returnLabelUrl || pd.returnLabel || pd.shippingLabelUrl || pd.returnShippingLabel;

        message = returnLabelUrl
          ? `📦 Today's the day! Ship your Sherbrt item back. Return label: ${returnLabelUrl}`
          : `📦 Today's the day! Ship your Sherbrt item back. Check your dashboard for return instructions.`;
      } else {
        message = `⏳ Your Sherbrt return is due tomorrow—please ship it back and submit pics & feedback.`;
      }

      if (VERBOSE) {
        console.log(`📬 To ${borrowerPhone} (tx ${tx?.id?.uuid || ''}) → ${message}`);
      }

      try {
        await sendSMS(borrowerPhone, message, { role: 'borrower', kind: 'return-reminder' });
        sent++;
      } catch (e) {
        console.error(`❌ SMS failed to ${borrowerPhone}:`, e?.message || e);
        failed++;
      }

      if (LIMIT && sent >= LIMIT) {
        console.log(`⏹️ Limit reached (${LIMIT}). Stopping.`);
        break;
      }
    }

    console.log(`\n📊 Done. Sent=${sent} Failed=${failed} Processed=${processed}`);
    if (DRY) console.log('🧪 DRY-RUN mode: no real SMS were sent.');
  } catch (err) {
    console.error('❌ Fatal:', err?.message || err);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  sendReturnReminders()
    .then(() => {
      console.log('🎉 Return reminder script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Return reminder script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { sendReturnReminders }; 
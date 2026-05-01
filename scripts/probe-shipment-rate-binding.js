#!/usr/bin/env node
/**
 * Probe: does USPS at /transactions/ validate against the rate's ORIGINAL
 * shipment, or against the shipment-being-purchased-against?
 *
 * Confirmed: USPS validates against the rate's ORIGINAL shipment.
 *   Step 1 reproduces the bug: ZIP-only ('N/A') checkout-time shipment +
 *   purchase its rate at /transactions/ → tx.status: ERROR with USPS
 *   "Address not found" message.
 *
 * Step 1.5 demonstrates the fix landed in commit 0f587f256 + this follow-up:
 *   create a SECOND shipment with FULL canonical addresses, find a rate in
 *   that fresh shipment matching the locked rate's provider+servicelevel.token,
 *   and purchase against the FRESH rate's object_id. Expected: tx.status:
 *   SUCCESS. The borrower-preauth amount stays at the locked-rate amount;
 *   any delta is logged and ops-alerted (if abs >= 200c).
 *
 * Usage:
 *   SHIPPO_API_TOKEN=<test-token> node scripts/probe-shipment-rate-binding.js
 *
 * Use a TEST-mode token (starts with shippo_test_). Production tokens are
 * blocked to avoid accidental live charges.
 */

const axios = require('axios');

const SHIPPO_BASE = 'https://api.goshippo.com';

function headers(token) {
  return {
    headers: {
      Authorization: `ShippoToken ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  };
}

const PARCEL = {
  length: '12',
  width: '10',
  height: '1',
  distance_unit: 'in',
  weight: '0.75',
  mass_unit: 'lb',
};

// Mirror server/lib/shipping.js#toShippoAddress — the exact shape that
// the checkout-time shipment uses.
function zipOnlyAddress({ name, zip, city, state }) {
  return {
    name,
    street1: 'N/A',
    city,
    state,
    zip,
    country: 'US',
    validate: false,
  };
}

// Full-address shape — what we'd build at accept time AFTER pre-validation
// via /addresses/?validate=true (server/shippo/validateAddress.js).
const FULL_FROM = {
  name: 'Lender',
  street1: '1745 Pacific Ave',
  city: 'San Francisco',
  state: 'CA',
  zip: '94109',
  country: 'US',
  phone: '+14155550111',
};
const FULL_TO = {
  name: 'Borrower',
  street1: '1795 Chestnut St',
  street2: 'Apt 7',
  city: 'San Francisco',
  state: 'CA',
  zip: '94123-2935', // canonical with ZIP+4 (what /addresses/?validate=true returns)
  country: 'US',
  phone: '+14155550222',
};

async function createShipment(token, addrFrom, addrTo, label) {
  const res = await axios.post(
    `${SHIPPO_BASE}/shipments/`,
    { address_from: addrFrom, address_to: addrTo, parcels: [PARCEL], async: false },
    headers(token),
  );
  console.log(`[probe] ${label} shipment_id: ${res.data.object_id}`);
  console.log(`[probe] ${label} address_from: ${addrFrom.street1}, ${addrFrom.city} ${addrFrom.zip}`);
  console.log(`[probe] ${label} address_to:   ${addrTo.street1}, ${addrTo.city} ${addrTo.zip}`);
  console.log(`[probe] ${label} rate count:   ${(res.data.rates || []).length}`);
  if (res.data.messages?.length) {
    console.log(`[probe] ${label} shipment messages:`, JSON.stringify(res.data.messages, null, 2));
  }
  return res.data;
}

async function purchase(token, rateId, label) {
  try {
    const res = await axios.post(
      `${SHIPPO_BASE}/transactions/`,
      { rate: rateId, async: false, label_file_type: 'PNG' },
      headers(token),
    );
    console.log(`[probe] ${label} tx.status: ${res.data.status}`);
    console.log(`[probe] ${label} tx.tracking_number: ${res.data.tracking_number || '(none)'}`);
    if (res.data.messages?.length) {
      console.log(`[probe] ${label} tx.messages:`, JSON.stringify(res.data.messages, null, 2));
    }
    return res.data;
  } catch (err) {
    console.error(`[probe] ${label} /transactions/ failed:`, err.response?.status, JSON.stringify(err.response?.data || err.message));
    return null;
  }
}

(async () => {
  const token = process.env.SHIPPO_API_TOKEN || process.env.SHIPPO_TOKEN;
  if (!token) {
    console.error('SHIPPO_API_TOKEN (or SHIPPO_TOKEN) required. Use a TEST-mode token.');
    process.exit(1);
  }
  if (!/^shippo_test_/.test(token)) {
    console.error('[probe] ABORT: token does not look like a test-mode token (must start with shippo_test_).');
    console.error('[probe] Production tokens are blocked to avoid live charges.');
    process.exit(2);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 1: replicate the production bug — checkout-shaped 'N/A' shipment
  // ────────────────────────────────────────────────────────────────────────
  console.log('[probe] === Step 1: create checkout-shaped shipment (street1:"N/A") ===');
  const fromZipOnly = zipOnlyAddress({ name: 'Sherbrt User', zip: FULL_FROM.zip, city: FULL_FROM.city, state: FULL_FROM.state });
  const toZipOnly = zipOnlyAddress({ name: 'Sherbrt User', zip: '94123', city: FULL_TO.city, state: FULL_TO.state });
  const checkoutShipment = await createShipment(token, fromZipOnly, toZipOnly, 'checkout');

  if (!(checkoutShipment.rates || []).length) {
    console.error('[probe] No rates on checkout shipment. Check carrier accounts in test mode. ABORT.');
    process.exit(3);
  }

  // Pick a USPS Ground Advantage rate if present (matches the failing prod
  // tx). Otherwise use cheapest.
  const lockedRate =
    checkoutShipment.rates.find(r => String(r.provider).toUpperCase() === 'USPS' && r.servicelevel?.token === 'usps_ground_advantage') ||
    checkoutShipment.rates.slice().sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0];

  console.log('[probe] locked rate:', {
    object_id: lockedRate.object_id,
    provider: lockedRate.provider,
    token: lockedRate.servicelevel?.token,
    name: lockedRate.servicelevel?.name,
    amount: lockedRate.amount,
  });

  console.log('\n[probe] === Step 2 (BUG REPRO): purchase locked rate from "N/A" shipment ===');
  const txCheckout = await purchase(token, lockedRate.object_id, 'checkout-rate');

  const checkoutFailed = txCheckout && txCheckout.status !== 'SUCCESS';
  const checkoutMsgText = JSON.stringify(txCheckout?.messages || []);
  const checkoutHitUspsAddrError = /address|usps|invalid|not found/i.test(checkoutMsgText);

  if (checkoutFailed && checkoutHitUspsAddrError) {
    console.log('[probe] ✅ Bug reproduced: USPS rejected the "N/A" rate at /transactions/.');
  } else if (txCheckout?.status === 'SUCCESS') {
    console.log('[probe] ⚠️  UNEXPECTED: purchase against "N/A" rate succeeded. Original task #29 premise was correct after all?');
  } else {
    console.log('[probe] ⚠️  Inconclusive: purchase failed but not for an address reason. Inspect tx.messages above.');
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 1.5: re-rate against a fresh full-address shipment
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n[probe] === Step 1.5: create fresh full-address shipment (canonical, ZIP+4) ===');
  const freshShipment = await createShipment(token, FULL_FROM, FULL_TO, 'fresh');

  if (!(freshShipment.rates || []).length) {
    console.error('[probe] No rates on fresh shipment. CANNOT verify re-rate fix. ABORT.');
    process.exit(4);
  }

  // findMatchingRate (same logic as transition-privileged.js#findMatchingRate)
  const lockedProvider = String(lockedRate.provider).toUpperCase();
  const lockedToken = lockedRate.servicelevel?.token;
  const matched = freshShipment.rates.find(r =>
    String(r.provider || r.carrier || '').toUpperCase() === lockedProvider &&
    (r.servicelevel?.token || r.service?.token) === lockedToken,
  );

  if (!matched) {
    console.error(`[probe] ❌ No matching service-level (${lockedProvider}/${lockedToken}) in fresh rates.`);
    console.error('[probe] Fresh options:', freshShipment.rates.map(r => `${r.provider}/${r.servicelevel?.token}@$${r.amount}`));
    console.error('[probe] In production, this would hard-fail with reason:"unprintable_at_accept" + ops alert.');
    process.exit(5);
  }

  console.log('[probe] matched fresh rate:', {
    object_id: matched.object_id,
    provider: matched.provider,
    token: matched.servicelevel?.token,
    amount: matched.amount,
  });

  const lockedAmountCents = Math.round(parseFloat(lockedRate.amount) * 100);
  const freshAmountCents = Math.round(parseFloat(matched.amount) * 100);
  const deltaCents = freshAmountCents - lockedAmountCents;
  console.log('[probe] amount delta:', { lockedAmountCents, freshAmountCents, deltaCents, alertThreshold: 200 });
  if (Math.abs(deltaCents) >= 200) {
    console.log('[probe] (would fire OPS_ALERT_EMAIL: delta exceeds $2 threshold)');
  }

  console.log('\n[probe] === Step 2 (FIX VERIFY): POST /transactions/ to purchase the FRESH rate ===');
  const txFresh = await purchase(token, matched.object_id, 'fresh-rate');

  console.log('\n[probe] === CONCLUSION ===');
  if (txFresh?.status === 'SUCCESS') {
    console.log('[probe] ✅ Re-rate fix verified: purchasing the fresh-shipment rate succeeded.');
    console.log('[probe] => Task #29 (with re-rate follow-up) is shippable.');
    console.log('[probe] => Borrower-preauth stays at lockedRate.amountCents; Sherbrt absorbs the delta.');
  } else {
    console.log('[probe] ❌ Re-rate fix did NOT work. Purchase against fresh-shipment rate also failed.');
    console.log('[probe] Inspect tx.messages above. ESCALATE before merging.');
    process.exit(6);
  }
})().catch(err => {
  console.error('[probe] FATAL:', err.message);
  process.exit(1);
});

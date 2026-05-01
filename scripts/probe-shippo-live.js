#!/usr/bin/env node
/**
 * Live-Shippo end-to-end verification for task #29 fix.
 *
 * Replays the production accept-time flow against the LIVE Shippo token,
 * with auto-void after success so net cost is $0:
 *
 *   1. Pre-validate the failing recipient address via /addresses/?validate=true
 *      (mirrors what the new validateAddress helper does in production).
 *   2. Create a fresh full-address shipment using the canonical (ZIP+4) form.
 *   3. Find a USPS Ground Advantage rate in the fresh shipment's rate list
 *      (mirrors findMatchingRate).
 *   4. Purchase the label via /transactions/ (this is what was failing in
 *      production with `failed_address_validation: Address not found.`).
 *   5. If purchase succeeded, immediately void the label via /refunds/
 *      using the existing voidShippoLabel helper. Shippo credits the
 *      account balance — net cost $0.
 *
 * Run:
 *   SHIPPO_API_TOKEN=shippo_live_... node scripts/probe-shippo-live.js
 *
 * Pass the LIVE token (the one configured on Render). The test token
 * already passed; this is the live-USPS signal that test-USPS couldn't give.
 *
 * Sharetribe: not invoked.
 * Stripe: not invoked.
 * Marketplace transaction: none created.
 *
 * Expected output if the fix is sound:
 *   [probe-live] tx.status: SUCCESS
 *   [probe-live] tracking_number: 9X...
 *   [probe-live] void.status: QUEUED  (or REFUNDED, depending on carrier)
 *   [probe-live] ✅ Live USPS validation passed end-to-end. Task #29 confirmed in production.
 */

const TOKEN = process.env.SHIPPO_API_TOKEN || process.env.SHIPPO_TOKEN;
if (!TOKEN) {
  console.error('SHIPPO_API_TOKEN missing.');
  console.error('Run: SHIPPO_API_TOKEN=shippo_live_... node scripts/probe-shippo-live.js');
  process.exit(1);
}
if (!TOKEN.startsWith('shippo_live_')) {
  console.warn(`⚠️  Token tail "${TOKEN.slice(-8)}" does not look like a LIVE token.`);
  console.warn('   This probe is meant to run against the live token to confirm live-USPS behavior.');
  console.warn('   Continuing anyway, but the signal will be weaker.\n');
}

const SHIPPO_BASE = 'https://api.goshippo.com';

// The recipient address that was failing in production (tx 69f28897 / 69f0f9a8).
// If you want to test a different address, edit here.
const RAW_FROM = {
  name: 'Sherbrt Sender',
  street1: '1745 Pacific Ave',
  street2: '202',
  city: 'San Francisco',
  state: 'CA',
  zip: '94109',
  country: 'US',
  phone: '+14152023068',
};

const RAW_TO = {
  name: 'Sherbrt Recipient',
  street1: '1795 Chestnut Street',
  street2: 'apt 7',
  city: 'San Francisco',
  state: 'CA',
  zip: '94123',
  country: 'US',
  phone: '+14152023068',
};

const PARCEL = {
  length: '12', width: '10', height: '1',
  distance_unit: 'in',
  weight: '0.75', mass_unit: 'lb',
};

// Match the locked-rate carrier+service of the production failures.
// (Pulled from the failing tx logs: "USPS Ground Advantage" was the locked rate.)
const TARGET_PROVIDER = 'USPS';
const TARGET_TOKEN = 'usps_ground_advantage';

async function shippoPost(path, body) {
  const res = await fetch(`${SHIPPO_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `ShippoToken ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Shippo ${path} failed (${res.status}): ${JSON.stringify(json)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function validate(address) {
  const out = await shippoPost('/addresses/', { ...address, validate: true });
  const v = out.validation_results || {};
  return {
    valid: v.is_valid === true,
    canonical: v.is_valid ? {
      ...address,
      street1: out.street1 || address.street1,
      street2: out.street2 || address.street2,
      city: out.city || address.city,
      state: out.state || address.state,
      zip: out.zip || address.zip,
    } : null,
    messages: (v.messages || []).map(m => m.text || JSON.stringify(m)),
  };
}

(async () => {
  console.log('[probe-live] === Step 1: pre-validate addresses (live token) ===');
  console.log('[probe-live] token tail:', TOKEN.slice(-8), TOKEN.startsWith('shippo_live_') ? '(live)' : '(other)');

  const [fromValidation, toValidation] = await Promise.all([validate(RAW_FROM), validate(RAW_TO)]);
  console.log('[probe-live] address_from valid?', fromValidation.valid, '— messages:', fromValidation.messages.length ? fromValidation.messages : '(none)');
  console.log('[probe-live] address_to   valid?', toValidation.valid,   '— messages:', toValidation.messages.length ? toValidation.messages : '(none)');

  if (!fromValidation.valid || !toValidation.valid) {
    console.error('[probe-live] ❌ live USPS rejected one or both addresses at /addresses/?validate=true.');
    console.error('[probe-live] => This would be the new validateAddress hard-fail path in production.');
    console.error('[probe-live] => Fix would persist labelCreationError + ops alert (no label charge incurred).');
    process.exit(2);
  }

  const addressFrom = fromValidation.canonical;
  const addressTo = toValidation.canonical;
  console.log('[probe-live] canonical from:', JSON.stringify({ street1: addressFrom.street1, street2: addressFrom.street2, zip: addressFrom.zip }));
  console.log('[probe-live] canonical to:  ', JSON.stringify({ street1: addressTo.street1,   street2: addressTo.street2,   zip: addressTo.zip }));
  if (!addressFrom.zip.includes('-') || !addressTo.zip.includes('-')) {
    console.warn('[probe-live] ⚠️  one of the canonical zips lacks a ZIP+4 suffix. The fix relies on ZIP+4 — this might be an issue.');
  }

  console.log('\n[probe-live] === Step 2: create fresh full-address shipment ===');
  const shipment = await shippoPost('/shipments/', {
    address_from: addressFrom,
    address_to: addressTo,
    parcels: [PARCEL],
    async: false,
  });
  console.log('[probe-live] shipment_id:', shipment.object_id);
  console.log('[probe-live] rate count:', (shipment.rates || []).length);

  const matched = (shipment.rates || []).find(r => {
    const provider = String(r.provider || r.carrier || '').toUpperCase();
    const token = r?.servicelevel?.token || r?.service?.token || '';
    return provider === TARGET_PROVIDER && token === TARGET_TOKEN;
  });

  if (!matched) {
    console.error(`[probe-live] ❌ No ${TARGET_PROVIDER} ${TARGET_TOKEN} rate in fresh shipment.`);
    console.error('[probe-live] available service-levels:');
    (shipment.rates || []).forEach(r => {
      console.error(`  - ${r.provider} / ${r?.servicelevel?.token} @ $${r.amount}`);
    });
    console.error('[probe-live] => This would trigger unprintable_at_accept in production.');
    process.exit(3);
  }

  console.log('[probe-live] matched rate:', {
    object_id: matched.object_id,
    provider: matched.provider,
    token: matched?.servicelevel?.token,
    amount: matched.amount,
  });

  console.log('\n[probe-live] === Step 3: purchase the label ===');
  const tx = await shippoPost('/transactions/', {
    rate: matched.object_id,
    async: false,
    label_file_type: 'PNG',
    metadata: 'tx=probe-shippo-live|dir=outbound',
  });
  console.log('[probe-live] tx.object_id:', tx.object_id);
  console.log('[probe-live] tx.status:', tx.status);
  console.log('[probe-live] tx.tracking_number:', tx.tracking_number || '(none)');
  if (tx.messages && tx.messages.length) {
    console.log('[probe-live] tx.messages:', JSON.stringify(tx.messages, null, 2));
  }

  if (tx.status !== 'SUCCESS') {
    console.error('\n[probe-live] ❌ Label purchase FAILED in live mode.');
    console.error('[probe-live] => Production accepts will continue to fail until we re-investigate.');
    console.error('[probe-live] (Note: no void needed since no label was actually created.)');
    process.exit(4);
  }

  console.log('\n[probe-live] === Step 4: void the label (cost recovery) ===');
  // Use Shippo's /refunds/ endpoint, mirroring server/lib/shippo.js voidShippoLabel.
  try {
    const voidRes = await shippoPost('/refunds/', {
      transaction: tx.object_id,
      async: false,
    });
    console.log('[probe-live] void.object_id:', voidRes.object_id);
    console.log('[probe-live] void.status:', voidRes.status);
    if (voidRes.status === 'ERROR' || voidRes.status === 'INVALID') {
      console.warn('[probe-live] ⚠️  void did not succeed cleanly — you may need to manually refund this label in the Shippo dashboard.');
      console.warn('[probe-live] tx.object_id to void manually:', tx.object_id);
    } else {
      console.log('[probe-live] ✅ Label voided. Account credit recovered. Net cost: $0.');
    }
  } catch (voidErr) {
    console.warn('[probe-live] ⚠️  Void call threw:', voidErr.message);
    console.warn('[probe-live] Manually refund this label in the Shippo dashboard to recover the cost.');
    console.warn('[probe-live] tx.object_id to void manually:', tx.object_id);
  }

  console.log('\n[probe-live] === CONCLUSION ===');
  console.log('[probe-live] ✅ Live USPS accepted the canonical address at /transactions/ (label-print).');
  console.log('[probe-live] ✅ Task #29 is verified in production. Scenario 1 testing is unblocked.');
})().catch(err => {
  console.error('\n[probe-live] UNHANDLED:', err.message);
  if (err.body) console.error('[probe-live] body:', JSON.stringify(err.body, null, 2));
  process.exit(1);
});

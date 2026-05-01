#!/usr/bin/env node
/**
 * Probe Shippo's address-validation endpoint with several variants of one
 * address to figure out which form USPS will actually accept at label-purchase
 * time. Pairs with task #29 (failed_address_validation: Recipient address
 * invalid: Address not found).
 *
 * This is read-only — it creates Address objects on Shippo with
 * validate=true, which does not buy a label and costs nothing. Test mode
 * (shippo_test_*) recommended.
 *
 * Required env (loaded from .env / .env.test via dotenv if present):
 *   SHIPPO_API_TOKEN    # any valid Shippo token (test or live)
 *
 * Usage:
 *   node scripts/probe-shippo-address.js
 *
 * Optionally pass a JSON address as argv[2] to override the default test
 * address:
 *   node scripts/probe-shippo-address.js '{"street1":"123 Main St", ...}'
 *
 * Output: for each variant, prints the Shippo Address.is_valid flag, any
 * validation messages, and the canonical normalized address Shippo returns
 * (so you can compare what we sent vs what USPS thinks it should be).
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.test', override: false });

const TOKEN = process.env.SHIPPO_API_TOKEN || process.env.SHIPPO_TOKEN;
if (!TOKEN) {
  console.error('SHIPPO_API_TOKEN missing. Source .env or .env.test first.');
  process.exit(1);
}

const BASE_ADDR = process.argv[2] ? JSON.parse(process.argv[2]) : {
  // Failing recipient address from CLAUDE_CONTEXT task #29.
  // Edit if your failing tx has different values.
  name: 'Sherbrt User',
  street1: '1795 Chestnut Street',
  street2: 'apt 7',
  city: 'San Francisco',
  state: 'CA',
  zip: '94123',
  country: 'US',
};

// Generate plausible normalization variants. We test:
//   1. as-is (raw form input)
//   2. Street -> St
//   3. apt 7 -> Apt 7
//   4. Street -> St AND apt -> Apt
//   5. street2 packed into street1 ("1795 Chestnut St Apt 7", street2 empty)
//   6. uppercase the whole thing
//   7. remove street2 entirely (just to confirm whether the building itself validates)
function variants(a) {
  const fixStreet = s => (s || '').replace(/\bStreet\b/i, 'St').replace(/\bAvenue\b/i, 'Ave').replace(/\bBoulevard\b/i, 'Blvd');
  const fixUnit = s => (s || '').replace(/^apt\s+/i, 'Apt ').replace(/^ste\s+/i, 'Ste ').replace(/^suite\s+/i, 'Suite ');
  const upper = s => (s || '').toUpperCase();

  const out = [];
  out.push({ label: '1. as-typed (raw)', addr: { ...a } });
  out.push({ label: '2. Street→St on street1', addr: { ...a, street1: fixStreet(a.street1) } });
  out.push({ label: '3. apt 7→Apt 7 on street2', addr: { ...a, street2: fixUnit(a.street2) } });
  out.push({ label: '4. Street→St AND apt→Apt', addr: { ...a, street1: fixStreet(a.street1), street2: fixUnit(a.street2) } });
  out.push({ label: '5. street2 packed into street1', addr: { ...a, street1: `${fixStreet(a.street1)} ${fixUnit(a.street2)}`.trim(), street2: '' } });
  out.push({ label: '6. uppercase everything', addr: { ...a, street1: upper(fixStreet(a.street1)), street2: upper(fixUnit(a.street2)), city: upper(a.city), state: upper(a.state) } });
  out.push({ label: '7. building only (no apt)', addr: { ...a, street2: '' } });
  return out;
}

async function probe(label, addr) {
  const body = { ...addr, validate: true };
  const res = await fetch('https://api.goshippo.com/addresses/', {
    method: 'POST',
    headers: {
      'Authorization': `ShippoToken ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  const isValid = json?.validation_results?.is_valid;
  const messages = (json?.validation_results?.messages || []).map(m => m.text || JSON.stringify(m));
  console.log('\n' + label);
  console.log('  sent: ', JSON.stringify({ street1: addr.street1, street2: addr.street2, city: addr.city, state: addr.state, zip: addr.zip }));
  console.log('  http: ', res.status);
  console.log('  is_valid: ', isValid);
  console.log('  messages:', messages.length ? messages : '(none)');
  if (json?.street1 || json?.zip) {
    console.log('  shippo-normalized:', JSON.stringify({ street1: json.street1, street2: json.street2, city: json.city, state: json.state, zip: json.zip }));
  }
}

(async () => {
  console.log('Probing Shippo /addresses/?validate=true for address variants…');
  console.log('Token tail:', String(TOKEN).slice(-8));
  console.log('Base address:', JSON.stringify(BASE_ADDR, null, 2));
  for (const v of variants(BASE_ADDR)) {
    try {
      await probe(v.label, v.addr);
    } catch (e) {
      console.log('\n' + v.label + ' — error:', e.message);
    }
  }
})();

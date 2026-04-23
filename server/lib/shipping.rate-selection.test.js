/**
 * PR-1 (10.0): rate-selection helpers.
 *
 * Covers three things added/fixed in PR-1:
 *   1. `pickCheapestPreferredRate` (new helper in shipping.js) — used by
 *      return-label purchase at transition-privileged.js:1138.
 *   2. `estimateOneWay` nameOf regression — modern Shippo SDK returns
 *      `{ provider, servicelevel: { name } }`. Old builder read `r.service`
 *      (usually undefined), so filter matched nothing and fallback silently
 *      picked cheapest-of-all. Regression test asserts the fix filters
 *      correctly against the modern shape.
 *   3. (No direct test of `pickCheapestAllowedRate` here — it's exercised
 *      by the transition-privileged integration tests. Its signature change
 *      is covered implicitly by the new outbound caller at line 585.)
 */

const { pickCheapestPreferredRate } = require('./shipping');

const PREFERRED = [
  'USPS Priority Mail',
  'USPS Ground Advantage',
  'USPS Priority Mail Express',
  'UPS Ground',
  'UPS 2nd Day Air',
  'UPS Next Day Air Saver',
];

// Modern Shippo SDK rate shape
const rate = (provider, serviceName, amount, token = '') => ({
  provider,
  servicelevel: { name: serviceName, token },
  amount: String(amount),
});

describe('pickCheapestPreferredRate', () => {
  test('returns cheapest preferred when all rates are in the list', () => {
    const rates = [
      rate('USPS', 'Priority Mail', '8.50'),
      rate('UPS', 'Ground', '7.20'),
      rate('USPS', 'Ground Advantage', '6.80'),
    ];
    const chosen = pickCheapestPreferredRate(rates, PREFERRED);
    expect(chosen.provider).toBe('USPS');
    expect(chosen.servicelevel.name).toBe('Ground Advantage');
    expect(chosen.amount).toBe('6.80');
  });

  test('ignores non-preferred services when preferred matches exist', () => {
    const rates = [
      rate('FedEx', 'Express Saver', '5.50'), // NOT in preferred
      rate('USPS', 'Priority Mail', '8.50'),
      rate('UPS', 'Ground', '7.20'),
    ];
    const chosen = pickCheapestPreferredRate(rates, PREFERRED);
    // FedEx is cheaper but not preferred → should pick UPS Ground
    expect(chosen.provider).toBe('UPS');
    expect(chosen.servicelevel.name).toBe('Ground');
  });

  test('falls back to cheapest-of-all when no rates match preferred', () => {
    const rates = [
      rate('FedEx', 'Express Saver', '12.00'),
      rate('DHL', 'Ground', '9.50'),
    ];
    const chosen = pickCheapestPreferredRate(rates, PREFERRED);
    expect(chosen.provider).toBe('DHL');
  });

  test('returns null on empty input', () => {
    expect(pickCheapestPreferredRate([], PREFERRED)).toBeNull();
    expect(pickCheapestPreferredRate(null, PREFERRED)).toBeNull();
    expect(pickCheapestPreferredRate(undefined, PREFERRED)).toBeNull();
  });

  test('empty preferredServices skips filtering (returns cheapest overall)', () => {
    const rates = [
      rate('FedEx', 'Express Saver', '5.50'),
      rate('USPS', 'Priority Mail', '8.50'),
    ];
    const chosen = pickCheapestPreferredRate(rates, []);
    expect(chosen.provider).toBe('FedEx');
  });

  test('handles legacy r.service shape (back-compat)', () => {
    const legacyRates = [
      { provider: 'USPS', service: { name: 'Priority Mail' }, amount: '8.50' },
      { provider: 'UPS', service: { name: 'Ground' }, amount: '7.20' },
    ];
    const chosen = pickCheapestPreferredRate(legacyRates, PREFERRED);
    expect(chosen.provider).toBe('UPS');
    expect(chosen.service.name).toBe('Ground');
  });
});

describe('PR-1 regression: config contains 6 preferred services', () => {
  test('config file lists all 6 services in the expected order', () => {
    const config = require('../config/shipping');
    expect(config.preferredServices).toEqual([
      'USPS Priority Mail',
      'USPS Ground Advantage',
      'USPS Priority Mail Express',
      'UPS Ground',
      'UPS 2nd Day Air',
      'UPS Next Day Air Saver',
    ]);
  });
});

describe('PR-1 regression: estimateOneWay name-builder handles modern Shippo shape', () => {
  // Source-level assertion — not a behavioral test. The function is network-
  // bound (calls Shippo), so we verify the builder string by regex. This
  // catches accidental reverts to the old broken shape.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, 'shipping.js'), 'utf8');

  test('nameOf in estimateOneWay reads r.servicelevel?.name', () => {
    // The filter section inside estimateOneWay. There's also a nameOf inside
    // pickCheapestPreferredRate which is fine — both must read servicelevel.
    const matches = src.match(/r\.servicelevel\?\.name/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('old broken builder pattern is gone', () => {
    // Old pattern: `r.service || r.provider_service` without servicelevel
    // fallback first. Modern SDK returns servicelevel.name — this pattern
    // should not appear anywhere in shipping.js anymore.
    expect(src).not.toMatch(/\(r\.service\s*\|\|\s*r\.provider_service/);
  });

  test('nameOf strips trademark symbols (® U+00AE, ™ U+2122)', () => {
    // Every nameOf in shipping.js must apply the trademark strip. Live
    // Shippo probe (2026-04-23) confirmed UPS returns service names with ®
    // (e.g., "UPS 2nd Day Air®", "UPS Next Day Air Saver®"). Without this
    // regex, those names wouldn't match the ASCII-only preferredServices
    // config entries.
    const replaceMatches = src.match(/\.replace\(\/\[®™\]\/g, ''\)/g) || [];
    expect(replaceMatches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PR-1: trademark-symbol strip (regression for live Shippo probe 2026-04-23)', () => {
  // Behavioral test of pickCheapestPreferredRate: passing a rate whose
  // servicelevel.name contains ® should match the ASCII-only config entry
  // after the strip. Before the Option B fix, this would fail and the rate
  // would fall through to the cheapest-of-all fallback.
  const { pickCheapestPreferredRate } = require('./shipping');

  test("rate with 'UPS 2nd Day Air®' matches config 'UPS 2nd Day Air' after strip", () => {
    const rates = [
      // A cheaper non-preferred rate that should be filtered OUT
      {
        provider: 'FedEx',
        servicelevel: { name: 'Express Saver', token: 'fedex_express_saver' },
        amount: '5.00',
      },
      // The rate we care about — has ® in name
      {
        provider: 'UPS',
        servicelevel: { name: '2nd Day Air®', token: 'ups_second_day_air' },
        amount: '13.24',
      },
    ];
    const preferred = ['UPS 2nd Day Air']; // ASCII — as written in config
    const chosen = pickCheapestPreferredRate(rates, preferred);
    expect(chosen).not.toBeNull();
    expect(chosen.provider).toBe('UPS');
    expect(chosen.servicelevel.token).toBe('ups_second_day_air');
    // FedEx Express Saver was cheaper but not in preferred set → not chosen.
    expect(chosen.provider).not.toBe('FedEx');
  });

  test("rate with 'UPS Next Day Air Saver®' matches config 'UPS Next Day Air Saver'", () => {
    const rates = [
      {
        provider: 'UPS',
        servicelevel: { name: 'Next Day Air Saver®', token: 'ups_next_day_air_saver' },
        amount: '44.30',
      },
    ];
    const chosen = pickCheapestPreferredRate(rates, ['UPS Next Day Air Saver']);
    expect(chosen).not.toBeNull();
    expect(chosen.servicelevel.token).toBe('ups_next_day_air_saver');
  });

  test('™ (U+2122) is also stripped', () => {
    const rates = [
      {
        provider: 'SomeCarrier',
        servicelevel: { name: 'Premium™', token: 'some_premium' },
        amount: '10.00',
      },
    ];
    const chosen = pickCheapestPreferredRate(rates, ['SomeCarrier Premium']);
    expect(chosen).not.toBeNull();
    expect(chosen.servicelevel.token).toBe('some_premium');
  });

  test('plain ASCII names (no trademark) still match correctly', () => {
    const rates = [
      {
        provider: 'USPS',
        servicelevel: { name: 'Priority Mail', token: 'usps_priority' },
        amount: '12.48',
      },
    ];
    const chosen = pickCheapestPreferredRate(rates, ['USPS Priority Mail']);
    expect(chosen).not.toBeNull();
    expect(chosen.servicelevel.token).toBe('usps_priority');
  });
});

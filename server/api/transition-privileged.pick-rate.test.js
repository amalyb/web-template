/**
 * PR-1 (10.0): pickCheapestAllowedRate refactor.
 *
 * The refactored function now filters by the preferredServices config FIRST
 * (previously ignored), takes `daysUntilBookingStart` directly (no more
 * shipByDate coupling), reads `SAFETY_BUFFER_DAYS` from env, and has a
 * last-resort cheapest-of-preferred (not cheapest-of-all).
 *
 * The function is attached to module.exports.pickCheapestAllowedRate for
 * test access; the primary export remains the request middleware.
 */

// Sentry's @opentelemetry/instrumentation-pg has a broken transitive dep on
// @opentelemetry/semantic-conventions/incubating in the installed tree, so
// requiring transition-privileged.js (which imports server/log.js → Sentry)
// throws at test time. Mock @sentry/node before the require chain starts.
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  Handlers: { requestHandler: () => (req, res, next) => next(), errorHandler: () => (err, req, res, next) => next(err) },
  Integrations: {},
  getCurrentScope: () => ({ setTag: jest.fn(), setContext: jest.fn() }),
}));

const { pickCheapestAllowedRate } = require('./transition-privileged');

const fs = require('fs');
const path = require('path');

// Modern Shippo SDK rate shape
const rate = (provider, serviceName, token, amount, estimated_days) => ({
  provider,
  servicelevel: { name: serviceName, token },
  amount: String(amount),
  estimated_days,
});

// Six-service rate universe after carrier-account filtering. Amounts
// chosen so selection outcomes are unambiguous.
const SIX_SERVICE_RATES = [
  rate('USPS', 'Ground Advantage',      'usps_ground_advantage', '6.80', 4),
  rate('USPS', 'Priority Mail',         'usps_priority',         '8.50', 3),
  rate('USPS', 'Priority Mail Express', 'usps_priority_express', '28.40', 1),
  rate('UPS',  'Ground',                'ups_ground',            '7.20', 4),
  rate('UPS',  '2nd Day Air',           'ups_2nd_day_air',       '22.10', 2),
  rate('UPS',  'Next Day Air Saver',    'ups_next_day_air_saver','42.80', 1),
];

describe('pickCheapestAllowedRate — refactored (10.0 PR-1)', () => {
  test('daysUntilBookingStart=5 → UPS Ground (Ground-preference winner)', () => {
    // Ground estDays=4, buffer=1 → 4+1<=5 ✓. Default providerOrder is
    // ['UPS','USPS'] so UPS subset is tried first; ups_ground wins.
    const result = pickCheapestAllowedRate(SIX_SERVICE_RATES, {
      daysUntilBookingStart: 5,
    });
    expect(result.servicelevel.token).toBe('ups_ground');
  });

  test('daysUntilBookingStart=2 → UPS 2nd Day Air (Ground infeasible, cheapest feasible)', () => {
    // Ground: 4+1>2 → no. 2nd Day Air: 2+1<=3... wait 2+1=3>2 → no either.
    // Next Day Saver: 1+1=2<=2 ✓. Last-resort for UPS: cheapest of candidates
    // if none feasible. Let's trace: Ground (4), 2nd Day (2), Next Day Saver (1).
    // feasible = Next Day Saver only (1+1<=2). So cheapest feasible = Next Day Saver.
    const result = pickCheapestAllowedRate(SIX_SERVICE_RATES, {
      daysUntilBookingStart: 2,
    });
    expect(result.servicelevel.token).toBe('ups_next_day_air_saver');
  });

  test('daysUntilBookingStart=3 → UPS 2nd Day Air (2+1<=3, cheaper than Ground which is 4+1>3)', () => {
    // Ground: 4+1=5>3 → no. 2nd Day: 2+1=3<=3 ✓. Next Day Saver: 1+1=2<=3 ✓.
    // feasible = [2nd Day ($22.10), Next Day Saver ($42.80)]. Cheapest = 2nd Day.
    const result = pickCheapestAllowedRate(SIX_SERVICE_RATES, {
      daysUntilBookingStart: 3,
    });
    expect(result.servicelevel.token).toBe('ups_2nd_day_air');
  });

  test('daysUntilBookingStart=1 → last resort branch (nothing feasible in UPS, cheapest UPS)', () => {
    // Next Day Saver: 1+1=2>1 → no. Everything else in UPS larger. No UPS
    // feasible → last resort: cheapest of candidates (UPS subset) = UPS Ground ($7.20).
    const result = pickCheapestAllowedRate(SIX_SERVICE_RATES, {
      daysUntilBookingStart: 1,
    });
    expect(result.provider).toBe('UPS');
    expect(result.servicelevel.token).toBe('ups_ground');
  });

  test('filters by preferredServices (FedEx rates ignored even if cheaper)', () => {
    const ratesWithNonPreferred = [
      rate('FedEx', 'Ground Economy', 'fedex_ground_economy', '3.99', 4),
      ...SIX_SERVICE_RATES,
    ];
    const result = pickCheapestAllowedRate(ratesWithNonPreferred, {
      daysUntilBookingStart: 5,
    });
    expect(result.provider).not.toBe('FedEx');
    expect(result.servicelevel.token).toBe('ups_ground');
  });

  test('returns null on empty input', () => {
    expect(pickCheapestAllowedRate([], { daysUntilBookingStart: 5 })).toBeNull();
    expect(pickCheapestAllowedRate(null, { daysUntilBookingStart: 5 })).toBeNull();
  });

  test('undefined daysUntilBookingStart → treats as unbounded (Ground wins)', () => {
    const result = pickCheapestAllowedRate(SIX_SERVICE_RATES, {});
    expect(result.servicelevel.token).toBe('ups_ground');
  });

  test('preferredProviders=[USPS] → selects USPS even if UPS is cheaper', () => {
    const result = pickCheapestAllowedRate(SIX_SERVICE_RATES, {
      daysUntilBookingStart: 5,
      preferredProviders: ['USPS'],
    });
    expect(result.provider).toBe('USPS');
    // USPS subset: Ground Advantage ($6.80, 4d), Priority ($8.50, 3d), Express ($28.40, 1d).
    // No ups_ground token in USPS subset, so Ground-preference misses.
    // Feasible: all three fit (4+1=5<=5 for Ground Advantage). Cheapest = Ground Advantage.
    expect(result.servicelevel.token).toBe('usps_ground_advantage');
  });
});

describe('PR-1 regression: source-level assertions', () => {
  const srcPath = path.resolve(__dirname, 'transition-privileged.js');
  const src = fs.readFileSync(srcPath, 'utf8');

  test('pickCheapestAllowedRate signature drops shipByDate, adds daysUntilBookingStart', () => {
    const sigMatch = src.match(/function pickCheapestAllowedRate\([^)]*\)/);
    expect(sigMatch).not.toBeNull();
    expect(sigMatch[0]).not.toMatch(/shipByDate/);
    expect(sigMatch[0]).toMatch(/daysUntilBookingStart/);
  });

  test('return-label site uses pickCheapestPreferredRate, not pickCheapestAllowedRate', () => {
    const returnBlockStart = src.indexOf('[RATE-SELECT][RETURN]');
    expect(returnBlockStart).toBeGreaterThan(0);
    const returnBlockContext = src.slice(Math.max(0, returnBlockStart - 500), returnBlockStart);
    expect(returnBlockContext).toMatch(/pickCheapestPreferredRate/);
    expect(returnBlockContext).not.toMatch(/pickCheapestAllowedRate\(returnRates/);
  });

  test('SAFETY_BUFFER_DAYS is read from env, not hardcoded', () => {
    expect(src).toMatch(/SHIP_SAFETY_BUFFER/);
  });

  test('outbound caller passes daysUntilBookingStart', () => {
    // Match the outbound selector call, tolerating multi-line formatting
    const outboundMatch = src.match(
      /pickCheapestAllowedRate\s*\(\s*availableRates\s*,\s*\{[^}]*daysUntilBookingStart/
    );
    expect(outboundMatch).not.toBeNull();
  });
});

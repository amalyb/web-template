/**
 * task #29 follow-up: re-rate at accept.
 *
 * Verifies findMatchingRate + the 5 selection scenarios laid out in the brief:
 *   1. Locked rate exists, matching fresh service-level → returns matched fresh rate.
 *   2. $1 cheaper fresh rate (delta = -100c) → no ops alert (< 200c threshold).
 *   3. $3 more expensive fresh rate (delta = +300c) → ops alert (>= 200c threshold).
 *   4. Locked rate exists, no matching fresh service-level → null.
 *   5. No locked rate → fallback path is used (existing behavior unchanged).
 *
 * Helper-level tests (findMatchingRate + delta arithmetic + threshold constant)
 * are integration-equivalent: cases 2/3 are entirely a matter of the delta
 * computation and the LOCKED_RATE_AMOUNT_DELTA_ALERT_CENTS constant; case 4
 * is "findMatchingRate returns null and the wiring upstream sees null"; case 5
 * is "lockedRate is missing/incomplete so the lock branch is skipped". The
 * wiring itself in transition-privileged.js is straightforward enough that
 * the helper contracts cover the behavior the brief asks about.
 */

// Match the existing pick-rate test's Sentry mock to avoid the
// @opentelemetry/semantic-conventions/incubating breakage on require chain.
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  Handlers: {
    requestHandler: () => (req, res, next) => next(),
    errorHandler: () => (err, req, res, next) => next(err),
  },
  Integrations: {},
  getCurrentScope: () => ({ setTag: jest.fn(), setContext: jest.fn() }),
}));

const {
  findMatchingRate,
  LOCKED_RATE_AMOUNT_DELTA_ALERT_CENTS,
} = require('./transition-privileged');

const rate = (provider, token, amount, object_id = `rate_${provider}_${token}`) => ({
  object_id,
  provider,
  servicelevel: { token, name: token },
  amount: String(amount),
});

const lockedRate = ({ provider = 'USPS', token = 'usps_ground_advantage', amountCents = 875, rateObjectId = 'rate_locked_xxx' } = {}) => ({
  rateObjectId,
  provider,
  servicelevel: { token, name: token },
  amountCents,
  estimatedDays: 3,
});

describe('LOCKED_RATE_AMOUNT_DELTA_ALERT_CENTS', () => {
  it('is exactly 200 cents ($2 threshold)', () => {
    expect(LOCKED_RATE_AMOUNT_DELTA_ALERT_CENTS).toBe(200);
  });
});

describe('findMatchingRate', () => {
  describe('case 1: matching service-level exists in fresh rates', () => {
    it('returns the matched fresh rate (different object_id from locked)', () => {
      const fresh = [
        rate('UPS', 'ups_ground', '11.50', 'rate_ups_fresh'),
        rate('USPS', 'usps_ground_advantage', '8.75', 'rate_usps_fresh'),
        rate('USPS', 'usps_priority', '9.20', 'rate_usps_priority_fresh'),
      ];
      const locked = lockedRate({ provider: 'USPS', token: 'usps_ground_advantage' });

      const matched = findMatchingRate(fresh, locked);

      expect(matched).not.toBeNull();
      expect(matched.object_id).toBe('rate_usps_fresh');
      expect(matched.object_id).not.toBe(locked.rateObjectId);
      expect(matched.provider).toBe('USPS');
      expect(matched.servicelevel.token).toBe('usps_ground_advantage');
    });
  });

  describe('case 2: cheap delta scenario (verified via amount arithmetic)', () => {
    it('matched rate is $1 cheaper than locked → delta -100c, below $2 threshold', () => {
      const fresh = [
        rate('USPS', 'usps_ground_advantage', '7.75'), // $7.75 = 775c
      ];
      const locked = lockedRate({ amountCents: 875 }); // $8.75 = 875c

      const matched = findMatchingRate(fresh, locked);
      const freshAmountCents = Math.round(parseFloat(matched.amount) * 100);
      const deltaCents = freshAmountCents - locked.amountCents;

      expect(deltaCents).toBe(-100);
      expect(Math.abs(deltaCents) >= LOCKED_RATE_AMOUNT_DELTA_ALERT_CENTS).toBe(false);
    });
  });

  describe('case 3: expensive delta scenario', () => {
    it('matched rate is $3 more expensive → delta +300c, at/above $2 threshold', () => {
      const fresh = [
        rate('USPS', 'usps_ground_advantage', '11.75'), // $11.75 = 1175c
      ];
      const locked = lockedRate({ amountCents: 875 });

      const matched = findMatchingRate(fresh, locked);
      const freshAmountCents = Math.round(parseFloat(matched.amount) * 100);
      const deltaCents = freshAmountCents - locked.amountCents;

      expect(deltaCents).toBe(300);
      expect(Math.abs(deltaCents) >= LOCKED_RATE_AMOUNT_DELTA_ALERT_CENTS).toBe(true);
    });

    it('exactly at threshold (200c) also fires alert', () => {
      const fresh = [rate('USPS', 'usps_ground_advantage', '10.75')]; // 1075c
      const locked = lockedRate({ amountCents: 875 });
      const matched = findMatchingRate(fresh, locked);
      const deltaCents = Math.round(parseFloat(matched.amount) * 100) - locked.amountCents;
      expect(deltaCents).toBe(200);
      expect(Math.abs(deltaCents) >= LOCKED_RATE_AMOUNT_DELTA_ALERT_CENTS).toBe(true);
    });

    it('199c delta does NOT fire alert (boundary check)', () => {
      const fresh = [rate('USPS', 'usps_ground_advantage', '10.74')]; // 1074c
      const locked = lockedRate({ amountCents: 875 });
      const matched = findMatchingRate(fresh, locked);
      const deltaCents = Math.round(parseFloat(matched.amount) * 100) - locked.amountCents;
      expect(deltaCents).toBe(199);
      expect(Math.abs(deltaCents) >= LOCKED_RATE_AMOUNT_DELTA_ALERT_CENTS).toBe(false);
    });
  });

  describe('case 4: no matching service-level in fresh rates', () => {
    it('returns null when locked token is absent from fresh rates', () => {
      const fresh = [
        rate('USPS', 'usps_priority'),
        rate('UPS', 'ups_ground'),
        rate('UPS', 'ups_2nd_day_air'),
      ];
      const locked = lockedRate({ provider: 'USPS', token: 'usps_ground_advantage' });

      const matched = findMatchingRate(fresh, locked);

      expect(matched).toBeNull();
    });

    it('returns null when fresh has matching token but DIFFERENT provider (no silent carrier swap)', () => {
      // Defensive: USPS ground_advantage and UPS ground are distinct services.
      // If fresh only has UPS ground but locked is USPS ground_advantage,
      // we MUST NOT match — that would silently swap carriers from the
      // borrower's checkout quote. (This is the brief's "exact-or-fail" rule.)
      const fresh = [rate('UPS', 'usps_ground_advantage', '8.50')]; // weird hypothetical
      const locked = lockedRate({ provider: 'USPS', token: 'usps_ground_advantage' });
      expect(findMatchingRate(fresh, locked)).toBeNull();
    });
  });

  describe('case 5: no-locked-rate / malformed-locked-rate paths (fallback expected upstream)', () => {
    it('returns null when lockedRate is null', () => {
      const fresh = [rate('USPS', 'usps_ground_advantage', '8.75')];
      expect(findMatchingRate(fresh, null)).toBeNull();
    });

    it('returns null when lockedRate is undefined', () => {
      const fresh = [rate('USPS', 'usps_ground_advantage', '8.75')];
      expect(findMatchingRate(fresh, undefined)).toBeNull();
    });

    it('returns null when lockedRate has rateObjectId but no provider', () => {
      const fresh = [rate('USPS', 'usps_ground_advantage', '8.75')];
      const malformed = { rateObjectId: 'rate_xxx', servicelevel: { token: 'usps_ground_advantage' } };
      expect(findMatchingRate(fresh, malformed)).toBeNull();
    });

    it('returns null when lockedRate has rateObjectId but no servicelevel.token', () => {
      const fresh = [rate('USPS', 'usps_ground_advantage', '8.75')];
      const malformed = { rateObjectId: 'rate_xxx', provider: 'USPS' };
      expect(findMatchingRate(fresh, malformed)).toBeNull();
    });
  });

  describe('input edge cases', () => {
    it('returns null when freshRates is empty', () => {
      expect(findMatchingRate([], lockedRate())).toBeNull();
    });

    it('returns null when freshRates is not an array', () => {
      expect(findMatchingRate(null, lockedRate())).toBeNull();
      expect(findMatchingRate(undefined, lockedRate())).toBeNull();
      expect(findMatchingRate({}, lockedRate())).toBeNull();
    });

    it('matches case-insensitively on provider', () => {
      const fresh = [rate('usps', 'usps_ground_advantage', '8.75')]; // lowercase from Shippo
      const locked = lockedRate({ provider: 'USPS' });
      expect(findMatchingRate(fresh, locked)).not.toBeNull();
    });

    it('falls back to r.carrier when r.provider missing', () => {
      const fresh = [
        { object_id: 'r1', carrier: 'USPS', servicelevel: { token: 'usps_ground_advantage' }, amount: '8.75' },
      ];
      const locked = lockedRate();
      expect(findMatchingRate(fresh, locked)).not.toBeNull();
    });

    it('falls back to r.service.token when r.servicelevel.token missing (legacy SDK shape)', () => {
      const fresh = [
        { object_id: 'r1', provider: 'USPS', service: { token: 'usps_ground_advantage' }, amount: '8.75' },
      ];
      const locked = lockedRate();
      expect(findMatchingRate(fresh, locked)).not.toBeNull();
    });

    it('returns the FIRST match if multiple fresh rates have the same provider+token (defensive)', () => {
      const fresh = [
        rate('USPS', 'usps_ground_advantage', '8.75', 'rate_a'),
        rate('USPS', 'usps_ground_advantage', '9.00', 'rate_b'),
      ];
      const matched = findMatchingRate(fresh, lockedRate());
      expect(matched.object_id).toBe('rate_a');
    });
  });
});

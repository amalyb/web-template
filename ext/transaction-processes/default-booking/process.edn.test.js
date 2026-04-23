/**
 * PR-4 (10.0): process.edn v5 — tighten transition/expire to 24h.
 *
 * Source-level assertion that the only change in the expire clause is
 * P6D → PT24H, and the other two :fn/min branches (bookingStart + 1d,
 * bookingEnd) are untouched.
 */

const fs = require('fs');
const path = require('path');

const EDN = fs.readFileSync(
  path.resolve(__dirname, 'process.edn'),
  'utf8'
);

describe('PR-4: process.edn expire clause', () => {
  test('P6D is gone from the expire clause', () => {
    // The expire clause is the only place P6D appeared in v4. v5 drops it.
    // Locate the transition/expire block, then check it doesn't contain P6D.
    const expireBlock = EDN.match(/:transition\/expire[\s\S]*?:to :state\/expired/);
    expect(expireBlock).not.toBeNull();
    expect(expireBlock[0]).not.toMatch(/P6D/);
  });

  test('PT24H is present in the expire clause', () => {
    const expireBlock = EDN.match(/:transition\/expire[\s\S]*?:to :state\/expired/);
    expect(expireBlock[0]).toMatch(/\{:fn\/period \["PT24H"\]\}/);
  });

  test('the other two :fn/min branches (bookingStart + 1d, bookingEnd) are preserved', () => {
    const expireBlock = EDN.match(/:transition\/expire[\s\S]*?:to :state\/expired/);
    // P1D after booking-start still present
    expect(expireBlock[0]).toMatch(/\[:time\/booking-start\]\}\s*\{:fn\/period \["P1D"\]\}/);
    // booking-end timepoint still present
    expect(expireBlock[0]).toMatch(/:fn\/timepoint \[:time\/booking-end\]/);
  });
});

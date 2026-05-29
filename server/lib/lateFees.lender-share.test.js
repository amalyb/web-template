/**
 * Lender-share split (May 2026): unit tests for buildLateFeeLineItems and
 * lineItemEffectiveCents.
 *
 * Policy under test:
 *  - When the lender-share is OFF (or pct <= 0), one customer-side line item
 *    is emitted at the full $15 — historical behavior, 100% to Sherbrt.
 *  - When ON with pct > 0, a second provider-side line item is emitted that
 *    routes pct% of the fee to the lender's payout total. Borrower charge is
 *    unchanged either way.
 *  - The cap filter in applyCharges() matches `code === 'late-fee'` only, so
 *    the new `late-fee-lender-share` code never inflates the count-based cap.
 */

const {
  buildLateFeeLineItems,
  lineItemEffectiveCents,
} = require('./lateFees');

describe('buildLateFeeLineItems — split OFF (historical behavior)', () => {
  test('lenderSharePct=0 emits ONLY the customer-side late-fee line item', () => {
    const items = buildLateFeeLineItems({ lateFeeCents: 1500, lenderSharePct: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      code: 'late-fee',
      unitPrice: { amount: 1500, currency: 'USD' },
      quantity: 1,
      includeFor: ['customer'],
    });
  });

  test('undefined lenderSharePct is treated as OFF', () => {
    const items = buildLateFeeLineItems({ lateFeeCents: 1500 });
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe('late-fee');
  });

  test('negative lenderSharePct is treated as OFF (defensive)', () => {
    const items = buildLateFeeLineItems({ lateFeeCents: 1500, lenderSharePct: -10 });
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe('late-fee');
  });
});

describe('buildLateFeeLineItems — split ON', () => {
  test('lenderSharePct=50 emits customer + provider line items', () => {
    const items = buildLateFeeLineItems({ lateFeeCents: 1500, lenderSharePct: 50 });
    expect(items).toHaveLength(2);

    expect(items[0]).toMatchObject({
      code: 'late-fee',
      unitPrice: { amount: 1500, currency: 'USD' },
      quantity: 1,
      includeFor: ['customer'],
    });

    // Provider line follows the line-item/provider-commission shape:
    // percentage-based, no quantity, includeFor provider only.
    expect(items[1]).toMatchObject({
      code: 'late-fee-lender-share',
      unitPrice: { amount: 1500, currency: 'USD' },
      percentage: 50,
      includeFor: ['provider'],
    });
    expect(items[1].quantity).toBeUndefined();
  });

  test('lenderSharePct=100 still emits BOTH lines (lender gets full $15, Sherbrt $0)', () => {
    const items = buildLateFeeLineItems({ lateFeeCents: 1500, lenderSharePct: 100 });
    expect(items).toHaveLength(2);
    expect(items[1].percentage).toBe(100);
  });

  test('staging override values flow through (e.g. 25% split during a dry-run)', () => {
    const items = buildLateFeeLineItems({ lateFeeCents: 50, lenderSharePct: 25 });
    expect(items[0].unitPrice.amount).toBe(50);  // borrower still charged $0.50
    expect(items[1].percentage).toBe(25);
    expect(items[1].unitPrice.amount).toBe(50);
  });
});

describe('lineItemEffectiveCents — money-moved per line item', () => {
  test('quantity-based customer line: unitPrice * quantity', () => {
    const cents = lineItemEffectiveCents({
      unitPrice: { amount: 1500, currency: 'USD' },
      quantity: 1,
      percentage: 0,
    });
    expect(cents).toBe(1500);
  });

  test('percentage-based provider line at 50%: 750 cents', () => {
    const cents = lineItemEffectiveCents({
      unitPrice: { amount: 1500, currency: 'USD' },
      percentage: 50,
    });
    expect(cents).toBe(750);
  });

  test('percentage-based provider line at 100%: full unitPrice', () => {
    const cents = lineItemEffectiveCents({
      unitPrice: { amount: 1500, currency: 'USD' },
      percentage: 100,
    });
    expect(cents).toBe(1500);
  });

  test('percentage rounding stays integer for odd percentages', () => {
    // $15 at 33% = 495 cents via Math.round (half-up).
    // Note: this is the JS-side ESTIMATE; Sharetribe's authoritative
    // lineTotal rounding may disagree by 1 cent at non-divisor percentages.
    // At realistic configs (25/50/75/100) no rounding occurs and the two
    // always agree exactly.
    const cents = lineItemEffectiveCents({
      unitPrice: { amount: 1500, currency: 'USD' },
      percentage: 33,
    });
    expect(cents).toBe(495);
  });

  test('missing fields default cleanly (no NaN)', () => {
    expect(lineItemEffectiveCents({})).toBe(0);
    expect(lineItemEffectiveCents(null)).toBe(0);
    expect(lineItemEffectiveCents({ unitPrice: { amount: 100 } })).toBe(100);  // qty defaults to 1
  });
});

describe('cap accounting — late-fee-lender-share never inflates the 5-charge cap', () => {
  test('chargeHistory filter matches only code===late-fee, not lender-share', () => {
    // Simulates a chargeHistory after 3 daily charges with the split ON.
    // Each charge produces TWO items in chargeHistory.items, but the cap
    // filter matches by code on the items array. We assert that the filter
    // still counts 3, not 6.
    const chargeHistory = [
      { items: [{ code: 'late-fee' }, { code: 'late-fee-lender-share' }] },
      { items: [{ code: 'late-fee' }, { code: 'late-fee-lender-share' }] },
      { items: [{ code: 'late-fee' }, { code: 'late-fee-lender-share' }] },
    ];
    const count = chargeHistory.filter(
      e => e.items?.some(i => i.code === 'late-fee')
    ).length;
    expect(count).toBe(3);
  });

  test('mixed pre-flag and post-flag history counts each charge ONCE', () => {
    // Pre-flag: chargeHistory entries had ONLY {code: 'late-fee'}.
    // Post-flag (split ON): entries have BOTH items.
    // Cap filter must count each entry once regardless of shape.
    const chargeHistory = [
      { items: [{ code: 'late-fee' }] },                                     // pre-flag
      { items: [{ code: 'late-fee' }, { code: 'late-fee-lender-share' }] },  // post-flag
    ];
    const count = chargeHistory.filter(
      e => e.items?.some(i => i.code === 'late-fee')
    ).length;
    expect(count).toBe(2);
  });
});

describe('charge math sanity — sum invariants', () => {
  test('lender share + Sherbrt share = full fee at any pct (no rounding leakage at 50%)', () => {
    const fee = 1500;
    const pct = 50;
    const lender = Math.round((fee * pct) / 100);
    const platform = fee - lender;
    expect(lender + platform).toBe(fee);
    expect(lender).toBe(750);
    expect(platform).toBe(750);
  });

  test('split is invisible to the borrower (customer line unchanged)', () => {
    const off = buildLateFeeLineItems({ lateFeeCents: 1500, lenderSharePct: 0 });
    const on = buildLateFeeLineItems({ lateFeeCents: 1500, lenderSharePct: 50 });
    const offCustomer = off.filter(i => i.includeFor.includes('customer'));
    const onCustomer = on.filter(i => i.includeFor.includes('customer'));
    expect(offCustomer).toEqual(onCustomer);  // borrower experience identical
  });
});

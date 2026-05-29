/**
 * SDK-mock integration tests for applyCharges (May 2026 code review S2).
 *
 * The 15 helper tests in lateFees.lender-share.test.js cover the pure
 * functions (buildLateFeeLineItems, lineItemEffectiveCents). These tests
 * exercise the FULL applyCharges flow end-to-end: mock
 * sdkInstance.transactions.show + .transition, then assert on the params
 * that would be sent to the Sharetribe transition — including
 * chargeHistory shape and cap-filter behavior on mixed history.
 *
 * Coverage scope (what these tests DO verify):
 *  - Transition called with the expected lineItems array (flag on/off)
 *  - chargeHistory entries written with the right shape per flag state
 *  - Cap filter behavior on mixed pre-flag/post-flag history
 *  - feature-flag-disabled returns wouldCharge with effective cents
 *
 * Out of scope (what these tests CAN'T verify — see B1 in the PR doc):
 *  - Whether provider line items actually accumulate into the cumulative
 *    payout total carried to stripe-create-payout. That's a Sharetribe
 *    server semantics question and must be verified empirically in staging.
 */

const TX_ID = 'test-tx-uuid';

// Fixture dates: Mon Apr 13 2026 UTC-08:00Z (PT) → Fri Apr 17 2026 PT.
// No USPS holidays, no Sundays — chargeable late days = Tue/Wed/Thu/Fri = 4.
// Comfortably >= 2 (past scan-lag-grace) and < cap of 5.
const FIXTURE_DUE_AT = '2026-04-13T08:00:00Z';
const FIXTURE_NOW = '2026-04-17T17:00:00Z';

function makeTxResponse({ chargeHistory = [], lastLateFeeDayCharged = null } = {}) {
  const returnData = { dueAt: FIXTURE_DUE_AT, chargeHistory };
  if (lastLateFeeDayCharged) {
    returnData.lastLateFeeDayCharged = lastLateFeeDayCharged;
  }
  return {
    data: {
      data: {
        id: { uuid: TX_ID },
        type: 'transaction',
        attributes: {
          state: 'accepted',
          processVersion: 5,
          protectedData: { return: returnData },
        },
        relationships: {
          listing: { data: { type: 'listing', id: { uuid: 'list-1' } } },
          booking: { data: { type: 'booking', id: { uuid: 'book-1' } } },
        },
      },
      included: [
        {
          type: 'listing',
          id: { uuid: 'list-1' },
          attributes: { title: 'Test Item' },
        },
      ],
    },
  };
}

function makeSdkMock(txResponse) {
  return {
    transactions: {
      show: jest.fn().mockResolvedValue(txResponse),
      transition: jest.fn().mockResolvedValue({ data: {} }),
    },
  };
}

describe('applyCharges — flag ON, charging master switch ON', () => {
  let applyCharges;

  beforeAll(() => {
    jest.resetModules();
    process.env.OVERDUE_FEES_CHARGING_ENABLED = 'true';
    process.env.LATE_FEE_LENDER_SHARE_ENABLED = 'true';
    delete process.env.LATE_FEE_CENTS_OVERRIDE;
    delete process.env.LENDER_LATE_FEE_SHARE_PCT_OVERRIDE;  // default 50
    ({ applyCharges } = require('./lateFees'));
  });

  test('transition called with [customer, provider] line items at default 50% split', async () => {
    const sdk = makeSdkMock(makeTxResponse());
    const now = new Date(FIXTURE_NOW);

    const result = await applyCharges({ sdkInstance: sdk, txId: TX_ID, now });

    expect(result.charged).toBe(true);
    expect(result.items).toEqual(['late-fee', 'late-fee-lender-share']);
    expect(result.lenderShareCents).toBe(750);
    expect(result.platformShareCents).toBe(750);
    expect(result.lenderShareEnabled).toBe(true);

    expect(sdk.transactions.transition).toHaveBeenCalledTimes(1);
    const callArgs = sdk.transactions.transition.mock.calls[0][0];
    expect(callArgs.transition).toBe('transition/privileged-apply-late-fees-non-return');
    expect(callArgs.params.lineItems).toHaveLength(2);

    expect(callArgs.params.lineItems[0]).toMatchObject({
      code: 'late-fee',
      unitPrice: { amount: 1500, currency: 'USD' },
      quantity: 1,
      includeFor: ['customer'],
    });
    expect(callArgs.params.lineItems[1]).toMatchObject({
      code: 'late-fee-lender-share',
      unitPrice: { amount: 1500, currency: 'USD' },
      percentage: 50,
      includeFor: ['provider'],
    });
    // Provider line item is percentage-based — no quantity per
    // line-item/provider-commission convention.
    expect(callArgs.params.lineItems[1].quantity).toBeUndefined();
  });

  test('chargeHistory entry records BOTH items with EFFECTIVE cents (review S1)', async () => {
    const sdk = makeSdkMock(makeTxResponse());
    const now = new Date(FIXTURE_NOW);

    await applyCharges({ sdkInstance: sdk, txId: TX_ID, now });

    const callArgs = sdk.transactions.transition.mock.calls[0][0];
    const history = callArgs.params.protectedData.return.chargeHistory;
    expect(history).toHaveLength(1);

    const entry = history[0];
    expect(entry.scenario).toBe('daily-overdue');
    // Customer line records full 1500 (qty 1); provider line records
    // 750 (= 1500 * 50%, half-up rounded). Sum = 1500 = LATE_FEE_CENTS.
    expect(entry.items).toEqual([
      { code: 'late-fee', amount: 1500 },
      { code: 'late-fee-lender-share', amount: 750 },
    ]);
    expect(entry.lenderShareCents).toBe(750);
    expect(entry.platformShareCents).toBe(750);
    expect(entry.lenderShareEnabled).toBe(true);
    expect(entry.lateDays).toBeGreaterThanOrEqual(2);
  });

  test('cap filter counts mixed pre-flag + post-flag history at 1 per charge', async () => {
    // 4 prior charges with MIXED shape: 2 pre-flag (single 'late-fee' item),
    // 2 post-flag (both items). Cap filter must count this as 4 charges, not
    // 6 (would be 6 if it naively counted any item with code 'late-fee').
    // With 4 priors, the 5th charge proceeds.
    const mixed = [
      { items: [{ code: 'late-fee', amount: 1500 }] },
      { items: [{ code: 'late-fee', amount: 1500 }] },
      { items: [
        { code: 'late-fee', amount: 1500 },
        { code: 'late-fee-lender-share', amount: 750 },
      ]},
      { items: [
        { code: 'late-fee', amount: 1500 },
        { code: 'late-fee-lender-share', amount: 750 },
      ]},
    ];
    const sdk = makeSdkMock(makeTxResponse({ chargeHistory: mixed }));
    const now = new Date(FIXTURE_NOW);

    const result = await applyCharges({ sdkInstance: sdk, txId: TX_ID, now });

    // 4 priors + 1 new = 5 total = at the cap, this charge allowed.
    expect(result.charged).toBe(true);
    expect(sdk.transactions.transition).toHaveBeenCalledTimes(1);
    const newHistory = sdk.transactions.transition.mock.calls[0][0]
      .params.protectedData.return.chargeHistory;
    expect(newHistory).toHaveLength(5);
  });

  test('cap enforced — 5 prior charges block the 6th, no transition fired', async () => {
    const atCap = [1, 2, 3, 4, 5].map(() => ({
      items: [
        { code: 'late-fee', amount: 1500 },
        { code: 'late-fee-lender-share', amount: 750 },
      ],
    }));
    const sdk = makeSdkMock(makeTxResponse({ chargeHistory: atCap }));
    const now = new Date(FIXTURE_NOW);

    const result = await applyCharges({ sdkInstance: sdk, txId: TX_ID, now });

    expect(result.charged).toBe(false);
    expect(result.reason).toBe('max-charges-reached');
    expect(result.chargeCount).toBe(5);
    expect(sdk.transactions.transition).not.toHaveBeenCalled();
  });
});

describe('applyCharges — flag OFF (historical behavior preserved)', () => {
  let applyCharges;

  beforeAll(() => {
    jest.resetModules();
    process.env.OVERDUE_FEES_CHARGING_ENABLED = 'true';
    process.env.LATE_FEE_LENDER_SHARE_ENABLED = 'false';
    delete process.env.LATE_FEE_CENTS_OVERRIDE;
    delete process.env.LENDER_LATE_FEE_SHARE_PCT_OVERRIDE;
    ({ applyCharges } = require('./lateFees'));
  });

  test('transition called with ONLY the customer late-fee line item', async () => {
    const sdk = makeSdkMock(makeTxResponse());
    const now = new Date(FIXTURE_NOW);

    const result = await applyCharges({ sdkInstance: sdk, txId: TX_ID, now });

    expect(result.charged).toBe(true);
    expect(result.items).toEqual(['late-fee']);
    expect(result.amounts).toEqual([{ code: 'late-fee', cents: 1500 }]);
    expect(result.lenderShareCents).toBe(0);
    expect(result.platformShareCents).toBe(1500);
    expect(result.lenderShareEnabled).toBe(false);

    const callArgs = sdk.transactions.transition.mock.calls[0][0];
    expect(callArgs.params.lineItems).toHaveLength(1);
    expect(callArgs.params.lineItems[0]).toMatchObject({
      code: 'late-fee',
      unitPrice: { amount: 1500, currency: 'USD' },
      quantity: 1,
      percentage: 0,
      includeFor: ['customer'],
    });
  });

  test('chargeHistory entry preserves the historical single-item shape (+ additive metadata)', async () => {
    const sdk = makeSdkMock(makeTxResponse());
    const now = new Date(FIXTURE_NOW);

    await applyCharges({ sdkInstance: sdk, txId: TX_ID, now });

    const callArgs = sdk.transactions.transition.mock.calls[0][0];
    const entry = callArgs.params.protectedData.return.chargeHistory[0];

    expect(entry.items).toEqual([{ code: 'late-fee', amount: 1500 }]);
    // Review N1: additive metadata fields exist even with flag OFF — they
    // are documented as debugging metadata, not destructive, no current
    // consumer reads them. Their presence is the only deviation from
    // strict byte-identical historical behavior on persisted protectedData.
    expect(entry.lenderShareCents).toBe(0);
    expect(entry.platformShareCents).toBe(1500);
    expect(entry.lenderShareEnabled).toBe(false);
  });
});

describe('applyCharges — feature-flag-disabled (charging master switch OFF)', () => {
  let applyCharges;

  beforeAll(() => {
    jest.resetModules();
    process.env.OVERDUE_FEES_CHARGING_ENABLED = 'false';
    process.env.LATE_FEE_LENDER_SHARE_ENABLED = 'true';
    delete process.env.LATE_FEE_CENTS_OVERRIDE;
    delete process.env.LENDER_LATE_FEE_SHARE_PCT_OVERRIDE;
    ({ applyCharges } = require('./lateFees'));
  });

  test('returns wouldCharge with EFFECTIVE cents per line item, no transition fired', async () => {
    const sdk = makeSdkMock(makeTxResponse());
    const now = new Date(FIXTURE_NOW);

    const result = await applyCharges({ sdkInstance: sdk, txId: TX_ID, now });

    expect(result.charged).toBe(false);
    expect(result.reason).toBe('feature-flag-disabled');
    // Pre-change shape was `cents: i.unitPrice.amount` (always 1500).
    // Post-change uses effective lineTotal so dry-run logs show the
    // true money flow ($15 customer, $7.50 provider at 50%). Existing
    // scenarioTests assert `wouldCharge.some(w => w.code === 'late-fee'
    // && w.cents === 1500)` — still passes (customer line unchanged).
    expect(result.wouldCharge).toEqual([
      { code: 'late-fee', cents: 1500 },
      { code: 'late-fee-lender-share', cents: 750 },
    ]);
    expect(result.lenderShareCents).toBe(750);
    expect(result.platformShareCents).toBe(750);
    expect(sdk.transactions.transition).not.toHaveBeenCalled();
  });
});

describe('applyCharges — env override for the share percentage', () => {
  let applyCharges;

  beforeAll(() => {
    jest.resetModules();
    process.env.OVERDUE_FEES_CHARGING_ENABLED = 'true';
    process.env.LATE_FEE_LENDER_SHARE_ENABLED = 'true';
    process.env.LENDER_LATE_FEE_SHARE_PCT_OVERRIDE = '25';  // staging-style split
    delete process.env.LATE_FEE_CENTS_OVERRIDE;
    ({ applyCharges } = require('./lateFees'));
  });

  afterAll(() => {
    delete process.env.LENDER_LATE_FEE_SHARE_PCT_OVERRIDE;
  });

  test('25% override flows through to line item + chargeHistory + return value', async () => {
    const sdk = makeSdkMock(makeTxResponse());
    const now = new Date(FIXTURE_NOW);

    const result = await applyCharges({ sdkInstance: sdk, txId: TX_ID, now });

    expect(result.charged).toBe(true);
    expect(result.lenderShareCents).toBe(375);   // 1500 * 25%
    expect(result.platformShareCents).toBe(1125);  // 1500 - 375

    const callArgs = sdk.transactions.transition.mock.calls[0][0];
    expect(callArgs.params.lineItems[1].percentage).toBe(25);

    const entry = callArgs.params.protectedData.return.chargeHistory[0];
    expect(entry.items[1]).toEqual({ code: 'late-fee-lender-share', amount: 375 });
  });
});

/**
 * PR-2 step 8 (10.0): lockedRate preservation across protectedData writes.
 *
 * Pre-task-30: Sharetribe's updateMetadata endpoint replaced top-level
 * protectedData keys wholesale, so every writer to nested `outbound` or
 * `return` keys had to spread the existing nested value or sibling fields
 * (like `lockedRate`) would be clobbered.
 *
 * Post-task-30 (May 1, 2026): writes route through the
 * operator-update-pd-<state> v6 transitions. txUpdateProtectedData now
 * fetches current protectedData via sdk.transactions.show, deep-merges
 * the patch client-side, and writes the merged object via the transition.
 * Siblings survive even without client-side spreads — spreads remain
 * harmless and still recommended.
 */

const mockShow = jest.fn();
const mockTransition = jest.fn(() => Promise.resolve({ data: { data: {} } }));

jest.doMock('sharetribe-flex-integration-sdk', () => ({
  createInstance: jest.fn(() => ({
    transactions: { show: mockShow, transition: mockTransition },
  })),
}));

process.env.INTEGRATION_CLIENT_ID = 'test-client-id';
process.env.INTEGRATION_CLIENT_SECRET = 'test-client-secret';

const { upsertProtectedData } = require('../lib/txData');

function mockTxState(protectedData = {}, state = 'state/accepted') {
  mockShow.mockResolvedValueOnce({
    data: { data: { attributes: { state, protectedData } } },
  });
}

describe('PR-2 step 8: lockedRate preservation', () => {
  beforeEach(() => {
    mockShow.mockReset();
    mockTransition.mockClear();
  });

  test('outbound.lockedRate is preserved when writer spreads existing outbound', async () => {
    const lockedRate = {
      rateObjectId: 'rate_abc',
      estimatedDays: 2,
      amountCents: 1250,
    };

    // First writer: persist just lockedRate against an empty tx.
    mockTxState({});
    await upsertProtectedData('tx-1', { outbound: { lockedRate } });
    expect(mockTransition).toHaveBeenCalledTimes(1);
    const firstCall = mockTransition.mock.calls[0][0];
    expect(firstCall.transition).toBe('transition/operator-update-pd-accepted');
    expect(firstCall.params.protectedData.outbound).toEqual({ lockedRate });

    // Second writer: spread existing outbound and write shipByDate.
    const existingOutbound = { lockedRate };
    mockTxState({ outbound: existingOutbound });
    await upsertProtectedData('tx-1', {
      outbound: { ...existingOutbound, shipByDate: '2026-04-25T07:00:00.000Z' },
    });
    expect(mockTransition).toHaveBeenCalledTimes(2);
    const secondWrite = mockTransition.mock.calls[1][0].params.protectedData;
    expect(secondWrite.outbound.lockedRate).toEqual(lockedRate);
    expect(secondWrite.outbound.shipByDate).toBe('2026-04-25T07:00:00.000Z');
  });

  test('return.lockedRate is preserved when writer spreads existing return', async () => {
    const lockedRate = {
      rateObjectId: 'rate_return_xyz',
      estimatedDays: 3,
      amountCents: 1400,
    };

    mockTxState({});
    await upsertProtectedData('tx-2', { return: { lockedRate } });
    const firstWrite = mockTransition.mock.calls[0][0].params.protectedData;
    expect(firstWrite.return).toEqual({ lockedRate });

    const existingReturn = { lockedRate };
    mockTxState({ return: existingReturn });
    await upsertProtectedData('tx-2', {
      return: { ...existingReturn, tMinus1SentAt: '2026-04-23T17:00:00.000Z' },
    });
    const secondWrite = mockTransition.mock.calls[1][0].params.protectedData;
    expect(secondWrite.return.lockedRate).toEqual(lockedRate);
    expect(secondWrite.return.tMinus1SentAt).toBe('2026-04-23T17:00:00.000Z');
  });

  test('post-task-30: server-side read-merge-write preserves siblings even without spread', async () => {
    // Pre-refactor this would have been a footgun: writing
    // `{ outbound: { shipByDate } }` without spreading `existingOutbound`
    // would have wiped lockedRate. Post-refactor, txUpdateProtectedData
    // deep-merges with the protectedData it just fetched via
    // sdk.transactions.show, so siblings are preserved automatically.
    const lockedRate = {
      rateObjectId: 'rate_foo',
      estimatedDays: 1,
      amountCents: 900,
    };
    mockTxState({});
    await upsertProtectedData('tx-3', { outbound: { lockedRate } });

    // Second write: no spread. Pre-task-30 this clobbered lockedRate.
    mockTxState({ outbound: { lockedRate } });
    await upsertProtectedData('tx-3', {
      outbound: { shipByDate: '2026-04-25T07:00:00.000Z' },
    });

    const secondWrite = mockTransition.mock.calls[1][0].params.protectedData;
    expect(secondWrite.outbound.shipByDate).toBe('2026-04-25T07:00:00.000Z');
    expect(secondWrite.outbound.lockedRate).toEqual(lockedRate);
  });

  test('top-level keys "outbound" and "return" pass through pruneProtectedData whitelist', async () => {
    mockTxState({});
    await upsertProtectedData('tx-4', {
      outbound: { lockedRate: { rateObjectId: 'a' } },
      return: { lockedRate: { rateObjectId: 'b' } },
    });
    const write = mockTransition.mock.calls[0][0].params.protectedData;
    expect(write.outbound).toBeDefined();
    expect(write.return).toBeDefined();
    expect(write.outbound.lockedRate.rateObjectId).toBe('a');
    expect(write.return.lockedRate.rateObjectId).toBe('b');
  });
});

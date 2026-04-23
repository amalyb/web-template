/**
 * PR-2 step 8 (10.0): spread-requirement clobber regression.
 *
 * Sharetribe's updateMetadata endpoint replaces top-level keys wholesale —
 * nested merging is client-side. Every writer to `outbound` or `return`
 * keys in protectedData MUST spread the existing nested value to preserve
 * siblings. This test locks in that behavior for the new rate-lock fields.
 */

const mockUpdateMetadata = jest.fn(() => Promise.resolve({ data: { data: {} } }));

jest.doMock('sharetribe-flex-integration-sdk', () => ({
  createInstance: jest.fn(() => ({
    transactions: { updateMetadata: mockUpdateMetadata },
  })),
}));

process.env.INTEGRATION_CLIENT_ID = 'test-client-id';
process.env.INTEGRATION_CLIENT_SECRET = 'test-client-secret';

const { upsertProtectedData } = require('../lib/txData');

describe('PR-2 step 8: lockedRate clobber regression', () => {
  beforeEach(() => {
    mockUpdateMetadata.mockClear();
  });

  test('outbound.lockedRate is preserved when writer spreads existing outbound', async () => {
    // Simulate two sequential writers. First: checkout writes lockedRate.
    // Second: accept-flow writes shipByDate while spreading the existing
    // outbound. The updateMetadata merge is client-side, so the second
    // write MUST spread to preserve lockedRate.
    const lockedRate = {
      rateObjectId: 'rate_abc',
      estimatedDays: 2,
      amountCents: 1250,
    };

    // First writer: persist just lockedRate.
    await upsertProtectedData('tx-1', {
      outbound: { lockedRate },
    });
    expect(mockUpdateMetadata).toHaveBeenCalledTimes(1);
    const firstWrite = mockUpdateMetadata.mock.calls[0][0].metadata.protectedData;
    expect(firstWrite.outbound).toEqual({ lockedRate });

    // Second writer: pretend we fetched the tx and now write shipByDate,
    // spreading existing outbound. This is the correct pattern used by
    // transition-privileged.js:974 and the NEW initiate-privileged.js rate-lock writer.
    const existingOutbound = { lockedRate };
    await upsertProtectedData('tx-1', {
      outbound: { ...existingOutbound, shipByDate: '2026-04-25T07:00:00.000Z' },
    });

    expect(mockUpdateMetadata).toHaveBeenCalledTimes(2);
    const secondWrite = mockUpdateMetadata.mock.calls[1][0].metadata.protectedData;
    // Both lockedRate and shipByDate must survive.
    expect(secondWrite.outbound.lockedRate).toEqual(lockedRate);
    expect(secondWrite.outbound.shipByDate).toBe('2026-04-25T07:00:00.000Z');
  });

  test('return.lockedRate is preserved when writer spreads existing return', async () => {
    const lockedRate = {
      rateObjectId: 'rate_return_xyz',
      estimatedDays: 3,
      amountCents: 1400,
    };

    await upsertProtectedData('tx-2', {
      return: { lockedRate },
    });
    const firstWrite = mockUpdateMetadata.mock.calls[0][0].metadata.protectedData;
    expect(firstWrite.return).toEqual({ lockedRate });

    // Second writer mimics sendReturnReminders.js:622 (T-1 reminder sent flag).
    const existingReturn = { lockedRate };
    await upsertProtectedData('tx-2', {
      return: { ...existingReturn, tMinus1SentAt: '2026-04-23T17:00:00.000Z' },
    });

    const secondWrite = mockUpdateMetadata.mock.calls[1][0].metadata.protectedData;
    expect(secondWrite.return.lockedRate).toEqual(lockedRate);
    expect(secondWrite.return.tMinus1SentAt).toBe('2026-04-23T17:00:00.000Z');
  });

  test('NEGATIVE: writing without spread clobbers siblings (anti-pattern proof)', async () => {
    // Locks in the behavior we're guarding against — if a future writer
    // accidentally drops the spread, this test documents the failure mode.
    const lockedRate = {
      rateObjectId: 'rate_foo',
      estimatedDays: 1,
      amountCents: 900,
    };
    await upsertProtectedData('tx-3', {
      outbound: { lockedRate },
    });

    // BAD: write shipByDate WITHOUT spreading existing outbound.
    await upsertProtectedData('tx-3', {
      outbound: { shipByDate: '2026-04-25T07:00:00.000Z' },
    });

    const badWrite = mockUpdateMetadata.mock.calls[1][0].metadata.protectedData;
    expect(badWrite.outbound.shipByDate).toBe('2026-04-25T07:00:00.000Z');
    // lockedRate is GONE — this is the bug we're guarding against.
    expect(badWrite.outbound.lockedRate).toBeUndefined();
  });

  test('top-level keys "outbound" and "return" pass through pruneProtectedData whitelist', async () => {
    // Ensures the whitelist doesn't strip the parent keys (which would
    // silently drop nested lockedRate).
    await upsertProtectedData('tx-4', {
      outbound: { lockedRate: { rateObjectId: 'a' } },
      return: { lockedRate: { rateObjectId: 'b' } },
    });
    const write = mockUpdateMetadata.mock.calls[0][0].metadata.protectedData;
    expect(write.outbound).toBeDefined();
    expect(write.return).toBeDefined();
    expect(write.outbound.lockedRate.rateObjectId).toBe('a');
    expect(write.return.lockedRate.rateObjectId).toBe('b');
  });
});

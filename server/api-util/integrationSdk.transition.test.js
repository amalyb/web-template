/**
 * Task #30 Phase 2 — verify the operator-update-pd-<state> transition path.
 *
 * The original bug: txUpdateProtectedData called sdk.transactions.updateMetadata
 * with `{ metadata: { protectedData } }`, which Sharetribe wrote to
 * tx.attributes.metadata.protectedData.X — but every reader looks at
 * tx.attributes.protectedData.X. Silent persistence loss across the app.
 *
 * Existing tests (lockedRate, persist, upsert) asserted *request shape* but
 * NOT where the data actually landed on the server-side tx. That gap is what
 * hid the bug. This file fills it: each test asserts that
 *   - the helper calls sdk.transactions.transition (NOT updateMetadata),
 *   - with a transition name from the operator-update-pd-<state> family, and
 *   - with the merged-and-pruned protectedData in `params.protectedData`,
 * so post-deploy the data lands at tx.attributes.protectedData.X.
 */

const mockShow = jest.fn();
const mockTransition = jest.fn();
const mockUpdateMetadata = jest.fn(() =>
  Promise.reject(new Error('updateMetadata MUST NOT be called post-task-30'))
);

jest.doMock('sharetribe-flex-integration-sdk', () => ({
  createInstance: jest.fn(() => ({
    transactions: {
      show: mockShow,
      transition: mockTransition,
      updateMetadata: mockUpdateMetadata,
    },
  })),
}));

// Stub the email module so unsupported-state / repeated-409 tests don't hit
// real SendGrid — the helper lazy-requires this module.
const mockSendTransactionalEmail = jest.fn(() => Promise.resolve());
jest.doMock('../email/emailClient', () => ({
  sendTransactionalEmail: mockSendTransactionalEmail,
}));

process.env.INTEGRATION_CLIENT_ID = 'test-client-id';
process.env.INTEGRATION_CLIENT_SECRET = 'test-client-secret';
process.env.OPS_ALERT_EMAIL = 'ops-test@sherbrt.test';

const { upsertProtectedData } = require('../lib/txData');

function mockTx({ state = 'state/accepted', protectedData = {} } = {}) {
  return {
    data: { data: { attributes: { state, protectedData } } },
  };
}

const TX_ID = 'tx-task30-test';

describe('task #30 Phase 2 — operator-update-pd-<state> transition path', () => {
  beforeEach(() => {
    mockShow.mockReset();
    mockTransition.mockReset();
    mockTransition.mockResolvedValue({ data: { data: {} } });
    mockUpdateMetadata.mockClear();
    mockSendTransactionalEmail.mockClear();
  });

  test('1. data lands at tx.attributes.protectedData.X (transition.params.protectedData), not metadata.protectedData', async () => {
    // Pre-write tx state.
    mockShow.mockResolvedValueOnce(
      mockTx({ state: 'state/accepted', protectedData: {} })
    );

    const patch = { outbound: { acceptedAt: '2026-05-01T10:00:00.000Z' } };
    const result = await upsertProtectedData(TX_ID, patch, { source: 'accept' });

    // updateMetadata MUST NOT be touched — that was the broken write path.
    expect(mockUpdateMetadata).not.toHaveBeenCalled();

    // The transition call must carry params.protectedData (lands at
    // tx.attributes.protectedData), not metadata.protectedData.
    expect(mockTransition).toHaveBeenCalledTimes(1);
    const call = mockTransition.mock.calls[0][0];
    expect(call.id).toBe(TX_ID);
    expect(call.transition).toBe('transition/operator-update-pd-accepted');
    expect(call.params).toBeDefined();
    expect(call.params.protectedData).toBeDefined();
    expect(call.params.protectedData.outbound.acceptedAt).toBe('2026-05-01T10:00:00.000Z');
    // No metadata wrapper anywhere on the request.
    expect(call.metadata).toBeUndefined();

    expect(result.success).toBe(true);
    expect(result.transition).toBe('transition/operator-update-pd-accepted');
  });

  test('2. top-level clobber regression — patch is merged with full existing pd, siblings preserved', async () => {
    // Existing tx already has lots of protectedData. The caller writes a tiny
    // patch (`{ outbound: { acceptedAt } }`) — the wholesale transition write
    // must include the full merged object, not just the patch.
    const existing = {
      providerName: 'Lender Lou',
      providerStreet: '123 Main',
      providerCity: 'Brooklyn',
      providerState: 'NY',
      providerZip: '11201',
      customerName: 'Borrower Bea',
      customerStreet: '456 Oak',
      customerCity: 'Queens',
      customerState: 'NY',
      customerZip: '11375',
      shipByDate: '2026-05-03',
      outbound: {
        lockedRate: { rateObjectId: 'rate_xyz', amountCents: 1100 },
        reminders: { t24: '2026-05-02T15:00:00.000Z' },
      },
      return: {
        lockedRate: { rateObjectId: 'rate_ret', amountCents: 1300 },
      },
    };
    mockShow.mockResolvedValueOnce(
      mockTx({ state: 'state/accepted', protectedData: existing })
    );

    await upsertProtectedData(
      TX_ID,
      { outbound: { acceptedAt: '2026-05-01T10:00:00.000Z' } },
      { source: 'accept' }
    );

    const sentPd = mockTransition.mock.calls[0][0].params.protectedData;
    // Patch added.
    expect(sentPd.outbound.acceptedAt).toBe('2026-05-01T10:00:00.000Z');
    // Outbound siblings (lockedRate, reminders) preserved.
    expect(sentPd.outbound.lockedRate).toEqual(existing.outbound.lockedRate);
    expect(sentPd.outbound.reminders).toEqual(existing.outbound.reminders);
    // Other top-level keys preserved.
    expect(sentPd.return).toEqual(existing.return);
    expect(sentPd.providerName).toBe('Lender Lou');
    expect(sentPd.customerName).toBe('Borrower Bea');
    expect(sentPd.shipByDate).toBe('2026-05-03');
  });

  test('3. deep-merge correctness — outbound.firstScanAt + existing outbound.lockedRate both survive', async () => {
    const existing = {
      outbound: {
        lockedRate: { rateObjectId: 'rate_xyz', amountCents: 1100 },
      },
    };
    mockShow.mockResolvedValueOnce(
      mockTx({ state: 'state/accepted', protectedData: existing })
    );

    await upsertProtectedData(
      TX_ID,
      { outbound: { firstScanAt: '2026-05-02T08:30:00.000Z' } },
      { source: 'webhook' }
    );

    const sentPd = mockTransition.mock.calls[0][0].params.protectedData;
    expect(sentPd.outbound).toEqual({
      lockedRate: { rateObjectId: 'rate_xyz', amountCents: 1100 },
      firstScanAt: '2026-05-02T08:30:00.000Z',
    });
  });

  test('4. unsupported state hard-fails with reason, ops alert, and NO updateMetadata fallback', async () => {
    mockShow.mockResolvedValueOnce(
      mockTx({ state: 'state/preauthorized', protectedData: {} })
    );

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await upsertProtectedData(
      TX_ID,
      { outbound: { acceptedAt: '2026-05-01T10:00:00.000Z' } },
      { source: 'accept' }
    );

    expect(result.success).toBe(false);
    expect(result.reason).toBe('unsupported_state');
    expect(result.state).toBe('state/preauthorized');

    // No transition call (state has no mapping).
    expect(mockTransition).not.toHaveBeenCalled();
    // No soft fallback to the broken updateMetadata path.
    expect(mockUpdateMetadata).not.toHaveBeenCalled();
    // Warning logged.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[INT][PD][UNSUPPORTED-STATE]',
      expect.objectContaining({ txId: TX_ID, state: 'state/preauthorized' })
    );
    // Ops alert fired (loud discovery channel for unexpected callers).
    expect(mockSendTransactionalEmail).toHaveBeenCalledTimes(1);
    const email = mockSendTransactionalEmail.mock.calls[0][0];
    expect(email.to).toBe('ops-test@sherbrt.test');
    expect(email.subject).toMatch(/unsupported state state\/preauthorized/);

    consoleWarnSpy.mockRestore();
  });

  test('5. 409 conflict — first transition rejects with 409, retry re-fetches and succeeds', async () => {
    // First show: existing pd is empty.
    mockShow.mockResolvedValueOnce(
      mockTx({ state: 'state/accepted', protectedData: {} })
    );
    // First transition rejects with 409.
    const conflict = new Error('Conflict');
    conflict.response = {
      status: 409,
      data: { errors: [{ code: 'transaction-conflict-on-update' }] },
    };
    mockTransition.mockRejectedValueOnce(conflict);

    // Second show (re-fetch on retry): pd now has competing concurrent write.
    mockShow.mockResolvedValueOnce(
      mockTx({
        state: 'state/accepted',
        protectedData: { outbound: { someOtherWrite: 'true' } },
      })
    );
    // Second transition succeeds.
    mockTransition.mockResolvedValueOnce({ data: { data: {} } });

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await upsertProtectedData(
      TX_ID,
      { outbound: { acceptedAt: '2026-05-01T10:00:00.000Z' } },
      { source: 'accept' }
    );

    expect(result.success).toBe(true);
    // Re-fetched on retry.
    expect(mockShow).toHaveBeenCalledTimes(2);
    expect(mockTransition).toHaveBeenCalledTimes(2);
    // Retry warning was logged.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[INT][PD][409][RETRY]',
      expect.objectContaining({ txId: TX_ID })
    );

    // The retry merged with the FRESH protectedData (the competing write
    // survives because we re-fetched).
    const retryPd = mockTransition.mock.calls[1][0].params.protectedData;
    expect(retryPd.outbound.someOtherWrite).toBe('true');
    expect(retryPd.outbound.acceptedAt).toBe('2026-05-01T10:00:00.000Z');

    // No ops alert on a single retried 409 that resolved.
    expect(mockSendTransactionalEmail).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  test('6. whitelist still applies — _task30Probe pruned, outbound passes through', async () => {
    mockShow.mockResolvedValueOnce(
      mockTx({ state: 'state/accepted', protectedData: {} })
    );

    await upsertProtectedData(
      TX_ID,
      {
        _task30Probe: 'should-be-stripped',
        outbound: { firstScanAt: '2026-05-02T08:30:00.000Z' },
        anotherJunkKey: { not: 'whitelisted' },
      },
      { source: 'webhook' }
    );

    const sentPd = mockTransition.mock.calls[0][0].params.protectedData;
    expect(sentPd._task30Probe).toBeUndefined();
    expect(sentPd.anotherJunkKey).toBeUndefined();
    expect(sentPd.outbound).toEqual({ firstScanAt: '2026-05-02T08:30:00.000Z' });
  });
});

describe('task #30 Phase 2 — state-to-transition mapping covers the 6 supported states', () => {
  // Sanity check the constant export — if anyone renames a transition in
  // process.edn, this catches the drift in the JS map.
  const { PD_TRANSITION_BY_STATE } = require('./integrationSdk');

  test.each([
    ['state/accepted', 'transition/operator-update-pd-accepted'],
    ['state/delivered', 'transition/operator-update-pd-delivered'],
    ['state/cancelled', 'transition/operator-update-pd-cancelled'],
    ['state/reviewed', 'transition/operator-update-pd-reviewed'],
    ['state/reviewed-by-provider', 'transition/operator-update-pd-reviewed-by-p'],
    ['state/reviewed-by-customer', 'transition/operator-update-pd-reviewed-by-c'],
  ])('%s -> %s', (state, expectedTransition) => {
    expect(PD_TRANSITION_BY_STATE[state]).toBe(expectedTransition);
  });

  test('terminal/preauth states are intentionally NOT mapped', () => {
    expect(PD_TRANSITION_BY_STATE['state/preauthorized']).toBeUndefined();
    expect(PD_TRANSITION_BY_STATE['state/inquiry']).toBeUndefined();
    expect(PD_TRANSITION_BY_STATE['state/pending-payment']).toBeUndefined();
    expect(PD_TRANSITION_BY_STATE['state/expired']).toBeUndefined();
    expect(PD_TRANSITION_BY_STATE['state/declined']).toBeUndefined();
    expect(PD_TRANSITION_BY_STATE['state/payment-expired']).toBeUndefined();
  });
});

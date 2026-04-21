/**
 * Regression tests for B2 — orphan transition/store-shipping-urls replaced
 * with upsertProtectedData.
 *
 * Prior bug: shippoTracking.js and resendDeliverySms.js called
 * sdk.transactions.transition({ transition: 'transition/store-shipping-urls', ... })
 * but that transition does not exist in process.edn. Every call 400'd,
 * was swallowed by a catch, and the scan/delivered flags never persisted.
 *
 * Tests here lock down the protectedData shape that now lands in Flex
 * after the upsertProtectedData migration — verifying the whitelist does
 * NOT prune the three critical keys the webhook needs to persist.
 */

const mockUpdateMetadata = jest.fn(() => Promise.resolve({ data: { data: {} } }));

jest.mock('sharetribe-flex-integration-sdk', () => ({
  createInstance: jest.fn(() => ({
    transactions: { updateMetadata: mockUpdateMetadata },
  })),
}));

// Stub env so the cached SDK initializes cleanly.
process.env.INTEGRATION_CLIENT_ID = 'test-client-id';
process.env.INTEGRATION_CLIENT_SECRET = 'test-client-secret';

const { upsertProtectedData } = require('../lib/txData');

describe('B2 — webhook protectedData upsert shape', () => {
  beforeEach(() => {
    mockUpdateMetadata.mockClear();
  });

  test('first-scan patch persists outbound.firstScanAt, shippingNotification.firstScan, lastTrackingStatus', async () => {
    const patch = {
      lastTrackingStatus: {
        status: 'TRANSIT',
        substatus: '',
        timestamp: '2026-04-21T12:00:00.000Z',
        event: 'first_scan',
      },
      shippingNotification: {
        firstScan: { sent: true, sentAt: '2026-04-21T12:00:00.000Z' },
      },
      outbound: {
        acceptedAt: '2026-04-20T10:00:00.000Z',
        firstScanAt: '2026-04-21T12:00:00.000Z',
      },
    };

    await upsertProtectedData('tx-123', patch, { source: 'webhook' });

    expect(mockUpdateMetadata).toHaveBeenCalledTimes(1);
    const sentBody = mockUpdateMetadata.mock.calls[0][0];
    expect(sentBody.id).toBe('tx-123');
    const sentPd = sentBody.metadata.protectedData;

    // The three critical keys from B2 must all survive the whitelist prune.
    expect(sentPd.outbound).toEqual(patch.outbound);
    expect(sentPd.shippingNotification).toEqual(patch.shippingNotification);
    expect(sentPd.lastTrackingStatus).toEqual(patch.lastTrackingStatus);
  });

  test('delivered patch persists shippingNotification.delivered + lastTrackingStatus', async () => {
    const patch = {
      lastTrackingStatus: {
        status: 'DELIVERED',
        substatus: '',
        timestamp: '2026-04-21T14:00:00.000Z',
        event: 'delivered',
      },
      shippingNotification: {
        firstScan: { sent: true, sentAt: '2026-04-21T12:00:00.000Z' },
        delivered: { sent: true, sentAt: '2026-04-21T14:00:00.000Z' },
      },
    };

    await upsertProtectedData('tx-456', patch, { source: 'webhook' });

    expect(mockUpdateMetadata).toHaveBeenCalledTimes(1);
    const sentPd = mockUpdateMetadata.mock.calls[0][0].metadata.protectedData;
    expect(sentPd.shippingNotification.delivered).toEqual({
      sent: true,
      sentAt: '2026-04-21T14:00:00.000Z',
    });
    expect(sentPd.lastTrackingStatus.status).toBe('DELIVERED');
  });

  test('unknown top-level keys are still pruned (whitelist remains strict)', async () => {
    await upsertProtectedData(
      'tx-789',
      {
        outbound: { firstScanAt: 'x' },
        totallyUnknownKey: { hi: 'there' },
      },
      { source: 'webhook' }
    );

    const sentPd = mockUpdateMetadata.mock.calls[0][0].metadata.protectedData;
    expect(sentPd.outbound).toBeDefined();
    expect(sentPd.totallyUnknownKey).toBeUndefined();
  });
});

/**
 * Unit tests for the confirm-payment events poller.
 *
 * Replaces the in-handler dispatch we used to run from initiate-privileged.js.
 * Coverage:
 *   - filters events stream for `lastTransition === 'transition/confirm-payment'`
 *   - skips events for unrelated transitions (request-payment, accept, etc.)
 *   - invokes helper with { tx, listing, lineItems, sdk } shape
 *   - per-event try/catch isolates failures (one bad event doesn't kill the batch)
 *   - exits cleanly with a result summary
 */

jest.mock('../api-util/lender-booking-sms', () => ({
  sendLenderBookingRequestSMS: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../util/getFlexSdk', () => jest.fn());

const { sendLenderBookingRequestSMS } = require('../api-util/lender-booking-sms');
const { processConfirmPaymentEvents } = require('./processConfirmPaymentEvents');

function makeEvent({ txId, lastTransition }) {
  return {
    id: { uuid: `evt-${txId}` },
    attributes: {
      eventType: 'transaction/transitioned',
      resource: {
        id: { uuid: txId },
        type: 'transaction',
        attributes: { lastTransition },
      },
    },
  };
}

function makeShowResp(txId, { listingId = `lst-${txId}`, lineItems = [{ code: 'line-item/day' }] } = {}) {
  return {
    data: {
      data: {
        id: { uuid: txId },
        type: 'transaction',
        attributes: { lineItems },
        relationships: {},
      },
      included: [{ id: { uuid: listingId }, type: 'listing', attributes: { title: 'Test' } }],
    },
  };
}

function makeSdk({ events, showByTxId = {}, showFailures = {} }) {
  return {
    events: {
      query: jest.fn().mockResolvedValue({ data: { data: events } }),
    },
    transactions: {
      show: jest.fn().mockImplementation(({ id }) => {
        if (showFailures[id]) return Promise.reject(showFailures[id]);
        if (showByTxId[id]) return Promise.resolve(showByTxId[id]);
        return Promise.resolve(makeShowResp(id));
      }),
    },
  };
}

describe('processConfirmPaymentEvents', () => {
  beforeEach(() => {
    sendLenderBookingRequestSMS.mockClear();
    sendLenderBookingRequestSMS.mockResolvedValue(undefined);
  });

  test('filters out events whose lastTransition is NOT confirm-payment', async () => {
    const events = [
      makeEvent({ txId: 'tx-A', lastTransition: 'transition/request-payment' }),
      makeEvent({ txId: 'tx-B', lastTransition: 'transition/accept' }),
      makeEvent({ txId: 'tx-C', lastTransition: 'transition/decline' }),
    ];
    const sdk = makeSdk({ events });

    const result = await processConfirmPaymentEvents({ sdk });

    expect(sdk.events.query).toHaveBeenCalledWith(
      expect.objectContaining({ eventTypes: 'transaction/transitioned' })
    );
    expect(sdk.transactions.show).not.toHaveBeenCalled();
    expect(sendLenderBookingRequestSMS).not.toHaveBeenCalled();
    expect(result).toMatchObject({ fetched: 3, matched: 0, attempted: 0, succeeded: 0, failed: 0 });
  });

  test('dispatches lender SMS for each confirm-payment event', async () => {
    const events = [
      makeEvent({ txId: 'tx-1', lastTransition: 'transition/confirm-payment' }),
      makeEvent({ txId: 'tx-2', lastTransition: 'transition/request-payment' }),
      makeEvent({ txId: 'tx-3', lastTransition: 'transition/confirm-payment' }),
    ];
    const sdk = makeSdk({ events });

    const result = await processConfirmPaymentEvents({ sdk });

    expect(sdk.transactions.show).toHaveBeenCalledTimes(2);
    expect(sendLenderBookingRequestSMS).toHaveBeenCalledTimes(2);
    expect(sendLenderBookingRequestSMS).toHaveBeenCalledWith(
      expect.objectContaining({
        tx: expect.objectContaining({ id: { uuid: 'tx-1' }, type: 'transaction' }),
        listing: expect.objectContaining({ type: 'listing' }),
        lineItems: expect.any(Array),
        sdk,
      })
    );
    expect(result).toMatchObject({ fetched: 3, matched: 2, attempted: 2, succeeded: 2, failed: 0 });
  });

  test('per-event failure does not kill the batch', async () => {
    const events = [
      makeEvent({ txId: 'tx-good', lastTransition: 'transition/confirm-payment' }),
      makeEvent({ txId: 'tx-bad', lastTransition: 'transition/confirm-payment' }),
      makeEvent({ txId: 'tx-also-good', lastTransition: 'transition/confirm-payment' }),
    ];
    const sdk = makeSdk({
      events,
      showFailures: { 'tx-bad': new Error('Sharetribe 500') },
    });

    const result = await processConfirmPaymentEvents({ sdk });

    expect(sdk.transactions.show).toHaveBeenCalledTimes(3);
    expect(sendLenderBookingRequestSMS).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ matched: 3, attempted: 3, succeeded: 2, failed: 1 });
  });

  test('helper failure on one event does not block subsequent events (idempotency-friendly)', async () => {
    sendLenderBookingRequestSMS
      .mockRejectedValueOnce(new Error('twilio rate limit'))
      .mockResolvedValueOnce(undefined);

    const events = [
      makeEvent({ txId: 'tx-fail', lastTransition: 'transition/confirm-payment' }),
      makeEvent({ txId: 'tx-ok', lastTransition: 'transition/confirm-payment' }),
    ];
    const sdk = makeSdk({ events });

    const result = await processConfirmPaymentEvents({ sdk });

    expect(sendLenderBookingRequestSMS).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ matched: 2, attempted: 2, succeeded: 1, failed: 1 });
  });

  test('skips events whose resource id is missing', async () => {
    const events = [
      {
        id: { uuid: 'evt-noid' },
        attributes: {
          eventType: 'transaction/transitioned',
          resource: { attributes: { lastTransition: 'transition/confirm-payment' } },
        },
      },
      makeEvent({ txId: 'tx-real', lastTransition: 'transition/confirm-payment' }),
    ];
    const sdk = makeSdk({ events });

    const result = await processConfirmPaymentEvents({ sdk });

    expect(sdk.transactions.show).toHaveBeenCalledTimes(1);
    expect(sdk.transactions.show).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tx-real' })
    );
    expect(result).toMatchObject({ matched: 2, attempted: 1 });
  });

  test('5-min lookback window is passed to events.query', async () => {
    const sdk = makeSdk({ events: [] });
    const before = Date.now();
    await processConfirmPaymentEvents({ sdk });
    const after = Date.now();

    const call = sdk.events.query.mock.calls[0][0];
    const startMs = Date.parse(call.createdAtStart);
    expect(startMs).toBeGreaterThanOrEqual(before - 5 * 60 * 1000);
    expect(startMs).toBeLessThanOrEqual(after - 5 * 60 * 1000 + 50);
  });
});

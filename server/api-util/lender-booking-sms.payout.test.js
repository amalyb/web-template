/**
 * Regression test for the May 8, 2026 dogfood bug:
 *
 *   [SMS][booking-request] Could not calculate payout: Value must be a Money type
 *
 * Cause: when the cron poller fetches the transaction via
 * sdk.transactions.show() (Integration SDK), tx.attributes.lineItems[i]
 * unitPrice/lineTotal come back as plain { amount, currency } objects, NOT
 * Money instances. calculateTotalForProvider in lineItemHelpers.js does an
 * `instanceof Money` check and throws on plain objects. The helper now uses
 * calculateLenderPayoutTotal (server/api-util/lenderEarnings.js) which has a
 * tolerant fallback path for the plain-object shape — same helper
 * sendLenderRequestReminders.js uses.
 */

jest.mock('../redis', () => ({
  getRedis: jest.fn(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  })),
}));

jest.mock('./integrationSdk', () => ({
  getIntegrationSdk: jest.fn(() => ({
    users: {
      show: jest.fn().mockResolvedValue({
        data: {
          data: {
            attributes: {
              profile: { protectedData: { phone: '+15551112222' } },
            },
          },
        },
      }),
    },
  })),
}));

jest.mock('./shortlink', () => ({
  shortLink: jest.fn(async url => url),
}));

jest.mock('./sendSMS', () => ({
  sendSMS: jest.fn().mockResolvedValue(undefined),
}));

const { sendSMS: sendSmsMock } = require('./sendSMS');
const { sendLenderBookingRequestSMS } = require('./lender-booking-sms');

// Mirrors the shape that sdk.transactions.show() returns from the
// Integration SDK: line items where unitPrice / lineTotal are plain
// { amount, currency } objects (not Money instances).
function makePlainObjectLineItems() {
  return [
    {
      code: 'line-item/day',
      includeFor: ['customer', 'provider'],
      unitPrice: { amount: 5000, currency: 'USD' }, // $50.00
      quantity: 2,
      lineTotal: { amount: 10000, currency: 'USD' }, // $100.00
      reversal: false,
    },
    {
      code: 'line-item/provider-commission',
      includeFor: ['provider'],
      unitPrice: { amount: 10000, currency: 'USD' },
      percentage: -10,
      lineTotal: { amount: -1000, currency: 'USD' }, // -$10.00 commission
      reversal: false,
    },
    {
      code: 'line-item/customer-commission',
      includeFor: ['customer'],
      unitPrice: { amount: 10000, currency: 'USD' },
      percentage: 5,
      lineTotal: { amount: 500, currency: 'USD' },
      reversal: false,
    },
  ];
}

function makeTx() {
  return {
    id: { uuid: 'tx-abc-123' },
    type: 'transaction',
    attributes: {
      lineItems: makePlainObjectLineItems(),
      protectedData: {},
    },
    relationships: {
      provider: { data: { id: { uuid: 'prov-1' } } },
      customer: {
        data: {
          id: { uuid: 'cust-1' },
          attributes: { profile: { firstName: 'Amalia' } },
        },
      },
    },
  };
}

function makeListing() {
  return {
    id: { uuid: 'list-1' },
    type: 'listing',
    attributes: { title: 'Cindy Dress' },
    relationships: { author: { data: { id: { uuid: 'prov-1' } } } },
  };
}

describe('sendLenderBookingRequestSMS — payout calculation from plain-object lineItems', () => {
  beforeEach(() => {
    sendSmsMock.mockClear();
    sendSmsMock.mockResolvedValue(undefined);
  });

  test('SMS body includes "You\'ll earn $90.00" when lineItems are Integration-SDK shape', async () => {
    const tx = makeTx();
    const listing = makeListing();
    const sdk = { users: { show: jest.fn() } };

    await sendLenderBookingRequestSMS({ tx, listing, lineItems: tx.attributes.lineItems, sdk });

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const [, body] = sendSmsMock.mock.calls[0];
    // Provider portion: 100 (rental) + (-10) (commission) = $90.00
    expect(body).toMatch(/You'll earn \$90\.00 💸🤑/);
    expect(body).toMatch(/Amalia wants to borrow your "Cindy Dress"/);
    expect(body).toMatch(/You have 24hrs to accept:/);
  });

  test('falls back to tx.attributes.lineItems when explicit lineItems arg is omitted', async () => {
    const tx = makeTx();
    const listing = makeListing();
    const sdk = { users: { show: jest.fn() } };

    await sendLenderBookingRequestSMS({ tx, listing, lineItems: null, sdk });

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const [, body] = sendSmsMock.mock.calls[0];
    expect(body).toMatch(/You'll earn \$90\.00 💸🤑/);
  });

  test('SMS still sends (without earnings tease) when lineItems are missing entirely', async () => {
    const tx = makeTx();
    tx.attributes.lineItems = [];
    const listing = makeListing();
    const sdk = { users: { show: jest.fn() } };

    await sendLenderBookingRequestSMS({ tx, listing, lineItems: null, sdk });

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const [, body] = sendSmsMock.mock.calls[0];
    expect(body).toMatch(/Amalia wants to borrow your "Cindy Dress"/);
    expect(body).toMatch(/You have 24hrs to accept:/);
    expect(body).not.toMatch(/You'll earn/);
  });
});

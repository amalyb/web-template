/**
 * Regression test for H3 on sendShipByReminders.js.
 *
 * Fourth instance of the sdk.transactions.update silent-failure pattern
 * (after sendLenderRequestReminders in April, sendShippingReminders in
 * April, and sendReturnReminders as H2 in 9.2). The Integration SDK
 * does not expose sdk.transactions.update — every write threw, was
 * swallowed by the catch, and outbound.reminders.<key> flags never
 * persisted across cron ticks.
 *
 * Migrated to upsertProtectedData() from server/lib/txData.js. The
 * `outbound` key was already in the ALLOWED_PROTECTED_DATA_KEYS
 * whitelist, so nested reminders land intact.
 */

const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, 'sendShipByReminders.js');

describe('H3 — upsertProtectedData migration', () => {
  test('source no longer references sdk.transactions.update as a call', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/sdk\.transactions\.update\s*\(/);
  });

  test('ship-by reminder branch calls upsertProtectedData', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const matches = src.match(/upsertProtectedData\s*\(/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('H3 — outbound.reminders patch survives the whitelist prune', () => {
  const mockUpdateMetadata = jest.fn(() => Promise.resolve({ data: { data: {} } }));

  beforeAll(() => {
    jest.doMock('sharetribe-flex-integration-sdk', () => ({
      createInstance: jest.fn(() => ({
        transactions: { updateMetadata: mockUpdateMetadata },
      })),
    }));
    process.env.INTEGRATION_CLIENT_ID = 'test-client-id';
    process.env.INTEGRATION_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => {
    jest.dontMock('sharetribe-flex-integration-sdk');
  });

  beforeEach(() => {
    mockUpdateMetadata.mockClear();
  });

  test('reminder patch reaches updateMetadata with outbound.reminders.<key> intact', async () => {
    const { upsertProtectedData } = require('../lib/txData');

    const existingOutbound = {
      acceptedAt: '2026-04-20T14:00:00.000Z',
      shipByDate: '2026-04-23',
      reminders: { t24: '2026-04-22T15:00:00.000Z' },
    };
    const updatedReminders = {
      ...existingOutbound.reminders,
      morning: '2026-04-23T15:00:00.000Z',
    };

    await upsertProtectedData(
      'tx-h3',
      {
        outbound: {
          ...existingOutbound,
          reminders: updatedReminders,
        },
      },
      { source: 'ship-by-reminders' }
    );

    expect(mockUpdateMetadata).toHaveBeenCalledTimes(1);
    const sentPd = mockUpdateMetadata.mock.calls[0][0].metadata.protectedData;
    expect(sentPd.outbound.reminders).toEqual({
      t24: '2026-04-22T15:00:00.000Z',
      morning: '2026-04-23T15:00:00.000Z',
    });
    // Sibling outbound fields (acceptedAt, shipByDate) must also round-trip.
    expect(sentPd.outbound.acceptedAt).toBe('2026-04-20T14:00:00.000Z');
    expect(sentPd.outbound.shipByDate).toBe('2026-04-23');
  });
});

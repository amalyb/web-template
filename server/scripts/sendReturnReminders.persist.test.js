/**
 * Regression tests for H2 on sendReturnReminders.js.
 *
 * The old updateTransactionProtectedData helper relied on
 * sdk.transactions.update/updateMetadata/updateProtectedData — none of
 * which the Integration SDK exposes. Every write threw, was caught, and
 * the cross-process dedupe flags (tMinus1SentAt, todayReminderSentAt,
 * returnSms.dueTodayLastSentLocalDate) never persisted.
 *
 * Migrated to upsertProtectedData() from server/lib/txData.js. Post-task-30
 * (May 1, 2026), upsertProtectedData routes through the v6
 * operator-update-pd-<state> transitions instead of updateMetadata, so
 * persistence actually lands at tx.attributes.protectedData.<key>.
 */

const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, 'sendReturnReminders.js');

describe('H2 — upsertProtectedData migration', () => {
  test('source no longer references updateTransactionProtectedData helper', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/updateTransactionProtectedData/);
  });

  test('source no longer references txApi.update/updateMetadata/updateProtectedData write paths', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/txApi\.update\s*\(/);
    expect(src).not.toMatch(/txApi\.updateMetadata\s*\(/);
    expect(src).not.toMatch(/txApi\.updateProtectedData\s*\(/);
    expect(src).not.toMatch(/sdk\.transactions\.update\s*\(/);
  });

  test('T-1 / TODAY / LATE branches each call upsertProtectedData', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const matches = src.match(/upsertProtectedData\s*\(/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

describe('H2 — return + returnSms survive the whitelist prune', () => {
  const mockShow = jest.fn();
  const mockTransition = jest.fn(() => Promise.resolve({ data: { data: {} } }));

  beforeAll(() => {
    jest.doMock('sharetribe-flex-integration-sdk', () => ({
      createInstance: jest.fn(() => ({
        transactions: { show: mockShow, transition: mockTransition },
      })),
    }));
    process.env.INTEGRATION_CLIENT_ID = 'test-client-id';
    process.env.INTEGRATION_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => {
    jest.dontMock('sharetribe-flex-integration-sdk');
  });

  beforeEach(() => {
    mockShow.mockReset();
    mockTransition.mockClear();
  });

  test('T-1 patch reaches the operator-update-pd transition with return.tMinus1SentAt intact', async () => {
    const { upsertProtectedData } = require('../lib/txData');

    // Return reminders fire while the tx sits in state/accepted (between
    // book and delivery). Mock show accordingly.
    mockShow.mockResolvedValueOnce({
      data: { data: { attributes: { state: 'state/accepted', protectedData: {} } } },
    });

    await upsertProtectedData(
      'tx-h2',
      {
        return: { tMinus1SentAt: '2026-04-21T17:00:00.000Z' },
      },
      { source: 'return-reminders' }
    );

    expect(mockTransition).toHaveBeenCalledTimes(1);
    const call = mockTransition.mock.calls[0][0];
    expect(call.transition).toBe('transition/operator-update-pd-accepted');
    const sentPd = call.params.protectedData;
    expect(sentPd.return).toEqual({ tMinus1SentAt: '2026-04-21T17:00:00.000Z' });
  });

  test('TODAY patch reaches the operator-update-pd transition with return + returnSms intact', async () => {
    const { upsertProtectedData } = require('../lib/txData');

    mockShow.mockResolvedValueOnce({
      data: { data: { attributes: { state: 'state/accepted', protectedData: {} } } },
    });

    await upsertProtectedData(
      'tx-h2',
      {
        return: { todayReminderSentAt: '2026-04-21T17:00:00.000Z' },
        returnSms: { dueTodayLastSentLocalDate: '2026-04-21' },
      },
      { source: 'return-reminders' }
    );

    expect(mockTransition).toHaveBeenCalledTimes(1);
    const sentPd = mockTransition.mock.calls[0][0].params.protectedData;
    expect(sentPd.return).toEqual({ todayReminderSentAt: '2026-04-21T17:00:00.000Z' });
    expect(sentPd.returnSms).toEqual({ dueTodayLastSentLocalDate: '2026-04-21' });
  });
});

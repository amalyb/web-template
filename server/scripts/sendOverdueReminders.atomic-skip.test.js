/**
 * Atomic charge-plus-SMS tests for sendOverdueReminders.js (May 29 2026).
 *
 * Regression guard for the reordered per-tx loop body. Before the fix the
 * loop fired applyCharges() BEFORE checking whether the overdue SMS could
 * actually be sent, so a borrower whose tx failed a downstream SMS gate
 * (missing label, missing phone, day-7 hard stop) got billed with no
 * notification. The fix moves all SMS-eligibility gates (Block A) ahead of
 * the charge (Block B); a failing gate now `continue`s and skips BOTH.
 *
 * Invariant under test: for an overdue non-return tx in a given run, either
 * both the SMS-attempt AND the charge-attempt happen, or NEITHER does.
 *
 * Pattern mirrors lateFees.applyCharges.test.js: jest.resetModules() +
 * per-test env setup, dependency mocks wired via jest.doMock, then a fresh
 * require of the SUT. The real businessDays helper is left unmocked so
 * daysLate is computed for real from the fixture dates.
 */

// Mon Apr 13 2026 (PT) due date. No Sundays/holidays in the windows below.
const FIXTURE_DUE_AT = '2026-04-13T08:00:00Z';
const NOW_DAY2 = '2026-04-15T17:00:00Z';  // → 2 chargeable late days (in 1..6)
const NOW_DAY13 = '2026-04-28T17:00:00Z'; // → 13 chargeable late days (> 6, hard stop)

const TX_ID = 'atomic-tx-uuid';

/**
 * Build an accepted, never-scanned (Scenario B / non-return) transaction.
 * Phone + listing + customer are toggleable to exercise individual gates.
 */
function makeTx({ withPhone = true, withCustomer = true, withListing = true } = {}) {
  const protectedData = { return: { dueAt: FIXTURE_DUE_AT } };
  if (withPhone) protectedData.customerPhone = '+15551234567';

  const tx = {
    id: { uuid: TX_ID },
    type: 'transaction',
    attributes: { state: 'accepted', protectedData },
    relationships: {},
  };
  if (withListing) {
    tx.relationships.listing = { data: { type: 'listing', id: { uuid: 'list-1' } } };
  }
  if (withCustomer) {
    tx.relationships.customer = { data: { type: 'customer', id: { uuid: 'cust-1' } } };
  }
  return tx;
}

function makeIncluded({ withListing = true, withCustomer = true } = {}) {
  const included = [];
  if (withListing) {
    included.push({ type: 'listing', id: { uuid: 'list-1' }, attributes: { title: 'Test Item' } });
  }
  if (withCustomer) {
    // Customer with a profile but NO phone in protectedData (phone comes from
    // tx protectedData in the happy path; this guarantees the NO-PHONE test
    // can't accidentally fall back to a profile phone).
    included.push({
      type: 'customer',
      id: { uuid: 'cust-1' },
      attributes: { profile: { displayName: 'Test Borrower', protectedData: {} } },
    });
  }
  return included;
}

function makeSdk(acceptedTxs, included) {
  return {
    transactions: {
      // Only the "accepted-state" lastTransitions query returns candidates;
      // the "delivered-state" query returns none. Mock updated when the cron
      // switched from the silently-ignored `state: 'accepted'` filter to
      // `lastTransitions: ['transition/accept', 'transition/operator-update-pd-accepted']`.
      query: jest.fn(async (q) => {
        const isAcceptedQuery =
          Array.isArray(q.lastTransitions) &&
          q.lastTransitions.includes('transition/accept');
        return {
          data: { data: isAcceptedQuery ? acceptedTxs : [], included },
        };
      }),
      show: jest.fn(),
      transition: jest.fn(),
    },
  };
}

function makeRedis() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Wire all dependency mocks and return a fresh SUT plus the mock handles.
 * Must run inside a test (after jest.resetModules) so the module-level
 * FORCE_NOW / flag reads in sendOverdueReminders.js pick up our env.
 */
function loadScript({ now, tx, included, labelUrl }) {
  jest.resetModules();

  // Deterministic clock + clean flag state.
  process.env.FORCE_NOW = now;
  delete process.env.DRY_RUN;
  delete process.env.SMS_DRY_RUN;
  delete process.env.ONLY_PHONE;
  delete process.env.ONLY_TX;
  delete process.env.VERBOSE;
  delete process.env.LIMIT;

  const applyChargesMock = jest.fn().mockResolvedValue({ charged: false, reason: 'noop' });
  const resolveReturnLabelUrlMock = jest.fn().mockResolvedValue(
    labelUrl === null ? null : { url: labelUrl || 'https://label.example/return' }
  );
  const sendSMSMock = jest.fn().mockResolvedValue({ success: true });
  const redisMock = makeRedis();
  const sdk = makeSdk(tx ? [tx] : [], included || []);

  jest.doMock('../util/getFlexSdk', () => () => sdk);
  jest.doMock('../lib/lateFees', () => ({ applyCharges: applyChargesMock }));
  jest.doMock('../lib/shippo', () => ({ resolveReturnLabelUrl: resolveReturnLabelUrlMock }));
  jest.doMock('../api-util/sendSMS', () => ({ sendSMS: sendSMSMock }));
  jest.doMock('../api-util/shortlink', () => ({ shortLink: jest.fn().mockResolvedValue(null) }));
  jest.doMock('../redis', () => ({ getRedis: () => redisMock }));
  jest.doMock('../email/emailClient', () => ({
    sendTransactionalEmail: jest.fn().mockResolvedValue(undefined),
  }));

  const { sendOverdueReminders } = require('./sendOverdueReminders');
  return { sendOverdueReminders, applyChargesMock, resolveReturnLabelUrlMock, sendSMSMock, sdk };
}

describe('sendOverdueReminders — atomic charge+SMS gating (Block A before Block B)', () => {
  const ORIGINAL_FORCE_NOW = process.env.FORCE_NOW;

  afterAll(() => {
    if (ORIGINAL_FORCE_NOW === undefined) delete process.env.FORCE_NOW;
    else process.env.FORCE_NOW = ORIGINAL_FORCE_NOW;
  });

  test('NO-LABEL: missing return label skips BOTH charge and SMS', async () => {
    const { sendOverdueReminders, applyChargesMock, sendSMSMock } = loadScript({
      now: NOW_DAY2,
      tx: makeTx(),
      included: makeIncluded(),
      labelUrl: null, // resolveReturnLabelUrl → null
    });

    await sendOverdueReminders();

    expect(applyChargesMock).not.toHaveBeenCalled();
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  test('NO-PHONE: missing borrower phone skips BOTH charge and SMS', async () => {
    const { sendOverdueReminders, applyChargesMock, sendSMSMock } = loadScript({
      now: NOW_DAY2,
      tx: makeTx({ withPhone: false }),
      included: makeIncluded(), // customer has no profile phone either
      labelUrl: 'https://label.example/return',
    });

    await sendOverdueReminders();

    expect(applyChargesMock).not.toHaveBeenCalled();
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  test('Day-7 hard stop: daysLate > 6 skips BOTH charge and SMS (behavioral change)', async () => {
    // Pre-fix, the charge fired before this hard stop. The fix moves the
    // hard stop into Block A (gate a) so the charge is now also skipped.
    const { sendOverdueReminders, applyChargesMock, sendSMSMock } = loadScript({
      now: NOW_DAY13,
      tx: makeTx(),
      included: makeIncluded(),
      labelUrl: 'https://label.example/return',
    });

    await sendOverdueReminders();

    expect(applyChargesMock).not.toHaveBeenCalled();
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  // Regression test for the Scenario-B self-loop bug surfaced in code review:
  // transition/privileged-apply-late-fees-non-return is :from :state/accepted
  // :to :state/accepted (see ext/transaction-processes/default-booking/
  // process.edn:148-163). On day 2 the cron charges and the tx's lastTransition
  // flips from transition/accept to the non-return late-fee transition. If the
  // accepted allowlist doesn't include that self-loop transition, the cron
  // will silently miss days 3-6 (the tx wouldn't be returned by either the
  // accepted query OR be processable as Scenario B from the delivered query —
  // delivered + !hasScan hits POLICY SKIP). This regression test locks the
  // self-loop transition into the accepted allowlist.
  test('Scenario B self-loop: tx with lastTransition=non-return late-fee still charges', async () => {
    const tx = makeTx();
    tx.attributes.lastTransition = 'transition/privileged-apply-late-fees-non-return';
    const { sendOverdueReminders, applyChargesMock, sendSMSMock } = loadScript({
      now: NOW_DAY2,
      tx,
      included: makeIncluded(),
      labelUrl: 'https://label.example/return',
    });
    applyChargesMock.mockResolvedValue({
      charged: true,
      items: ['late-fee'],
      lateDays: 2,
      amounts: [{ code: 'late-fee', cents: 1500 }],
    });

    await sendOverdueReminders();

    expect(applyChargesMock).toHaveBeenCalledTimes(1);
    expect(sendSMSMock).toHaveBeenCalledTimes(1);
  });

  test('Happy path: all gates pass → applyCharges fires, THEN sendSMS fires', async () => {
    const { sendOverdueReminders, applyChargesMock, sendSMSMock } = loadScript({
      now: NOW_DAY2,
      tx: makeTx(),
      included: makeIncluded(),
      labelUrl: 'https://label.example/return',
    });
    // Charge succeeds with a non-replacement item so triggerReplacement* is
    // not invoked (avoids needing a sdk.transactions.show fixture).
    applyChargesMock.mockResolvedValue({
      charged: true,
      items: ['late-fee'],
      lateDays: 2,
      amounts: [{ code: 'late-fee', cents: 1500 }],
    });

    await sendOverdueReminders();

    expect(applyChargesMock).toHaveBeenCalledTimes(1);
    expect(sendSMSMock).toHaveBeenCalledTimes(1);
    // Order: charge (Block B) before SMS (Block C).
    expect(applyChargesMock.mock.invocationCallOrder[0])
      .toBeLessThan(sendSMSMock.mock.invocationCallOrder[0]);
  });

  // NO-COPY gate (Block A, gate b): buildOverdueMessage returns null only for
  // days outside 1..6. Under the new gate ordering, gate (a) (daysLate > 6)
  // catches every >6 case first and the loop never processes daysLate < 1, so
  // the NO-COPY gate is shadowed and cannot be isolated behaviorally — it is
  // defense-in-depth. The prompt's test #4 collapses into the day-7 hard-stop
  // case above. We instead lock the underlying contract directly.
  test('NO-COPY contract: buildOverdueMessage returns null outside day 1..6', () => {
    const { buildOverdueMessage } = require('./messages/overdueMessages');
    expect(buildOverdueMessage(0, { itemTitle: 'x', shortUrl: 'y' })).toBeNull();
    expect(buildOverdueMessage(7, { itemTitle: 'x', shortUrl: 'y' })).toBeNull();
    expect(buildOverdueMessage(2, { itemTitle: 'x', shortUrl: 'y' })).not.toBeNull();
  });
});

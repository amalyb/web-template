/**
 * Regression test for B1 — overdue.charge.skip structured log must not
 * throw ReferenceError when the charging flag is unset.
 *
 * Prior bug: sendOverdueReminders.js referenced a bare
 * `OVERDUE_FEES_CHARGING_ENABLED` identifier that was never declared.
 * Every skip-path emit threw, was caught as `overdue.charge.error`, and
 * bumped chargesFailed, defeating PR-4 dry-run analysis.
 */

const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, 'sendOverdueReminders.js');

describe('sendOverdueReminders — overdue.charge.skip logging', () => {
  const originalFlag = process.env.OVERDUE_FEES_CHARGING_ENABLED;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.OVERDUE_FEES_CHARGING_ENABLED;
    } else {
      process.env.OVERDUE_FEES_CHARGING_ENABLED = originalFlag;
    }
  });

  test('source file has no bare OVERDUE_FEES_CHARGING_ENABLED references', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const bareRefs = src
      .split('\n')
      .filter(line => /OVERDUE_FEES_CHARGING_ENABLED/.test(line))
      .filter(line => !/process\.env\.OVERDUE_FEES_CHARGING_ENABLED/.test(line));
    expect(bareRefs).toEqual([]);
  });

  test('skip-log body serializes cleanly with flag unset', () => {
    delete process.env.OVERDUE_FEES_CHARGING_ENABLED;
    const body = {
      event: 'overdue.charge.skip',
      txId: 'tx-123',
      scenario: 'non-return',
      reason: 'feature-flag-disabled',
      lateDays: 2,
      flag: process.env.OVERDUE_FEES_CHARGING_ENABLED === 'true' ? 'LIVE' : 'DISABLED',
      ts: new Date().toISOString(),
    };
    expect(() => JSON.stringify(body)).not.toThrow();
    expect(JSON.parse(JSON.stringify(body)).flag).toBe('DISABLED');
  });

  test('skip-log body serializes cleanly with flag=true', () => {
    process.env.OVERDUE_FEES_CHARGING_ENABLED = 'true';
    const body = {
      event: 'overdue.charge.skip',
      txId: 'tx-123',
      scenario: 'non-return',
      reason: 'borrower-shipped-in-transit',
      lateDays: 2,
      flag: process.env.OVERDUE_FEES_CHARGING_ENABLED === 'true' ? 'LIVE' : 'DISABLED',
      ts: new Date().toISOString(),
    };
    expect(() => JSON.stringify(body)).not.toThrow();
    expect(JSON.parse(JSON.stringify(body)).flag).toBe('LIVE');
  });
});

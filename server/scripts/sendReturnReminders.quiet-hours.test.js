/**
 * Regression test for H1 on sendReturnReminders.js.
 *
 * The quiet-hours gate must run BEFORE acquireRedisLock. The per-tx lock
 * has a 24h TTL; if the first cron tick lands in quiet hours and grabs
 * the lock, every later tick the same day short-circuits on "lock held"
 * and the T-1/TODAY SMS is lost for the day.
 */

const fs = require('fs');
const path = require('path');

const { withinSendWindow } = require('../util/time');

const SCRIPT = path.resolve(__dirname, 'sendReturnReminders.js');

describe('H1 — quiet-hours gate ordering', () => {
  const originalForceNow = process.env.FORCE_NOW;

  afterEach(() => {
    if (originalForceNow === undefined) {
      delete process.env.FORCE_NOW;
    } else {
      process.env.FORCE_NOW = originalForceNow;
    }
  });

  test('7:45 AM PT is OUTSIDE the send window', () => {
    // 7:45 AM PT ≈ 14:45 UTC during PDT (April, DST active).
    process.env.FORCE_NOW = '2026-04-21T14:45:00.000Z';
    expect(withinSendWindow()).toBe(false);
  });

  test('9:00 AM PT is INSIDE the send window', () => {
    // 9:00 AM PT ≈ 16:00 UTC during PDT.
    process.env.FORCE_NOW = '2026-04-21T16:00:00.000Z';
    expect(withinSendWindow()).toBe(true);
  });

  test('source orders withinSendWindow() check BEFORE acquireRedisLock', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const quietHoursIdx = src.indexOf('[RETURN-REMINDER][QUIET-HOURS]');
    const lockKeyIdx = src.indexOf('return-reminders:${reminderType}:${txId}:');
    expect(quietHoursIdx).toBeGreaterThan(0);
    expect(lockKeyIdx).toBeGreaterThan(0);
    expect(quietHoursIdx).toBeLessThan(lockKeyIdx);
  });
});

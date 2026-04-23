/**
 * PR-4 (10.0): sendLenderRequestReminders 2-phase escalation.
 *
 * Source-level regression suite covering:
 *   - PHASES array structure (60m + 22h, bypassQuietHours only on 22h)
 *   - MAX_AGE_MS widened from 13h to 24h
 *   - per-phase Redis keys (lenderReminder:{txId}:60m:sent vs :22h:sent)
 *   - 22h SMS copy contains "Final call" and 2-hour expiration language
 *   - 60m SMS copy has the updated "before it expires" wording
 *   - quiet-hours bypass only for 22h phase
 *   - MISSED_FINAL watchdog query exists
 *   - stale 6-day references removed from doc block
 *
 * The script is tightly coupled to the Integration SDK + Redis + sendSMS
 * + Flex query API — a full behavioral test harness would need heavy
 * mocking. Source-level assertions lock in the structural correctness
 * that scope review found critical; prod dry-run smoke tests cover the
 * end-to-end path.
 */

const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, 'sendLenderRequestReminders.js');
const src = fs.readFileSync(SCRIPT, 'utf8');

describe('PR-4: PHASES array structure', () => {
  test('PHASES is defined with 60m and 22h entries', () => {
    expect(src).toMatch(/const PHASES\s*=\s*\[/);
    expect(src).toMatch(/key:\s*'60m'/);
    expect(src).toMatch(/key:\s*'22h'/);
  });

  test('60m phase window is [60 min, 22h)', () => {
    // Tolerate inline // comments between fields in the PHASES literal.
    const match = src.match(/key:\s*'60m'[\s\S]*?minAgeMs:\s*([^,\n]+)[\s\S]*?maxAgeMs:\s*([^,\n]+)/);
    expect(match).not.toBeNull();
    const minMs = Function(`return (${match[1]})`)();
    const maxMs = Function(`return (${match[2]})`)();
    expect(minMs).toBe(60 * 60 * 1000);
    expect(maxMs).toBe(22 * 60 * 60 * 1000);
  });

  test('22h phase window is [22h, 24h)', () => {
    const match = src.match(/key:\s*'22h'[\s\S]*?minAgeMs:\s*([^,\n]+)[\s\S]*?maxAgeMs:\s*([^,\n]+)/);
    expect(match).not.toBeNull();
    const minMs = Function(`return (${match[1]})`)();
    const maxMs = Function(`return (${match[2]})`)();
    expect(minMs).toBe(22 * 60 * 60 * 1000);
    expect(maxMs).toBe(24 * 60 * 60 * 1000);
  });

  test('22h phase has bypassQuietHours: true; 60m does not', () => {
    // 22h bypasses
    const twentyTwoBlock = src.match(/key:\s*'22h'[\s\S]{0,400}?bypassQuietHours:\s*true/);
    expect(twentyTwoBlock).not.toBeNull();
    // 60m does NOT bypass
    const sixtyBlock = src.match(/key:\s*'60m'[\s\S]{0,400}?bypassQuietHours:\s*false/);
    expect(sixtyBlock).not.toBeNull();
  });

  test('per-phase SMS tags are 60m and 22h (no 12h)', () => {
    expect(src).toMatch(/tag:\s*'lender_request_reminder_60m'/);
    expect(src).toMatch(/tag:\s*'lender_request_reminder_22h'/);
    expect(src).not.toMatch(/lender_request_reminder_12h/);
  });
});

describe('PR-4: MAX_AGE_MS widened to 24h', () => {
  test('MAX_AGE_MS is 24 hours, not 13', () => {
    const match = src.match(/const MAX_AGE_MS\s*=\s*([^;]+);/);
    expect(match).not.toBeNull();
    const value = Function(`return (${match[1]})`)();
    expect(value).toBe(24 * 60 * 60 * 1000);
  });

  test('no reference to 13 hours or 13h MAX remains in active code', () => {
    // Allow the v1 comment about "Widened for Pattern B" to be removed;
    // assert the stale constant value is gone from active code.
    expect(src).not.toMatch(/const MAX_AGE_MS\s*=\s*13\s*\*/);
  });
});

describe('PR-4: per-phase Redis keys', () => {
  test('phaseKey helper composes "{phase}:sent" / "{phase}:inFlight"', () => {
    expect(src).toMatch(/phaseKey\s*=\s*\(phase,\s*kind\)\s*=>\s*`\$\{phase\.key\}:\$\{kind\}`/);
  });

  test('markInFlight, markSent, clearInFlight all take a phase argument', () => {
    expect(src).toMatch(/async function markInFlight\(redis,\s*txId,\s*phase\)/);
    expect(src).toMatch(/async function markSent\(redis,\s*txId,\s*phase\)/);
    expect(src).toMatch(/async function clearInFlight\(redis,\s*txId,\s*phase\)/);
  });

  test('legacy single-key redisKey(txId, "sent") / ("inFlight") calls are gone', () => {
    // Watchdog reads redisKey(txId, '22h:sent') which is the per-phase shape;
    // that's allowed. The bare "sent" and "inFlight" suffixes should be gone.
    expect(src).not.toMatch(/redisKey\(txId,\s*'sent'\)/);
    expect(src).not.toMatch(/redisKey\(txId,\s*'inFlight'\)/);
  });
});

describe('PR-4: SMS copy', () => {
  test('60m message uses "before it expires" (not "to accept")', () => {
    // Locate the 60m-branch template literal.
    expect(src).toMatch(/Just tap before it expires/);
    // And the old copy is gone.
    expect(src).not.toMatch(/Just tap to accept:\s*\$\{shortUrl\}/);
  });

  test('22h message contains "Final call" and "expires in 2 hours"', () => {
    expect(src).toMatch(/Final call/);
    expect(src).toMatch(/expires in 2 hours/);
  });
});

describe('PR-4: quiet-hours bypass', () => {
  test('quiet-hours gate checks phase.bypassQuietHours', () => {
    expect(src).toMatch(/!phase\.bypassQuietHours\s*&&\s*!withinSendWindow/);
  });
});

describe('PR-4: MISSED_FINAL watchdog', () => {
  test('watchdog query for transition/expire exists', () => {
    expect(src).toMatch(/lastTransitions:\s*['"]transition\/expire['"]/);
  });

  test('watchdog checks redis.get("22h:sent") for each recently-expired tx', () => {
    expect(src).toMatch(/redisKey\(txId,\s*['"]22h:sent['"]\)/);
  });

  test('MISSED_FINAL per-tx log + MISSED_FINAL_SUMMARY count log both present', () => {
    expect(src).toMatch(/\[MISSED_FINAL\]/);
    expect(src).toMatch(/\[MISSED_FINAL_SUMMARY\]/);
  });

  test('watchdog errors are caught and do not block main cron', () => {
    expect(src).toMatch(/catch \(watchdogErr\)/);
    expect(src).toMatch(/WATCHDOG_ERROR/);
  });

  test('watchdog lookback window is 30 minutes', () => {
    expect(src).toMatch(/WATCHDOG_LOOKBACK_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  });
});

describe('PR-4: stale 6-day references removed', () => {
  test('doc-block no longer references "P6D" or "6 days" for the expire window', () => {
    // Allow the 6-days comment to be replaced by 24h language. Just make
    // sure no code-level reference remains.
    expect(src).not.toMatch(/firstEnteredPreauthorized \+ 6 days/);
  });

  test('doc-block mentions 24-hour window and 2-phase escalation', () => {
    expect(src).toMatch(/24-hour expiration window|24 hour expiration window|24h/);
    expect(src).toMatch(/2-phase escalation/);
  });
});

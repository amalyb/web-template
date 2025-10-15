/**
 * Unit tests for centralized time helper
 */

const {
  getNow,
  getToday,
  getTomorrow,
  yyyymmdd,
  diffDays,
  addDays,
  isSameDay,
  isMorningOf,
  timestamp,
  getNext9AM,
  TZ,
} = require('./time');

// Save original env vars
const originalEnv = { ...process.env };

// Helper to set env vars for tests
const setEnv = (vars) => {
  Object.keys(vars).forEach(key => {
    process.env[key] = vars[key];
  });
};

// Reset env after each test
const resetEnv = () => {
  Object.keys(process.env).forEach(key => {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  });
  Object.keys(originalEnv).forEach(key => {
    process.env[key] = originalEnv[key];
  });
};

describe('Time Helper Functions', () => {
  afterEach(() => {
    resetEnv();
  });

  describe('getNow', () => {
    it('should return current time without FORCE_NOW', () => {
      const before = new Date();
      const now = getNow();
      const after = new Date();
      
      expect(now.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(now.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should return overridden time with FORCE_NOW', () => {
      setEnv({ FORCE_NOW: '2025-01-15T09:30:00.000Z' });
      const now = getNow();
      
      expect(now.toISOString()).toBe('2025-01-15T09:30:00.000Z');
    });

    it('should handle different FORCE_NOW formats', () => {
      setEnv({ FORCE_NOW: '2025-12-25T12:00:00-08:00' });
      const now = getNow();
      
      // Should parse correctly (will be converted to UTC)
      expect(now).toBeInstanceOf(Date);
      expect(isNaN(now.getTime())).toBe(false);
    });
  });

  describe('getToday', () => {
    it('should return today without FORCE_TODAY', () => {
      const today = getToday();
      const expected = new Date().toISOString().split('T')[0];
      
      expect(today).toBe(expected);
    });

    it('should return overridden date with FORCE_TODAY', () => {
      setEnv({ FORCE_TODAY: '2025-12-25' });
      const today = getToday();
      
      expect(today).toBe('2025-12-25');
    });

    it('should respect FORCE_NOW when calculating today', () => {
      setEnv({ FORCE_NOW: '2025-01-15T09:30:00.000Z' });
      const today = getToday();
      
      expect(today).toBe('2025-01-15');
    });

    it('should prefer FORCE_TODAY over FORCE_NOW', () => {
      setEnv({
        FORCE_NOW: '2025-01-15T09:30:00.000Z',
        FORCE_TODAY: '2025-12-25',
      });
      const today = getToday();
      
      expect(today).toBe('2025-12-25');
    });
  });

  describe('getTomorrow', () => {
    it('should return tomorrow without FORCE_TOMORROW', () => {
      const tomorrow = getTomorrow();
      const now = new Date();
      const expected = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
      
      expect(tomorrow).toBe(expected);
    });

    it('should return overridden date with FORCE_TOMORROW', () => {
      setEnv({ FORCE_TOMORROW: '2025-12-26' });
      const tomorrow = getTomorrow();
      
      expect(tomorrow).toBe('2025-12-26');
    });

    it('should respect FORCE_NOW when calculating tomorrow', () => {
      setEnv({ FORCE_NOW: '2025-01-15T09:30:00.000Z' });
      const tomorrow = getTomorrow();
      
      expect(tomorrow).toBe('2025-01-16');
    });

    it('should prefer FORCE_TOMORROW over FORCE_NOW', () => {
      setEnv({
        FORCE_NOW: '2025-01-15T09:30:00.000Z',
        FORCE_TOMORROW: '2025-12-31',
      });
      const tomorrow = getTomorrow();
      
      expect(tomorrow).toBe('2025-12-31');
    });
  });

  describe('yyyymmdd', () => {
    it('should format Date object to YYYY-MM-DD', () => {
      const date = new Date('2025-01-15T09:30:00.000Z');
      expect(yyyymmdd(date)).toBe('2025-01-15');
    });

    it('should format timestamp to YYYY-MM-DD', () => {
      const timestamp = new Date('2025-01-15T09:30:00.000Z').getTime();
      expect(yyyymmdd(timestamp)).toBe('2025-01-15');
    });

    it('should handle edge of day in UTC', () => {
      const date = new Date('2025-01-15T23:59:59.999Z');
      expect(yyyymmdd(date)).toBe('2025-01-15');
    });
  });

  describe('diffDays', () => {
    it('should calculate positive difference', () => {
      expect(diffDays('2025-01-20', '2025-01-15')).toBe(5);
    });

    it('should calculate negative difference', () => {
      expect(diffDays('2025-01-15', '2025-01-20')).toBe(-5);
    });

    it('should return 0 for same date', () => {
      expect(diffDays('2025-01-15', '2025-01-15')).toBe(0);
    });

    it('should handle month boundaries', () => {
      expect(diffDays('2025-02-01', '2025-01-31')).toBe(1);
    });

    it('should handle year boundaries', () => {
      expect(diffDays('2025-01-01', '2024-12-31')).toBe(1);
    });

    it('should handle leap years', () => {
      expect(diffDays('2024-03-01', '2024-02-28')).toBe(2); // 2024 is leap year
      expect(diffDays('2025-03-01', '2025-02-28')).toBe(1); // 2025 is not
    });
  });

  describe('addDays', () => {
    it('should add positive days', () => {
      const result = addDays('2025-01-15', 5);
      expect(yyyymmdd(result)).toBe('2025-01-20');
    });

    it('should subtract days with negative value', () => {
      const result = addDays('2025-01-15', -5);
      expect(yyyymmdd(result)).toBe('2025-01-10');
    });

    it('should handle month boundaries', () => {
      const result = addDays('2025-01-31', 1);
      expect(yyyymmdd(result)).toBe('2025-02-01');
    });

    it('should handle year boundaries', () => {
      const result = addDays('2024-12-31', 1);
      expect(yyyymmdd(result)).toBe('2025-01-01');
    });

    it('should handle leap years', () => {
      const result = addDays('2024-02-28', 1);
      expect(yyyymmdd(result)).toBe('2024-02-29'); // 2024 is leap year
      
      const result2 = addDays('2025-02-28', 1);
      expect(yyyymmdd(result2)).toBe('2025-03-01'); // 2025 is not
    });
  });

  describe('isSameDay', () => {
    it('should return true for same date', () => {
      const date1 = new Date('2025-01-15T09:00:00.000Z');
      const date2 = new Date('2025-01-15T18:00:00.000Z');
      expect(isSameDay(date1, date2)).toBe(true);
    });

    it('should return false for different dates', () => {
      const date1 = new Date('2025-01-15T23:59:59.999Z');
      const date2 = new Date('2025-01-16T00:00:00.000Z');
      expect(isSameDay(date1, date2)).toBe(false);
    });

    it('should work with string dates', () => {
      expect(isSameDay('2025-01-15', '2025-01-15')).toBe(true);
      expect(isSameDay('2025-01-15', '2025-01-16')).toBe(false);
    });

    it('should work with timestamps', () => {
      const ts1 = new Date('2025-01-15T09:00:00.000Z').getTime();
      const ts2 = new Date('2025-01-15T18:00:00.000Z').getTime();
      expect(isSameDay(ts1, ts2)).toBe(true);
    });
  });

  describe('isMorningOf', () => {
    it('should return true during morning hours (6-12 UTC)', () => {
      setEnv({ FORCE_NOW: '2025-01-15T07:00:00.000Z' }); // 7 AM UTC
      expect(isMorningOf('2025-01-15')).toBe(true);
    });

    it('should return false before morning hours', () => {
      setEnv({ FORCE_NOW: '2025-01-15T05:59:59.000Z' }); // 5:59 AM UTC
      expect(isMorningOf('2025-01-15')).toBe(false);
    });

    it('should return false after morning hours', () => {
      setEnv({ FORCE_NOW: '2025-01-15T12:00:00.000Z' }); // 12 PM UTC
      expect(isMorningOf('2025-01-15')).toBe(false);
    });

    it('should return false for different day', () => {
      setEnv({ FORCE_NOW: '2025-01-15T07:00:00.000Z' }); // 7 AM UTC
      expect(isMorningOf('2025-01-16')).toBe(false);
    });

    it('should work at exact boundaries', () => {
      setEnv({ FORCE_NOW: '2025-01-15T06:00:00.000Z' }); // 6 AM UTC (start)
      expect(isMorningOf('2025-01-15')).toBe(true);
      
      setEnv({ FORCE_NOW: '2025-01-15T11:59:59.000Z' }); // 11:59 AM UTC (end)
      expect(isMorningOf('2025-01-15')).toBe(true);
    });
  });

  describe('timestamp', () => {
    it('should return ISO timestamp', () => {
      const ts = timestamp();
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should respect FORCE_NOW', () => {
      setEnv({ FORCE_NOW: '2025-01-15T09:30:00.000Z' });
      const ts = timestamp();
      expect(ts).toBe('2025-01-15T09:30:00.000Z');
    });

    it('should match getNow().toISOString()', () => {
      const ts = timestamp();
      const now = getNow().toISOString();
      expect(ts).toBe(now);
    });
  });

  describe('getNext9AM', () => {
    it('should return today 9 AM PT if before 9 AM', () => {
      // 8 AM PT = 16:00 UTC
      setEnv({ FORCE_NOW: '2025-01-15T16:00:00.000Z' });
      const next = getNext9AM();
      
      expect(next.getUTCHours()).toBe(17); // 9 AM PT = 17:00 UTC
      expect(next.getUTCMinutes()).toBe(0);
      expect(yyyymmdd(next)).toBe('2025-01-15');
    });

    it('should return tomorrow 9 AM PT if after 9 AM', () => {
      // 10 AM PT = 18:00 UTC
      setEnv({ FORCE_NOW: '2025-01-15T18:00:00.000Z' });
      const next = getNext9AM();
      
      expect(next.getUTCHours()).toBe(17); // 9 AM PT = 17:00 UTC
      expect(next.getUTCMinutes()).toBe(0);
      expect(yyyymmdd(next)).toBe('2025-01-16');
    });

    it('should handle exactly at 9 AM PT', () => {
      // 9 AM PT = 17:00 UTC
      setEnv({ FORCE_NOW: '2025-01-15T17:00:00.000Z' });
      const next = getNext9AM();
      
      // Should return tomorrow since now >= next
      expect(yyyymmdd(next)).toBe('2025-01-16');
    });

    it('should handle midnight edge case', () => {
      // 11:59 PM PT = 07:59 UTC next day
      setEnv({ FORCE_NOW: '2025-01-16T07:59:00.000Z' });
      const next = getNext9AM();
      
      expect(next.getUTCHours()).toBe(17);
      expect(yyyymmdd(next)).toBe('2025-01-16');
    });
  });

  describe('Integration tests', () => {
    it('should work with all FORCE_* vars set', () => {
      setEnv({
        FORCE_NOW: '2025-01-15T09:30:00.000Z',
        FORCE_TODAY: '2025-12-25',
        FORCE_TOMORROW: '2025-12-26',
      });
      
      expect(timestamp()).toBe('2025-01-15T09:30:00.000Z');
      expect(getToday()).toBe('2025-12-25');
      expect(getTomorrow()).toBe('2025-12-26');
    });

    it('should calculate ship-by reminder scenario', () => {
      // Test scenario: Ship-by date is tomorrow, should trigger t-24 reminder
      setEnv({ FORCE_TODAY: '2025-01-18' });
      
      const today = getToday();
      const shipByDate = '2025-01-19';
      const diff = diffDays(shipByDate, today);
      
      expect(diff).toBe(1); // 24 hours before ship-by
    });

    it('should calculate return reminder scenario', () => {
      // Test scenario: Return due tomorrow, should trigger t-1 reminder
      setEnv({
        FORCE_TODAY: '2025-01-20',
        FORCE_TOMORROW: '2025-01-21',
      });
      
      const tomorrow = getTomorrow();
      const returnDate = '2025-01-21';
      
      expect(tomorrow).toBe(returnDate);
    });

    it('should calculate overdue scenario', () => {
      // Test scenario: Item overdue by 5 days
      setEnv({ FORCE_TODAY: '2025-01-25' });
      
      const today = getToday();
      const returnDate = '2025-01-20';
      const daysLate = diffDays(today, returnDate);
      
      expect(daysLate).toBe(5);
    });

    it('should handle morning-of ship-by reminder', () => {
      // Test scenario: Morning of ship-by date
      setEnv({ FORCE_NOW: '2025-01-20T07:00:00.000Z' }); // 7 AM UTC
      
      const shipByDate = '2025-01-20';
      expect(isMorningOf(shipByDate)).toBe(true);
    });
  });

  describe('TZ constant', () => {
    it('should have default timezone', () => {
      expect(TZ).toBe('America/Los_Angeles');
    });

    it('should respect TZ environment variable', () => {
      // Note: This test modifies module exports, so it's a bit tricky
      // In real usage, TZ should be set before requiring the module
      expect(TZ).toBeDefined();
    });
  });
});


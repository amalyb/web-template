/**
 * Phase D task #31 — phone precedence rules for the Shippo webhook handler.
 *
 * Per-booking phone wins over account phone. Precedence applied identically
 * to borrower + lender resolvers:
 *   1. tx.protectedData.{customerPhone | providerPhone}  (booking-specific)
 *   2. profile.protectedData.phoneNumber                  (canonical account)
 *   3. profile.protectedData.phone                        (legacy account, soak fallback)
 *   4. tx.metadata.{customerPhone | providerPhone}        (legacy metadata fallback)
 *
 * Per-booking phone never leaks into the user's account record — selection
 * just picks which slot to read for THIS booking's SMS.
 */

// Stub env so the cached SDK initializes cleanly when shippoTracking.js
// requires `../api-util/integrationSdk` transitively.
process.env.INTEGRATION_CLIENT_ID = 'test-client-id';
process.env.INTEGRATION_CLIENT_SECRET = 'test-client-secret';

jest.mock('sharetribe-flex-integration-sdk', () => ({
  createInstance: jest.fn(() => ({
    transactions: { show: jest.fn(), transition: jest.fn() },
  })),
}));

const { getBorrowerPhone, getLenderPhone } = require('./shippoTracking');

const buildTx = ({ txProtected = {}, txMetadata = {}, customerProfile, providerProfile } = {}) => ({
  attributes: { protectedData: txProtected, metadata: txMetadata },
  relationships: {
    customer: customerProfile
      ? { data: { attributes: { profile: { protectedData: customerProfile } } } }
      : undefined,
    provider: providerProfile
      ? { data: { attributes: { profile: { protectedData: providerProfile } } } }
      : undefined,
  },
});

describe('getBorrowerPhone — borrower-side precedence', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('per-booking customerPhone wins even when all slots are populated', () => {
    const tx = buildTx({
      txProtected: { customerPhone: '+15551111111' },
      txMetadata: { customerPhone: '+15554444444' },
      customerProfile: { phoneNumber: '+15552222222', phone: '+15553333333' },
    });
    expect(getBorrowerPhone(tx)).toContain('5551111111');
  });

  test('falls back to profile.phoneNumber when no booking phone', () => {
    const tx = buildTx({
      customerProfile: { phoneNumber: '+15552222222', phone: '+15553333333' },
    });
    expect(getBorrowerPhone(tx)).toContain('5552222222');
  });

  test('falls back to legacy profile.phone when phoneNumber missing (soak window)', () => {
    const tx = buildTx({
      customerProfile: { phone: '+15553333333' },
    });
    expect(getBorrowerPhone(tx)).toContain('5553333333');
  });

  test('falls back to tx.metadata.customerPhone as last resort', () => {
    const tx = buildTx({
      txMetadata: { customerPhone: '+15554444444' },
    });
    expect(getBorrowerPhone(tx)).toContain('5554444444');
  });

  test('returns null when no phone is found anywhere', () => {
    expect(getBorrowerPhone(buildTx())).toBeNull();
  });

  test('handles fully missing transaction shape without throwing', () => {
    expect(getBorrowerPhone({})).toBeNull();
    expect(getBorrowerPhone(null)).toBeNull();
    expect(getBorrowerPhone(undefined)).toBeNull();
  });
});

describe('getLenderPhone — lender-side precedence', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('per-booking providerPhone wins even when all slots are populated', () => {
    const tx = buildTx({
      txProtected: { providerPhone: '+15551111111' },
      txMetadata: { providerPhone: '+15554444444' },
      providerProfile: { phoneNumber: '+15552222222', phone: '+15553333333' },
    });
    expect(getLenderPhone(tx)).toContain('5551111111');
  });

  test('falls back to provider profile.phoneNumber when no booking phone', () => {
    const tx = buildTx({
      providerProfile: { phoneNumber: '+15552222222', phone: '+15553333333' },
    });
    expect(getLenderPhone(tx)).toContain('5552222222');
  });

  test('falls back to legacy provider profile.phone (soak window)', () => {
    const tx = buildTx({ providerProfile: { phone: '+15553333333' } });
    expect(getLenderPhone(tx)).toContain('5553333333');
  });

  test('falls back to tx.metadata.providerPhone as last resort', () => {
    const tx = buildTx({ txMetadata: { providerPhone: '+15554444444' } });
    expect(getLenderPhone(tx)).toContain('5554444444');
  });

  test('returns null when no phone is found anywhere', () => {
    expect(getLenderPhone(buildTx())).toBeNull();
  });
});

describe('per-booking phone never bleeds across roles', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('borrower resolver does not pick up providerPhone', () => {
    const tx = buildTx({ txProtected: { providerPhone: '+15551111111' } });
    expect(getBorrowerPhone(tx)).toBeNull();
  });

  test('lender resolver does not pick up customerPhone', () => {
    const tx = buildTx({ txProtected: { customerPhone: '+15551111111' } });
    expect(getLenderPhone(tx)).toBeNull();
  });
});

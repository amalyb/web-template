/**
 * Step 3 of persistent lender shipping address: server-side hydration
 * of missing provider* fields on transition/accept from the provider's
 * saved profile.protectedData.lenderShippingAddress.
 *
 * The helper is the unit under test. The full request handler is too
 * large to mock end-to-end here, so we verify:
 *   1. Helper behavior across the documented cases (hydration cases 1-3, 5)
 *   2. Helper writes to BOTH params[k] and params.protectedData[k] so the
 *      downstream missingProvider filter and the SDK transition both see
 *      the hydrated values (case 6)
 *   3. Source-level assertions that the helper is invoked inside the
 *      accept-validation block and that the existing 422 path with code
 *      `transition/accept-missing-provider` is unchanged (case 4)
 */

// Same Sentry mock dance as transition-privileged.pick-rate.test.js — the
// require chain pulls in server/log.js which loads @sentry/node, and the
// installed Sentry package has a broken transitive dep that throws at test time.
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  Handlers: {
    requestHandler: () => (req, res, next) => next(),
    errorHandler: () => (err, req, res, next) => next(err),
  },
  Integrations: {},
  getCurrentScope: () => ({ setTag: jest.fn(), setContext: jest.fn() }),
}));

const fs = require('fs');
const path = require('path');

const { hydrateProviderFieldsFromProfile } = require('./transition-privileged');

const FULL_ADDRESS = {
  streetAddress: '123 Main St',
  streetAddress2: 'Apt 4B',
  city: 'Brooklyn',
  state: 'NY',
  zipCode: '11201',
  phoneNumber: '+15555550100',
};

const FULL_EMAIL = 'lender@example.com';

describe('hydrateProviderFieldsFromProfile', () => {
  test('case 1: empty params + full profile → hydrates all six required fields', () => {
    const params = {};
    const hydrated = hydrateProviderFieldsFromProfile(params, FULL_ADDRESS, FULL_EMAIL);

    // All six required + street2 (optional) should be hydrated.
    expect(hydrated).toEqual(
      expect.arrayContaining([
        'providerStreet',
        'providerStreet2',
        'providerCity',
        'providerState',
        'providerZip',
        'providerPhone',
        'providerEmail',
      ])
    );

    // Hydrated values written to top-level params (so missingProvider sees them)
    expect(params.providerStreet).toBe('123 Main St');
    expect(params.providerCity).toBe('Brooklyn');
    expect(params.providerState).toBe('NY');
    expect(params.providerZip).toBe('11201');
    expect(params.providerPhone).toBe('+15555550100');
    expect(params.providerEmail).toBe('lender@example.com');
    expect(params.providerStreet2).toBe('Apt 4B');

    // And mirrored to params.protectedData (so SDK transition + tx.protectedData get them)
    expect(params.protectedData).toBeDefined();
    expect(params.protectedData.providerStreet).toBe('123 Main St');
    expect(params.protectedData.providerCity).toBe('Brooklyn');
    expect(params.protectedData.providerState).toBe('NY');
    expect(params.protectedData.providerZip).toBe('11201');
    expect(params.protectedData.providerPhone).toBe('+15555550100');
    expect(params.protectedData.providerEmail).toBe('lender@example.com');
    expect(params.protectedData.providerStreet2).toBe('Apt 4B');
  });

  test('case 2: client provides some fields, profile fills the rest (client wins)', () => {
    // Client sends only providerStreet + providerCity — but with VALUES
    // distinct from the profile so we can prove the client side won.
    const params = {
      providerStreet: '999 Client Way',
      providerCity: 'ClientCity',
      protectedData: {
        providerStreet: '999 Client Way',
        providerCity: 'ClientCity',
      },
    };

    hydrateProviderFieldsFromProfile(params, FULL_ADDRESS, FULL_EMAIL);

    // Client values preserved
    expect(params.providerStreet).toBe('999 Client Way');
    expect(params.providerCity).toBe('ClientCity');
    expect(params.protectedData.providerStreet).toBe('999 Client Way');
    expect(params.protectedData.providerCity).toBe('ClientCity');

    // Missing fields filled from profile
    expect(params.providerState).toBe('NY');
    expect(params.providerZip).toBe('11201');
    expect(params.providerPhone).toBe('+15555550100');
    expect(params.providerEmail).toBe('lender@example.com');
    expect(params.protectedData.providerState).toBe('NY');
    expect(params.protectedData.providerZip).toBe('11201');
    expect(params.protectedData.providerPhone).toBe('+15555550100');
    expect(params.protectedData.providerEmail).toBe('lender@example.com');
  });

  test('case 2b: client value lives in params.protectedData only (not flat) — still wins', () => {
    // Mirrors how the existing accept-merge code at lines 1842-1843
    // sometimes leaves values in protectedData without a flat copy.
    const params = {
      protectedData: { providerZip: '90210' },
    };
    hydrateProviderFieldsFromProfile(params, FULL_ADDRESS, FULL_EMAIL);
    // Client zip preserved (the helper sees it via params.protectedData.providerZip).
    expect(params.protectedData.providerZip).toBe('90210');
    // Other fields hydrated.
    expect(params.providerStreet).toBe('123 Main St');
  });

  test('case 3: empty strings in profile do NOT hydrate (would still 422 downstream)', () => {
    const partial = {
      streetAddress: '', // empty — should not hydrate
      streetAddress2: '',
      city: 'Springfield',
      state: '   ', // whitespace only — should not hydrate
      zipCode: '62701',
      phoneNumber: '',
    };
    const params = {};
    const hydrated = hydrateProviderFieldsFromProfile(params, partial, '');

    // Only city + zip should hydrate (the only non-empty strings).
    expect(hydrated.sort()).toEqual(['providerCity', 'providerZip'].sort());
    expect(params.providerCity).toBe('Springfield');
    expect(params.providerZip).toBe('62701');

    // Fields with empty/whitespace values in profile remain missing.
    expect(params.providerStreet).toBeUndefined();
    expect(params.providerState).toBeUndefined();
    expect(params.providerPhone).toBeUndefined();
    expect(params.providerEmail).toBeUndefined();
  });

  test('case 4: no profile address at all → no hydration → existing missingProvider check fires downstream', () => {
    const params = {};
    const hydrated = hydrateProviderFieldsFromProfile(params, undefined, undefined);
    expect(hydrated).toEqual([]);
    // params is essentially untouched (just gets an empty protectedData container)
    expect(params.providerStreet).toBeUndefined();
    expect(params.providerCity).toBeUndefined();
    expect(params.providerState).toBeUndefined();
    expect(params.providerZip).toBeUndefined();
    expect(params.providerPhone).toBeUndefined();
    expect(params.providerEmail).toBeUndefined();

    // The downstream check at transition-privileged.js:1933-1935 reads
    // `!(params?.[k] ?? pd?.[k])`. Simulate that here to prove all six
    // required fields would be flagged missing:
    const pd = params.protectedData || {};
    const required = [
      'providerStreet',
      'providerCity',
      'providerState',
      'providerZip',
      'providerEmail',
      'providerPhone',
    ];
    const missing = required.filter(k => !(params[k] ?? pd[k]));
    expect(missing).toEqual(required);
  });

  test('case 4b: profile present but no lenderShippingAddress key → no hydration', () => {
    // Profile has other protectedData (like a phone) but no
    // lenderShippingAddress nested object. The caller passes undefined
    // for lenderShippingAddress. No hydration of address fields.
    const params = {};
    const hydrated = hydrateProviderFieldsFromProfile(params, undefined, FULL_EMAIL);
    // Only email comes from prov.attributes.email, which is provided.
    expect(hydrated).toEqual(['providerEmail']);
    expect(params.providerEmail).toBe('lender@example.com');
    expect(params.providerStreet).toBeUndefined();
  });

  test('case 5: providerEmail comes from prov.attributes.email, NOT lenderShippingAddress', () => {
    // lenderShippingAddress has NO email field (we don't store it there).
    const addrNoEmail = { ...FULL_ADDRESS };
    delete addrNoEmail.email; // belt + suspenders — wasn't there to begin with
    const params = {};
    hydrateProviderFieldsFromProfile(params, addrNoEmail, 'lender@example.com');

    expect(params.providerEmail).toBe('lender@example.com');
    expect(params.protectedData.providerEmail).toBe('lender@example.com');
  });

  test('case 6: hydrated values flow through to params.protectedData (what tx.protectedData ends up with)', () => {
    // The downstream code at lines 2042-2045 upserts params.protectedData
    // onto the transaction. Verify every hydrated field lands there.
    const params = {};
    hydrateProviderFieldsFromProfile(params, FULL_ADDRESS, FULL_EMAIL);

    const pd = params.protectedData;
    expect(pd).toEqual(
      expect.objectContaining({
        providerStreet: '123 Main St',
        providerStreet2: 'Apt 4B',
        providerCity: 'Brooklyn',
        providerState: 'NY',
        providerZip: '11201',
        providerPhone: '+15555550100',
        providerEmail: 'lender@example.com',
      })
    );
  });

  test('null params is a no-op (defensive)', () => {
    expect(() => hydrateProviderFieldsFromProfile(null, FULL_ADDRESS, FULL_EMAIL)).not.toThrow();
    expect(hydrateProviderFieldsFromProfile(null, FULL_ADDRESS, FULL_EMAIL)).toEqual([]);
  });

  test('does not overwrite a client-provided field even if profile has a different value', () => {
    const params = {
      providerEmail: 'override@example.com',
    };
    hydrateProviderFieldsFromProfile(params, FULL_ADDRESS, 'profile@example.com');
    expect(params.providerEmail).toBe('override@example.com');
  });
});

describe('hydrateProviderFieldsFromProfile — wiring (source-level assertions)', () => {
  const srcPath = path.resolve(__dirname, 'transition-privileged.js');
  const src = fs.readFileSync(srcPath, 'utf8');

  test('helper is invoked inside the accept-transition validation block, before missingProvider filter', () => {
    // Find the validation block start and the missingProvider filter,
    // then assert the hydration call appears between them.
    const acceptCheckIdx = src.indexOf('if (transition === ACCEPT_TRANSITION) {');
    expect(acceptCheckIdx).toBeGreaterThan(0);

    const missingProviderIdx = src.indexOf('const missingProvider = requiredProviderFields.filter');
    expect(missingProviderIdx).toBeGreaterThan(acceptCheckIdx);

    const between = src.slice(acceptCheckIdx, missingProviderIdx);
    expect(between).toMatch(/hydrateProviderFieldsFromProfile\s*\(/);
  });

  test('hydration uses Integration SDK to fetch provider with profile.protectedData', () => {
    // The hydration block must call the integration SDK because the
    // marketplace SDK can't read another user's protectedData.
    const acceptCheckIdx = src.indexOf('if (transition === ACCEPT_TRANSITION) {');
    const missingProviderIdx = src.indexOf('const missingProvider = requiredProviderFields.filter');
    const between = src.slice(acceptCheckIdx, missingProviderIdx);
    expect(between).toMatch(/getIntegrationSdk\s*\(/);
    expect(between).toMatch(/users\.show/);
  });

  test('lenderShippingAddress is read from the profile.protectedData path', () => {
    const acceptCheckIdx = src.indexOf('if (transition === ACCEPT_TRANSITION) {');
    const missingProviderIdx = src.indexOf('const missingProvider = requiredProviderFields.filter');
    const between = src.slice(acceptCheckIdx, missingProviderIdx);
    // Path matches the contract from Step 1:
    // currentUser.attributes.profile.protectedData.lenderShippingAddress
    expect(between).toMatch(/profile.*protectedData.*lenderShippingAddress/);
  });

  test('existing 422 with code transition/accept-missing-provider is unchanged', () => {
    // Case 4 of the spec: when fields are still missing after hydration,
    // the existing error response shape must remain identical so existing
    // client code keeps working.
    expect(src).toMatch(/code:\s*'transition\/accept-missing-provider'/);
    expect(src).toMatch(/missing:\s*missingProvider/);
    expect(src).toMatch(/res\.status\(422\)\.json\(\{/);
  });

  test('hydration is wrapped in try/catch so a fetch failure does not break accept', () => {
    // If the integration SDK errors, we want to fall through to the
    // existing missingProvider check rather than 500 the request.
    const acceptCheckIdx = src.indexOf('if (transition === ACCEPT_TRANSITION) {');
    const missingProviderIdx = src.indexOf('const missingProvider = requiredProviderFields.filter');
    const between = src.slice(acceptCheckIdx, missingProviderIdx);
    expect(between).toMatch(/try\s*{[\s\S]*hydrateProviderFieldsFromProfile/);
    expect(between).toMatch(/catch\s*\(\s*hydrationErr/);
  });
});

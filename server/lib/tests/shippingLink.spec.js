/**
 * Unit tests for shipping link selection and lender SMS building
 * 
 * Tests the complete flow from Shippo artifact extraction through
 * link selection and SMS message building for initial lender shipment.
 */

const { extractArtifacts } = require('../shipping/extractArtifacts');
const { pickShipmentLink } = require('../shipping/pickShipmentLink');
const { buildLenderShipByMessage } = require('../sms/buildLenderShipByMessage');

// Mock the environment variables and shortlink function
jest.mock('../env', () => ({
  UPS_LINK_MODE: ['qr', 'label'],
  USPS_LINK_MODE: ['label'],
  ALLOW_TRACKING_IN_LENDER_SHIP: false,
  SHORTLINK_ENABLED: true,
}));

jest.mock('../shortlink', () => ({
  makeShortLink: jest.fn(async (url) => {
    if (!url) return null;
    // Mock shortlink generation
    const token = Buffer.from(url.substring(0, 20)).toString('base64').substring(0, 10);
    return `https://sherbrt.com/r/${token}`;
  }),
}));

describe('extractArtifacts', () => {
  test('extracts UPS artifacts correctly', () => {
    const shippoTx = {
      tracking_number: '1Z999AA10123456784',
      tracking_url_provider: 'https://ups.com/track/1Z999AA10123456784',
      label_url: 'https://shippo.com/label/ups-123.pdf',
      qr_code_url: 'https://shippo.com/qr/ups-qr-123.png',
    };

    const artifacts = extractArtifacts({
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      shippoTx,
    });

    expect(artifacts).toMatchObject({
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      upsQrUrl: 'https://shippo.com/qr/ups-qr-123.png',
      upsLabelUrl: 'https://shippo.com/label/ups-123.pdf',
      uspsLabelUrl: null,
      trackingUrl: 'https://ups.com/track/1Z999AA10123456784',
    });
  });

  test('extracts USPS artifacts correctly', () => {
    const shippoTx = {
      tracking_number: '9400111899223344556677',
      tracking_url_provider: 'https://tools.usps.com/go/TrackConfirmAction',
      label_url: 'https://shippo.com/label/usps-456.pdf',
      qr_code_url: null, // USPS doesn't have QR codes
    };

    const artifacts = extractArtifacts({
      carrier: 'USPS',
      trackingNumber: '9400111899223344556677',
      shippoTx,
    });

    expect(artifacts).toMatchObject({
      carrier: 'USPS',
      trackingNumber: '9400111899223344556677',
      upsQrUrl: null,
      upsLabelUrl: null,
      uspsLabelUrl: 'https://shippo.com/label/usps-456.pdf',
      trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction',
    });
  });

  test('handles nested label object structure', () => {
    const shippoTx = {
      tracking_number: '1Z999AA10123456784',
      label: {
        url: 'https://shippo.com/label/nested-123.pdf',
      },
      qr_code: {
        url: 'https://shippo.com/qr/nested-qr-123.png',
      },
    };

    const artifacts = extractArtifacts({
      carrier: 'UPS',
      shippoTx,
    });

    expect(artifacts.upsLabelUrl).toBe('https://shippo.com/label/nested-123.pdf');
    expect(artifacts.upsQrUrl).toBe('https://shippo.com/qr/nested-qr-123.png');
  });

  test('handles missing shippoTx gracefully', () => {
    const artifacts = extractArtifacts({
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      shippoTx: null,
    });

    expect(artifacts).toMatchObject({
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      upsQrUrl: null,
      upsLabelUrl: null,
      uspsLabelUrl: null,
      trackingUrl: null,
      raw: null,
    });
  });
});

describe('pickShipmentLink', () => {
  describe('initial-lender phase (strict mode)', () => {
    test('returns UPS QR code when available', () => {
      const artifacts = {
        carrier: 'UPS',
        upsQrUrl: 'https://shippo.com/qr/ups-qr.png',
        upsLabelUrl: 'https://shippo.com/label/ups-label.pdf',
        uspsLabelUrl: null,
        trackingUrl: 'https://ups.com/track/123',
      };

      const link = pickShipmentLink(artifacts, { phase: 'initial-lender' });
      expect(link).toBe('https://shippo.com/qr/ups-qr.png');
    });

    test('returns UPS label when QR not available', () => {
      const artifacts = {
        carrier: 'UPS',
        upsQrUrl: null,
        upsLabelUrl: 'https://shippo.com/label/ups-label.pdf',
        uspsLabelUrl: null,
        trackingUrl: 'https://ups.com/track/123',
      };

      const link = pickShipmentLink(artifacts, { phase: 'initial-lender' });
      expect(link).toBe('https://shippo.com/label/ups-label.pdf');
    });

    test('returns USPS label when carrier is USPS', () => {
      const artifacts = {
        carrier: 'USPS',
        upsQrUrl: null,
        upsLabelUrl: null,
        uspsLabelUrl: 'https://shippo.com/label/usps-label.pdf',
        trackingUrl: 'https://tools.usps.com/go/Track',
      };

      const link = pickShipmentLink(artifacts, { phase: 'initial-lender' });
      expect(link).toBe('https://shippo.com/label/usps-label.pdf');
    });

    test('NEVER returns tracking URL in initial-lender phase', () => {
      const artifacts = {
        carrier: 'UPS',
        upsQrUrl: null,
        upsLabelUrl: null,
        uspsLabelUrl: null,
        trackingUrl: 'https://ups.com/track/123',
      };

      const link = pickShipmentLink(artifacts, { phase: 'initial-lender' });
      expect(link).toBeNull(); // Should return null, not tracking URL
    });

    test('returns null when no compliant link available', () => {
      const artifacts = {
        carrier: 'UPS',
        upsQrUrl: null,
        upsLabelUrl: null,
        uspsLabelUrl: null,
        trackingUrl: 'https://ups.com/track/123',
      };

      const link = pickShipmentLink(artifacts, { phase: 'initial-lender' });
      expect(link).toBeNull();
    });
  });

  describe('non-initial phases', () => {
    test('may return tracking URL for return phase if enabled', () => {
      // Note: This requires ALLOW_TRACKING_IN_LENDER_SHIP to be true
      // In the mocked env above, it's false, so tracking still won't be returned
      const artifacts = {
        carrier: 'UPS',
        upsQrUrl: null,
        upsLabelUrl: null,
        uspsLabelUrl: null,
        trackingUrl: 'https://ups.com/track/123',
      };

      const link = pickShipmentLink(artifacts, { phase: 'return' });
      // With ALLOW_TRACKING_IN_LENDER_SHIP: false, should still be null
      expect(link).toBeNull();
    });

    test('prefers label over tracking even in non-initial phase', () => {
      const artifacts = {
        carrier: 'UPS',
        upsQrUrl: null,
        upsLabelUrl: 'https://shippo.com/label/ups-label.pdf',
        uspsLabelUrl: null,
        trackingUrl: 'https://ups.com/track/123',
      };

      const link = pickShipmentLink(artifacts, { phase: 'return' });
      expect(link).toBe('https://shippo.com/label/ups-label.pdf');
    });
  });
});

describe('buildLenderShipByMessage', () => {
  const { makeShortLink } = require('../shortlink');

  beforeEach(() => {
    makeShortLink.mockClear();
  });

  test('builds message with UPS QR code and shortlink', async () => {
    const message = await buildLenderShipByMessage({
      itemTitle: 'Canon EOS R5',
      shipByDate: 'Dec 15',
      shippingArtifacts: {
        carrier: 'UPS',
        upsQrUrl: 'https://shippo.com/qr/ups-qr-123.png',
        upsLabelUrl: 'https://shippo.com/label/ups-label-123.pdf',
        uspsLabelUrl: null,
        trackingUrl: 'https://ups.com/track/123',
      },
    });

    expect(message).toContain('Sherbrt 🍧');
    expect(message).toContain('Ship "Canon EOS R5"');
    expect(message).toContain('by Dec 15');
    expect(message).toContain('Label: https://sherbrt.com/r/');
    expect(makeShortLink).toHaveBeenCalledWith('https://shippo.com/qr/ups-qr-123.png');
  });

  test('builds message with UPS label (no QR)', async () => {
    const message = await buildLenderShipByMessage({
      itemTitle: 'Sony A7 III',
      shipByDate: 'Jan 3',
      shippingArtifacts: {
        carrier: 'UPS',
        upsQrUrl: null,
        upsLabelUrl: 'https://shippo.com/label/ups-label-456.pdf',
        uspsLabelUrl: null,
        trackingUrl: 'https://ups.com/track/456',
      },
    });

    expect(message).toContain('Sherbrt 🍧');
    expect(message).toContain('Ship "Sony A7 III"');
    expect(message).toContain('by Jan 3');
    expect(message).toContain('Label: https://sherbrt.com/r/');
    expect(makeShortLink).toHaveBeenCalledWith('https://shippo.com/label/ups-label-456.pdf');
  });

  test('builds message with USPS label', async () => {
    const message = await buildLenderShipByMessage({
      itemTitle: 'Nikon Z6',
      shipByDate: 'Feb 20',
      shippingArtifacts: {
        carrier: 'USPS',
        upsQrUrl: null,
        upsLabelUrl: null,
        uspsLabelUrl: 'https://shippo.com/label/usps-label-789.pdf',
        trackingUrl: 'https://tools.usps.com/go/Track',
      },
    });

    expect(message).toContain('Sherbrt 🍧');
    expect(message).toContain('Ship "Nikon Z6"');
    expect(message).toContain('by Feb 20');
    expect(message).toContain('Label: https://sherbrt.com/r/');
    expect(makeShortLink).toHaveBeenCalledWith('https://shippo.com/label/usps-label-789.pdf');
  });

  test('throws error when no compliant link available', async () => {
    await expect(
      buildLenderShipByMessage({
        itemTitle: 'Test Item',
        shipByDate: 'Mar 10',
        shippingArtifacts: {
          carrier: 'UPS',
          upsQrUrl: null,
          upsLabelUrl: null,
          uspsLabelUrl: null,
          trackingUrl: 'https://ups.com/track/999', // Only tracking available
        },
      })
    ).rejects.toThrow('No compliant shipment link available');
  });

  test('truncates long item titles', async () => {
    const longTitle = 'This is a very long item title that should be truncated to keep the SMS message compact and under carrier limits';

    const message = await buildLenderShipByMessage({
      itemTitle: longTitle,
      shipByDate: 'Apr 5',
      shippingArtifacts: {
        carrier: 'UPS',
        upsQrUrl: 'https://shippo.com/qr/qr.png',
        upsLabelUrl: 'https://shippo.com/label/label.pdf',
        uspsLabelUrl: null,
        trackingUrl: null,
      },
    });

    // The message should contain the title (possibly truncated)
    expect(message).toContain('Sherbrt 🍧');
    expect(message).toContain('Label: https://sherbrt.com/r/');
    // Message should be reasonably short
    expect(message.length).toBeLessThan(200);
  });

  test('handles missing shipByDate gracefully', async () => {
    const message = await buildLenderShipByMessage({
      itemTitle: 'Test Item',
      shipByDate: null, // No ship-by date
      shippingArtifacts: {
        carrier: 'UPS',
        upsQrUrl: 'https://shippo.com/qr/qr.png',
        upsLabelUrl: null,
        uspsLabelUrl: null,
        trackingUrl: null,
      },
    });

    expect(message).toContain('Sherbrt 🍧');
    expect(message).toContain('Ship "Test Item"');
    expect(message).toContain('Label: https://sherbrt.com/r/');
  });
});

describe('Integration: Full flow from Shippo to SMS', () => {
  const { makeShortLink } = require('../shortlink');

  beforeEach(() => {
    makeShortLink.mockClear();
  });

  test('UPS with QR → shortlink resolves to QR', async () => {
    // Step 1: Extract artifacts from Shippo response
    const shippoTx = {
      tracking_number: '1Z999AA10123456784',
      tracking_url_provider: 'https://ups.com/track/1Z999AA10123456784',
      label_url: 'https://shippo.com/label/ups-123.pdf',
      qr_code_url: 'https://shippo.com/qr/ups-qr-123.png',
    };

    const artifacts = extractArtifacts({
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      shippoTx,
    });

    // Step 2: Pick shipment link (should pick QR)
    const selectedLink = pickShipmentLink(artifacts, { phase: 'initial-lender' });
    expect(selectedLink).toBe('https://shippo.com/qr/ups-qr-123.png');

    // Step 3: Build SMS message (should create shortlink to QR)
    const message = await buildLenderShipByMessage({
      itemTitle: 'Canon EOS R5',
      shipByDate: 'Dec 15',
      shippingArtifacts: artifacts,
    });

    expect(message).toContain('Label: https://sherbrt.com/r/');
    expect(makeShortLink).toHaveBeenCalledWith('https://shippo.com/qr/ups-qr-123.png');
  });

  test('UPS without QR but with label → resolves to UPS label', async () => {
    const shippoTx = {
      tracking_number: '1Z999AA10123456784',
      tracking_url_provider: 'https://ups.com/track/1Z999AA10123456784',
      label_url: 'https://shippo.com/label/ups-456.pdf',
      qr_code_url: null, // No QR code
    };

    const artifacts = extractArtifacts({
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      shippoTx,
    });

    const selectedLink = pickShipmentLink(artifacts, { phase: 'initial-lender' });
    expect(selectedLink).toBe('https://shippo.com/label/ups-456.pdf');

    const message = await buildLenderShipByMessage({
      itemTitle: 'Sony A7 III',
      shipByDate: 'Jan 3',
      shippingArtifacts: artifacts,
    });

    expect(message).toContain('Label: https://sherbrt.com/r/');
    expect(makeShortLink).toHaveBeenCalledWith('https://shippo.com/label/ups-456.pdf');
  });

  test('USPS with label → resolves to USPS label', async () => {
    const shippoTx = {
      tracking_number: '9400111899223344556677',
      tracking_url_provider: 'https://tools.usps.com/go/Track',
      label_url: 'https://shippo.com/label/usps-789.pdf',
      qr_code_url: null,
    };

    const artifacts = extractArtifacts({
      carrier: 'USPS',
      trackingNumber: '9400111899223344556677',
      shippoTx,
    });

    const selectedLink = pickShipmentLink(artifacts, { phase: 'initial-lender' });
    expect(selectedLink).toBe('https://shippo.com/label/usps-789.pdf');

    const message = await buildLenderShipByMessage({
      itemTitle: 'Fujifilm X-T4',
      shipByDate: 'Feb 20',
      shippingArtifacts: artifacts,
    });

    expect(message).toContain('Label: https://sherbrt.com/r/');
    expect(makeShortLink).toHaveBeenCalledWith('https://shippo.com/label/usps-789.pdf');
  });

  test('Ensures no tracking URL in initial-lender SMS', async () => {
    const shippoTx = {
      tracking_number: '1Z999AA10123456784',
      tracking_url_provider: 'https://ups.com/track/1Z999AA10123456784',
      label_url: null, // No label
      qr_code_url: null, // No QR
    };

    const artifacts = extractArtifacts({
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      shippoTx,
    });

    const selectedLink = pickShipmentLink(artifacts, { phase: 'initial-lender' });
    expect(selectedLink).toBeNull(); // Should be null, not tracking URL

    // buildLenderShipByMessage should throw
    await expect(
      buildLenderShipByMessage({
        itemTitle: 'Test Item',
        shipByDate: 'Mar 10',
        shippingArtifacts: artifacts,
      })
    ).rejects.toThrow('No compliant shipment link available');
  });
});


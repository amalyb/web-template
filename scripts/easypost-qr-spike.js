// scripts/easypost-qr-spike.js
const EasyPost = require('@easypost/api');

(async () => {
  const apiKey =
    process.env.EASYPOST_MODE === 'test'
      ? process.env.EASYPOST_TEST_API_KEY
      : process.env.EASYPOST_API_KEY;

  if (!apiKey) {
    console.error('Missing EASYPOST_* API key');
    process.exit(1);
  }

  const ep = new EasyPost(apiKey);

  const to_address = {
    name: 'Test Receiver',
    street1: '1745 Pacific Ave APT 202',
    city: 'San Francisco',
    state: 'CA',
    zip: '94109',
    phone: '5555555555',
    country: 'US',
  };

  const from_address = {
    name: 'Test Sender',
    street1: '1795 Chestnut St APT 7',
    city: 'San Francisco',
    state: 'CA',
    zip: '94123',
    phone: '5555555555',
    country: 'US',
  };

  const parcel = { length: 10, width: 8, height: 4, weight: 16 }; // ounces

  try {
    // 1) Create shipment
    const shipment = await ep.Shipment.create({
      to_address,
      from_address,
      parcel,
      options: {
        label_format: 'PDF',
        label_size: '4x6',

        // Try common flags; harmless if ignored in test:
        paperless_trade: true,
        mobile_barcode: true,
      },
    });

    // 2) Pick a UPS rate if present; else fall back to lowest
    const upsRate =
      (shipment.rates || []).find(r => r.carrier === 'UPS') ||
      (shipment.rates || [])[0];

    if (!upsRate) {
      console.error('No rates returned on shipment. Check carrier enablement in your EasyPost account.');
      process.exit(1);
    }

    console.log('Chosen Rate →', {
      id: upsRate.id,
      carrier: upsRate.carrier,
      service: upsRate.service,
      rate: upsRate.rate,
      currency: upsRate.currency,
    });

    // 3) Buy using static method (JS SDK)
    const purchased = await ep.Shipment.buy(shipment.id, { rate: { id: upsRate.id } });

    // 4) Inspect label and forms (for QR/mobile barcode)
    const labelUrl = purchased?.postage_label?.label_url || null;
    const forms = purchased?.forms || [];
    console.log('Label URL:', labelUrl);
    console.log(
      'Forms:',
      forms.map(f => ({
        type: f.form_type || f.type,
        url: f.form_url,
      }))
    );

    // 5) Prefer a QR/mobile form if present
    const qrForm =
      forms.find(f => String(f.form_type || f.type || '').toLowerCase().includes('qr')) ||
      forms.find(f => String(f.form_type || f.type || '').toLowerCase().includes('mobile'));

    if (qrForm?.form_url) {
      console.log('✅ QR/Mobile barcode form found:', qrForm.form_url);
    } else {
      console.log('❌ No QR form found in this response.');
      console.log('Next step: ask EasyPost which request option enables UPS QR in TEST and what forms[].form_type to expect.');
    }
  } catch (err) {
    console.error('Spike failed:', err?.response?.body || err?.message || err);
    process.exit(1);
  }
})();


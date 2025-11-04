// server/api/diag-verify-flex-pi.js
const router = require('express').Router();
const { getTrustedSdk } = require('../api-util/sdk');

router.get('/diag/verify-flex-pi', async (req, res) => {
  try {
    if (process.env.ALLOW_PI_DIAG !== 'true') return res.status(404).end();
    const listingId = req.query.listingId;
    if (!listingId) return res.status(400).json({ error: 'listingId required' });

    const sdk = getTrustedSdk(req);
    
    const now = new Date();
    const start = new Date(now); start.setDate(start.getDate() + 2);
    const end = new Date(start); end.setDate(end.getDate() + 3);

    const body = {
      transition: 'transition/request-payment',
      params: { listingId, bookingStart: start.toISOString(), bookingEnd: end.toISOString(), seats: 1 },
    };
    const r = await sdk.transactions.initiateSpeculative(body, {});
    const tx = r?.data?.data?.[0];
    const nested = tx?.attributes?.protectedData?.stripePaymentIntents?.default || {};

    const secret = nested?.stripePaymentIntentClientSecret;
    const piId   = nested?.stripePaymentIntentId;
    const looksStripey = typeof secret === 'string' && /^pi_/.test(secret) && /_secret_/.test(secret);
    const idLooksStripey = typeof piId === 'string' && /^pi_/.test(piId);

    res.json({
      transition: 'transition/request-payment',
      secretLen: (secret || '').length,
      secretTail: (secret || '').slice(-10),
      looksStripey,
      idLooksStripey,
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

module.exports = router;


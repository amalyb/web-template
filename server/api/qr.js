// server/api/qr.js
const express = require('express');

module.exports = ({ getTrustedSdk }) => {
  const router = express.Router();

  async function resolveSdk(req) {
    // 1) Preferred: privileged SDK via getTrustedSdk
    if (typeof getTrustedSdk === 'function') {
      try {
        const s = await getTrustedSdk(req);     // <-- IMPORTANT: await
        if (s) return { sdk: s, src: 'getTrustedSdk' };
      } catch (_) {}
    }

    // 2) Fallbacks from app locals
    const integration = req.app.get('integrationSdk');
    if (integration) return { sdk: integration, src: 'integrationSdk' };

    const api = req.app.get('apiSdk');
    if (api) return { sdk: api, src: 'apiSdk' };

    return { sdk: null, src: null };
  }

  // quick health-check
  router.get('/_debug/ping', (_req, res) => res.sendStatus(204));

  // Debug: /api/qr/_debug/sdk
  router.get('/_debug/sdk', async (req, res) => {
    try {
      const { sdk, src } = await resolveSdk(req);
      const hasTransactionsShow = !!(sdk && sdk.transactions && typeof sdk.transactions.show === 'function');
      res.json({
        ok: !!sdk && hasTransactionsShow,
        hasTransactionsShow,
        from: {
          getTrustedSdk: src === 'getTrustedSdk',
          integrationSdk: src === 'integrationSdk',
          apiSdk: src === 'apiSdk',
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Main QR redirect: /api/qr/:txId
  router.get('/:txId', async (req, res) => {
    const { txId } = req.params;

    const { sdk } = await resolveSdk(req);
    const wired = !!(sdk && sdk.transactions && typeof sdk.transactions.show === 'function');
    if (!wired) {
      console.error('[QR] SDK not wired — transactions.show missing');
      return res.status(500).json({ ok: false, error: 'SDK not wired — transactions.show missing' });
    }

    try {
      const resp = await sdk.transactions.show({ id: txId, include: ['lineItems'] });
      const tx = resp?.data?.data;
      const pData = tx?.attributes?.protectedData || {};
      const shippo = pData?.shippo || {};

      const redirectUrl =
        shippo.qr_code_url ||
        shippo.label_url ||
        shippo.tracking_url_provider ||
        null;

      if (!redirectUrl) {
        return res.status(404).json({ ok: false, error: 'Label not ready yet' });
      }
      return res.redirect(302, redirectUrl);
    } catch (err) {
      return res.status(500).json({ ok: false, error: `Failed to read transaction: ${String(err)}` });
    }
  });

  return router;
};

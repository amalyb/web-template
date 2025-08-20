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
      // 1. Try Flex first: sdk.transactions.show({ id }). If found and `protectedData.shippo.outbound.qrCodeUrl`, redirect 302 to it.
      const resp = await sdk.transactions.show({ id: txId, include: ['lineItems'] });
      const tx = resp?.data?.data;
      const pData = tx?.attributes?.protectedData || {};
      const shippo = pData?.shippo || {};
      const outbound = shippo.outbound || {};

      if (outbound.qrCodeUrl) {
        console.log(`qr:redirect source=flex`);
        return res.redirect(302, outbound.qrCodeUrl);
      }

      // 2. Else check qrCache.get(id). If present and not expired, redirect 302.
      // Import qrCache from transition-privileged module
      let qrCache = null;
      try {
        const transitionPrivileged = require('./transition-privileged');
        qrCache = transitionPrivileged.qrCache;
      } catch (err) {
        console.warn('[QR] Could not import qrCache:', err.message);
      }

      if (qrCache && qrCache.has(txId)) {
        const cachedData = qrCache.get(txId);
        const now = Date.now();
        
        // Check if not expired (expiresAt is in seconds, convert to milliseconds)
        if (!cachedData.expiresAt || (cachedData.expiresAt * 1000) > now) {
          console.log(`qr:redirect source=cache`);
          return res.redirect(302, cachedData.qrCodeUrl);
        } else {
          console.log(`[QR] Cached QR data expired for transaction ${txId}`);
          qrCache.delete(txId); // Clean up expired entry
        }
      }

      // 3. Else return 202 with JSON: { ok: false, status: 'pending', message: 'Label not ready yet' }.
      // Never return 404 for a known tx unless you're sure the label failed.
      console.log(`[QR] No QR data available for transaction ${txId} - returning 202 pending`);
      res.set('Cache-Control', 'no-store'); // So devices will re-poll
      return res.status(202).json({ 
        ok: false, 
        status: 'pending', 
        message: 'Label not ready yet' 
      });

    } catch (err) {
      // If we can't even read the transaction, it might not exist
      if (err.response?.status === 404) {
        return res.status(404).json({ ok: false, error: 'Transaction not found' });
      }
      return res.status(500).json({ ok: false, error: `Failed to read transaction: ${String(err)}` });
    }
  });

  return router;
};

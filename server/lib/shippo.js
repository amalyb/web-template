// server/lib/shippo.js
//
// Shippo API client helpers. Currently exposes label void/refund for use by
// the auto-cancel-unshipped cron. Extend as other admin-side Shippo
// operations come online.
//
// Auth: ShippoToken header using SHIPPO_API_TOKEN env (same token used by
// label creation in server/api/transition-privileged.js).

const SHIPPO_API_BASE = 'https://api.goshippo.com';

function getShippoToken() {
  const token = process.env.SHIPPO_API_TOKEN;
  if (!token) {
    throw new Error('SHIPPO_API_TOKEN environment variable is not set');
  }
  return token;
}

/**
 * Request a refund/void for a Shippo label transaction.
 *
 * Shippo's refund endpoint voids unused labels and returns the label cost
 * as credit to the account. Only works on labels that haven't been used
 * (no carrier scan). For used labels this returns 400.
 *
 * API: POST https://api.goshippo.com/refunds/
 * Body: { transaction: "<shippo_tx_object_id>", async: false }
 *
 * @param {string} shippoTransactionId - Shippo transaction object_id (not a
 *   Sharetribe tx id). Stored on protectedData.outboundTransactionId /
 *   protectedData.returnTransactionId when labels are created.
 * @returns {Promise<object>} - Shippo refund object
 * @throws if the request fails or label has already been used
 */
async function voidShippoLabel(shippoTransactionId) {
  if (!shippoTransactionId) {
    throw new Error('voidShippoLabel: shippoTransactionId is required');
  }

  const token = getShippoToken();
  const url = `${SHIPPO_API_BASE}/refunds/`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `ShippoToken ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transaction: shippoTransactionId,
      async: false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '<no body>');
    throw new Error(
      `Shippo refund failed (${res.status}) for tx ${shippoTransactionId}: ${errorText}`
    );
  }

  const data = await res.json();
  console.log(
    `[shippo] void request for ${shippoTransactionId}: status=${data.status}`
  );
  return data;
}

/**
 * Retrieve a single Shippo transaction (label) by its object_id.
 *
 * API: GET https://api.goshippo.com/transactions/{object_id}
 *
 * @param {string} objectId - Shippo transaction object_id (stored on
 *   protectedData.returnTransactionId / protectedData.outboundTransactionId).
 * @returns {Promise<object|null>} - Parsed transaction object (includes
 *   label_url, qr_code_url, tracking_number, tracking_url_provider, status),
 *   or null if missing/unfetchable. Never throws.
 */
async function getShippoTransaction(objectId) {
  if (!objectId) return null;

  const token = getShippoToken();
  const url = `${SHIPPO_API_BASE}/transactions/${encodeURIComponent(objectId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `ShippoToken ${token}`,
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '<no body>');
    console.warn(
      `[shippo] getShippoTransaction(${objectId}) failed (${res.status}): ${errorText}`
    );
    return null;
  }

  return res.json();
}

/**
 * Resolve the best available return-label link from a transaction's
 * protectedData, with a Shippo re-fetch fallback.
 *
 * Order of preference:
 *   1. pd.returnQrUrl    (USPS QR code — preferred)
 *   2. pd.returnLabelUrl (PDF label — fallback)
 *   3. Re-fetch from Shippo via pd.returnTransactionId, then qr_code_url || label_url
 *
 * The whitelist fix in api-util/integrationSdk.js means returnQrUrl/returnLabelUrl
 * now persist directly, so case 3 is defense-in-depth for transactions where the
 * URL fields are somehow absent but the durable object_id survived.
 *
 * @param {object} pd - transaction protectedData
 * @returns {Promise<{url: string, type: 'QR'|'label', source: string}|null>}
 */
async function resolveReturnLabelUrl(pd) {
  if (!pd || typeof pd !== 'object') return null;

  if (pd.returnQrUrl) return { url: pd.returnQrUrl, type: 'QR', source: 'returnQrUrl' };
  if (pd.returnLabelUrl) return { url: pd.returnLabelUrl, type: 'label', source: 'returnLabelUrl' };

  const objectId = pd.returnTransactionId || (pd.return && pd.return.transactionId);
  if (!objectId) return null;

  try {
    const txn = await getShippoTransaction(objectId);
    if (txn && txn.qr_code_url) return { url: txn.qr_code_url, type: 'QR', source: 'shippo:qr' };
    if (txn && txn.label_url) return { url: txn.label_url, type: 'label', source: 'shippo:label' };
  } catch (e) {
    console.warn(`[shippo] resolveReturnLabelUrl re-fetch failed for ${objectId}: ${e.message}`);
  }
  return null;
}

module.exports = {
  voidShippoLabel,
  getShippoTransaction,
  resolveReturnLabelUrl,
};

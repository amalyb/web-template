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

module.exports = {
  voidShippoLabel,
};

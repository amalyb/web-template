// server/scripts/debugTransactionPhones.js
require('dotenv').config();
const flexIntegrationSdk = require('sharetribe-flex-integration-sdk');

const sdk = flexIntegrationSdk.createInstance({
  clientId: process.env.INTEGRATION_CLIENT_ID,
  clientSecret: process.env.INTEGRATION_CLIENT_SECRET,
});

async function main() {
  try {
    const txId = process.argv[2];
    if (!txId) {
      console.error("Usage: node server/scripts/debugTransactionPhones.js <transaction-uuid>");
      process.exit(1);
    }

    // Fetch transaction and include both users
    const res = await sdk.transactions.show({
      id: txId,
      include: ["customer", "provider"],
    });

    const tx = res.data.data;
    const included = res.data.included;

    const customerId = tx.relationships.customer.data.id.uuid;
    const providerId = tx.relationships.provider.data.id.uuid;

    const customer = included.find(i => i.type === "user" && i.id.uuid === customerId);
    const provider = included.find(i => i.type === "user" && i.id.uuid === providerId);

    const customerPhone = customer?.attributes?.profile?.protectedData?.phone;
    const providerPhone = provider?.attributes?.profile?.protectedData?.phone;

    console.log("Transaction ID:", txId);
    console.log("Customer phone:", customerPhone || "N/A");
    console.log("Provider phone:", providerPhone || "N/A");
  } catch (err) {
    console.error("Error fetching transaction:", err);
  }
}

main();

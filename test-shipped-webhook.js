// test-shipped-webhook.js

const fetch = require('node-fetch');

const txId = process.argv[2];
if (!txId) {
  console.error('❌ Usage: npm run webhook:test:shipped -- <TRANSACTION_ID>');
  process.exit(1);
}

const host = 'http://localhost:3500';
const useTest = process.env.TEST_ENDPOINTS === '1';
const path = useTest
  ? '/api/webhooks/__test/shippo/track'
  : '/api/webhooks/shippo';
const url = host.replace(/\/$/, '') + path;

const payload = useTest
  ? { txId, status: 'TRANSIT', metadata: { direction: 'outbound' } }        // <- test endpoint shape
  : { tracking_status: { status: 'TRANSIT' }, metadata: { transactionId: txId } }; // real webhook shape

console.log(`🚀 Simulating SHIPPED webhook for borrower SMS...`);
console.log(`📋 Transaction ID: ${txId}`);
console.log(`🌐 Endpoint: ${url}`);

(async () => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`❌ Request failed: ${res.status} ${res.statusText}`);
      const text = await res.text();
      console.error(text);
      process.exit(1);
    }

    console.log(`✅ Success! Borrower SHIPPED SMS sent`);
  } catch (err) {
    console.error(`❌ Request error:\n${err}`);
    console.log(`\n💡 Make sure the backend is running:\n   npm run dev-backend`);
  }
})();


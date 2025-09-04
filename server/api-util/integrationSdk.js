// server/api-util/integrationSdk.js
const { createInstance } = require('sharetribe-flex-integration-sdk');

let cached;
function getIntegrationSdk() {
  if (!cached) {
    cached = createInstance({
      clientId: process.env.INTEGRATION_CLIENT_ID,
      clientSecret: process.env.INTEGRATION_CLIENT_SECRET,
    });
  }
  return cached;
}

// Plain helper (no monkey-patching)
async function txUpdateProtectedData({ id, protectedData }) {
  const sdk = getIntegrationSdk();
  
  console.log('📝 [SHIPPO] Attempting to update protectedData for transaction:', id);
  console.log('📝 [SHIPPO] ProtectedData to update:', Object.keys(protectedData));
  
  // Add idempotency key to prevent retry collisions
  const idempotencyKey = `shipping-${id}-${Date.now()}`;
  
  try {
    // Try using transition/update which should be available in most Flex processes
    return sdk.transactions.transition({
      id,
      transition: 'transition/update',
      params: { 
        protectedData,
        // Add idempotency key if supported
        ...(idempotencyKey && { idempotencyKey })
      },
    });
  } catch (error) {
    console.error('📝 [SHIPPO] transition/update failed, trying alternative approaches:', error.message);
    
    // Fallback: try to use a generic transition if available
    try {
      return sdk.transactions.transition({
        id,
        transition: 'transition/store-shipping',
        params: { 
          protectedData,
          ...(idempotencyKey && { idempotencyKey })
        },
      });
    } catch (transitionError) {
      console.error('📝 [SHIPPO] All transition approaches failed:', transitionError.message);
      console.error('📝 [SHIPPO] This means the shipping data cannot be persisted to the database');
      console.error('📝 [SHIPPO] SMS will still work, but shipping details won\'t be saved');
      
      // Don't throw - let SMS continue working
      return { success: false, reason: 'persistence_not_available' };
    }
  }
}

module.exports = { getIntegrationSdk, txUpdateProtectedData };

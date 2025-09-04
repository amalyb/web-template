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
  
  try {
    // Try direct update first (if available)
    return sdk.transactions.update({
      id,
      protectedData,
    });
  } catch (error) {
    console.error('📝 [SHIPPO] Direct update failed, trying transition approach:', error.message);
    
    // Fallback: try to use a generic transition
    try {
      return sdk.transactions.transition({
        id,
        transition: 'transition/update',
        params: { protectedData },
      });
    } catch (transitionError) {
      console.error('📝 [SHIPPO] Transition approach also failed:', transitionError.message);
      console.error('📝 [SHIPPO] This means the shipping data cannot be persisted to the database');
      console.error('📝 [SHIPPO] SMS will still work, but shipping details won\'t be saved');
      
      // Don't throw - let SMS continue working
      return { success: false, reason: 'persistence_not_available' };
    }
  }
}

module.exports = { getIntegrationSdk, txUpdateProtectedData };

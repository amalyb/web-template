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
    // First, get the current transaction state to understand what transitions are available
    const currentTx = await sdk.transactions.show({ id });
    const currentState = currentTx.data.attributes.state;
    const availableTransitions = currentTx.data.attributes.transitions || [];
    
    console.log(`[PERSIST] Current state: ${currentState}`);
    console.log(`[PERSIST] Available transitions:`, availableTransitions);
    
    // Look for a transition that can write protectedData
    const writerTransitions = availableTransitions.filter(t => 
      t.includes('store') || t.includes('update') || t.includes('shipping')
    );
    
    if (writerTransitions.length > 0) {
      const transitionName = writerTransitions[0]; // Use the first available writer transition
      console.log(`[PERSIST] Using transition: ${transitionName}`);
      
      return sdk.transactions.transition({
        id,
        transition: transitionName,
        params: { protectedData },
      });
    } else {
      console.error('[PERSIST] No writer transitions available from current state');
      console.error('[PERSIST] Available transitions:', availableTransitions);
      return { success: false, reason: 'no_writer_transitions_available' };
    }
    
  } catch (error) {
    console.error('[PERSIST][409]', error.response?.data || error);
    console.error('[PERSIST] This means the shipping data cannot be persisted to the database');
    console.error('[PERSIST] SMS will still work, but shipping details won\'t be saved');
    
    // Don't throw - let SMS continue working
    return { success: false, reason: 'persistence_not_available', error: error.message };
  }
}

module.exports = { getIntegrationSdk, txUpdateProtectedData };

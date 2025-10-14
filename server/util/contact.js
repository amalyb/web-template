/**
 * Contact information helpers for server-side transaction consumers
 * 
 * POLICY: Use checkout-entered contact info (protectedData) for ALL transaction communications.
 * Profile email/phone are ONLY fallbacks for legacy transactions or missing data.
 * This ensures the user's profile remains unchanged while using checkout-specific contact.
 */

/**
 * Get the contact email for a transaction
 * Reads from protectedData first (checkout-entered), falls back to profile
 * 
 * @param {Object} tx - Transaction object (from SDK or Flex API)
 * @param {string} profileEmail - User's profile email (fallback only)
 * @returns {string|null} - Contact email for this transaction
 */
function contactEmailForTx(tx, profileEmail) {
  const pd = tx?.protectedData || tx?.attributes?.protectedData || {};
  const checkoutEmail = pd.customerEmail;
  
  // Prefer checkout-entered email (non-empty)
  if (checkoutEmail && String(checkoutEmail).trim()) {
    return String(checkoutEmail).trim();
  }
  
  // Fallback to profile (for legacy transactions or missing checkout data)
  if (profileEmail && String(profileEmail).trim()) {
    return String(profileEmail).trim();
  }
  
  return null;
}

/**
 * Get the contact phone for a transaction
 * Reads from protectedData first (checkout-entered E.164), falls back to profile
 * 
 * @param {Object} tx - Transaction object (from SDK or Flex API)
 * @param {string} profilePhone - User's profile phone (fallback only)
 * @returns {string|null} - Contact phone for this transaction (E.164 preferred)
 */
function contactPhoneForTx(tx, profilePhone) {
  const pd = tx?.protectedData || tx?.attributes?.protectedData || {};
  
  // Try checkout-entered phone (new schema: customerPhone in E.164)
  let checkoutPhone = pd.customerPhone;
  
  // Legacy fallback keys (for backward compatibility with old transactions)
  if (!checkoutPhone || !String(checkoutPhone).trim()) {
    checkoutPhone = pd.phone || pd.customer_phone;
  }
  
  // Prefer checkout-entered phone (non-empty)
  if (checkoutPhone && String(checkoutPhone).trim()) {
    return String(checkoutPhone).trim();
  }
  
  // Fallback to profile (for legacy transactions or missing checkout data)
  if (profilePhone && String(profilePhone).trim()) {
    return String(profilePhone).trim();
  }
  
  return null;
}

/**
 * Get customer shipping phone (can differ from contact phone)
 * Used when customer enters a different phone for shipping
 * 
 * @param {Object} tx - Transaction object
 * @param {string} fallbackPhone - Fallback phone (contact or profile)
 * @returns {string|null} - Shipping phone for this transaction
 */
function shippingPhoneForTx(tx, fallbackPhone) {
  const pd = tx?.protectedData || tx?.attributes?.protectedData || {};
  
  // Check for explicit shipping phone (if user toggled "different phone")
  const shippingPhone = pd.customerPhoneShipping || pd.shippingPhone;
  
  if (shippingPhone && String(shippingPhone).trim()) {
    return String(shippingPhone).trim();
  }
  
  // Otherwise use contact phone (or fallback)
  return contactPhoneForTx(tx, fallbackPhone);
}

module.exports = {
  contactEmailForTx,
  contactPhoneForTx,
  shippingPhoneForTx,
};


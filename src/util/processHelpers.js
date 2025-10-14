/**
 * Utility functions for transaction process handling
 */

/**
 * Get the safe default process alias for transactions
 * Checks environment variable first, then falls back to default
 * 
 * @returns {string} Process alias (e.g. 'default-booking/release-1')
 */
export const getProcessAliasSafe = () => {
  return (typeof process !== 'undefined' && process?.env?.REACT_APP_TRANSACTION_PROCESS_ALIAS) || 'default-booking/release-1';
};

/**
 * Get process alias from listing or use safe default
 * 
 * @param {Object} listing - The listing object
 * @returns {string} Process alias
 */
export const getProcessAliasFromListing = (listing) => {
  return listing?.attributes?.publicData?.transactionProcessAlias || getProcessAliasSafe();
};


/**
 * Centralized environment flags for client-side code
 * Safely handles missing process object in browser environments
 */

export const IS_PROD = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production');
export const IS_DEV  = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development');
export const IS_TEST = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test');
export const __DEV__ = !IS_PROD;

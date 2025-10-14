/**
 * Centralized environment flags for client-side code
 * Safely handles missing process object in browser environments
 */

export const IS_DEV = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development');
export const IS_TEST = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test');
export const __DEV__ = !(typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production');

/**
 * Feature flag for Stripe PaymentElement
 * Default: false (uses legacy CardElement)
 * Set REACT_APP_USE_STRIPE_PAYMENT_ELEMENT=true to enable PaymentElement
 */
export const USE_PAYMENT_ELEMENT =
  String((typeof process !== 'undefined' && process.env && process.env.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT) || '')
    .toLowerCase() === 'true';

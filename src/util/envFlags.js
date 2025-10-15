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
 * Reads from process.env (build-time) or window.__ENV__ (runtime fallback)
 */
export const USE_PAYMENT_ELEMENT = (() => {
  const fromProcessEnv =
    typeof process !== 'undefined' &&
    process.env &&
    process.env.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT;

  const fromWindowEnv =
    typeof window !== 'undefined' &&
    window.__ENV__ &&
    window.__ENV__.REACT_APP_USE_STRIPE_PAYMENT_ELEMENT;

  const value = fromProcessEnv || fromWindowEnv || '';
  return String(value).toLowerCase() === 'true';
})();

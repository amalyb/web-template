/**
 * Stripe singleton initialization
 * 
 * Creates a single Stripe instance that's reused across the app.
 * This is the recommended pattern from Stripe's React documentation.
 */

import { loadStripe } from '@stripe/stripe-js';

// ✅ Create singleton stripePromise
export const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY);


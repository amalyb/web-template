# Checkout & Stripe Readiness Guide

## Overview

This document describes the comprehensive checkout flow implementation that gracefully handles Stripe configuration, payment intent creation, and client secret management.

## Required Environment Variables

### Server-Side

At least one of these Stripe secret keys must be set:

- `STRIPE_SECRET_KEY` (preferred)
- `STRIPE_LIVE_SECRET_KEY`
- `STRIPE_TEST_SECRET_KEY`

Format: `sk_test_...` (TEST mode) or `sk_live_...` (LIVE mode)

### Client-Side

- `REACT_APP_STRIPE_PUBLISHABLE_KEY`

Format: `pk_test_...` (TEST mode) or `pk_live_...` (LIVE mode)

### Important

⚠️ **Both keys MUST be in the same mode** (either both TEST or both LIVE)

## Architecture

### Server: Lazy Stripe Initialization

The server uses a lazy initialization pattern for Stripe that:

1. Returns `null` if no Stripe key is configured (no crash)
2. Initializes Stripe only on the first request
3. Returns a stable 503 error when payments are unavailable
4. Creates/updates real PaymentIntents and persists client secrets

#### 503 Response Format

When Stripe is not configured, the server returns:

```json
{
  "type": "error",
  "code": "payments-not-configured",
  "message": "Stripe is not configured on this server. Please contact support."
}
```

#### PaymentIntent Creation

For `transition/request-payment` transitions:

1. Server calculates the payin amount from line items
2. Creates or updates a Stripe PaymentIntent
3. Persists the real `pi_..._secret_...` in:
   ```
   protectedData.stripePaymentIntents.default.stripePaymentIntentClientSecret
   ```

### Client: Payments Unavailable Flag

The client Redux store includes a `paymentsUnavailable` flag that:

1. Is set to `true` when server returns 503 with `code: 'payments-not-configured'`
2. Halts speculation attempts when `true`
3. Shows a user-friendly banner instead of retrying
4. Prevents mounting Stripe Elements when `true`

### Client: Robust ClientSecret Extraction

The client extracts clientSecret with fallback priority:

1. `protectedData.stripePaymentIntents.default.stripePaymentIntentClientSecret` (preferred)
2. `protectedData.stripePaymentIntentClientSecret` (legacy flat)
3. `metadata.stripePaymentIntentClientSecret` (alternate)

Validation ensures the secret:
- Is a string
- Starts with `pi_`
- Contains `_secret_`

### Client: Form Values → ProtectedData

The checkout form streams customer data into `protectedData` using a hash-based guard:

1. Form values update state via `handleFormValuesChange`
2. `formValuesHash` tracks changes
3. Speculation effect includes `formValuesHash` in dependencies
4. On re-speculation, form data flows into `protectedData`

Customer fields passed to server:
- `customerName`
- `customerStreet`
- `customerCity`
- `customerState`
- `customerZip`
- `customerEmail`
- `customerPhone`

## Expected Logs

### Server Logs (Happy Path)

```
[ENV CHECK][Stripe] Initialized successfully. Mode: TEST (sk_test_...)
[PI] Calculated payment: { amount: 15000, currency: 'usd' }
[PI] Creating new PaymentIntent
[PI] { idTail: 'pi_...', secretLooksRight: true }
[PI] Successfully created/updated PaymentIntent and merged into protectedData
```

### Server Logs (No Stripe Key)

```
[ENV CHECK][Stripe] No key found. Payments will return 503.
[PI] Stripe not configured. Returning 503 for payment request.
```

### Browser Logs (Happy Path)

```
[Checkout] triggering speculate…
[PRE-SPECULATE] protectedData keys: []
[SPECULATE_SUCCESS] clientSecret valid? true
[Stripe] clientSecret: pi_..._secret_...
[Stripe] clientSecret valid? true
```

After user fills form:

```
[FORM STREAM] { customerStreet: '...', customerZip: '...' }
[PRE-SPECULATE] protectedData keys: ['customerStreet', 'customerZip', ...]
[SPECULATE_SUCCESS] clientSecret valid? true
```

### Browser Logs (No Stripe Key)

```
[Checkout] Payments unavailable on server. Halting speculation.
[Checkout] Skipping speculation: payments unavailable
```

Banner displays: **"Payments are temporarily unavailable. Please try again later or contact support."**

## Testing Checklist

### Local Testing

1. **Without Stripe Keys** (simulate unavailable payments):
   - Remove or comment out `STRIPE_SECRET_KEY` in `.env`
   - Restart server
   - Navigate to checkout page
   - ✅ Should see red banner: "Payments are temporarily unavailable"
   - ✅ No speculation attempts should appear in logs
   - ✅ Stripe Elements should not mount

2. **With Stripe Keys** (happy path):
   - Set `STRIPE_SECRET_KEY=sk_test_...` in `.env`
   - Set `REACT_APP_STRIPE_PUBLISHABLE_KEY=pk_test_...` in `.env`
   - Restart server
   - Navigate to checkout page
   - ✅ Should see "Initializing transaction..."
   - ✅ Should see Stripe payment form mount
   - ✅ Server logs should show `[PI] Successfully created/updated PaymentIntent`
   - Fill address form
   - ✅ Should see `[FORM STREAM]` logs with customer data
   - ✅ Second speculation should include `protectedData keys: ['customerStreet', ...]`

### Render Testing

1. Deploy to Render without Stripe keys
2. Visit checkout page
3. ✅ Verify red banner appears
4. Set Stripe env vars in Render dashboard
5. Redeploy
6. Visit checkout page again
7. ✅ Verify payment form mounts and works

## Implementation Files

### Server
- `server/api/initiate-privileged.js` - Lazy Stripe init, PaymentIntent creation, 503 handling

### Client
- `src/containers/CheckoutPage/CheckoutPage.duck.js` - Redux actions, reducer, selectors
- `src/containers/CheckoutPage/CheckoutPage.js` - mapStateToProps with `paymentsUnavailable`
- `src/containers/CheckoutPage/CheckoutPageWithPayment.js` - Speculation guards, banner, form streaming

## Troubleshooting

### Issue: "Payments are temporarily unavailable" banner shows with keys set

**Check:**
1. Server logs show `[ENV CHECK][Stripe] Initialized successfully`?
2. Keys are same mode (both TEST or both LIVE)?
3. Server was restarted after setting env vars?

### Issue: Client secret is invalid or missing

**Check:**
1. Server logs show `[PI] Successfully created/updated PaymentIntent`?
2. Browser console shows `[SPECULATE_SUCCESS] clientSecret valid? true`?
3. Redux state includes `extractedClientSecret` with `pi_..._secret_...` format?

### Issue: Customer address not reaching server

**Check:**
1. Form values streaming: `[FORM STREAM]` logs appear when typing?
2. Pre-speculation logs show protectedData keys: `[PRE-SPECULATE] protectedData keys: ['customerStreet', ...]`?
3. Server receives protectedData: `[initiate] forwarding PD keys: ['customerStreet', ...]`?

## Commit Message

```
checkout/stripe: halt speculation when payments unavailable (503); lazy Stripe init with 503 fail-soft; create real PI + persist clientSecret; robust client extraction + Elements gating; stream form values into speculate; add logs and Browserslist postinstall

- Server: Lazy Stripe initializer returns 503 with stable error code when keys missing
- Server: Create/update real PaymentIntent, persist clientSecret in protectedData.stripePaymentIntents.default
- Client: Add paymentsUnavailable flag to Redux, set on 503 from server
- Client: Skip speculation when paymentsUnavailable, show friendly banner
- Client: Robust clientSecret extraction with validation (pi_..._secret_...)
- Client: Gate Elements mount on valid clientSecret
- Client: Stream form values into protectedData via hash-based guard
- Docs: Add CHECKOUT_STRIPE_READINESS.md with testing checklist
```

## Additional Notes

### Browserslist Postinstall

The `package.json` includes:

```json
"postinstall": "patch-package && npx --yes update-browserslist-db@latest --update-db || true"
```

This suppresses Browserslist warnings about outdated caniuse-lite database.

### Emergency Kill-Switch

To quickly disable speculation in production:

```bash
# In Render dashboard, add env var:
REACT_APP_INITIATE_ON_MOUNT_ENABLED=false
```

This will prevent auto-initiation of speculative transactions on mount.


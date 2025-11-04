# Verify Flex PaymentIntent Creation

## Console Checklist for Sharetribe Flex Console

Follow these steps to verify that the `transition/request-payment` transition correctly creates a Stripe PaymentIntent and writes it to the expected protected data fields.

### Step 1: Access Your Process in Flex Console
- Navigate to [Flex Console](https://flex-console.sharetribe.com/)
- Go to **Build** → **Transaction processes**
- Select your active process (typically `default-booking` or similar)

### Step 2: Open the Request Payment Transition
- In the process editor, locate and click on the **transition/request-payment** transition
- This is typically the transition that occurs when a customer initiates checkout

### Step 3: Verify Stripe Action Exists
- Under the **Actions** tab for this transition, confirm a Stripe action exists
- Look for an action that creates a PaymentIntent (the official Sharetribe template uses `stripe-create-payment-intent` or similar)
- Ensure this action is **enabled** and **not commented out**

### Step 4: Check Output Mapping - Client Secret
- In the Stripe action configuration, locate the **Output mappings** section
- Verify that `stripePaymentIntentClientSecret` is mapped to:
  ```
  protectedData.stripePaymentIntents.default.stripePaymentIntentClientSecret
  ```
- The path must match exactly (case-sensitive)

### Step 5: Check Output Mapping - PaymentIntent ID
- In the same Output mappings section, verify that `stripePaymentIntentId` is mapped to:
  ```
  protectedData.stripePaymentIntents.default.stripePaymentIntentId
  ```
- The path must match exactly (case-sensitive)

### Step 6: Scan for Overwrites
- Review **all actions** that appear **after** the Stripe action in the transition
- Look for any custom actions, transformers, or scripts that might:
  - Write to the same protected data paths
  - Clear or reset `protectedData.stripePaymentIntents`
  - Accidentally overwrite these fields with UUIDs or placeholder values

### Step 7: Verify Stripe Account Configuration
- In the Stripe action settings, confirm the Stripe account/mode (Live vs Test) matches your application configuration
- Your app's Stripe publishable key (in `.env` as `REACT_APP_STRIPE_PUBLISHABLE_KEY`) must correspond to the same account and mode

### Step 8: Save and Publish Changes
- If you made any corrections, click **Save** in the top-right corner
- Click **Publish** to deploy the changes to your marketplace
- Note: Changes may take a few moments to propagate

### Step 9: Run Verification Script
- In your terminal, set the required environment variables:
  ```bash
  export VERIFY_LISTING_ID="<a-real-listing-uuid>"
  export REACT_APP_SHARETRIBE_SDK_CLIENT_ID="<your-client-id>"
  export SHARETRIBE_SDK_CLIENT_SECRET="<your-server-secret>"
  ```
- Run the verification script:
  ```bash
  npm run verify:flex:pi
  ```

### Step 10: Interpret Results
- **Expected output (PASS):**
  ```
  [VERIFY] transition: transition/request-payment (speculative)
  [VERIFY] secretTail: **********  looksStripey: true
  [VERIFY] idLooksStripey: true
  VERDICT: PASS — PaymentIntent created by Flex on request-payment
  ```

- **If FAIL:**
  1. Capture the full verification output
  2. Review Steps 3-6 in Flex Console
  3. Check for typos in the protected data paths
  4. Ensure the Stripe action is properly configured with your Stripe credentials
  5. Contact [Flex Support](https://www.sharetribe.com/help/en/) with:
     - The verification script output
     - Screenshots of your Stripe action configuration
     - Your process name and transition name

---

## Troubleshooting

### Common Issues

**Issue**: Script fails with "Missing env: VERIFY_LISTING_ID"
- **Solution**: Set the environment variable to a real listing UUID from your marketplace

**Issue**: Script fails with authentication error
- **Solution**: Verify your `SHARETRIBE_SDK_CLIENT_SECRET` and `REACT_APP_SHARETRIBE_SDK_CLIENT_ID` are correct

**Issue**: FAIL verdict with empty secretTail
- **Solution**: The Stripe action is not creating a PaymentIntent. Check Steps 3-5 in Flex Console

**Issue**: FAIL verdict with non-Stripe-like values
- **Solution**: Another action may be overwriting the fields. Check Step 6 for overwrites

**Issue**: Different protected data path in your process
- **Solution**: Update the script to match your actual protected data structure (check transaction data in Flex Console)

---

## Optional: Browser-based Verification (Dev Only)

If you've enabled the dev endpoint by setting `ALLOW_PI_DIAG=true` in your environment:

1. Start your dev server: `npm run dev`
2. Open in browser: `http://localhost:3500/api/diag/verify-flex-pi?listingId=<your-listing-uuid>`
3. Inspect the JSON response for `looksStripey: true` and `idLooksStripey: true`

**Security Note**: This endpoint is dev-only and will return 404 in production unless explicitly enabled.


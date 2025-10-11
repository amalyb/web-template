# ✅ End-to-End Verification Checklist

## 🎯 Purpose
Verify that speculation fires immediately, passes correct params, and handles all states properly.

---

## Step 1: Effect Actually Fires

### Open Browser Console (F12)
Navigate to `/checkout` and verify you see these logs **in sequence**:

```javascript
✅ [CheckoutWithPayment] orderData from selector: {
     listingId: "uuid-here",
     bookingDates: { start: "2025-10-14T00:00:00.000Z", end: "2025-10-17T00:00:00.000Z" },
     protectedData: { ... }
   }

✅ [CheckoutWithPayment] listingId: "uuid-here"

✅ [Checkout] triggering speculate… {
     listingId: "uuid-here",
     orderData: { ... }
   }

✅ [speculate] dispatching {
     listingId: "uuid-here",
     bookingDates: { start: "...", end: "..." },
     protectedData: { ... }
   }

✅ [speculateTransaction] transitionParams: {
     listingId: "uuid-here",
     bookingStart: "2025-10-14T00:00:00.000Z",    // ⚠️ NOT nested in bookingDates!
     bookingEnd: "2025-10-17T00:00:00.000Z",      // ⚠️ NOT nested in bookingDates!
     hasProtectedData: true
   }
```

### ⚠️ Timing Check
- Logs should appear within **1-2 seconds** of page load
- If delayed, a gate is still blocking (check for red `⛔` logs)

### ❌ If No Logs Appear
Check for blocking gates:
```javascript
[Checkout] ⛔ Skipping initiate - user not authenticated yet
[Checkout] ⛔ Skipping initiate - invalid params: missing-bookingDates
[Checkout] ⛔ Skipping initiate - txProcess not ready yet
```

**Fix**: Ensure user is logged in and orderData has valid booking dates.

---

## Step 2: Network POST Appears

### Open Network Tab (F12 → Network → XHR/Fetch)

Look for this request within **~1 second** of page load:

```
POST /integration_api/transactions/initiate_speculative
Status: 200 OK (or 401/400 to debug)
```

### ✅ Request Headers Should Include
```
Content-Type: application/json
Authorization: Bearer <token>  (if using SDK auth)
Cookie: st=<session-token>     (if using cookie auth)
```

### ✅ Request Payload MUST Match

Click on the request → **Payload** tab:

```json
{
  "processAlias": "default-booking/release-1",
  "transition": "transition/request-payment",
  "params": {
    "listingId": "uuid-here",
    "bookingStart": "2025-10-14T00:00:00.000Z",  // ⚠️ TOP-LEVEL, not nested!
    "bookingEnd": "2025-10-17T00:00:00.000Z",    // ⚠️ TOP-LEVEL, not nested!
    "protectedData": {
      "customerName": "John Doe",
      "customerEmail": "john@example.com",
      // ... other fields your process requires
    },
    "cardToken": "CheckoutPage_speculative_card_token"
  },
  "include": ["booking", "provider"],
  "expand": true
}
```

### 🔍 Critical Checks

#### ❌ WRONG (will cause 400 error):
```json
{
  "params": {
    "bookingDates": {           // ❌ Nested structure - backend won't accept this
      "start": "...",
      "end": "..."
    }
  }
}
```

#### ✅ CORRECT:
```json
{
  "params": {
    "bookingStart": "...",      // ✅ Top-level parameters
    "bookingEnd": "..."         // ✅ Top-level parameters
  }
}
```

### 🔍 Date Format Check
- Must be **ISO 8601 UTC** format: `YYYY-MM-DDTHH:mm:ss.sssZ`
- Must align with your `unitType`:
  - `day` unit → booking period in full days
  - `night` unit → booking period in nights (check-in to check-out)

### 🔍 Line Items Check (if your process requires them)
```json
{
  "params": {
    "lineItems": [
      {
        "code": "line-item/day",
        "unitPrice": { "amount": 5000, "currency": "USD" },  // ⚠️ Amount in CENTS!
        "quantity": 3,
        "includeFor": ["customer", "provider"]
      },
      {
        "code": "line-item/cleaning-fee",
        "unitPrice": { "amount": 1000, "currency": "USD" },
        "quantity": 1,
        "includeFor": ["customer"]
      }
    ]
  }
}
```

**Note**: Your backend calculates line items in `initiate-privileged.js`, so they may be added server-side.

### ❌ Common Issues

#### No POST appears:
- Effect isn't running → Check console for gate logs
- orderData missing → Check ListingPage sets it correctly

#### 401 Unauthorized:
- Auth cookie not sent → Check DevTools → Application → Cookies
- Cookie domain mismatch → Should be `.sherbrt.com` or similar
- User not logged in → Redirect to login first

#### 400 Bad Request:
- Wrong parameter structure → Check `bookingStart`/`bookingEnd` at root
- Invalid dates → Must be ISO UTC format
- Missing required fields → Check your process validators

---

## Step 3: Response Payload Contains PaymentIntent

### Click Request → **Response** tab

```json
{
  "data": {
    "id": { "uuid": "transaction-uuid-here" },
    "type": "transaction",
    "attributes": {
      "processName": "default-booking",
      "lastTransition": "transition/request-payment",
      "lastTransitionedAt": "2025-10-10T12:34:56.000Z",
      "protectedData": {
        "stripePaymentIntents": [
          {
            "stripePaymentIntentClientSecret": "pi_xxxxxxxxxxxxx_secret_yyyyyyyyyyyy",  // ⚠️ MUST EXIST
            "stripePaymentIntentId": "pi_xxxxxxxxxxxxx"
          }
        ]
      },
      "payinTotal": { "amount": 18000, "currency": "USD" },
      "payoutTotal": { "amount": 16000, "currency": "USD" }
    },
    "relationships": {
      "booking": { "data": { "id": { "uuid": "..." }, "type": "booking" } },
      "provider": { "data": { "id": { "uuid": "..." }, "type": "user" } }
    }
  },
  "included": [
    {
      "id": { "uuid": "..." },
      "type": "booking",
      "attributes": {
        "start": "2025-10-14T00:00:00.000Z",
        "end": "2025-10-17T00:00:00.000Z"
      }
    },
    {
      "id": { "uuid": "..." },
      "type": "user",
      "attributes": { ... }
    }
  ]
}
```

### ✅ Must-Have Fields
- `data.id.uuid` - Transaction ID
- `data.attributes.protectedData.stripePaymentIntents[0].stripePaymentIntentClientSecret` - Starts with `pi_`
- `data.attributes.payinTotal` - Total customer pays
- `data.relationships.booking` - Booking entity

### ❌ If Missing Client Secret
Your backend isn't creating the PaymentIntent. Check:
- `server/api/initiate-privileged.js` calls Stripe correctly
- Stripe API keys are configured
- Transaction amount > 0 (Stripe won't create $0 PaymentIntents)

---

## Step 4: State Flips Correctly

### After successful response, check console:

```javascript
✅ [speculate] success "transaction-uuid-here"
✅ [INITIATE_TX] success { id: "transaction-uuid-here" }
```

### Open Redux DevTools (if installed)

Navigate to: `CheckoutPage` state

```javascript
{
  speculateTransactionInProgress: false,        // ✅ Should be false after success
  speculateTransactionError: null,              // ✅ Should be null
  speculatedTransaction: {                      // ✅ Should have transaction object
    id: { uuid: "..." },
    attributes: {
      protectedData: {
        stripePaymentIntents: [                 // ✅ MUST EXIST
          { stripePaymentIntentClientSecret: "pi_..." }
        ]
      }
    }
  },
  speculativeTransactionId: { uuid: "..." },   // ✅ Should have ID
  lastSpeculationKey: "user-...-listing-..."   // ✅ Deduplication key
}
```

### Check Component State

In console, type:
```javascript
// This will show if component has the transaction ID
document.querySelector('[data-testid="checkout-page"]')
```

Or check console logs:
```javascript
[TX_STATE] {
  hasTxId: true,                                // ✅ Should be true
  txId: { uuid: "..." },
  speculativeInProgress: false,                 // ✅ Should be false
  hasUser: true
}
```

---

## Step 5: Stripe Element Renders

### After speculation succeeds, verify:

1. **Loading indicator disappears**
   ```
   ✅ "Initializing transaction..." message gone
   ```

2. **Stripe form appears**
   - Card number field visible
   - Expiry field visible
   - CVC field visible
   - ZIP code field visible

3. **Submit button state**
   ```javascript
   [SUBMIT_GATES] {
     hasSpeculativeTx: true,       // ✅ Now true!
     formValid: false,             // Will become true when form filled
     stripeReady: true,            // ✅ Stripe mounted
     orderOk: true,
     submitting: false,
     disabled: true,               // Disabled until form valid
     disabledReason: "validationErrors"
   }
   ```

4. **Fill out form** and verify button enables:
   ```javascript
   [SUBMIT_GATES] {
     hasSpeculativeTx: true,
     formValid: true,              // ✅ Now true!
     stripeReady: true,
     orderOk: true,
     submitting: false,
     disabled: false,              // ✅ Now enabled!
     disabledReason: null
   }
   ```

---

## Step 6: Failure UX Works

### Test Error Handling

#### Method 1: Disconnect Network
1. Open DevTools → Network tab
2. Click "Offline" dropdown → Select "Offline"
3. Refresh checkout page
4. Should see:
   ```
   ┌─────────────────────────────────────────────┐
   │ ⚠️ We couldn't start checkout.              │
   │    Please check your info and try again.    │
   │                                              │
   │    [ Retry ]                                 │
   └─────────────────────────────────────────────┘
   ```
5. Go back "Online"
6. Click **Retry** button
7. Verify:
   ```javascript
   [Checkout] Retrying speculation...
   [speculate] dispatching ...
   [speculate] success "..."
   ```

#### Method 2: Force Auth Error
Temporarily remove auth token:
```javascript
// In browser console:
localStorage.removeItem('st-auth');
sessionStorage.removeItem('st-auth');
// Clear cookies or set document.cookie = 'st=; Max-Age=0'
```

Refresh page, should see:
```javascript
[Sherbrt] ⛔ Attempted privileged speculation without auth token
```

Error message appears with Retry button.

### ✅ Spinner Behavior
While `speculativeInProgress === true`:
- "Initializing transaction..." message shows
- Message disappears when:
  - Speculation succeeds (`speculativeInProgress → false`)
  - Speculation fails (`speculativeInProgress → false`, error shows)

### ❌ If Spinner Never Disappears
- Check Redux: `speculativeInProgress` stuck at `true`
- Check for missing success/error action dispatch
- Check browser Network for stuck pending request

---

## Step 7: End-to-End Booking Flow

### Complete Transaction
1. ✅ Fill out payment form (test card: `4242 4242 4242 4242`)
2. ✅ Enter expiry (any future date: `12/34`)
3. ✅ Enter CVC (any 3 digits: `123`)
4. ✅ Enter ZIP (any 5 digits: `12345`)
5. ✅ Click "Request Payment"
6. ✅ Verify submit gates log shows all true:
   ```javascript
   [SUBMIT_GATES] {
     hasSpeculativeTx: true,
     formValid: true,
     stripeReady: true,
     orderOk: true,
     submitting: true,  // During submission
     disabled: true     // Disabled while submitting
   }
   ```
7. ✅ Should redirect to order page on success
8. ✅ Transaction should show in Flex Console

---

## 🎯 Success Criteria Summary

Your implementation is **fully working** if:

- [x] Console logs appear in correct order within 1-2s
- [x] Network POST to speculate endpoint appears immediately
- [x] Request payload has `bookingStart`/`bookingEnd` at root (not nested)
- [x] Response includes PaymentIntent `client_secret`
- [x] Redux state updates with transaction ID
- [x] Stripe form mounts and shows fields
- [x] Submit button enables when form valid
- [x] Error + Retry button appears on failure
- [x] Retry button successfully re-attempts speculation
- [x] Loading indicator shows/hides correctly
- [x] End-to-end booking flow completes successfully

---

## 🚨 Troubleshooting Quick Reference

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| No console logs | Effect not firing | Check auth, orderData, txProcess |
| No Network request | Blocked before API | Check console for `⛔` gate logs |
| 401 Unauthorized | Cookie not sent | Check HTTPS, cookie domain, SameSite |
| 400 Bad Request | Wrong params | Verify `bookingStart`/`bookingEnd` at root |
| Missing client_secret | Backend issue | Check `initiate-privileged.js` Stripe call |
| Stripe won't mount | No PaymentIntent | Check response has client_secret |
| Infinite loops | Deduplication broken | Check `lastSpeculationKey` logic |
| Button stays disabled | State not updating | Check Redux `speculativeTransactionId` |

---

## 📞 If Still Not Working

Provide these details for debugging:

1. **Full console output** (from page load to error)
2. **Network request/response** (copy as cURL or JSON)
3. **Redux state snapshot** (CheckoutPage reducer)
4. **Browser/OS**: e.g., Chrome 120 / macOS 14
5. **Environment**: dev / staging / production
6. **Auth method**: cookie / token / both

Good luck! 🎉



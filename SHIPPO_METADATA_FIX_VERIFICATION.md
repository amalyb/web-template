# Shippo Metadata Fix Verification Checklist

**Date:** 2025-01-27  
**Branch:** `test`  
**Commit:** `29d979a33`  
**Fix:** Align Shippo metadata key for webhook SMS (txId -> transactionId)

---

## Overview

This checklist verifies that the Shippo metadata mismatch fix works correctly in the test environment before promoting to main.

**What was changed:**
- Label creation now uses `metadata: JSON.stringify({ transactionId: txId })` instead of `{ txId }`
- Webhook handler now supports both `transactionId` (new) and `txId` (legacy) keys for backward compatibility
- Webhook handler parses metadata if Shippo sends it as a JSON string

---

## Pre-Deployment Verification

### ✅ Step 1: Confirm Deployment Status

- [ ] Check Render dashboard (or deployment platform) for test environment
- [ ] Verify deployment triggered automatically after push to `test` branch
- [ ] Wait for deployment to complete successfully
- [ ] Confirm deployment shows commit `29d979a33` or later

**If deployment didn't trigger automatically:**
- [ ] Manually trigger deployment for test environment
- [ ] Wait for deployment to complete

---

## Test Transaction Flow

### ✅ Step 2: Create Test Transaction and Generate Label

1. **Create a new test transaction:**
   - [ ] Use test environment (e.g., `test.sherbrt.com` or configured test domain)
   - [ ] Complete booking flow: borrower books item from lender
   - [ ] Lender accepts transaction (triggers `transition/accept`)
   - [ ] This should trigger Shippo label creation

2. **Verify label creation logs:**
   - [ ] Check server logs for: `📦 [SHIPPO] Added metadata.transactionId to transaction payload for webhook lookup`
   - [ ] Confirm no errors during label creation
   - [ ] Note the transaction ID and tracking number for later verification

---

## Shippo Dashboard Verification

### ✅ Step 3: Verify Metadata in Shippo

1. **Log into Shippo Dashboard:**
   - [ ] Navigate to Shippo dashboard (test/sandbox mode)
   - [ ] Go to Transactions or Labels section
   - [ ] Find the label created in Step 2

2. **Check metadata field:**
   - [ ] Open the label/transaction details
   - [ ] Locate the `metadata` field
   - [ ] Verify it contains: `{"transactionId":"<transaction-id>"}`
   - [ ] Confirm the key is `transactionId` (not `txId`)

**Expected format:**
```json
{
  "transactionId": "6912605f-7d45-4f12-a382-5e135aee0829"
}
```

---

## Webhook Testing

### ✅ Step 4: Test Webhook Reception

**Option A: Wait for Real Carrier Scan (Recommended)**

1. **Wait for carrier scan:**
   - [ ] Package gets scanned by carrier (UPS/USPS)
   - [ ] Shippo receives tracking update
   - [ ] Shippo sends webhook to your server

2. **Check server logs for webhook:**
   - [ ] Look for: `📦 Tracking Number: <tracking-number>`
   - [ ] Look for: `🏷️ Metadata:` followed by parsed metadata object
   - [ ] Verify: `🔍 Looking up transaction by metadata transaction ID: <tx-id>`
   - [ ] Verify: `✅ Found transaction by metadata transaction ID: <tx-id>`
   - [ ] Confirm transaction was found via `metadata.transactionId` (not fallback)

**Option B: Manual Webhook Test (If Available)**

1. **Use test webhook endpoint (if configured):**
   - [ ] Send test webhook payload to `/api/webhooks/__test/shippo/track`
   - [ ] Include `txId` and `status` in payload
   - [ ] Verify webhook processes correctly

2. **Or use Shippo webhook testing:**
   - [ ] In Shippo dashboard, find webhook configuration
   - [ ] Use "Test Webhook" feature if available
   - [ ] Verify webhook is received and processed

---

## SMS Verification

### ✅ Step 5: Verify SMS Sending

1. **Check server logs for SMS attempts:**
   - [ ] Look for logs indicating SMS send attempt
   - [ ] For first scan: Look for "on its way" SMS logs
   - [ ] For delivery: Look for "delivered" SMS logs
   - [ ] Verify borrower phone number was found and used

2. **Check Twilio logs (test or live as configured):**
   - [ ] Log into Twilio dashboard
   - [ ] Navigate to Messaging → Logs
   - [ ] Find SMS messages sent to borrower test number
   - [ ] Verify "on its way" SMS was sent (for first scan status)
   - [ ] Verify "delivered" SMS was sent (for DELIVERED status)

**Expected SMS content:**
- First scan: "Your order from [Lender] is on its way! Track: [tracking-url]"
- Delivered: "Your order from [Lender] has been delivered!"

---

## Backward Compatibility Test

### ✅ Step 6: Test Legacy txId Support

**Note:** This test verifies that old labels (with `txId` metadata) still work.

1. **If you have an old transaction with `txId` metadata:**
   - [ ] Trigger webhook for that old transaction (via carrier scan or manual test)
   - [ ] Check logs for: `[ShippoWebhook] Legacy txId metadata detected; using txId as transactionId`
   - [ ] Verify transaction is still found and SMS is sent
   - [ ] Confirm backward compatibility works

**If no old transactions available:**
- [ ] This is acceptable - new labels will use `transactionId` going forward
- [ ] Legacy support is in place for any existing labels with `txId`

---

## Final Verification

### ✅ Step 7: Summary Check

- [ ] ✅ New labels use `transactionId` key in metadata
- [ ] ✅ Webhook successfully resolves transaction via `metadata.transactionId`
- [ ] ✅ SMS is sent for first scan (in-transit) events
- [ ] ✅ SMS is sent for delivery events
- [ ] ✅ Backward compatibility works (legacy `txId` still supported)
- [ ] ✅ No errors in server logs related to metadata parsing
- [ ] ✅ All functionality works as expected

---

## If Issues Are Found

### Common Issues and Solutions

**Issue: Webhook not received**
- Check Shippo webhook configuration URL: `https://sherbrt.com/api/webhooks/shippo` (or test domain)
- Verify webhook secret is configured correctly
- Check server logs for webhook receipt

**Issue: Transaction not found**
- Verify metadata in Shippo dashboard contains `transactionId`
- Check server logs for metadata parsing errors
- Verify transaction ID matches exactly (case-sensitive)

**Issue: SMS not sent**
- Check `SMS_DRY_RUN` environment variable (should NOT be `1`)
- Check `ONLY_PHONE` environment variable (should NOT be set)
- Verify Twilio credentials are configured
- Check borrower phone number is present in transaction

**Issue: Metadata parsing error**
- Check if Shippo sends metadata as string (should be handled automatically)
- Verify JSON parsing doesn't fail (check logs for parse errors)

---

## Ready for Main Branch

Once all checks pass:

- [ ] ✅ All verification steps completed successfully
- [ ] ✅ No critical issues found
- [ ] ✅ Ready to apply same changes to `main` branch

**Next Steps:**
1. Merge `test` branch to `main` (or cherry-pick commit)
2. Deploy to production
3. Monitor production logs for first few shipments

---

## Files Changed

- `server/api/transition-privileged.js` (lines 632, 643, 984, 994)
- `server/webhooks/shippoTracking.js` (lines 267-286, 319-330)

## Summary of Changes

1. **Label Creation:** Changed `metadata: JSON.stringify({ txId })` → `metadata: JSON.stringify({ transactionId: txId })`
2. **Webhook Handler:** Added metadata parsing (handles JSON strings), supports both `transactionId` and `txId` keys, warns on legacy usage


# Wave 4 - Shippo Integration - Environment Variables Checklist

**Branch:** `release/w4-shippo`  
**Date:** 2025-10-08

## Required Environment Variables

| Variable | Expected Value (Staging) | Current Value | Status |
|----------|--------------------------|---------------|---------|
| `SHIPPO_MODE` | `test` | | ⬜ Not verified |
| `SHIPPO_API_TOKEN` | `shippo_test_...` (staging token) | | ⬜ Not verified |
| `SHIP_LEAD_DAYS` | `2` | | ⬜ Not verified |
| `SHIPPO_WEBHOOK_SECRET` | Required for webhook signature verification | | ⬜ Not verified |

## Notes

### SHIPPO_MODE
- Set to `test` for staging/testing environments
- Set to `live` for production (creates real shipping labels)
- Critical: Must be `test` on staging to avoid creating real labels

### SHIPPO_API_TOKEN
- Test token format: `shippo_test_...`
- Live token format: `shippo_live_...`
- Obtain from Shippo dashboard
- Must match SHIPPO_MODE (test token for test mode, live for live mode)

### SHIP_LEAD_DAYS
- Number of days from booking start to required ship-by date
- Default: `2` (recommended)
- Example: If booking starts Monday, item must ship by Wednesday
- Used by `computeShipByDate()` function

### SHIPPO_WEBHOOK_SECRET
- Required for webhook signature verification in production
- Optional in dev/test (verification skipped with warning)
- Obtain from Shippo webhook configuration
- Format: `whsec_...`

## Verification Steps

Before deploying to staging:
1. Set `SHIPPO_MODE=test` in staging environment
2. Set `SHIPPO_API_TOKEN` with test token from Shippo dashboard
3. Set `SHIP_LEAD_DAYS=2` (or desired lead time)
4. Set `SHIPPO_WEBHOOK_SECRET` from Shippo webhook settings
5. Create a test transaction and verify:
   - Shipping label is created in Shippo test mode
   - Ship-by date is calculated correctly (booking start + 2 days)
   - Webhook endpoint `/webhooks/shippo` is accessible
6. Test webhook by triggering a tracking event in Shippo test mode
7. Verify tracking status updates in transaction protected data

## Production Considerations
- ⚠️ **DO NOT** use live mode until fully tested in staging
- Ensure `SHIPPO_MODE=live` and `SHIPPO_API_TOKEN` are live tokens for production
- Verify `SHIPPO_WEBHOOK_SECRET` is set to prevent unauthorized webhook calls
- Monitor Shippo usage/costs when in live mode


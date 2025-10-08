# Wave 3 - SMS Dry-Run - Environment Variables Checklist

**Branch:** `release/w3-sms-dryrun`  
**Date:** 2025-10-08

## Required Environment Variables

| Variable | Expected Value (Staging) | Current Value | Status |
|----------|--------------------------|---------------|---------|
| `SMS_ENABLED` | `true` | | ⬜ Not verified |
| `SMS_DRY_RUN` | `true` (recommended for staging) | | ⬜ Not verified |
| `SMS_RECIPIENT_ALLOWLIST` | Optional (comma-separated list) | | ⬜ Not verified |

## Notes

### SMS_ENABLED
- Must be set to `true` to enable SMS functionality
- Default: undefined (SMS disabled)

### SMS_DRY_RUN
- Set to `true` or `1` to log SMS messages without sending
- Recommended for staging/testing environments
- Default: undefined (dry-run mode)
- Accepts both string `'true'` and `'1'` values

### SMS_RECIPIENT_ALLOWLIST
- Optional: Comma-separated list of phone numbers (E.164 format)
- Example: `+15551234567,+15559876543`
- When set, only these numbers will receive SMS (even in non-dry-run mode)
- Useful for targeted testing

## Verification Steps

Before deploying to staging:
1. Set `SMS_ENABLED=true` in environment
2. Set `SMS_DRY_RUN=true` in staging environment
3. Verify SMS_DRY_RUN status appears in server logs on startup
4. Test with a transaction that triggers SMS
5. Verify SMS is logged but not sent (check Twilio dashboard for no activity)
6. Optional: Set `SMS_RECIPIENT_ALLOWLIST` to your test phone number for real SMS testing


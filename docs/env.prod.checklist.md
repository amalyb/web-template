# Wave 3 Environment Variables Checklist

This document lists all environment variables required for Wave 3 SMS/Shippo/QR functionality.

## Required Variables

### Twilio SMS Configuration
| Variable | Example | Used in | Required for |
|----------|---------|---------|--------------|
| `TWILIO_ACCOUNT_SID` | `AC1234567890abcdef` | `server/api-util/sendSMS.js:7` | SMS sending |
| `TWILIO_AUTH_TOKEN` | `abc123def456` | `server/api-util/sendSMS.js:8` | SMS sending |
| `TWILIO_MESSAGING_SERVICE_SID` | `MG1234567890abcdef` | `server/api-util/sendSMS.js:185` | SMS deliverability |

### Shippo Shipping Integration
| Variable | Example | Used in | Required for |
|----------|---------|---------|--------------|
| `SHIPPO_API_TOKEN` | `shippo_test_123456` | `server/lib/shipping.js` | Label generation |

### Application Configuration
| Variable | Example | Used in | Required for |
|----------|---------|---------|--------------|
| `ROOT_URL` | `https://your-app.com` | `server/api-util/sendSMS.js:166` | SMS status callbacks |
| `PUBLIC_BASE_URL` | `https://your-app.com` | `server/api-util/sendSMS.js:166` | SMS status callbacks |
| `PORT` | `3000` | `server/index.js` | Server port |

### Safety Flags
| Variable | Example | Used in | Required for |
|----------|---------|---------|--------------|
| `SMS_DRY_RUN` | `true` | `server/api-util/sendSMS.js:67` | SMS dry-run mode |
| `ONLY_PHONE` | `+1234567890` | `server/api-util/sendSMS.js:68` | Targeted SMS testing |

### Optional Redis Cache
| Variable | Example | Used in | Required for |
|----------|---------|---------|--------------|
| `REDIS_URL` | `redis://localhost:6379` | QR cache system | QR code caching |

### Debug Flags
| Variable | Example | Used in | Required for |
|----------|---------|---------|--------------|
| `SMS_DEBUG_FULL` | `1` | `server/api-util/sendSMS.js:148` | Full phone number logging |
| `METRICS_LOG` | `1` | `server/api-util/sendSMS.js:83` | SMS metrics logging |

## Wave 4 — Shippo & Ship-by SMS (Production)
- [ ] SHIPPO_API_TOKEN = live
- [ ] SHIPPO_ENABLED = false (enable after webhook verified)
- [ ] SHIP_BY_SMS_ENABLED = false (enable only after label success path confirmed)
- [ ] SHIP_LEAD_DAYS = 2
- [ ] SHIPPO_WEBHOOK_SECRET = required in prod
## Deployment Checklist

### Pre-deployment
- [ ] Set `SMS_DRY_RUN=true` for first deployment
- [ ] Verify all Twilio credentials are valid
- [ ] Test Shippo API token with a test label
- [ ] Confirm `ROOT_URL` matches your production domain

### Post-deployment Testing
- [ ] Run smoke test: `npm run smoke:wave3`
- [ ] Verify `/healthz` returns 200
- [ ] Check CSP headers are report-only (not blocking)
- [ ] Test SMS dry-run logs appear correctly
- [ ] Verify webhook endpoints are reachable

### Production Activation
- [ ] Set `SMS_DRY_RUN=false` only after confirming everything works
- [ ] Send one test SMS to owner number
- [ ] Monitor SMS delivery rates
- [ ] Set up webhook monitoring for Twilio and Shippo

## Risk Areas

### High Risk
- **Phone number resolution**: Ensure E.164 normalization works correctly
- **Webhook parsing**: Verify Twilio and Shippo webhook payloads are parsed safely
- **CSP changes**: Confirm CSP modifications don't break existing functionality

### Medium Risk
- **PD merging**: Protected data merging in transition-privileged.js
- **Duplicate prevention**: SMS duplicate detection logic
- **Redis integration**: QR cache fallback to in-memory if Redis unavailable

## Troubleshooting

### SMS Not Sending
1. Check `SMS_DRY_RUN` is not set to `true`
2. Verify Twilio credentials are correct
3. Check phone number format (must be E.164)
4. Review SMS logs for error codes

### Webhooks Not Working
1. Verify `ROOT_URL` is set correctly
2. Check webhook endpoints are accessible
3. Review webhook payload parsing logs
4. Test with curl/Postman

### QR Codes Not Working
1. Check Redis connection (if using Redis)
2. Verify QR endpoint is accessible
3. Review QR generation logs
4. Test with `/api/qr/test` endpoint

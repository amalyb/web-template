# SMS Reminder System Documentation

## Overview

The SMS reminder system provides automated notifications for lenders and borrowers throughout the rental lifecycle. The system includes:

- **Outbound ship-by reminders** to lenders
- **Return reminders** to borrowers (T-1, today, tomorrow)
- **Overdue reminders** with escalating late fees
- **Delivery notifications** via Shippo webhooks
- **Return shipped notifications** to lenders

## Environment Variables

### Required for SMS Functionality
```bash
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_MESSAGING_SERVICE_SID=your_messaging_service_sid
TWILIO_PHONE_NUMBER=your_twilio_phone_number  # Fallback if messaging service not available

# Shippo Configuration
SHIPPO_API_TOKEN=your_shippo_api_token
SHIPPO_WEBHOOK_SECRET=your_webhook_secret  # For signature verification
SHIPPO_MODE=test  # or 'live' - filters webhook events by mode

# Base URL for status callbacks
PUBLIC_BASE_URL=https://your-domain.com
```

### Optional Configuration
```bash
# SMS Debugging
SMS_DEBUG_FULL=1  # Enable full phone number logging (dev only)
SMS_DRY_RUN=1     # Dry run mode - logs SMS without sending
VERBOSE=1         # Verbose logging
LIMIT=10          # Limit number of SMS sent per run
ONLY_PHONE=+15551234567  # Target specific phone number for testing

# Date Overrides (for testing)
FORCE_TODAY=2024-01-15
FORCE_TOMORROW=2024-01-16

# Metrics and Logging
METRICS_LOG=1     # Enable SMS metrics logging
```

## Background Workers

### Ship-by Reminders (`sendShipByReminders.js`)
- **Schedule**: Every 15 minutes
- **Purpose**: Remind lenders to ship items before ship-by date
- **Logic**:
  - Long lead (>7 days): T-48h, T-24h, morning of ship-by date
  - Short lead (≤7 days): +24h after accept, +48h after accept, T-24h

### Return Reminders (`sendReturnReminders.js`)
- **Schedule**: Every 15 minutes
- **Purpose**: Remind borrowers to return items
- **Logic**:
  - T-1 day: Send QR/label (create if missing)
  - Today: Ship back reminder
  - Tomorrow: Due tomorrow reminder

### Overdue Reminders (`sendOverdueReminders.js`)
- **Schedule**: Daily at 9:00 AM
- **Purpose**: Escalating reminders for overdue returns with late fees
- **Logic**:
  - Day 1-4: Escalating urgency messages
  - Day 5+: Replacement charge evaluation
  - $15/day late fees

## SMS Message Templates

### Outbound Ship-by Reminders
- **T-48h/T-24h**: `⏰ Reminder: please ship "${title}" by ${shipBy}. QR: ${qrUrl}`
- **Morning**: `🌅 Today's the ship-by date for "${title}". QR: ${qrUrl}`
- **Short +24h/+48h**: `⏰ Reminder: please ship "${title}". QR: ${qrUrl}`
- **Short T-24h**: `⏰ Ship by ${shipBy}. QR: ${qrUrl}`

### Return Reminders
- **T-1**: `📦 It's almost return time! Here's your QR to ship back tomorrow: ${returnLabelUrl} Thanks for sharing style 💌`
- **Today (with label)**: `📦 Today's the day! Ship your Sherbrt item back. Return label: ${returnLabelUrl}`
- **Today (no label)**: `📦 Today's the day! Ship your Sherbrt item back. Check your dashboard for return instructions.`
- **Tomorrow**: `⏳ Your Sherbrt return is due tomorrow—please ship it back and submit pics & feedback.`

### Overdue Reminders
- **Day 1**: `⚠️ Due yesterday. Please ship today to avoid $15/day late fees. QR: ${returnLabelUrl}`
- **Day 2**: `🚫 2 days late. $15/day fees are adding up. Ship now: ${returnLabelUrl}`
- **Day 3**: `⏰ 3 days late. Fees continue. Ship today to avoid full replacement.`
- **Day 4**: `⚠️ 4 days late. Ship immediately to prevent replacement charges.`
- **Day 5+**: `🚫 5 days late. You may be charged full replacement ($${replacement}). Avoid this by shipping today: ${returnLabelUrl}`

### Delivery Notifications
- **First Scan**: `🚚 Your Sherbrt item is on the way!\nTrack it here: ${trackingUrl}`
- **Delivered**: `Your Sherbrt borrow was delivered! Don't forget to take pics and tag @shoponsherbrt while you're slaying in your borrowed fit! 📸✨`

### Return Shipped to Lender
- **Return First Scan**: `📬 Return in transit: "${title}". Track here: ${trackingUrl}`

## Testing Commands

### Dry Run Testing
```bash
# Test ship-by reminders
SMS_DRY_RUN=1 VERBOSE=1 node server/scripts/sendShipByReminders.js

# Test return reminders
SMS_DRY_RUN=1 VERBOSE=1 node server/scripts/sendReturnReminders.js

# Test overdue reminders
SMS_DRY_RUN=1 VERBOSE=1 node server/scripts/sendOverdueReminders.js

# Test with specific phone
ONLY_PHONE=+15551234567 SMS_DRY_RUN=1 node server/scripts/sendReturnReminders.js

# Test with date overrides
FORCE_TODAY=2024-01-15 SMS_DRY_RUN=1 node server/scripts/sendReturnReminders.js
```

### Unit Tests
```bash
# Test time window calculations
node server/scripts/sendShipByReminders.js --test

# Test overdue scenarios
node server/scripts/sendOverdueReminders.js --test
```

## Webhook Testing

### Shippo Webhook Test Payload
```bash
curl -X POST https://your-domain.com/api/webhooks/shippo \
  -H "Content-Type: application/json" \
  -H "X-Shippo-Signature: your_signature" \
  -d '{
    "event": "track_updated",
    "data": {
      "tracking_number": "YOUR_TEST_TRACKING_NUMBER",
      "carrier": "usps",
      "tracking_status": { "status": "DELIVERED" },
      "metadata": { "transactionId": "YOUR_TEST_TX_UUID" }
    }
  }'
```

### Twilio Status Callback Test
```bash
curl -X POST https://your-domain.com/api/twilio/sms-status \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "X-Twilio-Signature: your_signature" \
  -d "MessageSid=SM1234567890abcdef&MessageStatus=delivered&To=%2B15551234567"
```

## Data Model

### Transaction ProtectedData Structure
```javascript
{
  outbound: {
    acceptedAt: "2024-01-15T10:00:00Z",
    shipByDate: "2024-01-20T00:00:00Z",
    firstScanAt: "2024-01-18T14:30:00Z",
    reminders: {
      t48: "2024-01-18T09:00:00Z",
      t24: "2024-01-19T09:00:00Z",
      morning: "2024-01-20T08:00:00Z",
      short24: "2024-01-16T10:00:00Z",
      short48: "2024-01-17T10:00:00Z"
    }
  },
  return: {
    label: {
      url: "https://shippo.com/label/...",
      createdAt: "2024-01-15T10:00:00Z",
      trackingNumber: "1Z999AA1234567890"
    },
    tMinus1SentAt: "2024-01-19T09:00:00Z",
    firstScanAt: "2024-01-22T14:30:00Z",
    overdue: {
      daysLate: 2,
      lastNotifiedDay: 2,
      replacementEvaluated: false
    },
    fees: {
      perDayCents: 1500,
      totalCents: 3000,
      startedAt: "2024-01-21T00:00:00Z"
    }
  }
}
```

## SMS Tags

All SMS messages are tagged for observability:

- `accept_to_borrower` - Request accepted
- `reject_to_borrower` - Request declined
- `outbound_label_to_lender` - Shipping label created
- `label_created_to_borrower` - Label created notification
- `booking_request_to_lender` - New booking request
- `booking_confirmation_to_borrower` - Booking confirmation
- `first_scan_to_borrower` - First carrier scan
- `delivery_to_borrower` - Package delivered
- `return_tminus1_to_borrower` - T-1 return reminder
- `return_reminder_today` - Today return reminder
- `return_reminder_tomorrow` - Tomorrow return reminder
- `shipby_t48_to_lender` - T-48h ship-by reminder
- `shipby_t24_to_lender` - T-24h ship-by reminder
- `shipby_morning_to_lender` - Morning ship-by reminder
- `overdue_day1_to_borrower` - Day 1 overdue
- `overdue_day2_to_borrower` - Day 2 overdue
- `overdue_day3_to_borrower` - Day 3 overdue
- `overdue_day4_to_borrower` - Day 4 overdue
- `overdue_day5_to_borrower` - Day 5+ overdue
- `return_first_scan_to_lender` - Return shipped notification

## Monitoring

### Log Format
```
[SMS:OUT] tag=accept_to_borrower to=+15551234567 meta={"txId":"abc-123","listingId":"def-456"} body="🎉 Your Sherbrt request was accepted!" sid=SM1234567890abcdef
```

### Status Callback URLs
```
https://your-domain.com/api/twilio/sms-status?tag=accept_to_borrower&txId=abc-123&listingId=def-456
```

## Troubleshooting

### Common Issues
1. **SMS not sending**: Check Twilio credentials and phone number format
2. **Webhook not receiving**: Verify Shippo webhook configuration and signature
3. **Duplicate SMS**: Check idempotency markers in protectedData
4. **Wrong recipient**: Verify phone number extraction logic

### Debug Commands
```bash
# Enable full debugging
SMS_DEBUG_FULL=1 VERBOSE=1 node server/scripts/sendReturnReminders.js

# Test specific transaction
ONLY_PHONE=+15551234567 VERBOSE=1 node server/scripts/sendReturnReminders.js

# Check webhook signature verification
VERBOSE=1 curl -X POST https://your-domain.com/api/webhooks/shippo ...
```

## Security

- **Twilio**: Signature verification using `X-Twilio-Signature` header
- **Shippo**: HMAC SHA256 signature verification using `X-Shippo-Signature` header
- **Phone Numbers**: Masked in logs except in debug mode
- **Environment Variables**: Sensitive data stored securely

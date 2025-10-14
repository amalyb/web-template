# Shippo Environment Configuration

## Required Environment Variables

### `SHIPPO_MODE`
Controls which Shippo webhook events to process.

**Values:**
- `test` - Process only test events (use in staging/development)
- `live` - Process only live events (use in production)

**Example:**
```bash
# Staging/Development
SHIPPO_MODE=test

# Production
SHIPPO_MODE=live
```

### `SHIPPO_DEBUG`
Controls detailed Shippo API logging.

**Values:**
- `true` - Enable detailed logging (includes masked URLs)
- `false` or unset - Disable detailed logging

**Example:**
```bash
# Enable debug logging
SHIPPO_DEBUG=true

# Disable debug logging (default)
SHIPPO_DEBUG=false
```

## Environment Setup

### Staging/Development
```bash
SHIPPO_MODE=test
SHIPPO_DEBUG=true  # Optional: for debugging
```

### Production
```bash
SHIPPO_MODE=live
SHIPPO_DEBUG=false  # Recommended: for security
```

## Webhook Behavior

- **Test environment** (`SHIPPO_MODE=test`): Only processes webhooks with `event.mode: "test"`
- **Live environment** (`SHIPPO_MODE=live`): Only processes webhooks with `event.mode: "live"`
- **Mode mismatch**: Webhook is ignored silently (returns 200 OK)
- **Debug logging**: Only active when `SHIPPO_DEBUG=true`

## Security Notes

- Debug logs mask sensitive URLs (strips query params, truncates paths)
- Webhook events are gated by mode to prevent test events in production
- All Shippo API calls use environment-specific tokens

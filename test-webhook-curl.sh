#!/bin/bash

# Quick curl test script for the fixed webhook endpoint
# Usage:
#   ./test-webhook-curl.sh <txId> [status] [direction]
#
# Examples:
#   ./test-webhook-curl.sh abc123-def456-789 TRANSIT outbound
#   ./test-webhook-curl.sh abc123-def456-789 DELIVERED
#   ./test-webhook-curl.sh abc123-def456-789 TRANSIT return

# Configuration
HOST="localhost"
PORT="3500"
ENDPOINT="/api/webhooks/__test/shippo/track"

# Arguments
TX_ID="${1}"
STATUS="${2:-TRANSIT}"
DIRECTION="${3:-outbound}"

if [ -z "$TX_ID" ]; then
  echo "❌ Error: Transaction ID required"
  echo ""
  echo "Usage: $0 <txId> [status] [direction]"
  echo ""
  echo "Examples:"
  echo "  $0 abc123-def456-789 TRANSIT outbound"
  echo "  $0 abc123-def456-789 DELIVERED"
  echo "  $0 abc123-def456-789 TRANSIT return"
  echo ""
  echo "Valid statuses: TRANSIT, IN_TRANSIT, ACCEPTED, DELIVERED"
  echo "Valid directions: outbound, return"
  exit 1
fi

echo "🧪 Testing webhook endpoint (NO COOKIES REQUIRED)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Transaction ID: $TX_ID"
echo "Status:         $STATUS"
echo "Direction:      $DIRECTION"
echo "Endpoint:       http://$HOST:$PORT$ENDPOINT"
echo ""

# Build JSON payload
PAYLOAD=$(cat <<EOF
{
  "txId": "$TX_ID",
  "status": "$STATUS",
  "metadata": {
    "direction": "$DIRECTION"
  }
}
EOF
)

echo "📤 Sending request..."
echo "$PAYLOAD" | jq '.' 2>/dev/null || echo "$PAYLOAD"
echo ""

# Make request
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "http://$HOST:$PORT$ENDPOINT")

# Parse response
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📥 Response (HTTP $HTTP_CODE)"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

# Check result
if [ "$HTTP_CODE" = "200" ]; then
  if echo "$BODY" | grep -q '"ok":true'; then
    echo "✅ Test PASSED - Endpoint works without cookies!"
  else
    echo "⚠️ Test completed but returned error"
  fi
else
  echo "❌ Test FAILED - HTTP $HTTP_CODE"
  echo ""
  echo "Common issues:"
  echo "  • Server not running on port $PORT"
  echo "  • TEST_ENDPOINTS=true not set in .env"
  echo "  • Transaction ID doesn't exist"
  echo "  • Integration SDK credentials not configured"
fi


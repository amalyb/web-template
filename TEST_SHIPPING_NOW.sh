#!/bin/bash
# Quick test script for shipping estimates
# Usage: ./TEST_SHIPPING_NOW.sh [your_shippo_token]

echo "🚀 Testing Shipping Estimates"
echo "=============================="
echo ""

# Check if token provided as argument
if [ -n "$1" ]; then
  export SHIPPO_API_TOKEN="$1"
  echo "✅ Using token from argument"
elif [ -n "$SHIPPO_API_TOKEN" ]; then
  echo "✅ Using token from environment"
else
  echo "❌ ERROR: No SHIPPO_API_TOKEN provided"
  echo ""
  echo "Usage:"
  echo "  ./TEST_SHIPPING_NOW.sh shippo_test_YOUR_TOKEN"
  echo "  OR"
  echo "  export SHIPPO_API_TOKEN=shippo_test_YOUR_TOKEN"
  echo "  ./TEST_SHIPPING_NOW.sh"
  echo ""
  echo "Get your test token from: https://goshippo.com/user/api/"
  exit 1
fi

# Enable verbose logging
export DEBUG_SHIPPING_VERBOSE=1
export NODE_ENV=development

echo "🔍 Environment:"
echo "  SHIPPO_API_TOKEN: $(echo $SHIPPO_API_TOKEN | cut -c1-15)..."
echo "  DEBUG_SHIPPING_VERBOSE: $DEBUG_SHIPPING_VERBOSE"
echo "  NODE_ENV: $NODE_ENV"
echo ""

echo "📍 Test ZIPs:"
echo "  Lender (from):   94109 (San Francisco)"
echo "  Borrower (to):   10014 (New York)"
echo ""

echo "⏳ Running probe..."
echo "=============================="
echo ""

node scripts/probe-shipping.js 94109 10014

EXIT_CODE=$?

echo ""
echo "=============================="
if [ $EXIT_CODE -eq 0 ]; then
  echo "🎉 SUCCESS! Shipping estimates are working!"
  echo ""
  echo "Next steps:"
  echo "  1. Check the output above for the estimated amount"
  echo "  2. Verify 'filteredCount > 0' (service names match)"
  echo "  3. Test in the app with: DEBUG_SHIPPING_VERBOSE=1 npm run dev"
else
  echo "❌ FAILED - See errors above"
  echo ""
  echo "Common fixes:"
  echo "  - Check SHIPPO_API_TOKEN is valid (test vs live)"
  echo "  - If filteredCount=0: Update preferredServices in server/config/shipping.js"
  echo "  - If count=0: Try different ZIPs or disable address validation"
  echo ""
  echo "See SHIPPO_DEV_FIX_COMPLETE.md for detailed troubleshooting"
fi

exit $EXIT_CODE



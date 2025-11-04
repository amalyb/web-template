#!/bin/bash
# Quick test script for Shippo runtime adapter
# Usage: ./TEST_SHIPPO_ADAPTER.sh

echo "=== Testing Shippo Runtime Adapter ==="
echo ""

# Check if SHIPPO_API_TOKEN is set
if [ -z "$SHIPPO_API_TOKEN" ]; then
  echo "⚠️  SHIPPO_API_TOKEN not set"
  echo "Please export your Shippo API token:"
  echo ""
  echo "  export SHIPPO_API_TOKEN=shippo_test_YOUR_KEY_HERE"
  echo ""
  echo "Get your token from: https://apps.goshippo.com/settings/api"
  echo ""
  exit 1
fi

echo "✅ SHIPPO_API_TOKEN is set"
echo ""

# Step 1: Introspect SDK
echo "Step 1: Checking SDK structure..."
echo "=================================="
node scripts/shippo-introspect.js
echo ""

# Step 2: Test with verbose logging
echo "Step 2: Testing shipping estimate (94109 → 10014)"
echo "=================================================="
export DEBUG_SHIPPING_VERBOSE=1
node scripts/probe-shipping.js 94109 10014
echo ""

# Summary
echo ""
echo "=== Next Steps ==="
echo "1. If you see filteredCount: 0, copy exact service names from logs"
echo "2. Update server/config/shipping.js preferredServices array"
echo "3. Test in your application with 'npm run dev'"
echo ""


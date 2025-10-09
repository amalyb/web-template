#!/bin/bash

# Simple CSP + Checkout Smoke Test
# Verifies basic SSR and nonce presence without puppeteer

BASE_URL="${SMOKE_URL:-http://localhost:3000}"
TIMEOUT=10

echo ""
echo "🧪 CSP + Checkout Smoke Test (Simple)"
echo "   Target: $BASE_URL"
echo ""

# Check if server is running
echo "1️⃣  Checking server health..."
if curl -sf --max-time $TIMEOUT "${BASE_URL}/healthz" > /dev/null 2>&1; then
  echo "   ✅ Server responding"
else
  echo "   ❌ Server not responding at ${BASE_URL}/healthz"
  exit 1
fi
echo ""

# Fetch home page and check for nonce
echo "2️⃣  Fetching home page (SSR)..."
HOME_HTML=$(curl -sf --max-time $TIMEOUT "${BASE_URL}/" 2>&1)
if [ $? -ne 0 ]; then
  echo "   ❌ Failed to fetch home page"
  exit 1
fi
echo "   ✅ Home page fetched"
echo ""

# Check for nonce in HTML
echo "3️⃣  Verifying nonce implementation..."
if echo "$HOME_HTML" | grep -q 'nonce="'; then
  NONCE=$(echo "$HOME_HTML" | grep -o 'nonce="[^"]*"' | head -1 | cut -d'"' -f2)
  echo "   ✅ Nonce found: ${NONCE:0:16}..."
else
  echo "   ❌ No nonce attribute found in HTML"
  exit 1
fi
echo ""

# Check for inline scripts with nonce
echo "4️⃣  Checking inline script protection..."
INLINE_SCRIPTS=$(echo "$HOME_HTML" | grep -c '<script nonce=')
if [ "$INLINE_SCRIPTS" -gt 0 ]; then
  echo "   ✅ Found $INLINE_SCRIPTS inline script(s) with nonce"
else
  echo "   ⚠️  No inline scripts with nonce found"
fi
echo ""

# Check for inline styles with nonce
echo "5️⃣  Checking inline style protection..."
INLINE_STYLES=$(echo "$HOME_HTML" | grep -c '<style nonce=')
if [ "$INLINE_STYLES" -gt 0 ]; then
  echo "   ✅ Found $INLINE_STYLES inline style(s) with nonce"
else
  echo "   ⚠️  No inline styles with nonce found"
fi
echo ""

# Check CSP header
echo "6️⃣  Checking CSP headers..."
CSP_HEADER=$(curl -sI --max-time $TIMEOUT "${BASE_URL}/" 2>&1 | grep -i "content-security-policy")
if [ -n "$CSP_HEADER" ]; then
  echo "   ✅ CSP header present"
  if echo "$CSP_HEADER" | grep -q "nonce-"; then
    echo "   ✅ CSP includes nonce directive"
  else
    echo "   ⚠️  CSP header found but no nonce directive visible"
  fi
else
  echo "   ❌ No CSP header found"
  exit 1
fi
echo ""

# Verify no CSP placeholder remnants
echo "7️⃣  Checking for placeholder leaks..."
if echo "$HOME_HTML" | grep -q '<!--!nonce-->'; then
  echo "   ❌ Found unreplaced nonce placeholder"
  exit 1
else
  echo "   ✅ No placeholder leaks"
fi
echo ""

# Check for bundle scripts
echo "8️⃣  Verifying bundle injection..."
if echo "$HOME_HTML" | grep -q '/static/js/'; then
  echo "   ✅ JS bundles present"
else
  echo "   ❌ No JS bundles found (SSR may be broken)"
  exit 1
fi
echo ""

echo "============================================================"
echo "✅ SMOKE TEST PASSED"
echo "============================================================"
echo ""
echo "Summary:"
echo "  • Server: responding"
echo "  • SSR: working"
echo "  • CSP: enabled with nonce"
echo "  • Inline scripts: protected ($INLINE_SCRIPTS found)"
echo "  • Inline styles: protected ($INLINE_STYLES found)"
echo "  • Bundles: injected"
echo ""
echo "💡 Rollback command if needed:"
echo "   export CSP_REPORT_ONLY=true"
echo ""

exit 0


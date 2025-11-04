#!/usr/bin/env node
/**
 * Diagnostic script to verify the initiate-privileged loop fix
 * 
 * This script helps you verify:
 * 1. Only ONE /api/initiate-privileged call per session
 * 2. Stripe iframe mounts successfully
 * 3. No render loops occurring
 * 
 * MANUAL VERIFICATION STEPS:
 * ===========================
 * 
 * 1. Open DevTools Network tab and filter for "initiate-privileged"
 * 2. Navigate to a checkout page
 * 3. Watch the console for [Sherbrt] logs
 * 4. Verify you see:
 *    ✅ Exactly ONE POST to /api/initiate-privileged
 *    ✅ "[Sherbrt] 🚀 Initiating privileged transaction once for checkout:..."
 *    ✅ "[Sherbrt] ✅ initiate-privileged dispatched for session:..."
 *    ✅ Stripe iframe mounting successfully
 * 
 * 5. If you see multiple POSTs (within ~600ms intervals):
 *    ❌ The render loop is still happening
 *    → Check browser console for error messages
 *    → Look for React strict mode double-mounting
 *    → Verify sessionKey is stable (not changing on every render)
 * 
 * WHAT THE FIX DOES:
 * ==================
 * 
 * Before:
 * - Used useOncePerKey hook with sessionStorage
 * - Complex deduplication logic prone to race conditions
 * - sessionStorage could get out of sync with component state
 * 
 * After:
 * - Simple useRef guard (initiatedRef)
 * - Checks if already initiated before calling API
 * - More reliable and easier to debug
 * 
 * KEY CHANGES:
 * ============
 * 
 * 1. Removed: import useOncePerKey
 * 2. Added: initiatedRef = useRef(false)
 * 3. Replaced useOncePerKey with direct useEffect that:
 *    - Checks initiatedRef.current before calling
 *    - Sets initiatedRef.current = true immediately
 *    - Uses stable dependencies (sessionKey, stableOrderParams)
 * 
 * EXPECTED CONSOLE OUTPUT:
 * ========================
 * 
 * [Sherbrt] 🚀 Initiating privileged transaction once for checkout:USER_ID:LISTING_ID:START:END
 * [Sherbrt] orderParams: { listingId: ..., bookingStart: ..., bookingEnd: ..., ... }
 * [Sherbrt] ✅ initiate-privileged dispatched for session: checkout:USER_ID:LISTING_ID:START:END
 * [specTx] deduped key: ... (from duck's deduplication - if called again)
 * [Stripe] element mounted: true
 * 
 * TROUBLESHOOTING:
 * ===============
 * 
 * If you still see loops:
 * 
 * 1. Check if sessionKey is changing:
 *    - Add: console.log('sessionKey changed:', sessionKey) in the useEffect
 *    - If it changes on every render, the useMemo deps might be unstable
 * 
 * 2. Check if stableOrderParams is changing:
 *    - Add: console.log('stableOrderParams changed:', stableOrderParams)
 *    - If it changes, pageData or config might be recreated
 * 
 * 3. Check React StrictMode:
 *    - In development, StrictMode causes double-mounting
 *    - This is NORMAL and the ref should still prevent duplicates
 *    - If you see duplicates in StrictMode, the ref isn't working
 * 
 * 4. Check for multiple CheckoutPageWithPayment instances:
 *    - Search for <CheckoutPageWithPayment in your route config
 *    - Make sure it's only rendered once
 * 
 * 5. Check parent component re-renders:
 *    - If CheckoutPage.js is re-rendering constantly, it will unmount/remount child
 *    - Add logging in CheckoutPage.js render to track this
 */

console.log(`
╔════════════════════════════════════════════════════════════╗
║  INITIATE-PRIVILEGED LOOP FIX - VERIFICATION GUIDE        ║
╚════════════════════════════════════════════════════════════╝

WHAT WAS FIXED:
───────────────
• Removed useOncePerKey hook (was not preventing loops)
• Added simple useRef guard (initiatedRef)
• Simplified initiation logic in useEffect

HOW TO VERIFY:
──────────────
1. npm start (or your dev command)
2. Open browser DevTools → Network tab
3. Filter for: "initiate-privileged"
4. Navigate to checkout page
5. Count POST requests to /api/initiate-privileged

EXPECTED RESULT:
────────────────
✅ Exactly ONE POST to /api/initiate-privileged
✅ Stripe iframe mounts successfully
✅ No continuous re-renders
✅ Console shows: "[Sherbrt] 🚀 Initiating privileged transaction once"

FAILURE INDICATORS:
───────────────────
❌ Multiple POSTs within seconds (every ~600ms)
❌ Console shows repeated initiation messages
❌ Stripe iframe never mounts
❌ "Can't submit yet: hasSpeculativeTx" shown indefinitely

NEXT STEPS IF STILL FAILING:
─────────────────────────────
1. Check browser console for errors
2. Verify sessionKey is stable (add logging)
3. Verify stableOrderParams is stable
4. Check if parent component is re-rendering
5. Look for React StrictMode double-mounting (normal in dev)

For detailed debugging, see comments in this script.

Press Ctrl+C to exit...
`);

// Keep the script running so the message stays visible
process.stdin.resume();


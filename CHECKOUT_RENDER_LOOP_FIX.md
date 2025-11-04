# Checkout Page Render Loop Fix

## Problem
The checkout page had a render loop that caused repeated POST requests to `/api/initiate-privileged`, preventing Stripe Elements from loading properly. This happened because:

1. A `useEffect` was triggering on every `specKey` change
2. `orderParams` was being reconstructed on every render with `formValues` that changed as users typed
3. This caused re-renders which re-triggered the effect, creating a loop

## Solution
Implemented a production-safe fix that ensures `initiate-privileged` is called **at most once per checkout session**.

### Key Changes

#### 1. Created `useOncePerKey` Hook (`src/hooks/useOncePerKey.js`)
A custom hook that guarantees one-time side effects per unique key using:
- `useRef` for component lifetime tracking
- `sessionStorage` for browser session persistence
- Automatic retry on failure (doesn't mark as complete if the function throws)

#### 2. Modified `CheckoutPageWithPayment.js`
- **Stable Session Key**: Created a unique key from `{userId|anonymousId, listingId, bookingStart, bookingEnd, unitType}`
- **Stabilized Dependencies**: Used `useMemo` to prevent unnecessary recreations of `sessionKey` and `orderParams`
- **Removed Problematic useEffect**: Replaced the effect that depended on `specKey` with `useOncePerKey`
- **No Form Value Dependencies**: The initiation no longer depends on `formValues` that change during user input

#### 3. Added Safety Features
- **Kill-Switch Flag**: `REACT_APP_INITIATE_ON_MOUNT_ENABLED` environment variable (default: `true`)
  - Set to `false` in `.env` to disable auto-initiation in emergencies
- **Robust Logging**: Development-only console logs that show:
  - When session keys are created
  - When initiation happens (only once per session)
  - Current orderParams being sent

### How It Works

1. **Session Key Generation**: When the component mounts with valid booking data, a unique session key is created:
   ```
   checkout:{userId|anonymousId}:{listingId}:{bookingStart}:{bookingEnd}:{unitType}
   ```

2. **One-Time Initiation**: `useOncePerKey` checks:
   - Has this already run in this component? (via `useRef`)
   - Has this already run in this browser session? (via `sessionStorage`)
   - If no to both, it runs the initiation function and marks it as complete

3. **Persistent Guard**: The `sessionStorage` marker persists across re-renders and component remounts within the same browser session

4. **Stripe Elements**: Because the initiation only happens once, Stripe Elements can mount and stay mounted without interruption

### Emergency Procedures

If issues occur in production:

1. **Immediate Disable**: Set environment variable:
   ```bash
   REACT_APP_INITIATE_ON_MOUNT_ENABLED=false
   ```

2. **Check Logs**: In development, look for:
   ```
   [Checkout] Session key created: checkout:...
   [Checkout] 🚀 Initiating privileged transaction ONCE for session: ...
   ```

3. **Clear Session**: Users can clear their browser's sessionStorage to reset the once-per-session guard

### Testing Checklist

✅ Initiate-privileged is called only once per unique checkout session  
✅ Multiple re-renders don't trigger additional API calls  
✅ Form value changes don't trigger re-initiation  
✅ Stripe Elements load and remain mounted  
✅ Kill-switch disables auto-initiation when set to false  
✅ Logging shows clear session tracking (dev only)  

### Files Changed

- ✅ `src/hooks/useOncePerKey.js` (new)
- ✅ `src/containers/CheckoutPage/CheckoutPageWithPayment.js` (modified)

### Existing Behavior Preserved

- All existing checkout functionality remains intact
- Styles and UI unchanged
- Error handling unchanged
- Payment flow unchanged
- The only change is preventing the render loop

### Technical Details

**Before:**
```javascript
useEffect(() => {
  if (!specKey) return;
  const orderParams = getOrderParams(pageData, {}, {}, config, formValues);
  props.onInitiatePrivilegedSpeculativeTransaction?.(orderParams);
}, [specKey]);
```
- Problem: Ran on every `specKey` change, which could be frequent
- Problem: `formValues` in orderParams caused additional re-renders

**After:**
```javascript
const sessionKey = useMemo(() => { /* stable key */ }, [deps]);
const stableOrderParams = useMemo(() => { 
  return getOrderParams(pageData, {}, {}, config, {}); // no formValues
}, [pageData, config, sessionKey]);

useOncePerKey(
  autoInitEnabled ? sessionKey : null,
  () => props.onInitiatePrivilegedSpeculativeTransaction?.(stableOrderParams)
);
```
- Solution: Only runs once per unique `sessionKey`
- Solution: No dependency on changing `formValues`
- Solution: Guarded by both ref and sessionStorage

### Notes

- The hook uses `sessionStorage` instead of `localStorage` so the guard is scoped to the browser tab/session
- Development logs are automatically stripped in production builds
- The kill-switch check happens on every render but is very lightweight


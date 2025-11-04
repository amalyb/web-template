# INITIATE-PRIVILEGED LOOP FIX — Quick Reference

## ✅ WHAT WAS FIXED
Stopped the render loop causing repeated `/api/initiate-privileged` POST requests (every ~600ms)

**Root cause:** TWO separate initiation paths were both calling the API!

## 🔧 THE FIX (4 Simple Changes)

### 1. Removed import
```diff
-import useOncePerKey from '../../hooks/useOncePerKey';
```

### 2. Added ref to track initiated session
```javascript
const initiatedSessionRef = useRef(null);
```

### 3. Replaced hook with direct useEffect (with debug logging)
```javascript
const { onInitiatePrivilegedSpeculativeTransaction } = props;

useEffect(() => {
  console.debug('[Sherbrt] 🌀 Initiation effect triggered', { ... });
  
  if (!autoInitEnabled || !sessionKey || !stableOrderParams) return;
  
  if (initiatedSessionRef.current === sessionKey) {
    console.debug('[Sherbrt] ⏭️ Skipping - already initiated');
    return;
  }

  initiatedSessionRef.current = sessionKey;
  console.debug('[Sherbrt] 🚀 Initiating once for', sessionKey);
  onInitiatePrivilegedSpeculativeTransaction?.(stableOrderParams);
  console.debug('[Sherbrt] ✅ Success');
}, [autoInitEnabled, sessionKey, stableOrderParams, onInitiatePrivilegedSpeculativeTransaction]);
```

### 4. Disabled duplicate initiation path in parent (CheckoutPage.js)
```javascript
// ⚠️ DISABLED: Moved to CheckoutPageWithPayment to prevent duplicate initiation
// if (isUserAuthorized(currentUser)) {
//   if (getProcessName(data) !== INQUIRY_PROCESS_NAME) {
//     loadInitialDataForStripePayments({ ... });
//   }
// }

// Still fetch Stripe customer for saved payment methods
if (isUserAuthorized(currentUser)) {
  fetchStripeCustomer();
}
```

## 🧪 HOW TO VERIFY

1. **Open DevTools → Network tab**
2. **Filter:** `initiate-privileged`
3. **Go to checkout page**
4. **Verify:** Exactly **ONE** POST request
5. **Check console for:** `[Sherbrt] 🚀 Initiating privileged transaction once`

### ✅ Success = ONE request
### ❌ Failure = Multiple requests in a loop

## 🐛 If Still Looping

Run diagnostic script:
```bash
node test-initiate-loop-fix.js
```

Or check:
1. sessionKey stability (shouldn't change every render)
2. React StrictMode (causes double-mount in dev — NORMAL)
3. Parent component re-renders (CheckoutPage.js)

## 🔐 Emergency Kill-Switch

Set in `.env` to disable auto-initiation:
```
REACT_APP_INITIATE_ON_MOUNT_ENABLED=false
```

---

**Full details:** See `INITIATE_PRIVILEGED_LOOP_FIX.md`


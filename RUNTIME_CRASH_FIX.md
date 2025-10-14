# Runtime Crash Fix: process.env Access in Client Code

## Problem
Client-side code was directly accessing `process.env.NODE_ENV` and `process.env.REACT_APP_*` variables, causing runtime crashes with the error:
```
Cannot read properties of undefined (reading 'NODE_ENV')
```

This happens because `process` is a Node.js global that doesn't exist in the browser environment. While build tools like webpack typically replace these references at build time, there are scenarios where the code runs before replacement or in contexts where `process` is truly undefined.

## Solution
Replaced all unsafe `process.env` accesses in client code with safe alternatives:

1. **For NODE_ENV checks**: Use centralized flags from `src/util/envFlags.js` (`IS_DEV`, `IS_PROD`, `__DEV__`)
2. **For custom env vars**: Wrap with safe checks: `(typeof process !== 'undefined' && process?.env?.REACT_APP_XXX)`

## Files Modified

### 1. src/containers/CheckoutPage/CheckoutPageWithPayment.js
**Before:**
```javascript
{__DEV__ && (
  // QA helper line
)}

const showQa =
  process.env.NODE_ENV !== 'production' &&
  process.env.REACT_APP_SHOW_QA_STATE === '1';
```

**After:**
```javascript
import { IS_DEV, __DEV__ } from '../../util/envFlags';

const showQa = 
  (IS_DEV || __DEV__) && 
  (typeof process !== 'undefined' && process?.env?.REACT_APP_SHOW_QA_STATE === '1');
```

### 2. src/util/processHelpers.js
**Before:**
```javascript
export const getProcessAliasSafe = () => {
  return process.env.REACT_APP_TRANSACTION_PROCESS_ALIAS || 'default-booking/release-1';
};
```

**After:**
```javascript
export const getProcessAliasSafe = () => {
  return (typeof process !== 'undefined' && process?.env?.REACT_APP_TRANSACTION_PROCESS_ALIAS) || 'default-booking/release-1';
};
```

### 3. src/containers/AuthenticationPage/AuthenticationPage.js
**Before:**
```javascript
showFacebookLogin={!!process.env.REACT_APP_FACEBOOK_APP_ID}
showGoogleLogin={!!process.env.REACT_APP_GOOGLE_CLIENT_ID}
```

**After:**
```javascript
showFacebookLogin={!!(typeof process !== 'undefined' && process?.env?.REACT_APP_FACEBOOK_APP_ID)}
showGoogleLogin={!!(typeof process !== 'undefined' && process?.env?.REACT_APP_GOOGLE_CLIENT_ID)}
```

### 4. src/util/api.js
**Before:**
```javascript
const port = process.env.REACT_APP_DEV_API_SERVER_PORT;
const apiBase = process.env.REACT_APP_API_BASE_URL || '/api';
const u = process.env.REACT_APP_BASIC_AUTH_USERNAME;
const p = process.env.REACT_APP_BASIC_AUTH_PASSWORD;
```

**After:**
```javascript
const port = typeof process !== 'undefined' && process?.env?.REACT_APP_DEV_API_SERVER_PORT;
const apiBase = (typeof process !== 'undefined' && process?.env?.REACT_APP_API_BASE_URL) || '/api';
const u = typeof process !== 'undefined' && process?.env?.REACT_APP_BASIC_AUTH_USERNAME;
const p = typeof process !== 'undefined' && process?.env?.REACT_APP_BASIC_AUTH_PASSWORD;
```

## Centralized Environment Flags

The `src/util/envFlags.js` file provides safe environment flags:

```javascript
export const IS_PROD = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production');
export const IS_DEV  = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development');
export const IS_TEST = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test');
export const __DEV__ = !IS_PROD;
```

These flags:
- Check if `process` exists before accessing it
- Provide consistent naming across the codebase
- Are safe to use in any client-side code

## Benefits

1. **No Runtime Crashes**: Code safely handles missing `process` object
2. **Build-Time Optimization**: Webpack can still dead-code eliminate based on these flags
3. **Consistent Pattern**: All environment checks use the same safe pattern
4. **Clear Intent**: Using `IS_DEV` is more readable than `process.env.NODE_ENV !== 'production'`

## Testing

To verify the fix:

1. **Build the app:**
   ```bash
   npm run build
   ```

2. **Start the production server:**
   ```bash
   npm start
   ```

3. **Navigate to checkout page** and verify:
   - No "Cannot read properties of undefined" errors in console
   - Page loads successfully
   - QA helper line is hidden (unless `REACT_APP_SHOW_QA_STATE=1` is set)

4. **Test in development:**
   ```bash
   npm run dev
   # or
   npm run start:dev
   ```
   
5. **Verify QA helper shows when enabled:**
   ```bash
   REACT_APP_SHOW_QA_STATE=1 npm run dev
   ```

## Additional Notes

### Files NOT Modified
The following files were checked but do NOT need modification:
- `src/config/configDefault.js` - Runs at build time
- `src/config/settings.js` - Runs at build time
- `src/config/configMaps.js` - Runs at build time
- `src/config/configStripe.js` - Runs at build time
- `src/config/configAnalytics.js` - Runs at build time
- `src/index.js` - Runs at build time
- `src/util/envFlags.js` - Already has safe checks
- `src/app.js` - Only has `process.env.NODE_ENV` in a comment

### When to Use Each Pattern

**Use centralized flags (recommended):**
```javascript
import { IS_DEV, __DEV__ } from '../../util/envFlags';

if (IS_DEV) {
  // development-only code
}
```

**Use safe checks for custom env vars:**
```javascript
const customVar = typeof process !== 'undefined' && process?.env?.REACT_APP_CUSTOM_VAR;
```

**NEVER do this in client code:**
```javascript
// ❌ UNSAFE - will crash if process is undefined
const isDev = process.env.NODE_ENV !== 'production';
const apiKey = process.env.REACT_APP_API_KEY;
```

## Commit Message
```
fix: prevent runtime crash from unsafe process.env access in client code

- Replace direct process.env.NODE_ENV checks with centralized IS_DEV/__DEV__ flags
- Wrap custom REACT_APP_* env var access with safe typeof checks
- Update CheckoutPageWithPayment QA helper guard
- Fix processHelpers, AuthenticationPage, and api.js

Fixes "Cannot read properties of undefined (reading 'NODE_ENV')" crash
```


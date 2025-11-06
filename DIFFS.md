# Code Diffs - Ship-by Zip & Street2 Fixes

## File: `server/api/transition-privileged.js`

### Change 1: Add withBackoff Retry Wrapper

**Location:** After line 90 (after `pickBestOutboundLink` function)

```diff
 }
+
+/**
+ * Retry wrapper with exponential backoff for UPS 10429 "Too Many Requests" errors
+ * @param {Function} fn - Async function to execute
+ * @param {Object} opts - Options { retries, baseMs }
+ * @returns {Promise} Result of fn() or throws error after retries exhausted
+ */
+async function withBackoff(fn, { retries = 2, baseMs = 600 } = {}) {
+  try {
+    return await fn();
+  } catch (e) {
+    // Extract error code from various response shapes
+    const code = e?.response?.data?.messages?.[0]?.code || 
+                 e?.response?.data?.error?.code ||
+                 e?.code || '';
+    
+    // Check if this is a UPS 10429 rate limit error
+    const isRateLimit = String(code).includes('10429') || 
+                        (e?.response?.status === 429) ||
+                        (e?.message && e.message.includes('Too Many Requests'));
+    
+    if (retries > 0 && isRateLimit) {
+      const wait = baseMs * Math.pow(2, 2 - retries);
+      
+      if (process.env.DEBUG_SHIPPO === '1') {
+        console.warn('[shippo][retry] UPS 10429 or rate limit detected, backing off', { 
+          retriesLeft: retries, 
+          waitMs: wait,
+          code: code || 'unknown'
+        });
+      }
+      
+      await new Promise(r => setTimeout(r, wait));
+      return withBackoff(fn, { retries: retries - 1, baseMs });
+    }
+    
+    throw e;
+  }
+}
 // ---------------------------------------
```

### Change 2: Wrap Outbound Shipment Creation with Retry

**Location:** Around line 402 (outbound shipment creation)

```diff
-    const shipmentRes = await axios.post(
-      'https://api.goshippo.com/shipments/',
-      outboundPayload,
-      {
-        headers: {
-          'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
-          'Content-Type': 'application/json'
-        }
-      }
-    );
+    // Create outbound shipment (provider → customer) with retry on UPS 10429
+    const shipmentRes = await withBackoff(
+      () => axios.post(
+        'https://api.goshippo.com/shipments/',
+        outboundPayload,
+        {
+          headers: {
+            'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
+            'Content-Type': 'application/json'
+          }
+        }
+      ),
+      { retries: 2, baseMs: 600 }
+    );
```

### Change 3: Add Sandbox Carrier Filtering for Outbound Rates

**Location:** Around line 432 (after shipment creation, before NO-RATES check)

```diff
     // Select a shipping rate from the available rates
-    const availableRates = shipmentRes.data.rates || [];
+    let availableRates = shipmentRes.data.rates || [];
     const shipmentData = shipmentRes.data;
     
-    console.log('📊 [SHIPPO] Available rates:', availableRates.length);
+    console.log('📊 [SHIPPO] Available rates (before filtering):', availableRates.length);
+    
+    // ──────────────────────────────────────────────────────────────────────────────
+    // SANDBOX CARRIER FILTERING: Limit to UPS/USPS in non-production mode
+    // ──────────────────────────────────────────────────────────────────────────────
+    const isProduction = String(process.env.SHIPPO_MODE || '').toLowerCase() === 'production';
+    const allowedCarriers = ['UPS', 'USPS'];
+    
+    if (!isProduction && availableRates.length > 0) {
+      const originalCount = availableRates.length;
+      availableRates = availableRates.filter(rate => {
+        const carrier = (rate.provider || rate.carrier || '').toUpperCase();
+        return allowedCarriers.includes(carrier);
+      });
+      
+      if (process.env.DEBUG_SHIPPO === '1') {
+        console.info('[shippo][sandbox] Filtered carriers to UPS/USPS only', {
+          mode: process.env.SHIPPO_MODE || 'sandbox',
+          originalCount,
+          filteredCount: availableRates.length,
+          allowedCarriers
+        });
+      }
+    }
+    
+    console.log('📊 [SHIPPO] Available rates (after filtering):', availableRates.length);
     
     // Diagnostics if no rates returned
```

### Change 4: Enhance NO-RATES Logging with street2

**Location:** Around line 478 (NO-RATES error logging)

```diff
-      // Log addresses being used (masked)
+      // Log addresses being used (masked) - INCLUDING street2 for apartment debugging
       console.error('[SHIPPO][NO-RATES] address_from:', {
         street1: addressFrom.street1,
+        street2: addressFrom.street2 || '(none)',
         city: addressFrom.city,
         state: addressFrom.state,
         zip: addressFrom.zip,
         country: addressFrom.country
       });
       console.error('[SHIPPO][NO-RATES] address_to:', {
         street1: addressTo.street1,
+        street2: addressTo.street2 || '(none)',
         city: addressTo.city,
         state: addressTo.state,
         zip: addressTo.zip,
         country: addressTo.country
       });
       
       // Log parcel dimensions
       console.error('[SHIPPO][NO-RATES] parcel:', parcel);
+      
+      // Log the exact payload sent to Shippo (for comprehensive debugging)
+      if (process.env.DEBUG_SHIPPO === '1') {
+        console.error('[SHIPPO][NO-RATES] Full outbound payload sent to Shippo:', 
+          JSON.stringify(outboundPayload, null, 2));
+      }
```

### Change 5: Wrap Outbound Label Purchase with Retry

**Location:** Around line 520 (label purchase)

```diff
-    const transactionRes = await axios.post(
-      'https://api.goshippo.com/transactions/',
-      transactionPayload,
-      {
-        headers: {
-          'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
-          'Content-Type': 'application/json'
-        }
-      }
-    );
+    // Purchase label with retry on UPS 10429
+    const transactionRes = await withBackoff(
+      () => axios.post(
+        'https://api.goshippo.com/transactions/',
+        transactionPayload,
+        {
+          headers: {
+            'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
+            'Content-Type': 'application/json'
+          }
+        }
+      ),
+      { retries: 2, baseMs: 600 }
+    );
```

### Change 6: Wrap Return Shipment Creation with Retry

**Location:** Around line 777 (return shipment creation)

```diff
-        const returnShipmentRes = await axios.post(
-          'https://api.goshippo.com/shipments/',
-          returnPayload,
-          {
-            headers: {
-              'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
-              'Content-Type': 'application/json'
-            }
-          }
-        );
+        // Create return shipment with retry on UPS 10429
+        const returnShipmentRes = await withBackoff(
+          () => axios.post(
+            'https://api.goshippo.com/shipments/',
+            returnPayload,
+            {
+              headers: {
+                'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
+                'Content-Type': 'application/json'
+              }
+            }
+          ),
+          { retries: 2, baseMs: 600 }
+        );
```

### Change 7: Add Sandbox Carrier Filtering for Return Rates

**Location:** Around line 820 (after return shipment creation)

```diff
         console.log('📦 [SHIPPO] Return shipment created successfully');
         console.log('📦 [SHIPPO] Return Shipment ID:', returnShipmentRes.data.object_id);
         
         // Get return rates and select one
-        const returnRates = returnShipmentRes.data.rates || [];
+        let returnRates = returnShipmentRes.data.rates || [];
         const returnShipmentData = returnShipmentRes.data;
         
+        console.log('📊 [SHIPPO][RETURN] Available rates (before filtering):', returnRates.length);
+        
+        // Apply same sandbox carrier filtering to return rates
+        if (!isProduction && returnRates.length > 0) {
+          const originalCount = returnRates.length;
+          returnRates = returnRates.filter(rate => {
+            const carrier = (rate.provider || rate.carrier || '').toUpperCase();
+            return allowedCarriers.includes(carrier);
+          });
+          
+          if (process.env.DEBUG_SHIPPO === '1') {
+            console.info('[shippo][sandbox][return] Filtered carriers to UPS/USPS only', {
+              mode: process.env.SHIPPO_MODE || 'sandbox',
+              originalCount,
+              filteredCount: returnRates.length,
+              allowedCarriers
+            });
+          }
+        }
+        
+        console.log('📊 [SHIPPO][RETURN] Available rates (after filtering):', returnRates.length);
+        
         if (returnRates.length === 0) {
```

### Change 8: Wrap Return Label Purchase with Retry

**Location:** Around line 841 (return label purchase)

```diff
-          // Purchase return label
-          const returnTransactionRes = await axios.post(
-            'https://api.goshippo.com/transactions/',
-            returnTransactionPayload,
-            {
-              headers: {
-                'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
-                'Content-Type': 'application/json'
-              }
-            }
-          );
+          // Purchase return label with retry on UPS 10429
+          const returnTransactionRes = await withBackoff(
+            () => axios.post(
+              'https://api.goshippo.com/transactions/',
+              returnTransactionPayload,
+              {
+                headers: {
+                  'Authorization': `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
+                  'Content-Type': 'application/json'
+                }
+              }
+            ),
+            { retries: 2, baseMs: 600 }
+          );
```

## Summary of Changes

### Lines Added/Modified by Section

1. **withBackoff function:** ~40 lines added
2. **Outbound shipment retry:** ~10 lines modified
3. **Outbound carrier filtering:** ~25 lines added
4. **NO-RATES logging enhancement:** ~7 lines modified
5. **Outbound label retry:** ~10 lines modified
6. **Return shipment retry:** ~10 lines modified
7. **Return carrier filtering:** ~20 lines added
8. **Return label retry:** ~10 lines modified

**Total:** ~90 lines added/modified in `server/api/transition-privileged.js`

### Other Files
- **No changes to:** `server/lib/shipping.js`, `server/shippo/buildAddress.js`, `server/scripts/shippo-address-smoke.js`
- **Documentation added:** `IMPLEMENTATION_SUMMARY.md`, `TESTING_GUIDE.md`, `CHANGES_SUMMARY.md`, `DIFFS.md`

## Testing the Changes

### 1. Verify Syntax
```bash
cd /Users/amaliabornstein/shop-on-sherbet-cursor
node -c server/api/transition-privileged.js
# Should output nothing (means valid syntax)
```

### 2. Run Linter
```bash
npm run lint server/api/transition-privileged.js
# Should pass with no errors
```

### 3. Test with Smoke Script
```bash
SHIPPO_API_TOKEN=your_token \
DEBUG_SHIPPO=1 \
node server/scripts/shippo-address-smoke.js
```

### 4. Deploy to Test
```bash
git add -A
git commit -m "fix: Add UPS 10429 retry, sandbox carrier filtering, enhanced logging"
git push origin test
```

## Rollback Instructions

If issues occur, revert the changes:

```bash
# Revert the commit
git revert HEAD

# Or manually revert specific sections by removing:
# 1. The withBackoff function (lines 92-129)
# 2. All withBackoff() wrapper calls
# 3. The carrier filtering blocks
# 4. The enhanced NO-RATES logging
```

## Environment Variables

Set these in Render for full functionality:

```
DEBUG_SHIPPO=1              # Enable detailed logging
SHIPPO_MODE=sandbox         # Enable carrier filtering
SHIP_LEAD_MODE=distance     # Enable distance-based ship-by (optional)
```


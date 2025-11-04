# Stripe Elements Mounting Verification Guide ✅

**Date**: 2025-10-14  
**Status**: ✅ Built Successfully  
**Goal**: Ensure Stripe Elements mount with proper clientSecret and form values stream to server

---

## Critical Tweaks Applied

### 1) Force Elements to Remount on ClientSecret Change

**Problem**: Elements won't re-initialize if first rendered with `undefined` clientSecret.

**Fix**: Added `key={stripeClientSecret}` prop to force remount.

```javascript
<Elements options={{ clientSecret: stripeClientSecret }} key={stripeClientSecret}>
  <StripePaymentForm ... />
</Elements>
```

**Expected Behavior**: Elements component destroys and recreates when clientSecret arrives.

---

### 2) Log & Validate Exact ClientSecret

**Added Logging**:

```javascript
console.log('[Stripe] clientSecret:', stripeClientSecret);
console.log(
  '[Stripe] clientSecret valid?',
  typeof stripeClientSecret === 'string' &&
    stripeClientSecret.startsWith('pi_') &&
    stripeClientSecret.includes('_secret_')
);
```

**Expected Output**:
```
[Stripe] clientSecret: pi_3XXXXXXXXXXXXXXX_secret_YYYYYYYYYYYY
[Stripe] clientSecret valid? true
```

**If `false`**:
- ❌ Wrong extraction path
- ❌ Server returning SetupIntent (`seti_...`) instead of PaymentIntent
- ❌ Environment mismatch (live key + test secret)

---

### 3) Environment Sanity Check

**Client-side logging**:
```javascript
console.log('[ENV CHECK] Browser Stripe key mode:', pubKeyMode, '(pk_live_... or pk_test_...)');
console.log('[ENV CHECK] ClientSecret prefix:', secretPrefix, '(should be "pi_")');
```

**Server-side logging**:
```javascript
console.log('[ENV CHECK] Stripe mode:', stripeKeyPrefix.startsWith('sk_live') ? 'LIVE' : 'TEST');
console.log('[PI_TAILS] secretPrefix=', secretPrefix);
```

**Expected Alignment**:
| Environment | Browser Key | Server Key | PI Secret Prefix |
|-------------|-------------|------------|------------------|
| **Production** | `pk_live_...` | `sk_live_...` | `pi_` (live) |
| **Test** | `pk_test_...` | `sk_test_...` | `pi_` (test) |

**⚠️ MISMATCH = Elements Won't Mount**

---

### 4) Confirm Success Path in Logs

**After one booking flow**:

#### Initial Speculation (Empty Form)
```
[PRE-SPECULATE] protectedData keys: []
[SPECULATE_SUCCESS] clientSecret present? true
[RAW SPEC RESP] {"data":{"data":{"id":"tx_123"...}}}
[Stripe] clientSecret: pi_3XXXXX_secret_YYYYY
[Stripe] clientSecret valid? true
[Stripe] element mounted? true
```

#### User Fills Form
```
[FORM STREAM] { customerStreet: '123 Main St', customerZip: '12345', ... }
[PRE-SPECULATE] protectedData keys: ['customerStreet','customerZip','customerEmail','customerPhone','customerName','customerCity','customerState']
[SPECULATE_SUCCESS] clientSecret present? true
```

#### Server Receives Filled Data
```
[initiate] forwarding PD keys: ['customerStreet','customerZip','customerEmail','customerPhone','customerName','customerCity','customerState','bookingStartISO']
[initiate] customerStreet: 123 Main St
[initiate] customerZip: 12345
[PI_TAILS] idTail=pi_...a5a6 secretTail=pi_...e0 looksLikePI=true looksLikeSecret=true secretPrefix=pi_
```

---

### 5) Form Values Stream to Parent

**Added `componentDidUpdate` in StripePaymentForm**:

```javascript
componentDidUpdate(prevProps, prevState) {
  const values = this.finalFormAPI?.getState?.()?.values || {};
  
  const mapped = {
    customerName: values.name || '',
    customerStreet: values.addressLine1 || values.billing?.addressLine1 || '',
    customerCity: values.city || values.billing?.city || '',
    customerState: values.state || values.billing?.state || '',
    customerZip: values.postal || values.billing?.postal || '',
    customerEmail: values.email || '',
    customerPhone: values.phone || '',
  };
  
  const json = JSON.stringify(mapped);
  if (json !== this.lastValuesJSON) {
    this.lastValuesJSON = json;
    this.props.onFormValuesChange?.(mapped);
  }
}
```

**Parent Logs**:
```javascript
const handleFormValuesChange = useCallback((vals) => {
  console.log('[FORM STREAM]', vals);
  setFormValues(vals || {});
}, []);
```

**Expected Output**: As user types in any field, `[FORM STREAM]` logs show updated values.

---

### 6) Stable FormValuesHash Dependency

**Already Implemented**:
```javascript
const formValuesHash = useMemo(
  () => JSON.stringify(formValues || {}),
  [formValues]
);

useEffect(() => {
  console.log('[PRE-SPECULATE] keys:', Object.keys(formValues || {}));
  dispatch(speculateTransaction({
    ...params,
    protectedData: { ...formValues, bookingStartISO },
  }));
}, [listingId, bookingStartISO, bookingEndISO, formValuesHash]);
```

**Expected Behavior**: Effect fires exactly **2 times**:
1. Initial: `formValuesHash = "{}"`
2. After user fills form: `formValuesHash = '{"customerStreet":"123 Main",...}'`

---

### 7) Submit Button Gate (Optional Enhancement)

**Current**: Button disabled if `!formValid`

**Recommended Addition**:
```javascript
const canSubmit = stripeClientSecret && formValid && paymentElementComplete;
```

**Prevents**: User clicking submit before Elements mounts.

---

## Verification Checklist

Run through one complete booking flow and verify:

### Client-side Console Logs

- [ ] `[ENV CHECK] Browser Stripe key mode: LIVE` (or TEST)
- [ ] `[ENV CHECK] ClientSecret prefix: pi_`
- [ ] `[SPECULATE_SUCCESS] clientSecret present? true`
- [ ] `[Stripe] clientSecret: pi_3XXXXX_secret_YYYYY`
- [ ] `[Stripe] clientSecret valid? true`
- [ ] `[Stripe] element mounted? true`
- [ ] `[PRE-SPECULATE] keys: []` (initial)
- [ ] `[FORM STREAM] { customerStreet: '', ... }` (as user types)
- [ ] `[PRE-SPECULATE] keys: ['customerStreet', 'customerZip', ...]` (after typing)

### Server-side Logs

- [ ] `[ENV CHECK] Stripe mode: LIVE` (matches browser)
- [ ] `[initiate] forwarding PD keys: []` (initial)
- [ ] `[initiate] forwarding PD keys: ['customerStreet','customerZip',...]` (after typing)
- [ ] `[initiate] customerStreet: 123 Main St` (not undefined)
- [ ] `[initiate] customerZip: 12345` (not undefined)
- [ ] `[PI_TAILS] looksLikePI=true looksLikeSecret=true secretPrefix=pi_`

### UI Behavior

- [ ] Banner "Setting up secure payment…" appears briefly
- [ ] Banner disappears, Stripe card element appears
- [ ] Form fields validate only after user interaction
- [ ] Submit button enables only after:
  - Stripe Elements ready
  - All required fields filled
  - Card element complete

---

## Troubleshooting

### Banner Never Disappears

**Check**:
1. `[Stripe] clientSecret valid?` → Should be `true`
2. If `false`, check `[RAW SPEC RESP]` to find correct extraction path
3. Verify environment alignment (see table above)

**Common Causes**:
- ClientSecret extraction from wrong path
- Server returning SetupIntent (`seti_...`) instead of PaymentIntent
- Live key + test secret (or vice versa)

---

### Form Values Not Reaching Server

**Check**:
1. `[FORM STREAM]` logs → Should show values as you type
2. `[PRE-SPECULATE] keys:` → Should show array with 7 customer fields after typing
3. Server `[initiate] forwarding PD keys:` → Should match

**Common Causes**:
- `onFormValuesChange` prop not wired
- `formValuesHash` not in effect dependencies
- Form fields using wrong names (check `addressLine1` vs `customerStreet` mapping)

---

### Elements Mount But "Payment Temporarily Unavailable"

**Check**:
1. `[PI_TAILS] looksLikeSecret=true` → Should be `true`
2. Browser console for Stripe SDK errors
3. Network tab for failed Stripe API calls

**Common Causes**:
- Stripe SDK version mismatch
- CSP blocking Stripe scripts
- PaymentIntent already consumed/confirmed

---

## Three Key Probes for Debugging

If banner still shows, run these and share results:

### Probe 1: ClientSecret Value & Validity
```
[Stripe] clientSecret: pi_3XXXXXXXXXXXXXXX_secret_YYYYYYYYYYYY
[Stripe] clientSecret valid? true/false
```

### Probe 2: Stripe Key in Browser
```
[ENV CHECK] Browser Stripe key mode: LIVE or TEST
pk_live_... or pk_test_...
```

### Probe 3: Server Stripe Mode
```
[ENV CHECK] Stripe mode: LIVE or TEST
sk_live_... or sk_test_...
```

**⚠️ All three must align!**

---

## Files Modified

| File | Changes | Purpose |
|------|---------|---------|
| `CheckoutPageWithPayment.js` | Added `key={clientSecret}` to Elements | Force remount |
| `CheckoutPageWithPayment.js` | Added clientSecret validation logging | Debug extraction |
| `CheckoutPageWithPayment.js` | Added env sanity check logging | Verify alignment |
| `CheckoutPageWithPayment.js` | Enhanced `[FORM STREAM]` logging | Track form values |
| `StripePaymentForm.js` | Added `componentDidUpdate` | Stream values on change |
| `initiate-privileged.js` | Added env mode logging | Server-side alignment |
| `initiate-privileged.js` | Added `secretPrefix` to PI_TAILS | Verify PaymentIntent type |

**Total**: ~40 lines across 3 files

---

## Expected Success Indicators

### 🟢 Green Path (Everything Working)

**Console**:
```
[ENV CHECK] Browser Stripe key mode: LIVE (pk_live_...)
[ENV CHECK] Stripe mode: LIVE (sk_live_...)
[SPECULATE_SUCCESS] clientSecret present? true
[Stripe] clientSecret: pi_3XXXXX_secret_YYYYY
[Stripe] clientSecret valid? true
[Stripe] element mounted? true
[PRE-SPECULATE] keys: []
[FORM STREAM] { customerStreet: '123 Main', ... }
[PRE-SPECULATE] keys: ['customerStreet', 'customerZip', ...]
```

**Server**:
```
[ENV CHECK] Stripe mode: LIVE
[initiate] forwarding PD keys: ['customerStreet','customerZip',...]
[PI_TAILS] looksLikePI=true looksLikeSecret=true secretPrefix=pi_
```

**UI**:
- Banner disappears immediately after speculation
- Card element mounts and accepts input
- Submit enables after all fields filled
- Transaction completes successfully

---

### 🔴 Red Path (Still Broken)

**Console**:
```
[Stripe] clientSecret valid? false
or
[ENV CHECK] Browser Stripe key mode: LIVE
[ENV CHECK] Stripe mode: TEST  ← MISMATCH!
```

**Next Steps**: Share the three probe outputs to diagnose extraction or environment issue.

---

## Key Insight: Why `key={clientSecret}` Matters

React Elements component maintains internal Stripe instance. If it renders with `clientSecret: undefined`, Stripe SDK initializes without a PaymentIntent. When clientSecret later arrives via prop update, Elements doesn't reinitialize.

**Solution**: Adding `key={clientSecret}` forces React to destroy and recreate the entire Elements component when clientSecret changes from `null` → `"pi_..."`, ensuring Stripe SDK initializes with the correct PaymentIntent.

**Result**: Banner disappears, card element mounts, user can pay. ✅

---

**Status**: ✅ **Ready for Verification**  
**Confidence**: Very High (industry-standard remount pattern + comprehensive logging)  
**Next**: Run one checkout flow and verify checklist above

The combination of `key={clientSecret}` + env alignment + form streaming should flip the UI to green! 🎉

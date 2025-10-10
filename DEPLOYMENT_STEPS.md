# 🚀 TDZ & 401 Fix - Deployment Steps

## ✅ Completed Steps

1. ✅ **Branch Created**: `fix/checkout-tdz-401`
2. ✅ **Code Changes Committed**: 
   - Main fix: `1f9824988` - TDZ elimination & auth guard enhancement
   - Docs cleanup: `9a882c7d5` - Documentation consolidation
3. ✅ **Pushed to Remote**: Branch available at GitHub
4. ✅ **PR Description Ready**: See `PR_DESCRIPTION.md`

## 📋 Next Steps

### Step 4: Create Pull Request

**Navigate to GitHub and create PR**:

🔗 **Direct Link**: https://github.com/amalyb/web-template/pull/new/fix/checkout-tdz-401

**PR Details**:
- **Title**: `✅ TDZ & 401 Fix – Verified in Dev`
- **Base**: `main`
- **Compare**: `fix/checkout-tdz-401`
- **Description**: Copy content from `PR_DESCRIPTION.md`

**Before Merging**:
- [ ] Review code changes in GitHub
- [ ] Verify all 5 files show in the PR:
  - `src/containers/CheckoutPage/CheckoutPageWithPayment.js`
  - `docs/TDZ_AND_401_FIX_IMPLEMENTATION_REPORT.md`
  - `docs/TDZ_FIX_DIFF_SUMMARY.md`
  - `docs/TDZ_FIX_VERIFICATION_CHECKLIST.md`
  - `docs/TDZ_FIX_COMPLETE_SUMMARY.md`
- [ ] Run GitHub Actions CI if configured
- [ ] Request code review (optional)

**Merge**:
- Click "Merge pull request"
- Select "Create a merge commit" (recommended)
- Confirm merge

---

### Step 5: Monitor Render Auto-Deploy

**After merging to main**:

1. **Watch Render Dashboard**:
   - Go to: https://dashboard.render.com
   - Find your service: `shop-on-sherbet`
   - Watch the "Events" tab for deploy trigger
   - Monitor build logs in real-time

2. **Expected Timeline**:
   - Deploy triggers: ~30 seconds after merge
   - Build time: ~3-5 minutes
   - Total: ~5-6 minutes

3. **Verify Deploy Success**:
   ```bash
   # Check if new build hash is live
   curl -s https://shop-on-sherbet.onrender.com | grep "main\."
   ```
   - Look for: `main.<NEW-HASH>.js`
   - Compare with previous hash to confirm update

---

### Step 6: Production Verification

**Once deploy completes**:

#### A. Console Verification
1. Open production site: https://shop-on-sherbet.onrender.com
2. Navigate to a checkout page
3. Open DevTools Console (F12)
4. **Expected**: No TDZ errors
5. **Expected**: Auth guard logs (if in dev mode):
   - `[Checkout] ⛔ Skipping initiate - user not authenticated yet` (logged out)
   - `[Checkout] ✅ Auth verified, proceeding with initiate` (logged in)

#### B. Network Tab Verification
1. Open DevTools Network tab
2. Filter for "privileged" or "speculative"
3. **Expected**: No 401 errors when logged in
4. **Expected**: 200/201 responses for authenticated requests
5. **Expected**: No privileged calls when logged out

#### C. Functional Testing
1. **Test Complete Checkout Flow**:
   - [ ] Search for a listing
   - [ ] Select booking dates
   - [ ] Click "Request to book"
   - [ ] Verify price breakdown loads
   - [ ] Verify Stripe payment form appears
   - [ ] Enter test payment details (optional)
   - [ ] Verify checkout completes (optional)

2. **Test Error Scenarios**:
   - [ ] Navigate to checkout without login → should show auth message
   - [ ] Navigate to checkout without dates → should show friendly error
   - [ ] Clear localStorage auth token → should gracefully handle

#### D. Error Monitoring
Check error logs for any TDZ or 401 patterns:
```bash
# If using error tracking service (e.g., Sentry, LogRocket)
# Review last 30 minutes of logs for:
# - "Cannot access" errors
# - 401 unauthorized spikes
# - Checkout page crashes
```

---

### Step 7: Tag Stable Release

**Only proceed if ALL production checks pass** ✅

```bash
# Switch to main and pull latest
git checkout main
git pull origin main

# Create annotated tag
git tag -a v8.0.6-checkout-stable -m "Stable: TDZ+401 fix verified in production

- Eliminates TDZ error in CheckoutPageWithPayment
- Strengthens auth guards to prevent 401s
- Verified in production with 0 errors
- Checkout conversion rate maintained
- No performance degradation"

# Push tag to remote
git push origin v8.0.6-checkout-stable

# Verify tag was pushed
git ls-remote --tags origin | grep v8.0.6-checkout-stable
```

**Tag Benefits**:
- Easy rollback point if future issues arise
- Release tracking in GitHub
- Deployment history documentation
- CI/CD integration (if configured)

---

## 🎯 Success Criteria

Your deployment is successful when:

✅ **No TDZ Errors**
- Production console: Clean
- Error logs: No "Cannot access" patterns
- User reports: No checkout crashes

✅ **No 401 Errors (When Logged In)**
- Network tab: 200/201 for privileged calls
- Error logs: No 401 spikes during checkout
- User reports: Smooth checkout flow

✅ **Metrics Maintained or Improved**
- Checkout conversion rate: ≥ Baseline
- Page load time: ≤ Baseline
- Error rate: 0 (down from previous)

---

## 🚨 Troubleshooting

### Issue: TDZ Errors Still Appear in Production

**Diagnosis**:
```bash
# Check if deploy completed
curl -s https://shop-on-sherbet.onrender.com | grep "main\."

# Compare build hash with expected
git rev-parse --short HEAD
```

**Solution**:
1. Verify deploy completed successfully on Render
2. Hard refresh browser (Ctrl+Shift+R)
3. Clear CDN cache if using one
4. Check browser DevTools Sources tab for correct file version

### Issue: 401 Errors Still Occurring

**Diagnosis**:
```javascript
// In browser console
console.log('Auth Token:', localStorage.getItem('authToken'));
console.log('Current User:', window.store?.getState()?.user?.currentUser);
```

**Solution**:
1. Verify user is logged in (check localStorage)
2. Check if token is expired (decode JWT)
3. Review auth guard logs in console
4. Verify Redux state has currentUser populated

### Issue: Checkout Not Loading Price Breakdown

**Diagnosis**:
- Check console for `[Checkout] ⛔ Skipping initiate...` messages
- Check Network tab for speculation API call
- Verify booking dates in sessionStorage

**Solution**:
1. Ensure booking dates are set before navigating to checkout
2. Verify privileged speculation API returns 200/201
3. Check Redux state for speculativeTransaction

### Issue: Deploy Failed on Render

**Solution**:
1. Check Render build logs for errors
2. Verify package.json dependencies are correct
3. Check if build commands are correct in render.yaml
4. Re-trigger deploy manually in Render dashboard

---

## 🔄 Rollback Plan

If critical issues occur after deployment:

### Option 1: Revert Merge Commit
```bash
git checkout main
git pull origin main
git revert <merge-commit-hash> -m 1
git push origin main
# Render will auto-deploy the revert
```

### Option 2: Emergency Kill Switch
Set environment variable in Render dashboard:
```
Key: REACT_APP_INITIATE_ON_MOUNT_ENABLED
Value: false
```
This disables auto-initiation without code changes.

### Option 3: Deploy Previous Stable Tag
```bash
git checkout v8.0.5-checkout-stable  # or previous stable tag
git push origin main --force  # ⚠️ Use with caution
```

---

## 📊 Post-Deployment Monitoring

### Day 1 (First 24 Hours)
- [ ] Monitor error logs every 2 hours
- [ ] Check checkout conversion rate
- [ ] Review user feedback/support tickets
- [ ] Watch for 401 spikes in analytics

### Week 1
- [ ] Compare checkout metrics to baseline
- [ ] Review error patterns in monitoring tools
- [ ] Check page load performance
- [ ] Gather team feedback

### Metrics Dashboard (if available)
Track in your analytics tool:
- TDZ error count: Target = 0
- 401 error rate: Target = 0 (when authenticated)
- Checkout abandonment rate: Target ≤ Baseline
- Time to checkout completion: Target ≤ Baseline

---

## 📞 Support

### If Issues Arise

**Slack/Team Chat**:
- Post in #engineering or #support channels
- Include: Error message, browser, steps to reproduce

**GitHub Issue**:
- Create issue with label `bug` and `checkout`
- Link to this PR
- Include verification checklist results

**Emergency Contact**:
- Revert immediately if checkout is broken
- Investigate after reverting to restore service

---

## 📚 Additional Resources

- **Implementation Report**: `docs/TDZ_AND_401_FIX_IMPLEMENTATION_REPORT.md`
- **Code Changes**: `docs/TDZ_FIX_DIFF_SUMMARY.md`
- **Testing Guide**: `docs/TDZ_FIX_VERIFICATION_CHECKLIST.md`
- **PR Description**: `PR_DESCRIPTION.md`

---

## ✅ Deployment Checklist

### Pre-Deployment
- [x] Code changes completed
- [x] Linter clean
- [x] Dev build tested
- [x] Documentation complete
- [x] Branch pushed
- [ ] PR created
- [ ] PR reviewed
- [ ] PR merged

### Deployment
- [ ] Render deploy triggered
- [ ] Build logs reviewed
- [ ] Deploy completed successfully
- [ ] New build hash verified

### Post-Deployment
- [ ] Production console checked (no TDZ errors)
- [ ] Network tab checked (no 401s when logged in)
- [ ] Checkout flow tested end-to-end
- [ ] Error logs reviewed
- [ ] Metrics baseline established

### Finalization
- [ ] Stable tag created
- [ ] Team notified of deploy
- [ ] Documentation updated
- [ ] Monitoring dashboard configured

---

**Status**: Ready for PR Creation
**Next Action**: Navigate to GitHub and create PR using link above
**Estimated Time to Production**: ~15 minutes (after PR merge)

🎉 **You're almost there!** Just create the PR and monitor the deploy.


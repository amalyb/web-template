# Delta Inventory: Quick Reference Card

## Files at a Glance

```
Total Changed: 135 files
├── ✅ Already Deployed (64)
├── 🆕 Only in Test (45)
├── ⚠️ Diverged/Conflict Risk (23)
└── 🗑️ Deleted (3)
```

## Feature Categories

| Category | Files | Status | Priority |
|----------|-------|--------|----------|
| 📝 **Docs & Debug** | 31 | Only in test (mostly) | Low - Can deploy anytime |
| 🎨 **Client UI Core** | 22 | Mixed | Medium - Test thoroughly |
| ⚙️ **Config/Build** | 12 | Diverged | High - Resolve conflicts |
| 🛒 **Client Checkout** | 9 | Diverged | High - Critical path |
| 🔧 **Client Utils** | 9 | Mixed | Medium |
| 💰 **Client Pricing** | 6 | Mixed | Medium |
| 📅 **Client Calendar** | 4 | Mixed | Medium - Bug fixes |
| 🔄 **Server Transactions** | 7 | Diverged | **CRITICAL** |
| 🏗️ **Server Infra** | 6 | Diverged | **CRITICAL** |
| 🔌 **Server Utils** | 6 | Mixed | Medium |
| 📦 **Server Shippo/QR** | 5 | Only in test | Medium |
| 📱 **Server SMS/Twilio** | 4 | Only in test | Medium |
| 🤖 **Server Scripts** | 5 | Only in test | Low |

## Critical Diverged Files (Must Resolve)

```bash
# Server (Business Logic)
server/api/transition-privileged.js       # Transaction state machine
server/index.js                           # SSR and boot sequence

# Client (Payment Flow)
src/containers/CheckoutPage/CheckoutPageWithPayment.js
src/containers/CheckoutPage/StripePaymentForm/StripePaymentForm.js

# Build
package.json                              # Dependency conflicts
package-lock.json                         # Lockfile sync needed
public/index.html                         # Asset loading
```

## Quick Commands

### View Specific Diffs
```bash
# Checkout divergence
git diff main test -- src/containers/CheckoutPage/CheckoutPageWithPayment.js

# Transaction logic
git diff main test -- server/api/transition-privileged.js

# Server infra
git diff main test -- server/index.js
```

### Create Feature PR
```bash
# Example: Deploy docs only
git checkout -b release/docs-from-test
git cherry-pick <commit-hash-for-docs>
# Create PR to main
```

### Merge Strategy (Recommended)
```bash
# 1. Sync test with main first
git checkout test
git merge main
# Resolve conflicts
git commit

# 2. Then create targeted PRs from test
git checkout -b release/feature-name
# Cherry-pick or merge specific commits
# Create PR to main
```

## Environment Variables to Document

### Server (Must Configure)
```bash
# SMS/Twilio
SMS_ENABLED=false
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
SHIP_BY_SMS_ENABLED=false

# Shippo/QR
SHIPPO_ENABLED=false
SHIPPO_API_KEY=...
QR_ENABLED=false

# Redis (Optional)
REDIS_ENABLED=false
REDIS_URL=...

# Testing
DRY_RUN=true  # For scripts
```

### Client (Must Configure)
```bash
# Checkout
REACT_APP_CHECKOUT_ADDR_ENABLED=false

# Environment Detection
NODE_ENV=production
REACT_APP_ENV=production
```

## Testing Checklist

### Pre-Deploy
- [ ] `npm run build` - No errors
- [ ] `npm test` - All pass
- [ ] Linter clean
- [ ] No console errors in dev

### Critical Paths
- [ ] Create listing
- [ ] Search listings
- [ ] Book a listing (with address form)
- [ ] Stripe payment (test mode)
- [ ] Accept booking (provider side)
- [ ] Shippo label (if enabled)
- [ ] SMS notifications (if enabled)

### Regression
- [ ] Calendar displays correctly
- [ ] Pricing shows discounts
- [ ] SSR works (no blank page)
- [ ] CSP doesn't block resources
- [ ] Favicons load

## Deployment Order

```
1. Docs/Debug Files (no risk)
   └── SHIPPO_ENV_SETUP.md, SMS_*.md, etc.

2. Server Utils (low coupling)
   └── api-util/idempotency.js, metrics.js

3. Server Scripts (isolated)
   └── sendOverdueReminders.js, etc.

4. Resolve + Deploy Server Core
   └── transition-privileged.js (after conflict resolution)
   └── transaction-line-items.js

5. Resolve + Deploy Client Checkout
   └── CheckoutPageWithPayment.js (after conflict resolution)
   └── Test with Stripe

6. Deploy Server Infra (coordinated)
   └── server/index.js (SSR changes)
   └── Verify no blank pages

7. Cleanup
   └── Remove .zip files
   └── Remove test-*.js files
   └── Update test branch
```

## Risk Matrix

| Component | Risk | Impact | Mitigation |
|-----------|------|--------|------------|
| `transition-privileged.js` | 🔴 High | Lost bookings | Extensive testing, feature flags |
| `CheckoutPageWithPayment.js` | 🔴 High | Payment failures | Stripe test mode, E2E tests |
| `server/index.js` | 🟠 Medium | Blank pages | SSR testing, bundle verification |
| `package.json` | 🟠 Medium | Build failures | Clean install, lock regeneration |
| Server scripts | 🟢 Low | Isolated | DRY_RUN mode testing |
| Docs | 🟢 Low | None | Deploy anytime |

## Contact & Resources

- **Full JSON Report:** `reports/delta_inventory_20251008_1036.json`
- **Detailed MD Report:** `reports/delta_inventory_20251008_1036.md`
- **Executive Summary:** `reports/EXECUTIVE_SUMMARY.md`
- **Patches:** `reports/patches/*.patch`

---
*Quick Reference | Generated 2025-10-08 10:36*

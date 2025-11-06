# Dry-Run Test Artifacts

**Date:** Thu Nov  6 14:04:01 PST 2025
**Branch:** feat/overdue-prod-parity
**Transaction ID:** 690d06cf-24c8-45af-8ad7-aec8e7d51b62

---

## Test Matrix

```
[ENV] {
  SHORTLINK_BASE: 'https://www.sherbrt.com/r',
  UPS_LINK_MODE: [ 'qr', 'label' ],
  USPS_LINK_MODE: [ 'label' ],
  ALLOW_TRACKING_IN_LENDER_SHIP: false
}
[redis] REDIS_URL not set — using in-memory fallback (dev only)

🔍 Overdue Flow Diagnostic Tool


══════════════════════════════════════════════════════════════════════
🔬 MATRIX MODE: 5-DAY OVERDUE SIMULATION
══════════════════════════════════════════════════════════════════════
Transaction: 690d06cf-24c8-45af-8ad7-aec8e7d51b62
Testing escalation sequence: Day 1 → Day 5


❌ Diagnostic failed: Request failed with status code 403
```

---

## Test Force-Now

```
[ENV] {
  SHORTLINK_BASE: 'https://www.sherbrt.com/r',
  UPS_LINK_MODE: [ 'qr', 'label' ],
  USPS_LINK_MODE: [ 'label' ],
  ALLOW_TRACKING_IN_LENDER_SHIP: false
}
[redis] REDIS_URL not set — using in-memory fallback (dev only)

🔍 Overdue Flow Diagnostic Tool


══════════════════════════════════════════════════════════════════════
📋 TRANSACTION DIAGNOSTIC: 690d06cf-24c8-45af-8ad7-aec8e7d51b62
══════════════════════════════════════════════════════════════════════
⏰ Simulation time: 2025-11-11T12:00:00.000Z (2025-11-11)
🔍 Mode: LIVE (will charge!)

[FlexSDK] Using Integration SDK with clientId=ac5a1b…3671 baseUrl=https://flex-api.sharetribe.com
📡 Fetching transaction data...
❌ Diagnostic failed: Request failed with status code 403
AxiosError: Request failed with status code 403
    at settle (/Users/amaliabornstein/shop-on-sherbet-cursor/node_modules/axios/dist/node/axios.cjs:2090:12)
    at IncomingMessage.handleStreamEnd (/Users/amaliabornstein/shop-on-sherbet-cursor/node_modules/axios/dist/node/axios.cjs:3207:11)
    at IncomingMessage.emit (node:events:536:35)
    at endReadableNT (node:internal/streams/readable:1698:12)
    at process.processTicksAndRejections (node:internal/process/task_queues:82:21)
    at Axios.request (/Users/amaliabornstein/shop-on-sherbet-cursor/node_modules/axios/dist/node/axios.cjs:4317:41)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async diagnoseTransaction (/Users/amaliabornstein/shop-on-sherbet-cursor/scripts/diagnose-overdue.js:108:22)
    at async main (/Users/amaliabornstein/shop-on-sherbet-cursor/scripts/diagnose-overdue.js:382:7)

❌ Diagnostic failed: Request failed with status code 403
```

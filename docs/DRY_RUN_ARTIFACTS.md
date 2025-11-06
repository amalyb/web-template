## Test Matrix

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


## Test Force-Now

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
🔍 Mode: DRY_RUN (safe)

[FlexSDK] Using Integration SDK with clientId=ac5a1b…3671 baseUrl=https://api.sharetribe.com
📡 Fetching transaction data...
❌ Diagnostic failed: Unknown token type: undefined
Error: Unknown token type: undefined
    at constructAuthHeader (/Users/amaliabornstein/shop-on-sherbet-cursor/node_modules/sharetribe-flex-sdk/build/sharetribe-flex-sdk-node.js:10638:13)
    at enter (/Users/amaliabornstein/shop-on-sherbet-cursor/node_modules/sharetribe-flex-sdk/build/sharetribe-flex-sdk-node.js:10671:24)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)

❌ Diagnostic failed: Unknown token type: undefined

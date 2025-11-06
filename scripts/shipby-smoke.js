#!/usr/bin/env node
/**
 * Ship-by smoke test script
 * Tests the ship-by computation logic with various scenarios
 * 
 * Usage:
 *   DEBUG_SHIPBY=1 node scripts/shipby-smoke.js --borrow-start 2025-11-07 --origin 94107 --dest 94105
 *   DEBUG_SHIPBY=1 SHIP_LEAD_DAYS=2 node scripts/shipby-smoke.js --borrow-start 2025-11-07 --origin 94107 --dest 10012
 */

const { computeShipBy, formatShipBy } = require('../server/lib/shipping');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    borrowStart: null,
    originZip: null,
    destZip: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--borrow-start' && args[i + 1]) {
      parsed.borrowStart = args[i + 1];
      i++;
    } else if (args[i] === '--origin' && args[i + 1]) {
      parsed.originZip = args[i + 1];
      i++;
    } else if (args[i] === '--dest' && args[i + 1]) {
      parsed.destZip = args[i + 1];
      i++;
    }
  }

  return parsed;
}

// Build a minimal transaction object for testing
function buildMockTx({ borrowStart, originZip, destZip }) {
  return {
    attributes: {
      booking: {
        attributes: {
          start: borrowStart,
        },
      },
      protectedData: {
        providerZip: originZip,
        customerZip: destZip,
      },
    },
  };
}

async function runSmoke() {
  const args = parseArgs();

  if (!args.borrowStart || !args.originZip || !args.destZip) {
    console.error('Usage: node scripts/shipby-smoke.js --borrow-start YYYY-MM-DD --origin ZIP --dest ZIP');
    console.error('Example: DEBUG_SHIPBY=1 node scripts/shipby-smoke.js --borrow-start 2025-11-07 --origin 94107 --dest 94105');
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Ship-by Smoke Test');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Environment:');
  console.log('  SHIP_LEAD_MODE    :', process.env.SHIP_LEAD_MODE || '(not set → defaults to "static")');
  console.log('  SHIP_LEAD_DAYS    :', process.env.SHIP_LEAD_DAYS !== undefined ? process.env.SHIP_LEAD_DAYS : '(not set → defaults to 2)');
  console.log('  SHIP_LEAD_MAX     :', process.env.SHIP_LEAD_MAX || '(not set → defaults to 5)');
  console.log('  DEBUG_SHIPBY      :', process.env.DEBUG_SHIPBY || '(not set)');
  console.log('\nTest Case:');
  console.log('  Borrow Start      :', args.borrowStart);
  console.log('  Origin ZIP        :', args.originZip);
  console.log('  Destination ZIP   :', args.destZip);
  console.log('═══════════════════════════════════════════════════════════\n');

  const tx = buildMockTx({
    borrowStart: args.borrowStart,
    originZip: args.originZip,
    destZip: args.destZip,
  });

  try {
    const result = await computeShipBy(tx, { preferLabelAddresses: false });
    const { shipByDate, leadDays, miles, mode } = result;

    console.log('Result:');
    console.log('  Mode              :', mode);
    console.log('  Lead Days         :', leadDays);
    console.log('  Distance (mi)     :', miles !== null ? Math.round(miles) : '(not computed)');
    console.log('  Ship-by Date      :', shipByDate ? shipByDate.toISOString() : '(null)');
    console.log('  Ship-by Formatted :', formatShipBy(shipByDate) || '(null)');
    console.log('\n═══════════════════════════════════════════════════════════\n');

    // Exit with 0 if successful
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runSmoke().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runSmoke };


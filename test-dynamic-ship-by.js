// test-dynamic-ship-by.js
// Quick validation test for dynamic ship-by feature

const { haversineMiles, geocodeZip } = require('./server/lib/geo');
const { computeShipByDate, resolveZipsFromTx, computeLeadDaysDynamic } = require('./server/lib/shipping');

// Test fixtures
const mockTxStatic = {
  attributes: {
    booking: {
      attributes: {
        start: '2025-01-20T00:00:00.000Z'
      }
    },
    protectedData: {
      providerZip: '94123',
      customerZip: '94114'
    }
  }
};

const mockTxDistanceSF_NYC = {
  attributes: {
    booking: {
      attributes: {
        start: '2025-01-20T00:00:00.000Z'
      }
    },
    protectedData: {
      providerZip: '94123',  // San Francisco
      customerZip: '10001'   // New York
    }
  }
};

const mockTxMissingZips = {
  attributes: {
    booking: {
      attributes: {
        start: '2025-01-20T00:00:00.000Z'
      }
    },
    protectedData: {}
  }
};

async function runTests() {
  console.log('🧪 Testing Dynamic Ship-By Lead Time\n');
  
  // Test 1: Haversine calculation
  console.log('Test 1: Haversine distance calculation');
  const sf = [37.7749, -122.4194];  // San Francisco
  const nyc = [40.7128, -74.0060];  // New York
  const distance = haversineMiles(sf, nyc);
  console.log(`  SF → NYC: ${Math.round(distance)} miles`);
  console.log(`  Expected: ~2570 miles`);
  console.log(`  ✅ ${distance > 2500 && distance < 2600 ? 'PASS' : 'FAIL'}\n`);
  
  // Test 2: Static mode
  console.log('Test 2: Static mode');
  process.env.SHIP_LEAD_MODE = 'static';
  process.env.SHIP_LEAD_DAYS = '2';
  const staticDate = await computeShipByDate(mockTxStatic);
  console.log(`  Booking start: ${mockTxStatic.attributes.booking.attributes.start}`);
  console.log(`  Ship-by date: ${staticDate ? staticDate.toISOString() : 'null'}`);
  console.log(`  Expected: 2025-01-18 (2 days before Jan 20)`);
  const expectedStatic = new Date('2025-01-18T00:00:00.000Z');
  console.log(`  ✅ ${staticDate?.toISOString().split('T')[0] === '2025-01-18' ? 'PASS' : 'FAIL'}\n`);
  
  // Test 3: Distance mode (requires MAPBOX_TOKEN)
  if (process.env.MAPBOX_TOKEN) {
    console.log('Test 3: Distance mode (SF → NYC)');
    process.env.SHIP_LEAD_MODE = 'distance';
    process.env.SHIP_LEAD_DAYS = '2';
    process.env.SHIP_LEAD_MAX = '5';
    
    const distanceDate = await computeShipByDate(mockTxDistanceSF_NYC);
    console.log(`  Booking start: ${mockTxDistanceSF_NYC.attributes.booking.attributes.start}`);
    console.log(`  Ship-by date: ${distanceDate ? distanceDate.toISOString() : 'null'}`);
    console.log(`  Expected: 2025-01-17 (3 days before Jan 20, >1000 miles)`);
    console.log(`  ✅ ${distanceDate?.toISOString().split('T')[0] === '2025-01-17' ? 'PASS' : 'FAIL'}\n`);
  } else {
    console.log('Test 3: Skipped (MAPBOX_TOKEN not set)');
    console.log(`  Set MAPBOX_TOKEN env var to test distance mode\n`);
  }
  
  // Test 4: Missing ZIPs fallback
  console.log('Test 4: Missing ZIPs fallback');
  process.env.SHIP_LEAD_MODE = 'distance';
  process.env.SHIP_LEAD_DAYS = '2';
  const fallbackDate = await computeShipByDate(mockTxMissingZips);
  console.log(`  Booking start: ${mockTxMissingZips.attributes.booking.attributes.start}`);
  console.log(`  Ship-by date: ${fallbackDate ? fallbackDate.toISOString() : 'null'}`);
  console.log(`  Expected: 2025-01-18 (falls back to 2 days)`);
  console.log(`  ✅ ${fallbackDate?.toISOString().split('T')[0] === '2025-01-18' ? 'PASS' : 'FAIL'}\n`);
  
  // Test 5: ZIP resolution
  console.log('Test 5: ZIP resolution');
  const { fromZip, toZip } = await resolveZipsFromTx(mockTxStatic, { preferLabelAddresses: true });
  console.log(`  From ZIP: ${fromZip}`);
  console.log(`  To ZIP: ${toZip}`);
  console.log(`  Expected: 94123 → 94114`);
  console.log(`  ✅ ${fromZip === '94123' && toZip === '94114' ? 'PASS' : 'FAIL'}\n`);
  
  // Test 6: Lead days calculation (mock)
  if (process.env.MAPBOX_TOKEN) {
    console.log('Test 6: Lead days calculation');
    const leadShort = await computeLeadDaysDynamic({ fromZip: '94123', toZip: '94114' });
    console.log(`  SF → SF (short): ${leadShort} days`);
    console.log(`  Expected: 1-2 days (≤200 miles)`);
    
    const leadLong = await computeLeadDaysDynamic({ fromZip: '94123', toZip: '10001' });
    console.log(`  SF → NYC (long): ${leadLong} days`);
    console.log(`  Expected: 3 days (>1000 miles)`);
    console.log(`  ✅ ${leadShort >= 1 && leadShort <= 2 && leadLong === 3 ? 'PASS' : 'FAIL'}\n`);
  } else {
    console.log('Test 6: Skipped (MAPBOX_TOKEN not set)\n');
  }
  
  console.log('✅ All tests complete!\n');
  console.log('Environment check:');
  console.log(`  SHIP_LEAD_MODE: ${process.env.SHIP_LEAD_MODE || 'static (default)'}`);
  console.log(`  SHIP_LEAD_DAYS: ${process.env.SHIP_LEAD_DAYS || '2 (default)'}`);
  console.log(`  SHIP_LEAD_MAX: ${process.env.SHIP_LEAD_MAX || '5 (default)'}`);
  console.log(`  MAPBOX_TOKEN: ${process.env.MAPBOX_TOKEN ? '✅ Set' : '❌ Not set'}`);
}

// Run tests
runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});


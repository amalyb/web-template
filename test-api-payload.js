#!/usr/bin/env node

/**
 * Test script to simulate the exact API payload creation
 * This helps identify what's causing the validation-invalid-value error
 */

const testApiPayload = () => {
  console.log('=== Testing API Payload Creation ===\n');
  
  // Simulate the exact flow from the EditListingAvailabilityPanel
  const simulatePayloadCreation = (range, timeZone = 'America/New_York') => {
    console.log(`Testing range: ${range.join(', ')}`);
    console.log(`Timezone: ${timeZone}\n`);
    
    // Step 1: Create the range (this is what groupDatesToRanges returns)
    const start = new Date(range[0]);
    const endInclusive = new Date(range[range.length - 1]);
    const endExclusive = new Date(endInclusive);
    endExclusive.setDate(endExclusive.getDate() + 1); // Make exclusive for API
    
    console.log('Step 1: Range processing');
    console.log('  Start date (inclusive):', start.toISOString());
    console.log('  End date (inclusive):', endInclusive.toISOString());
    console.log('  End date (exclusive for API):', endExclusive.toISOString());
    
    // Step 2: Timezone conversion (simplified version)
    // In the real code, this uses getStartOf and zonedTimeToUtc
    const startDateInListingTZ = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDateInListingTZ = new Date(endExclusive.getFullYear(), endExclusive.getMonth(), endExclusive.getDate());
    
    // Convert to UTC (simplified)
    const startDateUtc = new Date(startDateInListingTZ.toISOString());
    const endDateUtc = new Date(endDateInListingTZ.toISOString());
    
    console.log('\nStep 2: Timezone conversion');
    console.log('  Start date in listing TZ:', startDateInListingTZ.toISOString());
    console.log('  End date in listing TZ:', endDateInListingTZ.toISOString());
    console.log('  Start date (UTC):', startDateUtc.toISOString());
    console.log('  End date (UTC):', endDateUtc.toISOString());
    
    // Step 3: Create the payload
    const payload = {
      listingId: 'test-listing-id',
      seats: 0,
      start: startDateUtc.toISOString(),
      end: endDateUtc.toISOString(),
    };
    
    console.log('\nStep 3: Final payload');
    console.log('Payload:', JSON.stringify(payload, null, 2));
    
    // Step 4: Validate the payload
    console.log('\nStep 4: Payload validation');
    console.log('  listingId type:', typeof payload.listingId);
    console.log('  listingId value:', payload.listingId);
    console.log('  seats type:', typeof payload.seats);
    console.log('  seats value:', payload.seats);
    console.log('  start type:', typeof payload.start);
    console.log('  start value:', payload.start);
    console.log('  end type:', typeof payload.end);
    console.log('  end value:', payload.end);
    
    // Test date parsing
    try {
      const testStart = new Date(payload.start);
      const testEnd = new Date(payload.end);
      console.log('  Parsed start:', testStart.toISOString());
      console.log('  Parsed end:', testEnd.toISOString());
      console.log('  Date range valid:', testStart < testEnd);
      
      // Test if the range includes the expected dates
      const july9 = new Date('2024-07-09T00:00:00Z');
      const july10 = new Date('2024-07-10T00:00:00Z');
      const july9InRange = testStart <= july9 && july9 < testEnd;
      const july10InRange = testStart <= july10 && july10 < testEnd;
      
      console.log('  July 9 in range:', july9InRange);
      console.log('  July 10 in range:', july10InRange);
      
      return {
        payload,
        valid: testStart < testEnd,
        july9InRange,
        july10InRange
      };
    } catch (e) {
      console.error('  Date parsing error:', e);
      return { payload, valid: false, error: e.message };
    }
  };
  
  // Test 1: July 2-9 range
  console.log('Test 1: July 2-9 range');
  const july2to9Range = [
    '2024-07-02',
    '2024-07-03', 
    '2024-07-04',
    '2024-07-05',
    '2024-07-06',
    '2024-07-07',
    '2024-07-08',
    '2024-07-09'
  ];
  
  const result1 = simulatePayloadCreation(july2to9Range);
  console.log('\nResult 1:', result1.valid ? '✅ PASS' : '❌ FAIL');
  
  // Test 2: Single day
  console.log('\n\nTest 2: Single day (July 5)');
  const singleDayRange = ['2024-07-05'];
  const result2 = simulatePayloadCreation(singleDayRange);
  console.log('\nResult 2:', result2.valid ? '✅ PASS' : '❌ FAIL');
  
  // Test 3: Different timezone
  console.log('\n\nTest 3: Different timezone (UTC)');
  const result3 = simulatePayloadCreation(july2to9Range, 'UTC');
  console.log('\nResult 3:', result3.valid ? '✅ PASS' : '❌ FAIL');
  
  // Test 4: Check for potential API issues
  console.log('\n\nTest 4: API Payload Analysis');
  console.log('Potential issues that could cause validation-invalid-value:');
  console.log('1. Date format not ISO 8601 compliant');
  console.log('2. End date before start date');
  console.log('3. Invalid listingId format');
  console.log('4. Seats not a number');
  console.log('5. Missing required fields');
  
  // Test the exact payload structure expected by Sharetribe Flex API
  console.log('\nExpected Sharetribe Flex API format:');
  const expectedFormat = {
    listingId: 'UUID string',
    seats: 'number (0 for unavailable)',
    start: 'ISO 8601 date string (inclusive)',
    end: 'ISO 8601 date string (exclusive)'
  };
  console.log(JSON.stringify(expectedFormat, null, 2));
  
  console.log('\n=== Test Complete ===');
};

// Run the test
testApiPayload(); 
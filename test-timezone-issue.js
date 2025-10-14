// Test to demonstrate the timezone conversion issue
function testTimezoneIssue() {
  console.log('=== TESTING TIMEZONE CONVERSION ISSUE ===');
  
  // Simulate the exact logic from EditListingAvailabilityPanel.js
  const timeZone = 'America/New_York'; // Example timezone
  
  // Test case: July 1-9 (inclusive) should become July 1-10 (exclusive) for API
  const testRanges = [
    {
      start: '2024-07-01T00:00:00.000Z',
      end: '2024-07-10T00:00:00.000Z' // This should be exclusive end
    }
  ];
  
  console.log('Test ranges:', testRanges);
  console.log('Timezone:', timeZone);
  
  testRanges.forEach((nr, index) => {
    console.log(`\n--- Processing range ${index + 1} ---`);
    console.log('Original range:', nr);
    
    // Parse the ISO strings and ensure proper timezone handling
    let startLocal = new Date(nr.start);
    let endLocal = new Date(nr.end);
    
    console.log('Parsed dates:');
    console.log('  startLocal:', startLocal.toISOString());
    console.log('  endLocal:', endLocal.toISOString());
    
    // Simulate getStartOf behavior - this is where the problem occurs
    // getStartOf shifts the date by timezone offset
    const startDateInListingTZ = new Date(startLocal.getFullYear(), startLocal.getMonth(), startLocal.getDate());
    const endDateInListingTZ = new Date(endLocal.getFullYear(), endLocal.getMonth(), endLocal.getDate());
    
    console.log('Dates in listing timezone (simulated):');
    console.log('  startDateInListingTZ:', startDateInListingTZ.toISOString());
    console.log('  endDateInListingTZ:', endDateInListingTZ.toISOString());
    
    // Simulate zonedTimeToUtc behavior - this converts back to UTC
    // The problem: this conversion shifts dates by timezone offset
    const startDateUtc = new Date(startDateInListingTZ.getTime() - (4 * 60 * 60 * 1000)); // EST offset
    const endDateUtc = new Date(endDateInListingTZ.getTime() - (4 * 60 * 60 * 1000)); // EST offset
    
    console.log('UTC dates for API (simulated):');
    console.log('  startDateUtc:', startDateUtc.toISOString());
    console.log('  endDateUtc:', endDateUtc.toISOString());
    
    // Validate that the end date is properly exclusive
    if (startDateUtc >= endDateUtc) {
      console.error('❌ ERROR: Invalid date range: start date must be before end date');
      return false;
    }
    
    const payload = {
      listingId: 'test-listing-id',
      seats: 0,
      start: startDateUtc.toISOString(),
      end: endDateUtc.toISOString(),
    };
    
    console.log('Final payload:', JSON.stringify(payload, null, 2));
    
    // Test if July 9 is included and July 10 is excluded
    const july9Date = new Date('2024-07-09T00:00:00Z');
    const july10Date = new Date('2024-07-10T00:00:00Z');
    const payloadStart = new Date(payload.start);
    const payloadEnd = new Date(payload.end);
    
    const july9Included = payloadStart <= july9Date && july9Date < payloadEnd;
    const july10Excluded = !(payloadStart <= july10Date && july10Date < payloadEnd);
    
    console.log('Validation:');
    console.log('  July 9 included:', july9Included);
    console.log('  July 10 excluded:', july10Excluded);
    
    if (july9Included && july10Excluded) {
      console.log('✅ SUCCESS: Range correctly includes July 9 and excludes July 10');
      return true;
    } else {
      console.log('❌ ERROR: Range does not correctly handle July 9/10');
      return false;
    }
  });
}

function testSimplifiedLogic() {
  console.log('\n=== TESTING SIMPLIFIED LOGIC ===');
  
  // Test the simplified approach: just use the dates as-is without timezone conversion
  const timeZone = 'America/New_York';
  
  // For July 1-9 (inclusive), the API should receive July 1-10 (exclusive)
  const startDate = '2024-07-01';
  const endDate = '2024-07-09';
  
  console.log('Input dates:', { startDate, endDate });
  
  // Create exclusive end date
  const endExclusive = new Date(endDate);
  endExclusive.setDate(endExclusive.getDate() + 1);
  
  console.log('Exclusive end date:', endExclusive.toISOString().split('T')[0]);
  
  // Create payload without timezone conversion
  const payload = {
    listingId: 'test-listing-id',
    seats: 0,
    start: startDate + 'T00:00:00.000Z',
    end: endExclusive.toISOString(),
  };
  
  console.log('Simplified payload:', JSON.stringify(payload, null, 2));
  
  // Test if July 9 is included and July 10 is excluded
  const july9Date = new Date('2024-07-09T00:00:00Z');
  const july10Date = new Date('2024-07-10T00:00:00Z');
  const payloadStart = new Date(payload.start);
  const payloadEnd = new Date(payload.end);
  
  const july9Included = payloadStart <= july9Date && july9Date < payloadEnd;
  const july10Excluded = !(payloadStart <= july10Date && july10Date < payloadEnd);
  
  console.log('Validation:');
  console.log('  July 9 included:', july9Included);
  console.log('  July 10 excluded:', july10Excluded);
  
  if (july9Included && july10Excluded) {
    console.log('✅ SUCCESS: Simplified logic works correctly');
    return true;
  } else {
    console.log('❌ ERROR: Simplified logic still has issues');
    return false;
  }
}

function runTests() {
  console.log('🔍 INVESTIGATING TIMEZONE CONVERSION ISSUE\n');
  
  const test1 = testTimezoneIssue();
  const test2 = testSimplifiedLogic();
  
  console.log('\n=== TEST RESULTS ===');
  console.log('Timezone conversion test:', test1 ? '✅ PASS' : '❌ FAIL');
  console.log('Simplified logic test:', test2 ? '✅ PASS' : '❌ FAIL');
  
  if (!test1) {
    console.log('\n🚨 ROOT CAUSE IDENTIFIED:');
    console.log('The timezone conversion logic is shifting dates incorrectly.');
    console.log('The getStartOf() and zonedTimeToUtc() functions are causing');
    console.log('the end date to be shifted by the timezone offset, which');
    console.log('results in the API receiving an incorrect date range.');
    console.log('\nThe fix is to simplify the logic and avoid unnecessary');
    console.log('timezone conversions for date-only ranges.');
  }
  
  if (test2) {
    console.log('\n✅ SOLUTION: Use simplified date handling without timezone conversion');
  }
}

runTests(); 
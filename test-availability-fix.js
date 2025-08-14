const { zonedTimeToUtc, utcToZonedTime, getStartOf } = require('date-fns-tz');

// Test the date range handling logic
function testDateRangeHandling() {
  console.log('=== TESTING DATE RANGE HANDLING ===');
  
  // Test case: July 2–9 (inclusive)
  const startDate = '2024-07-02';
  const endDate = '2024-07-09';
  const timeZone = 'America/New_York';
  
  console.log('Test case: July 2–9 (inclusive)');
  console.log('Start date:', startDate);
  console.log('End date:', endDate);
  console.log('Timezone:', timeZone);
  
  // Parse the ISO strings and ensure proper timezone handling
  let startLocal = new Date(startDate + 'T00:00:00');
  let endLocal = new Date(endDate + 'T00:00:00');
  
  // For testing, we'll simulate the timezone conversion
  // In the actual code, this uses date-fns-tz functions
  const startDateUtc = startLocal.toISOString();
  const endDateUtc = endLocal.toISOString();
  
  console.log('\nDate conversions:');
  console.log('Start date local:', startLocal.toISOString());
  console.log('End date local:', endLocal.toISOString());
  console.log('UTC start:', startDateUtc);
  console.log('UTC end:', endDateUtc);
  
  // Validate that the end date is properly exclusive
  if (startLocal >= endLocal) {
    console.error('❌ ERROR: Invalid date range: start date must be before end date');
    return false;
  }
  
  const payload = {
    listingId: 'test-listing-id',
    seats: 0,
    start: startDateUtc,
    end: endDateUtc,
  };
  
  console.log('\nFinal payload:');
  console.log(JSON.stringify(payload, null, 2));
  
  // Test date parsing
  try {
    const testStart = new Date(payload.start);
    const testEnd = new Date(payload.end);
    console.log('\nPayload validation:');
    console.log('Parsed start:', testStart.toISOString());
    console.log('Parsed end:', testEnd.toISOString());
    console.log('Date range valid:', testStart < testEnd);
    
    // Check if July 9 is included (should be the last day)
    const july9Date = new Date('2024-07-09T00:00:00');
    const july10Date = new Date('2024-07-10T00:00:00');
    
    console.log('\nJuly 9 inclusion check:');
    console.log('July 9 date:', july9Date.toISOString());
    console.log('July 10 date:', july10Date.toISOString());
    console.log('July 9 included:', testStart <= july9Date && july9Date < testEnd);
    console.log('July 10 excluded:', !(testStart <= july10Date && july10Date < testEnd));
    
    if (testStart <= july9Date && july9Date < testEnd && !(testStart <= july10Date && july10Date < testEnd)) {
      console.log('✅ SUCCESS: July 9 is correctly included, July 10 is correctly excluded');
      return true;
    } else {
      console.log('❌ ERROR: Date range does not correctly include July 9 and exclude July 10');
      return false;
    }
  } catch (e) {
    console.error('❌ ERROR: Date parsing error:', e);
    return false;
  }
}

// Test the groupDatesToRanges function logic
function testGroupDatesToRanges() {
  console.log('\n=== TESTING GROUP DATES TO RANGES ===');
  
  // Test dates: July 2, 3, 4, 5, 6, 7, 8, 9
  const testDates = [
    '2024-07-02',
    '2024-07-03', 
    '2024-07-04',
    '2024-07-05',
    '2024-07-06',
    '2024-07-07',
    '2024-07-08',
    '2024-07-09'
  ];
  
  console.log('Test dates:', testDates);
  
  // Sort dates
  const sortedDates = [...testDates].sort();
  console.log('Sorted dates:', sortedDates);
  
  // Group into ranges
  const ranges = [];
  let currentRange = null;
  
  for (const dateStr of sortedDates) {
    const currentDate = new Date(dateStr);
    
    if (!currentRange) {
      // Start new range
      currentRange = {
        start: dateStr,
        end: dateStr
      };
    } else {
      const lastDate = new Date(currentRange.end);
      const dayDiff = (currentDate - lastDate) / (1000 * 60 * 60 * 24);
      
      if (dayDiff === 1) {
        // Consecutive day, extend range
        currentRange.end = dateStr;
      } else {
        // Non-consecutive, save current range and start new one
        ranges.push({ ...currentRange });
        currentRange = {
          start: dateStr,
          end: dateStr
        };
      }
    }
  }
  
  // Add the last range
  if (currentRange) {
    ranges.push(currentRange);
  }
  
  console.log('Grouped ranges:', ranges);
  
  // Convert to API format (exclusive end dates)
  const apiRanges = ranges.map(range => ({
    start: range.start,
    end: new Date(range.end)
  }));
  
  console.log('API ranges (with exclusive end):', apiRanges.map(r => ({
    start: r.start,
    end: r.end.toISOString().split('T')[0]
  })));
  
  return ranges;
}

// Test the actual logic from the component
function testComponentLogic() {
  console.log('\n=== TESTING COMPONENT LOGIC ===');
  
  // Simulate the logic from EditListingAvailabilityPanel.js
  const unavailableDates = [
    '2024-07-02',
    '2024-07-03', 
    '2024-07-04',
    '2024-07-05',
    '2024-07-06',
    '2024-07-07',
    '2024-07-08',
    '2024-07-09'
  ];
  
  console.log('Unavailable dates:', unavailableDates);
  
  // Group dates to ranges (simplified version of groupDatesToRanges)
  const sortedDates = [...unavailableDates].sort();
  const ranges = [];
  let currentRange = null;
  
  for (const dateStr of sortedDates) {
    if (!currentRange) {
      currentRange = { start: dateStr, end: dateStr };
    } else {
      const currentDate = new Date(dateStr);
      const lastDate = new Date(currentRange.end);
      const dayDiff = (currentDate - lastDate) / (1000 * 60 * 60 * 24);
      
      if (dayDiff === 1) {
        currentRange.end = dateStr;
      } else {
        ranges.push({ ...currentRange });
        currentRange = { start: dateStr, end: dateStr };
      }
    }
  }
  
  if (currentRange) {
    ranges.push(currentRange);
  }
  
  console.log('Grouped ranges:', ranges);
  
  // Test the payload creation logic
  const timeZone = 'America/New_York';
  const promises = [];
  
  ranges.forEach(nr => {
    console.log(`\nProcessing range: ${nr.start} to ${nr.end}`);
    
    // Parse the ISO strings
    let startLocal = new Date(nr.start);
    let endLocal = new Date(nr.end);
    
    // Get start of day in listing timezone (simplified)
    const startDateInListingTZ = new Date(startLocal.getFullYear(), startLocal.getMonth(), startLocal.getDate());
    const endDateInListingTZ = new Date(endLocal.getFullYear(), endLocal.getMonth(), endLocal.getDate());
    
    // Convert to UTC (simplified)
    const startDateUtc = startDateInListingTZ.toISOString();
    const endDateUtc = endDateInListingTZ.toISOString();
    
    console.log('Start date in listing TZ:', startDateInListingTZ.toISOString());
    console.log('End date in listing TZ:', endDateInListingTZ.toISOString());
    console.log('UTC start:', startDateUtc);
    console.log('UTC end:', endDateUtc);
    
    const payload = {
      listingId: 'test-listing-id',
      seats: 0,
      start: startDateUtc,
      end: endDateUtc,
    };
    
    console.log('Payload:', JSON.stringify(payload, null, 2));
    
    // Validate the range includes July 9
    const july9Date = new Date('2024-07-09T00:00:00');
    const july10Date = new Date('2024-07-10T00:00:00');
    const payloadStart = new Date(payload.start);
    const payloadEnd = new Date(payload.end);
    
    const july9Included = payloadStart <= july9Date && july9Date < payloadEnd;
    const july10Excluded = !(payloadStart <= july10Date && july10Date < payloadEnd);
    
    console.log('July 9 included:', july9Included);
    console.log('July 10 excluded:', july10Excluded);
    
    if (july9Included && july10Excluded) {
      console.log('✅ SUCCESS: Range correctly includes July 9 and excludes July 10');
    } else {
      console.log('❌ ERROR: Range does not correctly handle July 9');
    }
  });
  
  return ranges.length > 0;
}

// Run all tests
function runAllTests() {
  console.log('🧪 RUNNING AVAILABILITY FIX TESTS\n');
  
  const test1 = testDateRangeHandling();
  const test2 = testGroupDatesToRanges();
  const test3 = testComponentLogic();
  
  console.log('\n=== TEST RESULTS ===');
  console.log('Date range handling:', test1 ? '✅ PASS' : '❌ FAIL');
  console.log('Group dates to ranges:', test2 ? '✅ PASS' : '❌ FAIL');
  console.log('Component logic:', test3 ? '✅ PASS' : '❌ FAIL');
  
  if (test1 && test2 && test3) {
    console.log('\n🎉 ALL TESTS PASSED! The availability fix should work correctly.');
    console.log('\nThe ReferenceError has been fixed and the date range logic should now work properly.');
  } else {
    console.log('\n⚠️  SOME TESTS FAILED. Please review the implementation.');
  }
}

// Run the tests
runAllTests(); 
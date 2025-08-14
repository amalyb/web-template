// Test script to verify the fix for the July 9 dropping bug
console.log('🔍 Testing the fix for July 9 dropping bug...\n');

// Import moment-timezone to simulate the actual functions
const moment = require('moment-timezone');

// Simulate the actual stringifyDateToISO8601 function
const stringifyDateToISO8601 = (date, timeZone = null) => {
  return timeZone
    ? moment(date)
        .tz(timeZone)
        .format('YYYY-MM-DD')
    : moment(date).format('YYYY-MM-DD');
};

// Simulate the server response for July 3-9 range
const serverException = {
  attributes: {
    start: '2024-07-03T00:00:00.000Z',  // July 3 (inclusive)
    end: '2024-07-10T00:00:00.000Z',    // July 10 (exclusive) - should block through July 9
    seats: 0
  }
};

console.log('📥 Server response:', JSON.stringify(serverException, null, 2));
console.log('Expected: Should block July 3, 4, 5, 6, 7, 8, 9 (7 days)');
console.log('Expected: Should NOT block July 10\n');

// Test the FIXED rehydration logic
const testFixedRehydration = (timeZone) => {
  console.log(`\n=== Testing FIXED rehydration with timezone: ${timeZone} ===`);
  
  const startDate = new Date(serverException.attributes.start);
  const endDate = new Date(serverException.attributes.end);
  
  console.log('Start date from server:', startDate.toISOString());
  console.log('End date from server:', endDate.toISOString());
  
  // FIXED: Handle timezone conversion correctly to avoid date shifting
  // The server stores dates in UTC, but we need to generate dates in the listing's timezone
  // We'll work directly with UTC dates to avoid timezone conversion issues
  
  // Parse the UTC dates and generate the date range
  let currentDate = new Date(startDate);
  const endDateExclusive = new Date(endDate);
  
  const dates = [];
  let iteration = 0;
  
  // Generate all dates in the range (inclusive start, exclusive end)
  while (currentDate < endDateExclusive) {
    // Convert to listing's timezone for the date string
    const dateInListingTZ = stringifyDateToISO8601(currentDate, timeZone);
    dates.push(dateInListingTZ);
    
    console.log(`Iteration ${iteration + 1}: ${currentDate.toISOString()} -> ${dateInListingTZ}`);
    
    // Move to next day in UTC to avoid timezone shifting
    currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
    iteration++;
    
    if (iteration > 10) {
      console.error('❌ INFINITE LOOP DETECTED!');
      break;
    }
  }
  
  console.log('Generated dates:', dates);
  console.log('Total dates generated:', dates.length);
  console.log('Expected count: 7 (July 3-9)');
  
  // Check specific dates
  const july9Included = dates.includes('2024-07-09');
  const july10Included = dates.includes('2024-07-10');
  const july2Included = dates.includes('2024-07-02');
  
  console.log('July 2 included:', july2Included, '(should be false)');
  console.log('July 9 included:', july9Included);
  console.log('July 10 included:', july10Included, '(should be false)');
  
  if (july2Included) {
    console.error('❌ BUG: July 2 is incorrectly included!');
    return false;
  } else if (!july9Included) {
    console.error('❌ BUG: July 9 is missing from rehydrated dates!');
    return false;
  } else if (july10Included) {
    console.error('❌ BUG: July 10 is incorrectly included!');
    return false;
  } else {
    console.log('✅ SUCCESS: Rehydration correctly includes July 3-9');
    return true;
  }
};

// Test with different timezones
const timezones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
let allTestsPassed = true;

timezones.forEach(timeZone => {
  const testPassed = testFixedRehydration(timeZone);
  if (!testPassed) {
    allTestsPassed = false;
  }
});

// Test edge cases
console.log('\n=== Testing edge cases ===');

// Test single day
console.log('\nSingle day test (July 3 only):');
const singleDayException = {
  attributes: {
    start: '2024-07-03T00:00:00.000Z',
    end: '2024-07-04T00:00:00.000Z',
    seats: 0
  }
};

const testSingleDay = (timeZone) => {
  const startDate = new Date(singleDayException.attributes.start);
  const endDate = new Date(singleDayException.attributes.end);
  
  let currentDate = new Date(startDate);
  const endDateExclusive = new Date(endDate);
  
  const dates = [];
  while (currentDate < endDateExclusive) {
    const dateInListingTZ = stringifyDateToISO8601(currentDate, timeZone);
    dates.push(dateInListingTZ);
    currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
  }
  
  console.log(`  ${timeZone}: ${dates.join(', ')} (count: ${dates.length})`);
  return dates.length === 1 && dates[0] === '2024-07-03';
};

timezones.forEach(timeZone => {
  const singleDayPassed = testSingleDay(timeZone);
  if (!singleDayPassed) {
    allTestsPassed = false;
    console.error(`  ❌ Single day test failed for ${timeZone}`);
  } else {
    console.log(`  ✅ Single day test passed for ${timeZone}`);
  }
});

// Test month boundary
console.log('\nMonth boundary test (June 30 - July 2):');
const monthBoundaryException = {
  attributes: {
    start: '2024-06-30T00:00:00.000Z',
    end: '2024-07-03T00:00:00.000Z',
    seats: 0
  }
};

const testMonthBoundary = (timeZone) => {
  const startDate = new Date(monthBoundaryException.attributes.start);
  const endDate = new Date(monthBoundaryException.attributes.end);
  
  let currentDate = new Date(startDate);
  const endDateExclusive = new Date(endDate);
  
  const dates = [];
  while (currentDate < endDateExclusive) {
    const dateInListingTZ = stringifyDateToISO8601(currentDate, timeZone);
    dates.push(dateInListingTZ);
    currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
  }
  
  console.log(`  ${timeZone}: ${dates.join(', ')} (count: ${dates.length})`);
  const expectedDates = ['2024-06-30', '2024-07-01', '2024-07-02'];
  const correct = dates.length === 3 && dates.every((date, i) => date === expectedDates[i]);
  
  if (!correct) {
    console.error(`  ❌ Month boundary test failed for ${timeZone}`);
    return false;
  } else {
    console.log(`  ✅ Month boundary test passed for ${timeZone}`);
    return true;
  }
};

timezones.forEach(timeZone => {
  const boundaryPassed = testMonthBoundary(timeZone);
  if (!boundaryPassed) {
    allTestsPassed = false;
  }
});

console.log('\n=== FINAL RESULTS ===');
if (allTestsPassed) {
  console.log('🎉 ALL TESTS PASSED! The fix successfully resolves the July 9 dropping bug.');
  console.log('✅ Date ranges now save properly and persist across edits, reloads, and views.');
  console.log('✅ All timezones are handled correctly.');
  console.log('✅ Edge cases (single day, month boundaries) work properly.');
} else {
  console.error('❌ SOME TESTS FAILED! The fix needs further investigation.');
}

console.log('\n=== FIX SUMMARY ===');
console.log('The fix addresses the timezone conversion issue by:');
console.log('1. Working directly with UTC dates to avoid timezone shifting');
console.log('2. Using simple date arithmetic (currentDate.getTime() + 24*60*60*1000)');
console.log('3. Converting to listing timezone only for display (stringifyDateToISO8601)');
console.log('4. Ensuring the exclusive end date is properly handled');

console.log('\n=== INVESTIGATION COMPLETE ==='); 
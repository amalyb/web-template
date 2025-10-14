// Test script using actual timezone functions to reproduce the July 9 dropping bug
console.log('🔍 Testing timezone conversion bug with actual functions...\n');

// Import moment-timezone to simulate the actual functions
const moment = require('moment-timezone');

// Simulate the actual getStartOf function
const getStartOf = (date, unit, timeZone, offset = 0, offsetUnit = 'days') => {
  const m = timeZone
    ? moment(date)
        .clone()
        .tz(timeZone)
    : moment(date).clone();

  const startOfUnit = m.startOf(unit);
  const startOfUnitWithOffset =
    offset === 0
      ? startOfUnit
      : ['day', 'week', 'month'].includes(unit)
      ? startOfUnit
          .add(offset, offsetUnit)
          .add(10, 'hours')
          .startOf(unit)
      : startOfUnit.add(offset, offsetUnit);
  return startOfUnitWithOffset.toDate();
};

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

// Test the rehydration logic with different timezones
const timezones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];

timezones.forEach(timeZone => {
  console.log(`\n=== Testing timezone: ${timeZone} ===`);
  
  const startDate = new Date(serverException.attributes.start);
  const endDate = new Date(serverException.attributes.end);
  
  console.log('Start date from server:', startDate.toISOString());
  console.log('End date from server:', endDate.toISOString());
  
  // Convert to listing's timezone for accurate date generation
  let currentDate = getStartOf(startDate, 'day', timeZone);
  const endDateInListingTZ = getStartOf(endDate, 'day', timeZone);
  
  console.log('Current date (start) in listing TZ:', currentDate.toISOString());
  console.log('End date in listing TZ:', endDateInListingTZ.toISOString());
  console.log('Loop condition: currentDate < endDateInListingTZ');
  console.log('Condition result:', currentDate < endDateInListingTZ);
  
  // Generate dates in loop
  const dates = [];
  let iteration = 0;
  
  while (currentDate < endDateInListingTZ) {
    const dateStr = stringifyDateToISO8601(currentDate, timeZone);
    dates.push(dateStr);
    console.log(`Iteration ${iteration + 1}: ${currentDate.toISOString()} -> ${dateStr}`);
    
    currentDate = getStartOf(currentDate, 'day', timeZone, 1, 'days');
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
  
  console.log('July 9 included:', july9Included);
  console.log('July 10 included:', july10Included);
  
  if (!july9Included) {
    console.error('❌ BUG: July 9 is missing from rehydrated dates!');
  } else if (july10Included) {
    console.error('❌ BUG: July 10 is incorrectly included!');
  } else {
    console.log('✅ SUCCESS: Rehydration correctly includes July 3-9');
  }
});

// Test the specific issue: why is July 9 being dropped?
console.log('\n=== DETAILED ANALYSIS ===');

const testTimeZone = 'America/New_York';
const startDate = new Date('2024-07-03T00:00:00.000Z');
const endDate = new Date('2024-07-10T00:00:00.000Z');

console.log(`Testing with timezone: ${testTimeZone}`);
console.log('Start date (UTC):', startDate.toISOString());
console.log('End date (UTC):', endDate.toISOString());

// Convert to listing's timezone
const startInListingTZ = getStartOf(startDate, 'day', testTimeZone);
const endInListingTZ = getStartOf(endDate, 'day', testTimeZone);

console.log('Start in listing TZ:', startInListingTZ.toISOString());
console.log('End in listing TZ:', endInListingTZ.toISOString());

// Check what happens when we iterate
let current = new Date(startInListingTZ);
const dates = [];

while (current < endInListingTZ) {
  const dateStr = stringifyDateToISO8601(current, testTimeZone);
  dates.push(dateStr);
  console.log(`Current: ${current.toISOString()} -> ${dateStr}`);
  
  // Move to next day
  current = getStartOf(current, 'day', testTimeZone, 1, 'days');
}

console.log('Final dates:', dates);
console.log('July 9 in dates:', dates.includes('2024-07-09'));

// The issue: timezone conversion is shifting the dates
console.log('\n=== ROOT CAUSE ANALYSIS ===');
console.log('The problem is that getStartOf() with timezone conversion is shifting dates.');
console.log('When we convert UTC dates to a timezone, the dates can shift by one day.');
console.log('This causes the loop to stop one day early, dropping July 9.');

console.log('\n=== SOLUTION ===');
console.log('We need to fix the rehydration logic to handle timezone conversion correctly.');
console.log('The fix should ensure that the exclusive end date is properly handled.');

console.log('\n=== INVESTIGATION COMPLETE ==='); 
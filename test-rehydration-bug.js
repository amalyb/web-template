// Test script to reproduce the rehydration bug
console.log('🔍 Testing rehydration bug - July 9 getting dropped...\n');

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

// Mock the timezone functions
const getStartOf = (date, unit, timezone, amount = 0, unit2 = 'days') => {
  const newDate = new Date(date);
  if (unit === 'day') {
    newDate.setHours(0, 0, 0, 0);
    if (amount > 0) {
      newDate.setDate(newDate.getDate() + amount);
    }
  }
  return newDate;
};

const stringifyDateToISO8601 = (date, timezone) => {
  return date.toISOString().split('T')[0];
};

// Test the rehydration logic
const timeZone = 'America/New_York'; // Example timezone
const startDate = new Date(serverException.attributes.start);
const endDate = new Date(serverException.attributes.end);

console.log('=== STEP 1: Parse server dates ===');
console.log('Start date from server:', startDate.toISOString());
console.log('End date from server:', endDate.toISOString());
console.log('Timezone:', timeZone);

// Convert to listing's timezone for accurate date generation
let currentDate = getStartOf(startDate, 'day', timeZone);
const endDateInListingTZ = getStartOf(endDate, 'day', timeZone);

console.log('\n=== STEP 2: Timezone conversion ===');
console.log('Current date (start):', currentDate.toISOString());
console.log('End date in listing TZ:', endDateInListingTZ.toISOString());
console.log('Loop condition: currentDate < endDateInListingTZ');
console.log('Condition result:', currentDate < endDateInListingTZ);

console.log('\n=== STEP 3: Generate dates in loop ===');
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

console.log('\n=== STEP 4: Results ===');
console.log('Generated dates:', dates);
console.log('Total dates generated:', dates.length);
console.log('Expected count: 7 (July 3-9)');

// Check specific dates
const july9Included = dates.includes('2024-07-09');
const july10Included = dates.includes('2024-07-10');

console.log('\n=== STEP 5: Validation ===');
console.log('July 9 included:', july9Included);
console.log('July 10 included:', july10Included);

if (!july9Included) {
  console.error('❌ BUG: July 9 is missing from rehydrated dates!');
} else if (july10Included) {
  console.error('❌ BUG: July 10 is incorrectly included!');
} else {
  console.log('✅ SUCCESS: Rehydration correctly includes July 3-9');
}

// Test with different timezones
console.log('\n=== STEP 6: Test different timezones ===');
const timezones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];

timezones.forEach(tz => {
  console.log(`\nTesting timezone: ${tz}`);
  
  const startDateTZ = getStartOf(startDate, 'day', tz);
  const endDateTZ = getStartOf(endDate, 'day', tz);
  
  const datesTZ = [];
  let currentTZ = new Date(startDateTZ);
  
  while (currentTZ < endDateTZ) {
    datesTZ.push(stringifyDateToISO8601(currentTZ, tz));
    currentTZ = getStartOf(currentTZ, 'day', tz, 1, 'days');
  }
  
  console.log(`  Dates: ${datesTZ.join(', ')}`);
  console.log(`  Count: ${datesTZ.length}`);
  console.log(`  July 9 included: ${datesTZ.includes('2024-07-09')}`);
});

console.log('\n=== INVESTIGATION COMPLETE ==='); 
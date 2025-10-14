// Test to verify the proper fix for rehydration logic
console.log('🔍 Testing proper fix for rehydration logic...\n');

const moment = require('moment-timezone');

// Simulate the actual functions
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

const stringifyDateToISO8601 = (date, timeZone = null) => {
  return timeZone
    ? moment(date)
        .tz(timeZone)
        .format('YYYY-MM-DD')
    : moment(date).format('YYYY-MM-DD');
};

// Test the rehydration logic with different timezones
const testRehydrationLogic = (timeZone) => {
  console.log(`\n=== TESTING REHYDRATION LOGIC FOR TIMEZONE: ${timeZone} ===`);
  
  // Simulate API response (what server returns)
  const apiResponse = [{
    attributes: {
      start: '2024-07-03T00:00:00.000Z',
      end: '2024-07-10T00:00:00.000Z',
      seats: 0
    }
  }];
  
  console.log('API response:', JSON.stringify(apiResponse, null, 2));
  
  // Current rehydration logic (BROKEN)
  console.log('\n--- CURRENT REHYDRATION LOGIC (BROKEN) ---');
  const rehydratedDates = apiResponse
    .map(exception => {
      const startDate = new Date(exception.attributes.start);
      const endDate = new Date(exception.attributes.end);
      const dates = [];
      
      console.log(`\nRehydrating exception: ${startDate.toISOString()} to ${endDate.toISOString()}`);
      
      // Convert the UTC dates to the listing's timezone first
      const startDateInListingTZ = getStartOf(startDate, 'day', timeZone);
      const endDateInListingTZ = getStartOf(endDate, 'day', timeZone);
      
      console.log(`  Start in listing TZ: ${startDateInListingTZ.toISOString()}`);
      console.log(`  End in listing TZ: ${endDateInListingTZ.toISOString()}`);
      
      // Generate all dates in the range (inclusive start, exclusive end)
      let currentDate = new Date(startDateInListingTZ);
      
      while (currentDate < endDateInListingTZ) {
        const dateInListingTZ = stringifyDateToISO8601(currentDate, timeZone);
        dates.push(dateInListingTZ);
        console.log(`    ${currentDate.toISOString()} -> ${dateInListingTZ}`);
        
        // Move to next day in the listing's timezone
        currentDate = getStartOf(currentDate, 'day', timeZone, 1, 'days');
      }
      
      console.log(`  Rehydrated dates: ${dates.join(', ')}`);
      return dates;
    })
    .flat();
  
  console.log('\nFinal rehydrated dates (CURRENT):', rehydratedDates);
  
  // PROPER FIX: Work with UTC dates directly
  console.log('\n--- PROPER FIX: WORK WITH UTC DATES DIRECTLY ---');
  const fixedRehydratedDates = apiResponse
    .map(exception => {
      const startDate = new Date(exception.attributes.start);
      const endDate = new Date(exception.attributes.end);
      const dates = [];
      
      console.log(`\nRehydrating exception: ${startDate.toISOString()} to ${endDate.toISOString()}`);
      
      // FIX: Work with UTC dates directly, don't convert to timezone
      // The server stores dates in UTC, so we should generate dates in UTC
      let currentDate = new Date(startDate);
      
      while (currentDate < endDate) {
        const dateInUTC = stringifyDateToISO8601(currentDate, null); // Use UTC
        dates.push(dateInUTC);
        console.log(`    ${currentDate.toISOString()} -> ${dateInUTC}`);
        
        // Move to next day in UTC
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      console.log(`  Rehydrated dates: ${dates.join(', ')}`);
      return dates;
    })
    .flat();
  
  console.log('\nFinal rehydrated dates (PROPER FIX):', fixedRehydratedDates);
  
  // Validation
  console.log('\n--- VALIDATION ---');
  const currentJuly2Included = rehydratedDates.includes('2024-07-02');
  const currentJuly9Included = rehydratedDates.includes('2024-07-09');
  const currentTotal = rehydratedDates.length;
  
  const fixedJuly2Included = fixedRehydratedDates.includes('2024-07-02');
  const fixedJuly9Included = fixedRehydratedDates.includes('2024-07-09');
  const fixedTotal = fixedRehydratedDates.length;
  
  console.log('Current logic:');
  console.log('  July 2 included:', currentJuly2Included, '(should be false)');
  console.log('  July 9 included:', currentJuly9Included, '(should be true)');
  console.log('  Total dates:', currentTotal, '(should be 7)');
  
  console.log('\nProper fix:');
  console.log('  July 2 included:', fixedJuly2Included, '(should be false)');
  console.log('  July 9 included:', fixedJuly9Included, '(should be true)');
  console.log('  Total dates:', fixedTotal, '(should be 7)');
  
  const currentSuccess = !currentJuly2Included && currentJuly9Included && currentTotal === 7;
  const fixedSuccess = !fixedJuly2Included && fixedJuly9Included && fixedTotal === 7;
  
  console.log(`\nCurrent logic: ${currentSuccess ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Proper fix: ${fixedSuccess ? '✅ PASS' : '❌ FAIL'}`);
  
  return {
    timeZone,
    currentSuccess,
    fixedSuccess,
    currentDates: rehydratedDates,
    fixedDates: fixedRehydratedDates
  };
};

// Test with different timezones
const timezones = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London'];
const results = [];

timezones.forEach(timeZone => {
  const result = testRehydrationLogic(timeZone);
  results.push(result);
});

// Summary
console.log('\n=== FINAL SUMMARY ===');
console.log('Timezone | Current | Proper Fix | Status');
console.log('---------|---------|------------|--------');
results.forEach(result => {
  const status = result.fixedSuccess ? '✅ FIXED' : '❌ STILL BROKEN';
  console.log(`${result.timeZone.padEnd(15)} | ${result.currentSuccess ? 'PASS' : 'FAIL'} | ${result.fixedSuccess ? 'PASS' : 'FAIL'} | ${status}`);
});

const allFixed = results.every(r => r.fixedSuccess);
console.log(`\nOverall result: ${allFixed ? '🎉 ALL TIMEZONES FIXED' : '❌ SOME TIMEZONES STILL BROKEN'}`);

console.log('\n=== ROOT CAUSE AND FIX ===');
console.log('ROOT CAUSE:');
console.log('1. Server stores dates in UTC (e.g., 2024-07-03T00:00:00.000Z to 2024-07-10T00:00:00.000Z)');
console.log('2. Current rehydration logic converts these UTC dates to listing timezone using getStartOf()');
console.log('3. This causes date shifting: July 3 UTC becomes July 2 in some timezones');
console.log('4. The loop then generates dates in the shifted range, missing the last day');
console.log('\nPROPER FIX:');
console.log('1. Work with UTC dates directly in rehydration');
console.log('2. Don\'t convert server UTC dates to listing timezone');
console.log('3. Generate date strings in UTC format (YYYY-MM-DD)');
console.log('4. This ensures consistent date handling regardless of timezone'); 
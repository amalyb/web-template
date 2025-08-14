// Comprehensive end-to-end test for July 3-9 availability flow
console.log('🔍 Testing entire end-to-end flow for July 3-9 availability...\n');

// Import moment-timezone to simulate the actual functions
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

const toUtcMidnightISOString = dateStr => {
  if (!dateStr || typeof dateStr !== 'string') {
    console.error('Invalid date string:', dateStr);
    throw new RangeError(`Invalid date string passed to payload: ${dateStr}`);
  }
  
  const parsedDate = new Date(dateStr);
  if (isNaN(parsedDate.getTime())) {
    console.error('Invalid date string that cannot be parsed:', dateStr);
    throw new RangeError(`Invalid date string passed to payload: ${dateStr}`);
  }
  
  const dateOnly = dateStr.split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    console.error('Invalid date format (expected YYYY-MM-DD):', dateStr);
    throw new RangeError(`Invalid date format passed to payload: ${dateStr}`);
  }
  
  return `${dateOnly}T00:00:00.000Z`;
};

const groupDatesToRanges = (sortedDates) => {
  if (!Array.isArray(sortedDates)) {
    console.error('groupDatesToRanges: input is not an array:', sortedDates);
    return [];
  }
  
  const ranges = [];
  let currentRange = [];
  sortedDates.forEach((date, index) => {
    if (typeof date !== 'string' || !date) {
      console.warn(`groupDatesToRanges: skipping invalid date at index ${index}:`, date);
      return;
    }
    
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      console.warn(`groupDatesToRanges: skipping unparseable date at index ${index}:`, date);
      return;
    }
    
    if (currentRange.length === 0) {
      currentRange = [date];
    } else {
      const lastDate = new Date(currentRange[currentRange.length - 1]);
      const currentDate = new Date(date);
      
      if (isNaN(lastDate.getTime()) || isNaN(currentDate.getTime())) {
        console.warn(`groupDatesToRanges: invalid date comparison, skipping:`, {
          lastDate: currentRange[currentRange.length - 1],
          currentDate: date
        });
        return;
      }
      
      const diffTime = currentDate - lastDate;
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      if (diffDays === 1) {
        currentRange.push(date);
      } else {
        if (currentRange.length > 0) {
          ranges.push([...currentRange]);
        }
        currentRange = [date];
      }
    }
  });
  if (currentRange.length > 0) {
    ranges.push(currentRange);
  }
  
  return ranges;
};

// Test the entire flow
const testEndToEndFlow = (timeZone) => {
  console.log(`\n=== TESTING END-TO-END FLOW FOR TIMEZONE: ${timeZone} ===`);
  
  // STEP 1: User selects July 3-9 as unavailable
  const selectedDates = [
    '2024-07-03',
    '2024-07-04', 
    '2024-07-05',
    '2024-07-06',
    '2024-07-07',
    '2024-07-08',
    '2024-07-09'
  ];
  
  console.log('📅 User selected dates:', selectedDates);
  console.log('Expected: Block July 3 through July 9 (7 days total)');
  
  // STEP 2: Group dates into ranges
  console.log('\n--- STEP 2: Group dates into ranges ---');
  const ranges = groupDatesToRanges(selectedDates);
  console.log('Generated ranges:', ranges);
  
  // STEP 3: Map ranges to API format (SAVING LOGIC)
  console.log('\n--- STEP 3: Map ranges to API format (SAVING) ---');
  const newRanges = ranges
    .map(range => {
      if (!range || range.length === 0) {
        console.warn('Skipping empty range:', range);
        return null;
      }
      const start = range[0];
      const endInclusive = range[range.length - 1];
      if (!start || !endInclusive) {
        console.warn('Skipping invalid range:', range);
        return null;
      }
      
      console.log(`\nProcessing range: ${start} to ${endInclusive} (inclusive)`);
      console.log(`Range contains ${range.length} dates:`, range);
      
      try {
        const startIso = toUtcMidnightISOString(start);
        const endInclusiveIso = toUtcMidnightISOString(endInclusive);
        
        console.log(`  Start (inclusive): ${start} -> ${startIso}`);
        console.log(`  End (inclusive): ${endInclusive} -> ${endInclusiveIso}`);
        
        // Add one day to endInclusive to make it exclusive
        const endExclusiveDate = new Date(endInclusive);
        endExclusiveDate.setDate(endExclusiveDate.getDate() + 1);
        const endExclusive = endExclusiveDate.toISOString().split('T')[0];
        const endIso = toUtcMidnightISOString(endExclusive);
        
        console.log(`  End (exclusive): ${endExclusive} -> ${endIso}`);
        console.log(`  Date math: ${endInclusive} + 1 day = ${endExclusive}`);
        
        const result = { start: startIso, end: endIso };
        console.log(`  Final range: ${result.start} to ${result.end} (exclusive)`);
        
        return result;
      } catch (e) {
        console.error('Skipping range due to invalid date:', range, e);
        return null;
      }
    })
    .filter(Boolean);
  
  console.log('\nFinal API ranges to save:', newRanges);
  
  // STEP 4: Simulate API response (what the server would return)
  console.log('\n--- STEP 4: Simulate API response ---');
  const apiResponse = newRanges.map(range => ({
    attributes: {
      start: range.start,
      end: range.end,
      seats: 0
    }
  }));
  
  console.log('API response (what server returns):', JSON.stringify(apiResponse, null, 2));
  
  // STEP 5: Rehydrate dates from API response (RELOADING LOGIC)
  console.log('\n--- STEP 5: Rehydrate dates from API response (RELOADING) ---');
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
  
  console.log('\nFinal rehydrated dates:', rehydratedDates);
  
  // STEP 6: Validate results
  console.log('\n--- STEP 6: Validation ---');
  const july2Included = rehydratedDates.includes('2024-07-02');
  const july9Included = rehydratedDates.includes('2024-07-09');
  const july10Included = rehydratedDates.includes('2024-07-10');
  
  console.log('July 2 included:', july2Included, '(should be false)');
  console.log('July 9 included:', july9Included);
  console.log('July 10 included:', july10Included, '(should be false)');
  console.log('Total dates:', rehydratedDates.length, '(should be 7)');
  
  const success = !july2Included && july9Included && !july10Included && rehydratedDates.length === 7;
  
  if (success) {
    console.log('✅ SUCCESS: End-to-end flow works correctly');
  } else {
    console.log('❌ FAILURE: End-to-end flow has issues');
  }
  
  return {
    timeZone,
    selectedDates,
    apiRanges: newRanges,
    rehydratedDates,
    july2Included,
    july9Included,
    july10Included,
    totalDates: rehydratedDates.length,
    success
  };
};

// Test with different timezones
const timezones = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London'];
const results = [];

timezones.forEach(timeZone => {
  const result = testEndToEndFlow(timeZone);
  results.push(result);
});

// Summary
console.log('\n=== FINAL SUMMARY ===');
console.log('Timezone | July 2 | July 9 | July 10 | Total | Status');
console.log('---------|--------|--------|---------|-------|--------');
results.forEach(result => {
  const status = result.success ? '✅ PASS' : '❌ FAIL';
  console.log(`${result.timeZone.padEnd(15)} | ${result.july2Included ? 'YES' : 'NO  '} | ${result.july9Included ? 'YES' : 'NO '} | ${result.july10Included ? 'YES' : 'NO  '} | ${result.totalDates.toString().padStart(5)} | ${status}`);
});

const allPassed = results.every(r => r.success);
console.log(`\nOverall result: ${allPassed ? '🎉 ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

if (!allPassed) {
  console.log('\n=== ISSUES FOUND ===');
  results.filter(r => !r.success).forEach(result => {
    console.log(`\n${result.timeZone}:`);
    if (result.july2Included) console.log('  - July 2 incorrectly included');
    if (!result.july9Included) console.log('  - July 9 missing');
    if (result.july10Included) console.log('  - July 10 incorrectly included');
    if (result.totalDates !== 7) console.log(`  - Wrong total dates: ${result.totalDates} (expected 7)`);
  });
}

console.log('\n=== INVESTIGATION COMPLETE ==='); 
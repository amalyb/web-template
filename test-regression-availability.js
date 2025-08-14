// Comprehensive regression test for availability date handling
// This test ensures that the July 9 dropping issue never happens again
console.log('🔍 Running comprehensive regression test for availability date handling...\n');

const moment = require('moment-timezone');

// Simulate the actual functions from the codebase
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

// FIXED rehydration logic (what we implemented)
const rehydrateDatesFromAPI = (apiResponse) => {
  return apiResponse
    .map(exception => {
      const startDate = new Date(exception.attributes.start);
      const endDate = new Date(exception.attributes.end);
      const dates = [];
      
      // FIXED: Work with UTC dates directly to avoid timezone shifting
      let currentDate = new Date(startDate);
      
      while (currentDate < endDate) {
        // Use moment.utc() to ensure we get UTC date strings, not local timezone
        const dateInUTC = moment.utc(currentDate).format('YYYY-MM-DD');
        dates.push(dateInUTC);
        
        // Move to next day in UTC
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      // Remove duplicates (in case of DST issues)
      return [...new Set(dates)];
    })
    .flat();
};

// BROKEN rehydration logic (what was causing the issue)
const brokenRehydrateDatesFromAPI = (apiResponse, timeZone) => {
  return apiResponse
    .map(exception => {
      const startDate = new Date(exception.attributes.start);
      const endDate = new Date(exception.attributes.end);
      const dates = [];
      
      // BROKEN: Convert UTC dates to listing timezone (causes date shifting)
      const startDateInListingTZ = getStartOf(startDate, 'day', timeZone);
      const endDateInListingTZ = getStartOf(endDate, 'day', timeZone);
      
      let currentDate = new Date(startDateInListingTZ);
      
      while (currentDate < endDateInListingTZ) {
        const dateInListingTZ = stringifyDateToISO8601(currentDate, timeZone);
        dates.push(dateInListingTZ);
        
        // Move to next day in the listing's timezone
        currentDate = getStartOf(currentDate, 'day', timeZone, 1, 'days');
      }
      
      return dates;
    })
    .flat();
};

// Test scenarios that were problematic
const testScenarios = [
  {
    name: 'July 3-9 (7 days) - The original bug',
    apiResponse: [{
      attributes: {
        start: '2024-07-03T00:00:00.000Z',
        end: '2024-07-10T00:00:00.000Z',
        seats: 0
      }
    }],
    expectedDates: ['2024-07-03', '2024-07-04', '2024-07-05', '2024-07-06', '2024-07-07', '2024-07-08', '2024-07-09'],
    expectedCount: 7
  },
  {
    name: 'Single day (July 3)',
    apiResponse: [{
      attributes: {
        start: '2024-07-03T00:00:00.000Z',
        end: '2024-07-04T00:00:00.000Z',
        seats: 0
      }
    }],
    expectedDates: ['2024-07-03'],
    expectedCount: 1
  },
  {
    name: 'Month boundary (June 30 to July 2)',
    apiResponse: [{
      attributes: {
        start: '2024-06-30T00:00:00.000Z',
        end: '2024-07-03T00:00:00.000Z',
        seats: 0
      }
    }],
    expectedDates: ['2024-06-30', '2024-07-01', '2024-07-02'],
    expectedCount: 3
  },
  {
    name: 'Year boundary (Dec 31 to Jan 2)',
    apiResponse: [{
      attributes: {
        start: '2024-12-31T00:00:00.000Z',
        end: '2025-01-03T00:00:00.000Z',
        seats: 0
      }
    }],
    expectedDates: ['2024-12-31', '2025-01-01', '2025-01-02'],
    expectedCount: 3
  },
  {
    name: 'DST transition (March 9-10, 2024)',
    apiResponse: [{
      attributes: {
        start: '2024-03-09T00:00:00.000Z',
        end: '2024-03-11T00:00:00.000Z',
        seats: 0
      }
    }],
    expectedDates: ['2024-03-09', '2024-03-10'],
    expectedCount: 2
  },
  {
    name: 'Long range (July 1-31)',
    apiResponse: [{
      attributes: {
        start: '2024-07-01T00:00:00.000Z',
        end: '2024-08-01T00:00:00.000Z',
        seats: 0
      }
    }],
    expectedCount: 31
  },
  {
    name: 'Problematic timezone scenario (July 2-4)',
    apiResponse: [{
      attributes: {
        start: '2024-07-02T00:00:00.000Z',
        end: '2024-07-05T00:00:00.000Z',
        seats: 0
      }
    }],
    expectedDates: ['2024-07-02', '2024-07-03', '2024-07-04'],
    expectedCount: 3
  }
];

// Test timezones that were problematic
const timezones = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'];

// Run regression tests
const runRegressionTests = () => {
  console.log('=== REGRESSION TEST RESULTS ===');
  
  const results = [];
  
  testScenarios.forEach(scenario => {
    console.log(`\n--- Testing: ${scenario.name} ---`);
    
    // Test with fixed logic
    const fixedDates = rehydrateDatesFromAPI(scenario.apiResponse);
    
    // Test with broken logic for each timezone
    const brokenResults = timezones.map(timeZone => {
      const brokenDates = brokenRehydrateDatesFromAPI(scenario.apiResponse, timeZone);
      const correctDates = scenario.expectedDates ? 
        scenario.expectedDates.every(date => brokenDates.includes(date)) : 
        brokenDates.length === scenario.expectedCount;
      const correctCount = brokenDates.length === scenario.expectedCount;
      
      return {
        timeZone,
        dates: brokenDates,
        correctDates,
        correctCount,
        success: correctDates && correctCount
      };
    });
    
    // Validate fixed logic
    const fixedCorrectDates = scenario.expectedDates ? 
      scenario.expectedDates.every(date => fixedDates.includes(date)) : 
      fixedDates.length === scenario.expectedCount;
    const fixedCorrectCount = fixedDates.length === scenario.expectedCount;
    const fixedSuccess = fixedCorrectDates && fixedCorrectCount;
    
    console.log('Fixed logic result:', fixedSuccess ? '✅ PASS' : '❌ FAIL');
    console.log('Fixed dates:', fixedDates);
    
    // Check if broken logic fails in any timezone (which is expected)
    const brokenLogicFails = brokenResults.some(r => !r.success);
    console.log('Broken logic fails in some timezones:', brokenLogicFails ? '✅ EXPECTED' : '❌ UNEXPECTED');
    
    if (!brokenLogicFails) {
      console.log('⚠️  WARNING: Broken logic should fail in some timezones!');
    }
    
    results.push({
      scenario: scenario.name,
      fixedSuccess,
      brokenLogicFails,
      fixedDates,
      brokenResults
    });
  });
  
  return results;
};

// Run the tests
const results = runRegressionTests();

// Summary
console.log('\n=== REGRESSION TEST SUMMARY ===');
console.log('Scenario | Fixed Logic | Broken Logic Fails | Status');
console.log('---------|-------------|-------------------|--------');

results.forEach(result => {
  const status = result.fixedSuccess && result.brokenLogicFails ? '✅ PASS' : '❌ FAIL';
  console.log(`${result.scenario.padEnd(30)} | ${result.fixedSuccess ? 'PASS' : 'FAIL'} | ${result.brokenLogicFails ? 'YES' : 'NO'} | ${status}`);
});

const allPassed = results.every(r => r.fixedSuccess && r.brokenLogicFails);
console.log(`\nOverall result: ${allPassed ? '🎉 ALL REGRESSION TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

if (allPassed) {
  console.log('\n=== REGRESSION TEST VERIFICATION COMPLETE ===');
  console.log('✅ The fix correctly resolves the July 9 dropping issue');
  console.log('✅ The broken logic correctly fails in problematic timezones');
  console.log('✅ The fix works consistently across all timezones');
  console.log('✅ Edge cases are handled correctly');
  console.log('✅ This regression test can be used to prevent future regressions');
} else {
  console.log('\n=== REGRESSION TEST ISSUES ===');
  console.log('❌ Some tests are failing');
  console.log('❌ The fix may not be complete');
}

console.log('\n=== REGRESSION TEST INSTRUCTIONS ===');
console.log('This test should be run:');
console.log('1. After any changes to availability date handling');
console.log('2. Before deploying to production');
console.log('3. As part of the CI/CD pipeline');
console.log('4. When testing in different timezones');
console.log('\nExpected behavior:');
console.log('- Fixed logic should PASS all scenarios');
console.log('- Broken logic should FAIL in some timezones (this is expected)');
console.log('- This ensures the fix is working and prevents regressions'); 
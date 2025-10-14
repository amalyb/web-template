// Test script to reproduce the July 3-9 date range exclusion bug
console.log('🔍 Testing July 3-9 date range exclusion bug...\n');

// Simulate the exact scenario: user selects July 3-9 as unavailable
const july3to9Dates = [
  '2024-07-03',
  '2024-07-04', 
  '2024-07-05',
  '2024-07-06',
  '2024-07-07',
  '2024-07-08',
  '2024-07-09'
];

console.log('📅 Selected dates (July 3-9):', july3to9Dates);
console.log('Expected: Block July 3 through July 9 (7 days total)');
console.log('Expected API payload: start=2024-07-03T00:00:00.000Z, end=2024-07-10T00:00:00.000Z\n');

// Test the groupDatesToRanges function
const groupDatesToRanges = (sortedDates) => {
  if (!Array.isArray(sortedDates)) {
    console.error('groupDatesToRanges: input is not an array:', sortedDates);
    return [];
  }
  
  const ranges = [];
  let currentRange = [];
  sortedDates.forEach((date, index) => {
    // Validate each date string
    if (typeof date !== 'string' || !date) {
      console.warn(`groupDatesToRanges: skipping invalid date at index ${index}:`, date);
      return;
    }
    
    // Try to parse the date to ensure it's valid
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
      
      // Validate that both dates are valid
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

// Test the toUtcMidnightISOString function
const toUtcMidnightISOString = dateStr => {
  if (!dateStr || typeof dateStr !== 'string') {
    console.error('Invalid date string:', dateStr);
    throw new RangeError(`Invalid date string passed to payload: ${dateStr}`);
  }
  
  // Try to parse the date string
  const parsedDate = new Date(dateStr);
  if (isNaN(parsedDate.getTime())) {
    console.error('Invalid date string that cannot be parsed:', dateStr);
    throw new RangeError(`Invalid date string passed to payload: ${dateStr}`);
  }
  
  // Ensure we have a valid date string in YYYY-MM-DD format
  const dateOnly = dateStr.split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    console.error('Invalid date format (expected YYYY-MM-DD):', dateStr);
    throw new RangeError(`Invalid date format passed to payload: ${dateStr}`);
  }
  
  return `${dateOnly}T00:00:00.000Z`;
};

console.log('=== STEP 1: Group dates into ranges ===');
const ranges = groupDatesToRanges(july3to9Dates);
console.log('Generated ranges:', ranges);
console.log('Expected: One range with all 7 dates\n');

console.log('=== STEP 2: Map ranges to API format ===');
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
    
    // Additional validation for date strings
    if (typeof start !== 'string' || typeof endInclusive !== 'string') {
      console.warn('Skipping range with non-string dates:', range);
      return null;
    }
    
    console.log(`\nProcessing range: ${start} to ${endInclusive} (inclusive)`);
    console.log(`Range contains ${range.length} dates:`, range);
    
    // Validate date strings before using
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
      
      // Final validation: ensure start < end
      const startDate = new Date(startIso);
      const endDate = new Date(endIso);
      if (startDate >= endDate) {
        console.warn('Skipping invalid range: start >= end:', { start: startIso, end: endIso });
        return null;
      }
      
      const result = { start: startIso, end: endIso };
      console.log(`  Final range: ${result.start} to ${result.end} (exclusive)`);
      
      // Verify the range covers the expected dates
      const startDay = new Date(result.start);
      const endDay = new Date(result.end);
      const daysInRange = Math.floor((endDay - startDay) / (1000 * 60 * 60 * 24));
      console.log(`  Days in range: ${daysInRange} (should be 7 for July 3-9)`);
      
      return result;
    } catch (e) {
      console.error('Skipping range due to invalid date:', range, e);
      return null;
    }
  })
  .filter(Boolean);

console.log('\n=== STEP 3: Final API ranges ===');
console.log('Mapped ranges:', newRanges);

console.log('\n=== STEP 4: Verify API payload ===');
newRanges.forEach((range, index) => {
  console.log(`\nRange ${index + 1}:`, range);
  
  const payload = {
    listingId: 'test-listing-id',
    seats: 0,
    start: range.start,
    end: range.end,
  };
  
  console.log('API payload:', JSON.stringify(payload, null, 2));
  
  // Test what dates this range actually blocks
  const startDate = new Date(payload.start);
  const endDate = new Date(payload.end);
  
  console.log('Blocked dates:');
  let currentDate = new Date(startDate);
  let blockedDates = [];
  while (currentDate < endDate) {
    blockedDates.push(currentDate.toISOString().split('T')[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  console.log('  Dates blocked:', blockedDates);
  console.log(`  Total days blocked: ${blockedDates.length}`);
  
  // Check if July 9 is included
  const july9Included = blockedDates.includes('2024-07-09');
  console.log(`  July 9 included: ${july9Included}`);
  
  // Check if July 10 is excluded
  const july10Included = blockedDates.includes('2024-07-10');
  console.log(`  July 10 included: ${july10Included} (should be false)`);
  
  if (!july9Included) {
    console.error('❌ BUG: July 9 is NOT included in the blocked range!');
  } else if (july10Included) {
    console.error('❌ BUG: July 10 is incorrectly included in the blocked range!');
  } else {
    console.log('✅ SUCCESS: Range correctly blocks July 3-9 (7 days)');
  }
});

console.log('\n=== STEP 5: Test edge cases ===');

// Test single day
console.log('\nSingle day test (July 3 only):');
const singleDayRange = groupDatesToRanges(['2024-07-03'])
  .map(range => {
    const start = range[0];
    const endInclusive = range[range.length - 1];
    const startIso = toUtcMidnightISOString(start);
    const endExclusiveDate = new Date(endInclusive);
    endExclusiveDate.setDate(endExclusiveDate.getDate() + 1);
    const endExclusive = endExclusiveDate.toISOString().split('T')[0];
    const endIso = toUtcMidnightISOString(endExclusive);
    return { start: startIso, end: endIso };
  })[0];

console.log('Single day range:', singleDayRange);
const singleStart = new Date(singleDayRange.start);
const singleEnd = new Date(singleDayRange.end);
const singleDays = Math.floor((singleEnd - singleStart) / (1000 * 60 * 60 * 24));
console.log(`Days blocked: ${singleDays} (should be 1)`);

console.log('\n=== INVESTIGATION COMPLETE ==='); 
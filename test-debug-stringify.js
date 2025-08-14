// Debug test to understand stringifyDateToISO8601 behavior
console.log('🔍 Debugging stringifyDateToISO8601 behavior...\n');

const moment = require('moment-timezone');

const stringifyDateToISO8601 = (date, timeZone = null) => {
  return timeZone
    ? moment(date)
        .tz(timeZone)
        .format('YYYY-MM-DD')
    : moment(date).format('YYYY-MM-DD');
};

// Test with the specific dates from our issue
const testDate = new Date('2024-07-03T00:00:00.000Z');
console.log('Test date:', testDate.toISOString());
console.log('Test date local timezone:', testDate.toString());

console.log('\n--- Testing stringifyDateToISO8601 ---');
console.log('With timeZone=null (UTC):', stringifyDateToISO8601(testDate, null));
console.log('With timeZone=UTC:', stringifyDateToISO8601(testDate, 'UTC'));
console.log('With timeZone=America/New_York:', stringifyDateToISO8601(testDate, 'America/New_York'));
console.log('With timeZone=America/Los_Angeles:', stringifyDateToISO8601(testDate, 'America/Los_Angeles'));
console.log('With timeZone=Europe/London:', stringifyDateToISO8601(testDate, 'Europe/London'));

console.log('\n--- Testing moment behavior ---');
console.log('moment(date).format():', moment(testDate).format('YYYY-MM-DD'));
console.log('moment(date).utc().format():', moment(testDate).utc().format('YYYY-MM-DD'));
console.log('moment.utc(date).format():', moment.utc(testDate).format('YYYY-MM-DD'));

console.log('\n--- Testing with different date formats ---');
const dates = [
  '2024-07-03T00:00:00.000Z',
  '2024-07-03T04:00:00.000Z', // NY time
  '2024-07-03T07:00:00.000Z', // LA time
  '2024-07-02T23:00:00.000Z', // London time
];

dates.forEach(dateStr => {
  const date = new Date(dateStr);
  console.log(`\nDate: ${dateStr}`);
  console.log(`  ISO: ${date.toISOString()}`);
  console.log(`  Local: ${date.toString()}`);
  console.log(`  stringify(null): ${stringifyDateToISO8601(date, null)}`);
  console.log(`  stringify(UTC): ${stringifyDateToISO8601(date, 'UTC')}`);
  console.log(`  moment.utc(): ${moment.utc(date).format('YYYY-MM-DD')}`);
});

console.log('\n--- Understanding the issue ---');
console.log('The problem is that when we call stringifyDateToISO8601(date, null),');
console.log('moment(date) interprets the date in the local timezone, not UTC.');
console.log('So 2024-07-03T00:00:00.000Z becomes 2024-07-02 in some timezones.');
console.log('\nThe fix is to use moment.utc(date) instead of moment(date) when we want UTC.'); 
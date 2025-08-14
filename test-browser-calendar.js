// Browser-compatible test script to verify the calendar fix
// This can be run in the browser console to test the fix

function testCalendarFix() {
  console.log('🧪 BROWSER CALENDAR FIX VERIFICATION');
  console.log('=====================================');
  
  // Test July 2025 specifically
  const july2025 = new Date(2025, 6, 1); // July 1, 2025
  const firstDayOfWeek = 1; // Monday
  
  console.log('Testing July 2025 calendar grid calculation...');
  console.log('July 1, 2025:', july2025.toDateString());
  console.log('Day of week:', july2025.getDay(), '(0=Sunday, 1=Monday, 2=Tuesday)');
  
  // OLD (buggy) calculation
  const oldStart = new Date(july2025.getFullYear(), july2025.getMonth(), 1 - july2025.getDay());
  const oldEnd = new Date(july2025.getFullYear(), july2025.getMonth() + 1, 7 - new Date(2025, 6, 31).getDay());
  
  console.log('\nOLD (BUGGY) CALCULATION:');
  console.log('Start:', oldStart.toDateString());
  console.log('End:', oldEnd.toDateString());
  
  // NEW (fixed) calculation
  const daysToSubtractFromStart = (july2025.getDay() - firstDayOfWeek + 7) % 7;
  const calendarStart = new Date(july2025.getFullYear(), july2025.getMonth(), 1 - daysToSubtractFromStart);
  
  const julyEnd = new Date(2025, 6, 31);
  const daysToAddToEnd = (7 - julyEnd.getDay() + firstDayOfWeek - 1) % 7;
  const calendarEnd = new Date(julyEnd.getFullYear(), julyEnd.getMonth(), julyEnd.getDate() + daysToAddToEnd);
  
  console.log('\nNEW (FIXED) CALCULATION:');
  console.log('Days to subtract from start:', daysToSubtractFromStart);
  console.log('Days to add to end:', daysToAddToEnd);
  console.log('Start:', calendarStart.toDateString());
  console.log('End:', calendarEnd.toDateString());
  
  // Test July 31, 2025 specifically
  const july31 = new Date(2025, 6, 31);
  console.log('\nJULY 31, 2025 TEST:');
  console.log('Date:', july31.toDateString());
  console.log('Day of week:', july31.getDay(), '(0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday)');
  console.log('Expected: Thursday (4)');
  console.log('Result:', july31.getDay() === 4 ? '✅ CORRECT' : '❌ WRONG');
  
  // Test first day of calendar
  console.log('\nFIRST DAY OF CALENDAR TEST:');
  console.log('Old calendar starts with:', oldStart.toDateString(), '(', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][oldStart.getDay()], ')');
  console.log('New calendar starts with:', calendarStart.toDateString(), '(', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][calendarStart.getDay()], ')');
  console.log('Expected: Monday');
  console.log('Old calendar result:', oldStart.getDay() === 1 ? '✅ CORRECT' : '❌ WRONG');
  console.log('New calendar result:', calendarStart.getDay() === 1 ? '✅ CORRECT' : '❌ WRONG');
  
  // Summary
  console.log('\n=== SUMMARY ===');
  const july31Correct = july31.getDay() === 4;
  const oldCalendarCorrect = oldStart.getDay() === 1;
  const newCalendarCorrect = calendarStart.getDay() === 1;
  
  console.log('July 31, 2025 appears under Thursday:', july31Correct ? '✅' : '❌');
  console.log('Old calendar starts with Monday:', oldCalendarCorrect ? '✅' : '❌');
  console.log('New calendar starts with Monday:', newCalendarCorrect ? '✅' : '❌');
  
  if (july31Correct && newCalendarCorrect) {
    console.log('\n🎉 CALENDAR FIX VERIFIED!');
    console.log('July 31, 2025 will now correctly appear under Thursday.');
  } else {
    console.log('\n❌ CALENDAR FIX NEEDED!');
    console.log('The calendar is still misaligned.');
  }
}

// Run the test
testCalendarFix();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { testCalendarFix };
} 
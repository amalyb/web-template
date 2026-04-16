/**
 * Overdue reminder SMS copy — Day 1 through Day 6.
 *
 * Each key is a pure function returning the SMS body for that day.
 * Interpolated variables are passed in; no globals, no side effects.
 *
 * Day 7+ is hard-stopped by sendOverdueReminders.js and lateFees.js.
 */

const overdueMessages = {
  day1: ({ itemTitle, shortUrl }) =>
    `⚠️ Your Sherbrt return for "${itemTitle}" ended yesterday. ` +
    `$15/day late fee may apply until scanned by the carrier. ` +
    `Please ship today using your QR/label: ${shortUrl}. ` +
    `For help: bestie@sherbrt.com.`,

  day2: ({ itemTitle, shortUrl }) =>
    `⚠️ Your Sherbrt return for "${itemTitle}" is now 2 days late. ` +
    `$15/day late fee applies until scanned by the carrier. ` +
    `Please ship today using your QR/label: ${shortUrl}.`,

  day3: ({ itemTitle, shortUrl }) =>
    `⚠️ Your Sherbrt return for "${itemTitle}" is now 3 days late. ` +
    `$15/day late fee applies until scanned by the carrier. ` +
    `Please ship today using your QR/label: ${shortUrl}.`,

  day4: ({ itemTitle, shortUrl }) =>
    `⚠️ Your Sherbrt return for "${itemTitle}" is now 4 days late. ` +
    `$15/day late fee continues and you may be charged the full replacement value. ` +
    `Ship immediately using your QR/label: ${shortUrl}. ` +
    `For help: bestie@sherbrt.com.`,

  day5: ({ itemTitle, shortUrl }) =>
    `⚠️ Your Sherbrt return for "${itemTitle}" is now 5 days late. ` +
    `$15/day late fee continues. ` +
    `Ship immediately using your QR/label: ${shortUrl} to avoid a replacement charge. ` +
    `For help: bestie@sherbrt.com.`,

  day6: ({ itemTitle, shortUrl }) =>
    `🚨 Your Sherbrt return for "${itemTitle}" is now 6 days late. ` +
    `Your borrow is being investigated and the full replacement value of the item may be charged. ` +
    `Please ship it back ASAP using your QR code or label: ${shortUrl}. ` +
    `For help: bestie@sherbrt.com.`,
};

const overdueTags = {
  1: 'overdue_day1_to_borrower',
  2: 'overdue_day2_to_borrower',
  3: 'overdue_day3_to_borrower',
  4: 'overdue_day4_to_borrower',
  5: 'overdue_day5_to_borrower',
  6: 'overdue_day6_to_borrower',
};

function buildOverdueMessage(daysLate, ctx) {
  const fn = overdueMessages[`day${daysLate}`];
  if (!fn) return null;
  return { message: fn(ctx), tag: overdueTags[daysLate] };
}

module.exports = { overdueMessages, overdueTags, buildOverdueMessage };

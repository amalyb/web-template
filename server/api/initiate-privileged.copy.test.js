/**
 * PR-4 (10.0): initiate-privileged 1-SMS copy update.
 *
 * Source-level regression: confirms the operator-approved copy change
 * landed correctly — comma (not period) after the listing title,
 * and the 24h window language replaces the old "Tap to review & accept".
 */

const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, 'initiate-privileged.js');
const src = fs.readFileSync(SCRIPT, 'utf8');

describe('PR-4: 1-SMS copy', () => {
  test('payout clause starts with a comma (not period)', () => {
    // Operator-approved: comma after "${title}" before "You'll earn".
    expect(src).toMatch(/message \+= `, You'll earn \$\{formattedPayout\}/);
    // The old period pattern should be gone.
    expect(src).not.toMatch(/message \+= `\. You'll earn/);
  });

  test('URL clause uses "You have 24hrs to accept"', () => {
    expect(src).toMatch(/message \+= `\. You have 24hrs to accept: \$\{shortUrl\}`/);
  });

  test('old "Tap to review & accept" copy is gone', () => {
    expect(src).not.toMatch(/Tap to review & accept:/);
  });
});

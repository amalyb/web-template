#!/usr/bin/env node

/**
 * Diagnostic Tool for Overdue Flow Validation
 * 
 * Purpose: Verify overdue reminders, late fees, and replacement charges
 * without sending actual SMS or applying real charges.
 * 
 * Usage:
 *   # Basic dry-run for specific transaction
 *   FORCE_NOW="2025-11-11T12:00:00Z" node scripts/diagnose-overdue.js --transaction abc-123-def
 *   
 *   # Test time-travel simulation (5-day sequence)
 *   node scripts/diagnose-overdue.js --transaction abc-123-def --matrix
 *   
 *   # Run against actual data with dry-run
 *   DRY_RUN=1 node scripts/diagnose-overdue.js --transaction abc-123-def
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const getFlexSdk = require('../server/util/getFlexSdk');
const getMarketplaceSdk = require('../server/util/getMarketplaceSdk');
const { applyCharges } = require('../server/lib/lateFees');
const { shortLink } = require('../server/api-util/shortlink');

// Configuration
const TZ = 'America/Los_Angeles';
const LATE_FEE_CENTS = 1500; // $15/day

// Parse arguments
const argv = process.argv.slice(2);
const has = name => argv.includes(name);
const getOpt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const DRY_RUN = process.env.DRY_RUN === '1' || has('--dry-run');
const MATRIX_MODE = has('--matrix');
const TX_ID = getOpt('--transaction', getOpt('--tx', null));
const FORCE_NOW = process.env.FORCE_NOW ? new Date(process.env.FORCE_NOW) : new Date();

// Formatting helpers
function ymd(d) {
  return dayjs(d).tz(TZ).format('YYYY-MM-DD');
}

function computeLateDays(now, returnAt) {
  const n = dayjs(now).tz(TZ).startOf('day');
  const r = dayjs(returnAt).tz(TZ).startOf('day');
  return Math.max(0, n.diff(r, 'day'));
}

function formatCurrency(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// SMS Template Generator
function getSmsTemplate(daysLate, shortUrl, replacementCents) {
  const templates = {
    1: {
      message: `⚠️ Due yesterday. Please ship today to avoid $15/day late fees. QR: ${shortUrl}`,
      tag: 'overdue_day1_to_borrower'
    },
    2: {
      message: `🚫 2 days late. $15/day fees are adding up. Ship now: ${shortUrl}`,
      tag: 'overdue_day2_to_borrower'
    },
    3: {
      message: `⏰ 3 days late. Fees continue. Ship today to avoid full replacement.`,
      tag: 'overdue_day3_to_borrower'
    },
    4: {
      message: `⚠️ 4 days late. Ship immediately to prevent replacement charges.`,
      tag: 'overdue_day4_to_borrower'
    },
    5: {
      message: `🚫 5 days late. You may be charged full replacement (${formatCurrency(replacementCents)}). Avoid this by shipping today: ${shortUrl}`,
      tag: 'overdue_day5_to_borrower'
    }
  };
  
  return templates[daysLate] || templates[5]; // Default to Day 5 for 6+ days
}

// Main diagnostic function
async function diagnoseTransaction(txId, now) {
  console.log('\n' + '═'.repeat(70));
  console.log(`📋 TRANSACTION DIAGNOSTIC: ${txId}`);
  console.log('═'.repeat(70));
  console.log(`⏰ Simulation time: ${now.toISOString()} (${ymd(now)})`);
  console.log(`🔍 Mode: ${DRY_RUN ? 'DRY_RUN (safe)' : 'LIVE (will charge!)'}`);
  console.log('');
  
  try {
    // Initialize SDKs
    const integSdk = getFlexSdk();
    const readSdk = getMarketplaceSdk();
    
    // Load transaction with listing
    console.log('📡 Fetching transaction data...');
    const response = await readSdk.transactions.show({
      id: txId,
      include: ['listing', 'customer']
    });
    
    const tx = response.data.data;
    const included = response.data.included || [];
    
    // Extract data
    const protectedData = tx.attributes?.protectedData || {};
    const returnData = protectedData.return || {};
    const returnDueAt = returnData.dueAt || tx.attributes?.booking?.end;
    
    if (!returnDueAt) {
      console.error('❌ No return due date found!');
      return;
    }
    
    console.log(`📅 Return due: ${ymd(returnDueAt)}`);
    
    // Calculate days late
    const lateDays = computeLateDays(now, returnDueAt);
    console.log(`📊 Days late: ${lateDays}`);
    
    // Check carrier status
    const firstScanAt = returnData.firstScanAt;
    const status = returnData.status;
    const isScanned = !!firstScanAt || ['accepted', 'in_transit'].includes(status?.toLowerCase());
    
    console.log(`📦 Carrier status: ${status || 'N/A'}`);
    console.log(`✓  First scan: ${firstScanAt || 'Not yet scanned'}`);
    console.log(`✓  Is scanned: ${isScanned ? '✅ YES' : '❌ NO'}`);
    console.log('');
    
    // Business logic decision tree
    console.log('─'.repeat(70));
    console.log('🧠 BUSINESS LOGIC EVALUATION');
    console.log('─'.repeat(70));
    
    if (lateDays < 1) {
      console.log('✅ Not overdue yet - no action needed');
      console.log(`   (Return due in ${-lateDays} days)`);
      return;
    }
    
    if (isScanned) {
      console.log('✅ Package scanned by carrier - no charges apply');
      console.log(`   (Scanned at: ${firstScanAt || status})`);
      return;
    }
    
    console.log(`⚠️  OVERDUE: ${lateDays} day(s) late, no carrier scan`);
    console.log('');
    
    // Idempotency check
    const lastLateFeeDayCharged = returnData.lastLateFeeDayCharged;
    const replacementCharged = returnData.replacementCharged === true;
    const lastNotifiedDay = returnData.overdue?.lastNotifiedDay;
    
    console.log('─'.repeat(70));
    console.log('🔒 IDEMPOTENCY STATUS');
    console.log('─'.repeat(70));
    console.log(`   Last fee day charged: ${lastLateFeeDayCharged || 'Never'}`);
    console.log(`   Replacement charged:  ${replacementCharged ? 'YES ✅' : 'NO ❌'}`);
    console.log(`   Last notified day:    ${lastNotifiedDay || 'Never'}`);
    console.log('');
    
    // Get listing data for replacement value
    const listingRef = tx.relationships?.listing?.data;
    const listingKey = listingRef ? `${listingRef.type}/${listingRef.id?.uuid || listingRef.id}` : null;
    const listing = listingKey ? included.find(i => 
      `${i.type}/${i.id.uuid || i.id}` === listingKey
    ) : null;
    
    const publicData = listing?.attributes?.publicData || {};
    const replacementCents = publicData.replacementValueCents || 
                            publicData.retailPriceCents || 
                            listing?.attributes?.price?.amount || 
                            5000; // fallback $50
    
    // Get borrower phone
    const customerRef = tx.relationships?.customer?.data;
    const customerKey = customerRef ? `${customerRef.type}/${customerRef.id?.uuid || customerRef.id}` : null;
    const customer = customerKey ? included.find(i => 
      `${i.type}/${i.id.uuid || i.id}` === customerKey
    ) : null;
    
    const borrowerPhone = customer?.attributes?.profile?.protectedData?.phone ||
                         customer?.attributes?.profile?.protectedData?.phoneNumber ||
                         '+1XXXXXXXXXX';
    
    // Get return label URL
    const returnLabelUrl = returnData.label?.url ||
                          protectedData.returnLabelUrl ||
                          `https://sherbrt.com/return/${txId}`;
    
    const shortUrl = await shortLink(returnLabelUrl).catch(() => returnLabelUrl);
    
    // SMS Preview
    console.log('─'.repeat(70));
    console.log('📱 SMS THAT WOULD BE SENT');
    console.log('─'.repeat(70));
    
    const smsTemplate = getSmsTemplate(lateDays, shortUrl, replacementCents);
    
    console.log(`   To:      ${borrowerPhone}`);
    console.log(`   Tag:     ${smsTemplate.tag}`);
    console.log(`   Message: ${smsTemplate.message}`);
    
    if (lastNotifiedDay === lateDays) {
      console.log(`   ⚠️  SKIP: Already notified for day ${lateDays}`);
    } else {
      console.log(`   ✅ SEND: New notification for day ${lateDays}`);
    }
    console.log('');
    
    // Charge Preview
    console.log('─'.repeat(70));
    console.log('💳 CHARGES THAT WOULD BE APPLIED');
    console.log('─'.repeat(70));
    
    const todayYmd = ymd(now);
    let willChargeFee = false;
    let willChargeReplacement = false;
    
    // Late fee logic
    if (lateDays >= 1 && lastLateFeeDayCharged !== todayYmd) {
      willChargeFee = true;
      console.log(`   ✅ Late Fee: ${formatCurrency(LATE_FEE_CENTS)} (Day ${lateDays})`);
      console.log(`      Reason: Not yet charged for ${todayYmd}`);
    } else if (lastLateFeeDayCharged === todayYmd) {
      console.log(`   ❌ Late Fee: ${formatCurrency(LATE_FEE_CENTS)} (Day ${lateDays})`);
      console.log(`      SKIP: Already charged today (${todayYmd})`);
    }
    
    // Replacement charge logic
    if (lateDays >= 5 && !replacementCharged) {
      willChargeReplacement = true;
      console.log(`   ✅ Replacement: ${formatCurrency(replacementCents)}`);
      console.log(`      Reason: Day ${lateDays}, no carrier scan, not yet charged`);
    } else if (replacementCharged) {
      console.log(`   ❌ Replacement: ${formatCurrency(replacementCents)}`);
      console.log(`      SKIP: Already charged previously`);
    } else if (lateDays < 5) {
      console.log(`   ⏳ Replacement: ${formatCurrency(replacementCents)}`);
      console.log(`      PENDING: Will charge on Day 5 (${5 - lateDays} days from now)`);
    }
    
    const totalCharge = (willChargeFee ? LATE_FEE_CENTS : 0) + 
                       (willChargeReplacement ? replacementCents : 0);
    
    console.log('');
    console.log(`   💰 TOTAL TODAY: ${formatCurrency(totalCharge)}`);
    console.log('');
    
    // Call actual applyCharges if not dry-run
    if (!DRY_RUN && (willChargeFee || willChargeReplacement)) {
      console.log('─'.repeat(70));
      console.log('⚡ EXECUTING CHARGES (LIVE MODE)');
      console.log('─'.repeat(70));
      
      try {
        const result = await applyCharges({
          sdkInstance: integSdk,
          txId: txId,
          now: now
        });
        
        console.log('   Status:', result.charged ? '✅ SUCCESS' : '⚠️  NO CHARGE');
        console.log('   Reason:', result.reason || 'Charges applied');
        if (result.items) {
          console.log('   Items:', result.items.join(', '));
        }
        if (result.amounts) {
          result.amounts.forEach(a => {
            console.log(`   - ${a.code}: ${formatCurrency(a.cents)}`);
          });
        }
      } catch (error) {
        console.error('   ❌ CHARGE FAILED:', error.message);
      }
      console.log('');
    }
    
    // Summary
    console.log('═'.repeat(70));
    console.log('📊 DIAGNOSTIC SUMMARY');
    console.log('═'.repeat(70));
    console.log(`   Transaction:     ${txId}`);
    console.log(`   Days Late:       ${lateDays}`);
    console.log(`   Carrier Scanned: ${isScanned ? 'Yes' : 'No'}`);
    console.log(`   Will Send SMS:   ${lastNotifiedDay !== lateDays ? 'Yes' : 'No (already sent)'}`);
    console.log(`   Will Charge Fee: ${willChargeFee ? 'Yes' : 'No'}`);
    console.log(`   Will Charge Rep: ${willChargeReplacement ? 'Yes' : 'No'}`);
    console.log(`   Total Charge:    ${formatCurrency(totalCharge)}`);
    console.log('═'.repeat(70));
    console.log('');
    
  } catch (error) {
    console.error('❌ Diagnostic failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

// Matrix mode: Run 5-day simulation
async function runMatrix(txId) {
  console.log('\n' + '═'.repeat(70));
  console.log('🔬 MATRIX MODE: 5-DAY OVERDUE SIMULATION');
  console.log('═'.repeat(70));
  console.log(`Transaction: ${txId}`);
  console.log('Testing escalation sequence: Day 1 → Day 5');
  console.log('');
  
  // Get transaction to find return due date
  const readSdk = getMarketplaceSdk();
  const response = await readSdk.transactions.show({
    id: txId,
    include: ['listing']
  });
  
  const tx = response.data.data;
  const protectedData = tx.attributes?.protectedData || {};
  const returnData = protectedData.return || {};
  const returnDueAt = returnData.dueAt || tx.attributes?.booking?.end;
  
  if (!returnDueAt) {
    console.error('❌ No return due date found!');
    return;
  }
  
  const returnDate = dayjs(returnDueAt).tz(TZ);
  console.log(`📅 Return due: ${ymd(returnDate)}`);
  console.log('');
  
  // Run simulation for each day
  for (let day = 1; day <= 5; day++) {
    const simulatedNow = returnDate.add(day, 'day').hour(12).toDate();
    console.log(`\n${'▼'.repeat(35)}`);
    console.log(`   DAY ${day} LATE: ${ymd(simulatedNow)}`);
    console.log(`${'▼'.repeat(35)}\n`);
    
    await diagnoseTransaction(txId, simulatedNow);
    
    if (day < 5) {
      console.log('\n⏭️  Advancing to next day...\n');
    }
  }
  
  console.log('\n' + '═'.repeat(70));
  console.log('✅ MATRIX SIMULATION COMPLETE');
  console.log('═'.repeat(70));
  console.log('');
}

// Main execution
async function main() {
  console.log('\n🔍 Overdue Flow Diagnostic Tool\n');
  
  if (!TX_ID) {
    console.error('❌ Error: Transaction ID required');
    console.error('\nUsage:');
    console.error('  node scripts/diagnose-overdue.js --transaction <tx-id>');
    console.error('  node scripts/diagnose-overdue.js --tx <tx-id> --matrix');
    console.error('\nEnvironment:');
    console.error('  FORCE_NOW="2025-11-11T12:00:00Z" - Set simulation time');
    console.error('  DRY_RUN=1 - Prevent actual charges (recommended)');
    process.exit(1);
  }
  
  try {
    if (MATRIX_MODE) {
      await runMatrix(TX_ID);
    } else {
      await diagnoseTransaction(TX_ID, FORCE_NOW);
    }
    
    console.log('✅ Diagnostic completed successfully\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Diagnostic failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { diagnoseTransaction, runMatrix };


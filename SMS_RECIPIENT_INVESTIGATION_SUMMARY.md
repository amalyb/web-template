# SMS Recipient Investigation Summary

## Issue Description
The "New Sherbrt booking request" SMS is being sent to the borrower's phone number instead of the lender's when a borrower makes a booking request.

## Key Facts
- **Provider = Lender** (the person who owns the listing)
- **Customer = Borrower** (the person making the booking request)
- This SMS should notify the **lender** about a new booking request
- The issue occurs in the Render test environment

## Investigation Implementation

### 1. Critical Logging Added
We've added comprehensive investigation logging to three key files:

#### `server/api/transition-privileged.js`
- **Function identification**: Logs when this function sends SMS
- **Provider ID verification**: Confirms the provider ID from listing relationships
- **Transaction relationship check**: Verifies provider ID matches transaction provider (not customer)
- **Phone number source**: Shows which phone number field is used
- **Critical markers**: `[CRITICAL] === TRANSITION-PRIVILEGED SMS SEND ===`

#### `server/api/initiate-privileged.js`
- **Function identification**: Logs when this function sends SMS
- **Transaction data**: Shows transaction customer vs provider IDs
- **Provider data verification**: Confirms provider data matches transaction provider
- **Phone number fallback**: Shows the fallback logic for phone number extraction
- **Critical markers**: `[CRITICAL] === INITIATE-PRIVILEGED SMS SEND ===`

#### `server/api-util/sendSMS.js`
- **Caller identification**: Uses stack trace to identify which function called sendSMS
- **Final recipient**: Shows the exact phone number sent to Twilio
- **Message content**: Confirms the SMS message being sent
- **Critical markers**: `[CRITICAL] === SEND SMS CALLED ===`

### 2. What the Logs Will Reveal

#### A. Which Function is Sending the SMS
Look for these log patterns to identify the source:

```
🔍 [CRITICAL] === TRANSITION-PRIVILEGED SMS SEND ===
🔍 [CRITICAL] Function: transition-privileged.js
```

OR

```
🔍 [CRITICAL] === INITIATE-PRIVILEGED SMS SEND ===
🔍 [CRITICAL] Function: initiate-privileged.js
```

#### B. User ID Targeting Verification
Check if the correct user is being targeted:

```
🔍 [CRITICAL] Provider ID from listing: [PROVIDER_ID]
🔍 [CRITICAL] Transaction customer ID: [CUSTOMER_ID]
🔍 [CRITICAL] Transaction provider ID: [PROVIDER_ID]
🔍 [CRITICAL] Provider ID matches transaction provider? true/false
🔍 [CRITICAL] Provider ID matches transaction customer? true/false
```

**Expected**: 
- Provider ID should match Transaction Provider ID = `true`
- Provider ID should NOT match Transaction Customer ID = `false`

#### C. Phone Number Source
Verify where the phone number comes from:

```
🔍 [CRITICAL] Phone source - publicData: [PHONE_OR_NULL]
🔍 [CRITICAL] Phone source - protectedData: [PHONE_OR_NULL]
🔍 [CRITICAL] Final recipient phone: [FINAL_PHONE]
```

#### D. SMS Delivery Confirmation
Confirm the final recipient in the sendSMS function:

```
📱 [CRITICAL] === SEND SMS CALLED ===
📱 [CRITICAL] Caller function: [FUNCTION_NAME]
📱 [CRITICAL] Recipient phone: [PHONE_NUMBER]
📱 [CRITICAL] SMS message: [MESSAGE]
```

## How to Test

### 1. Deploy to Render Test Environment
The critical investigation logging has been pushed to the `test` branch.

### 2. Run Test Transaction
1. Create a test listing as a lender (Account A)
2. Place a borrow request as a borrower (Account B)
3. Monitor the logs for the critical investigation entries

### 3. Expected Log Sequence

#### ✅ Correct Behavior (SMS to Lender)
```
🔍 [CRITICAL] === TRANSITION-PRIVILEGED SMS SEND ===
🔍 [CRITICAL] Provider ID from listing: lender-user-id
🔍 [CRITICAL] Transaction customer ID: borrower-user-id
🔍 [CRITICAL] Transaction provider ID: lender-user-id
🔍 [CRITICAL] Provider ID matches transaction provider? true
🔍 [CRITICAL] Provider ID matches transaction customer? false
🔍 [CRITICAL] Final recipient phone: +1234567890

📱 [CRITICAL] === SEND SMS CALLED ===
📱 [CRITICAL] Caller function: transition-privileged.js
📱 [CRITICAL] Recipient phone: +1234567890
```

#### ❌ Incorrect Behavior (SMS to Borrower)
```
🔍 [CRITICAL] === INITIATE-PRIVILEGED SMS SEND ===
🔍 [CRITICAL] Provider ID from listing: borrower-user-id  # WRONG!
🔍 [CRITICAL] Transaction customer ID: borrower-user-id
🔍 [CRITICAL] Transaction provider ID: lender-user-id
🔍 [CRITICAL] Provider ID matches transaction provider? false  # WRONG!
🔍 [CRITICAL] Provider ID matches transaction customer? true   # WRONG!

📱 [CRITICAL] === SEND SMS CALLED ===
📱 [CRITICAL] Caller function: initiate-privileged.js
📱 [CRITICAL] Recipient phone: +0987654321  # Borrower's phone
```

## Potential Root Causes

### 1. Wrong User ID Resolution
- **Issue**: Listing relationships point to the wrong user
- **Evidence**: Provider ID matches customer ID instead of provider ID
- **Fix**: Check listing creation process and author assignment

### 2. Function Execution Order
- **Issue**: Both functions execute, but one uses wrong data
- **Evidence**: Multiple SMS send attempts with different recipients
- **Fix**: Ensure only one function handles SMS for booking requests

### 3. Data Access Permissions
- **Issue**: Cannot read provider profile, falls back to wrong data
- **Evidence**: Permission errors in provider profile fetch
- **Fix**: Check user permissions and SDK authentication

### 4. Phone Number Field Mismatch
- **Issue**: Provider profile has phone number under different field name
- **Evidence**: Phone number exists but not in expected field
- **Fix**: Update field name or add fallback logic

## Investigation Steps

### Phase 1: Deploy and Test
1. Deploy the test branch to Render test environment
2. Run a test booking request transaction
3. Collect all logs with `[CRITICAL]` markers

### Phase 2: Analyze Logs
1. Identify which function(s) are sending SMS
2. Verify user ID targeting (provider vs customer)
3. Check phone number source and fallback logic
4. Confirm final recipient in sendSMS function

### Phase 3: Implement Fix
1. Based on log evidence, identify the root cause
2. Implement targeted fix for the specific issue
3. Test the fix in Render test environment
4. Remove investigation logging after confirmation

## Files Modified
- `server/api/transition-privileged.js` - Added critical investigation logging
- `server/api/initiate-privileged.js` - Added critical investigation logging
- `server/api-util/sendSMS.js` - Added caller identification and critical logging

## Commit Details
- **Branch**: `test`
- **Latest Commit**: `ce456fcb2` - "Add critical investigation logging to identify SMS recipient issue root cause"
- **Status**: Pushed to remote

## Next Steps
1. Deploy test branch to Render test environment
2. Run test transaction and collect logs
3. Analyze logs to identify root cause
4. Implement targeted fix
5. Test fix and remove investigation logging
6. Deploy to production

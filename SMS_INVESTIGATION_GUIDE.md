# SMS Recipient Investigation Guide

## Issue Description
The "New Sherbrt booking request" SMS is being received by the borrower instead of the lender in the Render test environment.

## What We've Implemented

### 1. Comprehensive Logging Added
We've added detailed investigation logging to three key files:

#### `server/api/transition-privileged.js`
- **Provider ID Detection**: Logs the provider ID extracted from listing relationships
- **Profile Fetch**: Logs the complete provider profile response structure
- **Phone Number Extraction**: Logs all available phone number fields from protectedData and publicData
- **Transaction Details**: Logs transaction ID, customer ID, and provider ID for verification
- **SMS Details**: Logs the final recipient phone number and message before sending

#### `server/api/initiate-privileged.js`
- **Transaction Data**: Logs transaction protectedData and providerPhone field
- **Provider Profile**: Logs provider profile structure and phone number extraction
- **Transaction Relationships**: Logs customer vs provider IDs for verification
- **SMS Details**: Logs recipient phone and message before sending

#### `server/api-util/sendSMS.js`
- **Phone Number Formatting**: Logs original and formatted phone numbers
- **Twilio API Call**: Logs the final recipient and message sent to Twilio
- **Message Confirmation**: Logs Twilio message SID for tracking

### 2. Key Investigation Points

#### A. Verify Recipient Targeting
Look for these log entries to confirm we're targeting the right party:

```
🔍 [INVESTIGATION] Provider ID from listing: [PROVIDER_ID]
🔍 [INVESTIGATION] Transaction customer ID: [CUSTOMER_ID]
🔍 [INVESTIGATION] Transaction provider ID: [PROVIDER_ID]
```

**Expected**: Provider ID should match Transaction Provider ID, NOT Transaction Customer ID.

#### B. Phone Number Source
Check which phone number field is being used:

```
🔍 [INVESTIGATION] protectedData.phoneNumber: [PHONE_OR_NULL]
🔍 [INVESTIGATION] publicData.phoneNumber: [PHONE_OR_NULL]
🔍 [INVESTIGATION] Final lenderPhone value: [FINAL_PHONE]
```

**Expected**: Should use the provider's (lender's) phone number, not the customer's.

#### C. SMS Delivery Confirmation
Verify the final recipient:

```
📱 [INVESTIGATION] Sending SMS to [PHONE_NUMBER] (original: [ORIGINAL_PHONE])
📤 [INVESTIGATION] Sent SMS to [PHONE_NUMBER]: [MESSAGE]
```

## How to Test

### 1. Deploy to Render Test Environment
The investigation logging has been pushed to the `test` branch. Deploy this to your Render test environment.

### 2. Run a Test Transaction
1. Create a test listing as a lender
2. Place a borrow request as a borrower
3. Monitor the logs for the investigation entries

### 3. Look for These Log Patterns

#### ✅ Correct Behavior (SMS to Lender)
```
🔍 [INVESTIGATION] Provider ID from listing: lender-user-id
🔍 [INVESTIGATION] Transaction customer ID: borrower-user-id
🔍 [INVESTIGATION] Transaction provider ID: lender-user-id
🔍 [INVESTIGATION] Final lenderPhone value: +1234567890
📱 [INVESTIGATION] Sending SMS to +1234567890
```

#### ❌ Incorrect Behavior (SMS to Borrower)
```
🔍 [INVESTIGATION] Provider ID from listing: borrower-user-id  # WRONG!
🔍 [INVESTIGATION] Transaction customer ID: borrower-user-id
🔍 [INVESTIGATION] Transaction provider ID: lender-user-id
🔍 [INVESTIGATION] Final lenderPhone value: +0987654321  # Borrower's phone
📱 [INVESTIGATION] Sending SMS to +0987654321  # WRONG!
```

## Potential Issues to Look For

### 1. Data Access Permissions
Look for permission errors:
```
❌ [INVESTIGATION] Provider profile fetch FAILED: 403
🚫 [INVESTIGATION] PERMISSION DENIED - Cannot read user data
```

### 2. Wrong User ID Resolution
Check if the listing relationships are pointing to the wrong user:
```
🔍 [INVESTIGATION] Listing relationships: {"author": {"data": {"id": "WRONG_USER_ID"}}}
```

### 3. Phone Number Field Mismatch
Verify the correct phone number field is being used:
```
🔍 [INVESTIGATION] protectedData.phoneNumber: null
🔍 [INVESTIGATION] publicData.phoneNumber: +1234567890
```

## Next Steps After Investigation

### 1. If Wrong User ID is Resolved
The issue is in the listing relationship resolution. Check:
- How `listing.relationships.author.data.id` is populated
- Whether the listing creation process sets the correct author

### 2. If Wrong Phone Number is Used
The issue is in phone number extraction. Check:
- Whether the provider profile has the correct phone number
- If the phone number field names are consistent

### 3. If Permissions Block Access
The issue is data access. Check:
- User permissions for reading other users' profiles
- Whether the SDK has the right authentication context

## Files Modified
- `server/api/transition-privileged.js` - Added investigation logging
- `server/api/initiate-privileged.js` - Added investigation logging  
- `server/api-util/sendSMS.js` - Added investigation logging

## Commit Details
- **Branch**: `test`
- **Commit**: `8d07d4a34` - "Add comprehensive investigation logging for SMS recipient issue"
- **Status**: Pushed to remote

## After Fix Confirmation
Once the issue is identified and fixed:
1. Remove all `[INVESTIGATION]` logging
2. Keep only essential operational logging
3. Test the fix in the Render test environment
4. Deploy to production

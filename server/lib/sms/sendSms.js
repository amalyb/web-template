// server/lib/sms/sendSms.js
/**
 * SMS Sending Wrapper
 * 
 * Re-exports the sendSMS function from api-util/sendSMS.js
 * with a cleaner, more discoverable path for imports.
 */

const sendSMS = require('../../api-util/sendSMS');

module.exports = { sendSMS };


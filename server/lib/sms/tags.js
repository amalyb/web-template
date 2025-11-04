// server/lib/sms/tags.js
/**
 * SMS Tag Constants
 *
 * Centralized constants for SMS tags used throughout the application.
 * These tags are used for:
 * - Twilio status callbacks (tracking delivery receipts)
 * - Idempotency (preventing duplicate sends)
 * - Metrics and logging
 * - Analytics and reporting
 */

const SMS_TAGS = {
  // Step 3: Label created → lender
  LABEL_READY_TO_LENDER: 'label_ready_to_lender',

  // Step 4: Item shipped (first scan) → borrower
  ITEM_SHIPPED_TO_BORROWER: 'item_shipped_to_borrower',

  // Step 6: Item delivered → borrower
  DELIVERY_TO_BORROWER: 'delivery_to_borrower',

  // Step 10: Return in transit → lender
  RETURN_FIRST_SCAN_TO_LENDER: 'return_first_scan_to_lender',

  // Step 11: Return delivered → lender (optional)
  RETURN_DELIVERED_TO_LENDER: 'return_delivered_to_lender',

  // Reminder flows
  SHIP_BY_REMINDER_TO_LENDER: 'ship_by_reminder_to_lender',
  RETURN_REMINDER_TO_BORROWER: 'return_reminder_to_borrower',
  OVERDUE_REMINDER: 'overdue_reminder',

  // Checkout/booking
  BOOKING_CONFIRMATION: 'booking_confirmation',

  // QR code specific
  QR_CODE_TO_LENDER: 'qr_code_to_lender',
};

module.exports = { SMS_TAGS };

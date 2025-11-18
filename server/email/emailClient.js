/**
 * Email Client for Transactional Emails
 * 
 * Uses SendGrid to send transactional emails.
 * In dev/test, missing config logs warnings but doesn't crash.
 */

const sgMail = require('@sendgrid/mail');

const { SENDGRID_API_KEY, EMAIL_FROM_ADDRESS } = process.env;

// Initialize SendGrid API key
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
} else {
  console.warn('[email] SENDGRID_API_KEY is not set – emails will be logged but not sent.');
}

// Log initialization state
console.log('[emailClient] init', {
  hasKey: !!SENDGRID_API_KEY,
  from: EMAIL_FROM_ADDRESS,
});

/**
 * Send a transactional email
 * 
 * @param {Object} params
 * @param {string} params.to - Recipient email address
 * @param {string} params.subject - Email subject
 * @param {string} params.text - Plain text version of email
 * @param {string} params.html - HTML version of email (optional, falls back to text)
 */
async function sendTransactionalEmail({ to, subject, text, html }) {
  console.log('[emailClient] sendTransactionalEmail', { to, subject });
  
  if (!SENDGRID_API_KEY || !EMAIL_FROM_ADDRESS) {
    console.warn('[email] Missing config, skipping send', { 
      to, 
      subject,
      hasApiKey: !!SENDGRID_API_KEY,
      hasFromAddress: !!EMAIL_FROM_ADDRESS
    });
    return;
  }

  const msg = {
    to,
    from: EMAIL_FROM_ADDRESS,
    subject,
    text,
    html: html || text,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ [email] Sent: ${subject} to ${to}`);
  } catch (error) {
    console.error(`❌ [email] Failed to send: ${subject} to ${to}`, {
      error: error.message,
      response: error.response?.body
    });
    throw error;
  }
}

module.exports = {
  sendTransactionalEmail,
};


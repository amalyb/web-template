/**
 * Lender Outbound Label Email Template
 * 
 * Sends an outbound shipping label to the lender (provider) when the outbound label is created.
 * Matches Sharetribe email styling as closely as possible.
 */

/**
 * Format date for email display
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string (e.g., "Mon, Jan 15")
 */
function formatDate(date) {
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(date));
  } catch (e) {
    return '';
  }
}

/**
 * Generate lender outbound label email content
 * 
 * @param {Object} params
 * @param {string} params.firstName - Lender's first name
 * @param {string} params.listingTitle - Title of the listing/item
 * @param {Date|string} params.startDate - Booking start date
 * @param {Date|string} params.endDate - Booking end date
 * @param {string} params.outboundLabelUrl - Short URL or direct URL to outbound label
 * @param {string} params.orderUrl - Link to Sherbrt order page
 * @param {string|null} params.qrUrl - QR code URL (optional)
 * @returns {Object} { subject, text, html }
 */
function lenderOutboundLabelEmail({
  firstName,
  listingTitle,
  startDate,
  endDate,
  outboundLabelUrl,
  orderUrl,
  qrUrl,
}) {
  const name = firstName || 'there';
  const start = startDate ? formatDate(startDate) : null;
  const end = endDate ? formatDate(endDate) : null;

  const subject = `Your Sherbrt shipping label for ${listingTitle}`;

  // Plain text version
  const lines = [
    `Hi ${name},`,
    '',
    `Here's your shipping label to send your item to the borrower.`,
    start && end ? `The booking is from ${start} to ${end}.` : null,
    '',
    outboundLabelUrl ? `Download your shipping label: ${outboundLabelUrl}` : null,
    qrUrl ? `QR code: ${qrUrl}` : null,
    orderUrl ? `View your order details: ${orderUrl}` : null,
    '',
    'Love,',
    'Sherbrt 🍧💕',
  ].filter(Boolean);

  const text = lines.join('\n');

  // HTML version - matches Sharetribe styling
  const qrImageHtml = qrUrl
    ? `
      <table style="padding:16px 0 0" align="center" border="0" cellPadding="0" cellSpacing="0" role="presentation" width="100%">
        <tbody>
          <tr>
            <td style="text-align:center;">
              <p style="font-size:16px;line-height:1.4;margin:16px 0;color:#484848">Scan this QR code at the carrier location:</p>
              <img src="${qrUrl}" alt="Shipping QR Code" style="max-width:300px;height:auto;margin:16px 0;border:1px solid #eaeaea;border-radius:4px;" />
              <p style="font-size:14px;line-height:1.5;margin:8px 0;color:#484848">Or use this link: <a target="_blank" style="color:#007DF2;text-decoration:none" href="${qrUrl}">${qrUrl}</a></p>
            </td>
          </tr>
        </tbody>
      </table>
    `
    : '';

  const buttonHtml = outboundLabelUrl
    ? `
      <table style="padding:16px 0 0" align="center" border="0" cellPadding="0" cellSpacing="0" role="presentation" width="100%">
        <tbody>
          <tr>
            <td>
              <a href="${outboundLabelUrl}" target="_blank" style="color:#000000;background-color:#fecaca;border-radius:4px;font-size:15px;text-decoration:none;text-align:center;display:inline-block;min-width:210px;padding:16px 32px;max-width:100%;line-height:120%;font-weight:600;">
                Download shipping label
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    `
    : '';

  const html = `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html lang="en">
      <head>
        <meta http-equiv="Content-Type" content="text/html charset=UTF-8" />
      </head>
      <table style="background-color:#FFF;margin:0 auto;padding:24px 12px 0;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif" align="center" border="0" cellPadding="0" cellSpacing="0" role="presentation" width="100%">
        <tbody>
          <tr>
            <td>
              <table align="center" role="presentation" cellSpacing="0" cellPadding="0" border="0" width="100%" style="max-width:600px;margin:0 auto">
                <tr style="width:100%">
                  <td>
                    <h1 style="color:#484848;font-size:26px;line-height:1.3;font-weight:700;margin-bottom:16px;">
                      Your shipping label for ${listingTitle}
                    </h1>
                    <p style="font-size:16px;line-height:1.4;margin:16px 0;color:#484848">Hi ${name},</p>
                    <p style="font-size:16px;line-height:1.4;margin:16px 0;color:#484848">Here's your shipping label to send your item to the borrower.</p>
                    ${start && end
                      ? `<p style="font-size:16px;line-height:1.4;margin:16px 0;color:#484848">The booking is from <strong>${start}</strong> to <strong>${end}</strong>.</p>`
                      : ''}
                    ${qrImageHtml}
                    ${buttonHtml}
                    ${
                      outboundLabelUrl && !qrUrl
                        ? `<p style="font-size:14px;line-height:1.5;margin:16px 0;color:#484848">Can't click the button? Here's a link for your convenience: <a target="_blank" style="color:#007DF2;text-decoration:none" href="${outboundLabelUrl}">${outboundLabelUrl}</a></p>`
                        : ''
                    }
                    ${
                      orderUrl
                        ? `<p style="font-size:16px;line-height:1.4;margin:16px 0;color:#484848">You can always <a target="_blank" style="color:#007DF2;text-decoration:none" href="${orderUrl}">view your order details on Sherbrt</a>.</p>`
                        : ''
                    }
                    <p style="font-size:16px;line-height:1.4;margin:16px 0;color:#484848">Love,<br/>Sherbrt 🍧💕</p>
                    <div>
                      <hr style="width:100%;border:none;border-top:1px solid #eaeaea;border-color:#E1E1E1;margin:20px 0" />
                      <p style="font-size:12px;line-height:15px;margin:0 auto;color:#b7b7b7;text-align:left;margin-bottom:50px">You're a member of Sherbrt. If you no longer want to receive these emails, please contact the Sherbrt team.</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    </html>
  `;

  return { subject, text, html };
}

module.exports = lenderOutboundLabelEmail;


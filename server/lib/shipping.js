// server/lib/shipping.js
const getInt = (k, d) => (Number.isFinite(+process.env[k]) ? +process.env[k] : d);

function getBookingStartISO(tx) {
  const pd = tx?.attributes?.protectedData || tx?.protectedData || {};
  return pd.bookingStart || pd.startDate || null;
}

function computeShipByDate(tx, opts = {}) {
  const leadDays = opts.leadDays ?? getInt('SHIP_LEAD_DAYS', 2);
  const startISO = opts.bookingStartISO ?? getBookingStartISO(tx);
  if (!startISO) return null;

  const start = new Date(startISO);
  if (isNaN(start)) return null;

  const shipBy = new Date(start);
  shipBy.setUTCDate(shipBy.getUTCDate() - leadDays);

  return shipBy;
}

function formatShipBy(date, locale = 'en-US') {
  if (!date) return null;
  const month = date.toLocaleString(locale, { month: 'short' });
  const d = date.getUTCDate();
  const ord = (n)=>{ const s=["th","st","nd","rd"], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
  return `${month} ${ord(d)}`;
}

module.exports = { computeShipByDate, formatShipBy, getBookingStartISO };

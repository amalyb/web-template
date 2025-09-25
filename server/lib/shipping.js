// server/lib/shipping.js
function getBookingStartISO(tx) {
  // Try a bunch of shapes defensively, including protectedData fallbacks
  return (
    tx?.attributes?.booking?.attributes?.start ||
    tx?.booking?.attributes?.start ||
    tx?.attributes?.protectedData?.bookingStartISO ||
    tx?.protectedData?.bookingStartISO ||
    null
  );
}

function computeShipByDate({ bookingStartISO, leadDays = 2 }) {
  const startISO = bookingStartISO;
  if (!startISO) return null;

  const start = new Date(startISO);
  if (Number.isNaN(+start)) return null;

  // normalize to local midnight
  start.setHours(0, 0, 0, 0);

  const shipBy = new Date(start);
  shipBy.setDate(shipBy.getDate() - leadDays);
  return shipBy;
}

function formatShipBy(date) {
  if (!date) return null;
  try {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

module.exports = { computeShipByDate, formatShipBy, getBookingStartISO };
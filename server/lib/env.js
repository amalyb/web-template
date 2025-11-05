/**
 * Centralized environment variable helpers for shipping and SMS configuration
 * 
 * This module provides a single source of truth for reading and parsing
 * environment variables related to shipping carriers, link modes, and shortlinks.
 */

// ---- Carrier Configuration ----

/** Primary shipping carrier (default: UPS) */
const SHIP_CARRIER_PRIMARY = process.env.SHIP_CARRIER_PRIMARY || 'UPS';

/** Fallback shipping carrier (default: USPS) */
const SHIP_CARRIER_FALLBACK = process.env.SHIP_CARRIER_FALLBACK || 'USPS';

// ---- Link Mode Configuration ----

/**
 * UPS link mode preferences (comma-separated)
 * Options: 'qr', 'label', 'tracking'
 * Default: 'qr,label' (prefer QR, fallback to label)
 */
const UPS_LINK_MODE = (process.env.UPS_LINK_MODE || 'qr,label')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/**
 * USPS link mode preferences (comma-separated)
 * Options: 'qr', 'label', 'tracking'
 * Default: 'label' (set to 'qr,label' to prefer QR codes when available)
 */
const USPS_LINK_MODE = (process.env.USPS_LINK_MODE || 'label')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/**
 * Allow tracking URLs in initial lender shipment SMS
 * Default: false (only QR/label allowed for initial lender SMS)
 */
const ALLOW_TRACKING_IN_LENDER_SHIP =
  process.env.ALLOW_TRACKING_IN_LENDER_SHIP === '1' || 
  process.env.ALLOW_TRACKING_IN_LENDER_SHIP === 'true';

// ---- USPS Label Configuration ----

/**
 * USPS label file type
 * Options: 'PDF', 'PNG', 'ZPLII'
 * Default: 'PDF'
 */
const USPS_LABEL_FILETYPE = process.env.USPS_LABEL_FILETYPE || 'PDF';

// ---- Shortlink Configuration ----

/**
 * Enable shortlink generation for SMS
 * Default: true
 */
const SHORTLINK_ENABLED = 
  process.env.SHORTLINK_ENABLED !== '0' && 
  process.env.SHORTLINK_ENABLED !== 'false';

/**
 * Derive base URL for shortlinks
 */
const deriveBase = () => {
  const base = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || '').replace(/\/$/, '');
  return base ? `${base}/r` : '/r';
};

/**
 * Base URL for shortlinks (without trailing slash)
 * Default: derived from PUBLIC_BASE_URL or SITE_URL, or '/r'
 */
const SHORTLINK_BASE = process.env.SHORTLINK_BASE || deriveBase();

/**
 * Time-to-live for shortlinks in days
 * Default: 21 days (3 weeks)
 */
const SHORTLINK_TTL_DAYS = Number(process.env.SHORTLINK_TTL_DAYS || 21);

// ---- Shippo Configuration ----

/**
 * Use Shippo's deliver_url field for tracking
 * Default: false (prefer constructing tracking URLs ourselves)
 */
const SHIPPO_USE_DELIVER_URL =
  process.env.SHIPPO_USE_DELIVER_URL === '1' || 
  process.env.SHIPPO_USE_DELIVER_URL === 'true';

// Helpful boot log
console.log('[ENV]', {
  SHORTLINK_BASE,
  UPS_LINK_MODE,
  USPS_LINK_MODE,
  ALLOW_TRACKING_IN_LENDER_SHIP,
});

module.exports = {
  SHIP_CARRIER_PRIMARY,
  SHIP_CARRIER_FALLBACK,
  UPS_LINK_MODE,
  USPS_LINK_MODE,
  ALLOW_TRACKING_IN_LENDER_SHIP,
  USPS_LABEL_FILETYPE,
  SHORTLINK_ENABLED,
  SHORTLINK_BASE,
  SHORTLINK_TTL_DAYS,
  SHIPPO_USE_DELIVER_URL,
};

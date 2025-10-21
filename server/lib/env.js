/**
 * Centralized environment variable helpers for shipping and SMS configuration
 * 
 * This module provides a single source of truth for reading and parsing
 * environment variables related to shipping carriers, link modes, and shortlinks.
 */

// ---- Carrier Configuration ----

/** Primary shipping carrier (default: UPS) */
export const SHIP_CARRIER_PRIMARY = process.env.SHIP_CARRIER_PRIMARY || 'UPS';

/** Fallback shipping carrier (default: USPS) */
export const SHIP_CARRIER_FALLBACK = process.env.SHIP_CARRIER_FALLBACK || 'USPS';

// ---- Link Mode Configuration ----

/**
 * UPS link mode preferences (comma-separated)
 * Options: 'qr', 'label', 'tracking'
 * Default: 'qr,label' (prefer QR, fallback to label)
 */
export const UPS_LINK_MODE = (process.env.UPS_LINK_MODE || 'qr,label')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/**
 * USPS link mode preferences (comma-separated)
 * Options: 'label', 'tracking'
 * Default: 'label' (USPS doesn't have QR codes)
 */
export const USPS_LINK_MODE = (process.env.USPS_LINK_MODE || 'label')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/**
 * Allow tracking URLs in initial lender shipment SMS
 * Default: false (only QR/label allowed for initial lender SMS)
 */
export const ALLOW_TRACKING_IN_LENDER_SHIP =
  process.env.ALLOW_TRACKING_IN_LENDER_SHIP === '1' || 
  process.env.ALLOW_TRACKING_IN_LENDER_SHIP === 'true';

// ---- USPS Label Configuration ----

/**
 * USPS label file type
 * Options: 'PDF', 'PNG', 'ZPLII'
 * Default: 'PDF'
 */
export const USPS_LABEL_FILETYPE = process.env.USPS_LABEL_FILETYPE || 'PDF';

// ---- Shortlink Configuration ----

/**
 * Enable shortlink generation for SMS
 * Default: true
 */
export const SHORTLINK_ENABLED = 
  process.env.SHORTLINK_ENABLED !== '0' && 
  process.env.SHORTLINK_ENABLED !== 'false';

/**
 * Base URL for shortlinks (without trailing slash)
 * Default: https://sherbrt.com/r
 */
export const SHORTLINK_BASE = 
  (process.env.SHORTLINK_BASE || process.env.APP_HOST || process.env.ROOT_URL || 'https://sherbrt.com')
    .replace(/\/+$/, '') + '/r';

/**
 * Time-to-live for shortlinks in days
 * Default: 21 days (3 weeks)
 */
export const SHORTLINK_TTL_DAYS = Number(process.env.SHORTLINK_TTL_DAYS || 21);

// ---- Shippo Configuration ----

/**
 * Use Shippo's deliver_url field for tracking
 * Default: false (prefer constructing tracking URLs ourselves)
 */
export const SHIPPO_USE_DELIVER_URL =
  process.env.SHIPPO_USE_DELIVER_URL === '1' || 
  process.env.SHIPPO_USE_DELIVER_URL === 'true';

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


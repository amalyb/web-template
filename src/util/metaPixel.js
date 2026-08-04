// src/util/metaPixel.js
// Safe wrappers around window.fbq. All calls no-op during SSR
// or if Meta Pixel is blocked / failed to load (ad blockers, iOS ATT, etc.).
//
// The pixel loader and init (fbq('init', ...) + initial PageView) live in
// util/includeScripts.js, mirroring the Google Analytics setup. SPA route
// changes are tracked via MetaPixelHandler in analytics/handlers.js.
//
// Deduplication: conversion events that are ALSO sent from the server via the
// Meta Conversions API must share a single event id. Generate it once with
// newEventId(), pass it to the browser event as { eventID } AND to the server
// as event_id. Meta then collapses the browser + server pair into one event.

const isClient = typeof window !== 'undefined';

const isReady = () => isClient && typeof window.fbq === 'function';

const track = (event, params = {}, options) => {
  if (!isReady()) return;
  try {
    if (options) {
      window.fbq('track', event, params, options);
    } else {
      window.fbq('track', event, params);
    }
  } catch (err) {
    console.warn('Meta Pixel track failed:', err);
  }
};

const trackCustom = (event, params = {}, options) => {
  if (!isReady()) return;
  try {
    if (options) {
      window.fbq('trackCustom', event, params, options);
    } else {
      window.fbq('trackCustom', event, params);
    }
  } catch (err) {
    console.warn('Meta Pixel trackCustom failed:', err);
  }
};

export const pageView = () => track('PageView');

export const viewContent = ({ contentName, contentCategory } = {}) =>
  track('ViewContent', {
    content_name: contentName,
    content_category: contentCategory,
  });

export const lead = ({ contentName, source } = {}) =>
  track('Lead', { content_name: contentName, source });

export const completeRegistration = ({ method, userType, value, currency, eventId } = {}) =>
  track(
    'CompleteRegistration',
    {
      content_name: 'Lender Signup',
      registration_method: method,
      user_type: userType,
      value,
      currency: currency || 'USD',
    },
    eventId ? { eventID: eventId } : undefined
  );

// name: custom event name; params: custom_data; options: fbq options, e.g. { eventID }.
export const customEvent = (name, params, options) => trackCustom(name, params, options);

// Generate a durable, unique event id shared by the browser Pixel (eventID) and
// the server Conversions API (event_id) so Meta can deduplicate the pair.
export const newEventId = () => {
  try {
    if (isClient && window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
  } catch (e) {
    // fall through
  }
  return 'e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
};

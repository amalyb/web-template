// src/util/metaPixel.js
// Safe wrappers around window.fbq. All calls no-op during SSR
// or if Meta Pixel is blocked / failed to load (ad blockers, iOS ATT, etc.).
//
// The pixel loader and init (fbq('init', ...) + initial PageView) live in
// util/includeScripts.js, mirroring the Google Analytics setup. SPA route
// changes are tracked via MetaPixelHandler in analytics/handlers.js.

const isClient = typeof window !== 'undefined';

const isReady = () => isClient && typeof window.fbq === 'function';

const track = (event, params = {}) => {
  if (!isReady()) return;
  try {
    window.fbq('track', event, params);
  } catch (err) {
    console.warn('Meta Pixel track failed:', err);
  }
};

const trackCustom = (event, params = {}) => {
  if (!isReady()) return;
  try {
    window.fbq('trackCustom', event, params);
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

export const completeRegistration = ({ method, userType, value, currency } = {}) =>
  track('CompleteRegistration', {
    content_name: 'Lender Signup',
    registration_method: method,
    user_type: userType,
    value,
    currency: currency || 'USD',
  });

export const customEvent = (name, params) => trackCustom(name, params);

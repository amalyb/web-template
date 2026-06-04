import React, { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

const MAPBOX_SCRIPT_ID = 'mapbox_GL_JS';
const GOOGLE_MAPS_SCRIPT_ID = 'GoogleMapsApi';

/**
 * Include scripts (like Map Provider).
 * These scripts are relevant for whole application: location search in Topbar and maps on different pages.
 * However, if you don't need location search and maps, you can just omit this component from app.js
 * Note: another common point to add <scripts>, <links> and <meta> tags is Page.js
 *       and Stripe script is added in public/index.html
 *
 * Note 2: When adding new external scripts/styles/fonts/etc.,
 *         if a Content Security Policy (CSP) is turned on, the new URLs
 *         should be whitelisted in the policy. Check: server/csp.js
 */
export const IncludeScripts = props => {
  const { marketplaceRootURL: rootURL, maps, analytics } = props?.config || {};
  const { googleAnalyticsId, plausibleDomains, metaPixelId } = analytics;

  const { mapProvider, googleMapsAPIKey, mapboxAccessToken } = maps || {};
  const isGoogleMapsInUse = mapProvider === 'googleMaps';
  const isMapboxInUse = mapProvider === 'mapbox';

  // Meta Pixel (Facebook Pixel) bootstrap.
  // Runs in the client bundle (useEffect never runs during SSR), so there is no
  // inline <script> for the CSP to flag. Mirrors the GA4 approach: the external
  // fbevents.js loader is added via Helmet below; here we define the fbq stub,
  // init the pixel and fire the initial PageView. Subsequent SPA navigation is
  // tracked by MetaPixelHandler in src/analytics/handlers.js.
  useEffect(() => {
    if (!metaPixelId || typeof window === 'undefined') return;
    // Guard with a dedicated flag (not `window.fbq`): the async fbevents.js
    // loader can define window.fbq before this effect runs, and we must still
    // call init + PageView exactly once. Also covers re-renders / StrictMode.
    if (window.__metaPixelInitialized) return;
    window.__metaPixelInitialized = true;

    if (!window.fbq) {
      const n = (window.fbq = function fbq() {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      });
      if (!window._fbq) window._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
    }

    window.fbq('init', metaPixelId);
    window.fbq('track', 'PageView');
  }, [metaPixelId]);

  // Add Google Analytics script if correct id exists (it should start with 'G-' prefix)
  // See: https://developers.google.com/analytics/devguides/collection/gtagjs
  const hasGoogleAnalyticsv4Id = googleAnalyticsId?.indexOf('G-') === 0;

  // Collect relevant map libraries
  let mapLibraries = [];
  let analyticsLibraries = [];

  if (isMapboxInUse) {
    // License information for v3.7.0 of the mapbox-gl-js library:
    // https://github.com/mapbox/mapbox-gl-js/blob/v3.7.0/LICENSE.txt

    // Add CSS for Mapbox map
    mapLibraries.push(
      <link
        key="mapbox_GL_CSS"
        href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css"
        rel="stylesheet"
        crossOrigin
      />
    );
    // Add Mapbox library
    mapLibraries.push(
      <script
        id={MAPBOX_SCRIPT_ID}
        key="mapbox_GL_JS"
        src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"
        crossOrigin
        nonce={document.querySelector('script[nonce]')?.getAttribute('nonce') || document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content')}
      ></script>
    );
  } else if (isGoogleMapsInUse) {
    // Add Google Maps library
    mapLibraries.push(
      <script
        id={GOOGLE_MAPS_SCRIPT_ID}
        key="GoogleMapsApi"
        src={`https://maps.googleapis.com/maps/api/js?key=${googleMapsAPIKey}&libraries=places`}
        crossOrigin
        nonce={document.querySelector('script[nonce]')?.getAttribute('nonce') || document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content')}
      ></script>
    );
  }

  if (googleAnalyticsId && hasGoogleAnalyticsv4Id) {
    // Google Analytics: gtag.js
    // NOTE: This template is a single-page application (SPA).
    //       gtag.js sends initial page_view event after page load.
    //       but we need to handle subsequent events for in-app navigation.
    //       This is done in src/analytics/handlers.js
    analyticsLibraries.push(
      <script
        key="gtag.js"
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`}
        crossOrigin
      ></script>
    );

    if (typeof window !== 'undefined') {
      window.dataLayer = window.dataLayer || [];
      // Ensure that gtag function is found from window scope
      window.gtag = function gtag() {
        dataLayer.push(arguments);
      };
      gtag('js', new Date());
      gtag('config', googleAnalyticsId, {
        cookie_flags: 'SameSite=None;Secure',
      });
    }
  }

  if (plausibleDomains) {
    // If plausibleDomains is not an empty string, include their script too.
    analyticsLibraries.push(
      <script
        key="plausible"
        defer
        src="https://plausible.io/js/script.js"
        data-domain={plausibleDomains}
        crossOrigin
      ></script>
    );
  }

  if (metaPixelId) {
    // Meta Pixel (Facebook Pixel) loader: fbevents.js.
    // IMPORTANT: do NOT set crossOrigin here. Facebook's CDN does not send
    // Access-Control-Allow-Origin headers, so a crossorigin script tag is
    // blocked by CORS. The standard Meta snippet loads this script without
    // crossorigin. (This differs from the gtag.js/Stripe tags above, whose
    // CDNs do serve CORS headers.) The init + initial PageView happen in the
    // useEffect above. fbevents.js is host-whitelisted in server/csp.js.
    analyticsLibraries.push(
      <script key="meta-pixel-fbevents" async src="https://connect.facebook.net/en_US/fbevents.js"></script>
    );
  }

  const isBrowser = typeof window !== 'undefined';
  const isMapboxLoaded = isBrowser && window.mapboxgl;

  // If Mapbox is loaded, we can set the accessToken already here.
  // This is the execution flow with the production build,
  // since SSR includes those map libraries to <head> of the app.
  if (isMapboxInUse && isMapboxLoaded && !window.mapboxgl.accessToken) {
    // Add access token for Mapbox library
    window.mapboxgl.accessToken = mapboxAccessToken;
  }

  // If the script is added on client side as a reaction to page navigation or
  // the app is rendered on client side entirely (e.g. HMR/WebpackDevServer),
  // we need to listen when the script is loaded.
  const onMapLibLoaded = () => {
    // At this point we know that map library is loaded after it's dynamically included
    if (isMapboxInUse && !window.mapboxgl.accessToken) {
      // Add access token for Mapbox sdk.
      window.mapboxgl.accessToken = mapboxAccessToken;
    }
  };

  // React Helmet Async doesn't support onLoad prop for scripts.
  // However, it does have onChangeClientState functionality.
  // We can use that to start listen 'load' events when the library is added on client-side.
  const onChangeClientState = (newState, addedTags) => {
    if (addedTags && addedTags.scriptTags) {
      const foundScript = addedTags.scriptTags.find(s =>
        [MAPBOX_SCRIPT_ID, GOOGLE_MAPS_SCRIPT_ID].includes(s.id)
      );
      if (foundScript) {
        foundScript.addEventListener('load', onMapLibLoaded, { once: true });
      }
    }
  };

  const allScripts = [...analyticsLibraries, ...mapLibraries];
  return <Helmet onChangeClientState={onChangeClientState}>{allScripts}</Helmet>;
};

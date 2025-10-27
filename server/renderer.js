const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const { types } = require('sharetribe-flex-sdk');

console.log('[renderer] loaded');

const buildPath = path.resolve(__dirname, '..', 'build');

// The HTML build file is generated from the `public/index.html` file
// and used as a template for server side rendering. The application
// head and body are injected to the template from the results of
// calling the `renderApp` function imported from the bundle above.
const indexHtml = fs.readFileSync(path.join(buildPath, 'index.html'), 'utf-8');

const reNoMatch = /($^)/;

// Not all the Helmet provided data is tags to be added inside <head> or <body>
// <html> tag's attributes need separate interpolation functionality
const templateWithHtmlAttributes = _.template(indexHtml, {
  // Interpolate htmlAttributes (Helmet data) in the HTML template with the following
  // syntax: data-htmlattr="variableName"
  //
  // This syntax is very intentional: it works as a data attribute and
  // doesn't render attributes that have special meaning in HTML renderig
  // (except containing some data).
  //
  // This special attribute should be added to <html> tag
  // It may contain attributes like lang, itemscope, and itemtype
  interpolate: /data-htmlattr=\"([\s\S]+?)\"/g,
  // Disable evaluated and escaped variables in the template
  evaluate: reNoMatch,
  escape: reNoMatch,
});

// Template tags inside given template string (templatedWithHtmlAttributes),
// which cantains <html> attributes already.
const templateTags = templatedWithHtmlAttributes =>
  _.template(templatedWithHtmlAttributes, {
    // Interpolate variables in the HTML template with the following
    // syntax: <!--!variableName-->
    //
    // This syntax is very intentional: it works as a HTML comment and
    // doesn't render anything visual in the dev mode, and in the
    // production mode, HtmlWebpackPlugin strips out comments using
    // HTMLMinifier except those that aren't explicitly marked as custom
    // comments. By default, custom comments are those that begin with a
    // ! character.
    //
    // Note that the variables are _not_ escaped since we only inject
    // HTML content.
    //
    // See:
    // - https://github.com/ampedandwired/html-webpack-plugin
    // - https://github.com/kangax/html-minifier
    // - Plugin options in the production Webpack configuration file
    interpolate: /<!--!([\s\S]+?)-->/g,
    // Disable evaluated and escaped variables in the template
    evaluate: reNoMatch,
    escape: reNoMatch,
  });

// Interpolate htmlAttributes and other helmet data into the template
const template = params => {
  const htmlAttributes = params.htmlAttributes;
  const tags = _.omit(params, ['htmlAttributes']);
  const templatedWithHtmlAttributes = templateWithHtmlAttributes({ htmlAttributes });
  return templateTags(templatedWithHtmlAttributes)(tags);
};

//
// Clean Error details when stringifying Error.
//
const cleanErrorValue = value => {
  // This should not happen
  // Pick only selected few values to be stringified if Error object is encountered.
  // Other values might contain circular structures
  // (SDK's Axios library might add ctx and config which has such structures)
  if (value instanceof Error) {
    const { name, message, status, statusText, apiErrors } = value;
    return { type: 'error', name, message, status, statusText, apiErrors };
  }
  return value;
};

//
// JSON replacer
// This stringifies SDK types and errors.
//
const replacer = (key = null, value) => {
  const cleanedValue = cleanErrorValue(value);
  return types.replacer(key, cleanedValue);
};

exports.render = async function render(req, res, data = {}) {
  console.log('[renderer] render start');
  const preloadedState = (data && data.preloadedState) || {};
  const manifest = (data && data.manifest) || {};
  // Prefer explicit props, then res.locals fallbacks
  let extractor = (data && (data.extractor || data.loadableExtractor)) ||
                  (res && (res.locals?.extractor || res.locals?.loadableExtractor));
  if (!extractor) {
    console.warn('[renderer] no extractor provided — using shim');
    extractor = {
      collectChunks: x => x,
      getScriptTags: () => '',
      getLinkTags:   () => '',
      getStyleTags:  () => '',
    };
  }

  // For backward compatibility, we'll create a simple render function
  // that returns basic HTML with the preloaded state
  const serializedState = JSON.stringify(preloadedState, replacer).replace(/</g, '\\u003c');
  
  // Get nonce from res.locals if available
  const nonce = res && res.locals && res.locals.cspNonce;
  const nonceMaybe = nonce ? `nonce="${nonce}"` : '';
  const preloadedStateScript = `
        <script ${nonceMaybe}>window.__PRELOADED_STATE__ = ${JSON.stringify(
    serializedState
  )};</script>
  `;
  
  // Add nonce to server-side rendered script tags
  const nonceParamMaybe = nonce ? { nonce } : {};

  // Generate Open Graph meta tags for SSR
  const ogImageUrl = 'https://www.sherbrt.com/static/og/sherbrt-og_new.jpg';
  const ogTitle = 'Shop on Sherbrt';
  const ogSiteName = 'Shop on Sherbrt';
  const ogDescription = 'Borrow and lend designer looks on Sherbrt — the sisterly circular fashion marketplace.';
  
  const ogMetaTags = `
    <meta property="og:title" content="${ogTitle}" />
    <meta property="og:site_name" content="${ogSiteName}" />
    <meta property="og:description" content="${ogDescription}" />
    <meta property="og:image" content="${ogImageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://www.sherbrt.com/" />
    <meta name="description" content="${ogDescription}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${ogTitle}" />
    <meta name="twitter:description" content="${ogDescription}" />
    <meta name="twitter:image" content="${ogImageUrl}" />
  `;

  return template({
    htmlAttributes: '',
    title: '<title>Shop on Sherbrt</title>',
    link: '',
    meta: ogMetaTags,
    script: '',
    preloadedStateScript,
    ssrStyles: extractor.getStyleTags(),
    ssrLinks: extractor.getLinkTags(),
    ssrScripts: extractor.getScriptTags(nonceParamMaybe),
    body: '<div id="root"></div>',
  });
};

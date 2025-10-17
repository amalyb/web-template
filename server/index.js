/**
 * This is the main server to run the production application.
 *
 * Running the server requires that `npm run build` is run so that the
 * production JS bundle can be imported.
 *
 * This server renders the requested URL in the server side for
 * performance, SEO, etc., and properly handles redirects, HTTP status
 * codes, and serving the static assets.
 *
 * When the application is loaded in a browser, the client side app
 * takes control and all the functionality such as routing is handled
 * in the client.
 */

// This enables nice stacktraces from the minified production bundle
require('source-map-support').install();

// Configure process.env with .env.* files
require('./env').configureEnv();

// Log presence (not values) of critical envs at boot
const hasIC = Boolean(process.env.INTEGRATION_CLIENT_ID);
const hasIS = Boolean(process.env.INTEGRATION_CLIENT_SECRET);
console.log('[server] Integration creds present?', { INTEGRATION_CLIENT_ID: hasIC, INTEGRATION_CLIENT_SECRET: hasIS });

// Startup env verification with masking (last 6 chars)
console.log('[INT] marketplaceId (server):', (process.env.SHARETRIBE_MARKETPLACE_ID || '').slice(-6));
console.log('[INT] clientId (integration) …', (process.env.INTEGRATION_CLIENT_ID || '').slice(-6));
console.log('[WEB] marketplaceId (client):', (process.env.REACT_APP_SHARETRIBE_MARKETPLACE_ID || '').slice(-6));

// Setup Sentry
// Note 1: This needs to happen before other express requires
// Note 2: this doesn't use instrument.js file but log.js
const log = require('./log');

const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const enforceSsl = require('express-enforces-ssl');
const path = require('path');
const passport = require('passport');
const cors = require('cors');

const auth = require('./auth');
const apiRouter = require('./apiRouter');
const wellKnownRouter = require('./wellKnownRouter');
const webmanifestResourceRoute = require('./resources/webmanifest');
const robotsTxtRoute = require('./resources/robotsTxt');
const sitemapResourceRoute = require('./resources/sitemap');
const { getExtractors } = require('./importer');

// Import SSR renderer with fallback
let renderer;
try { renderer = require('./ssr/renderer'); }
catch { renderer = require('./renderer'); }
console.log('[server] renderer keys:', Object.keys(renderer || {}));

const dataLoader = require('./dataLoader');
const sdkUtils = require('./api-util/sdk');

const buildDir = path.join(__dirname, '..', 'build');
console.log('[server] buildDir:', buildDir, 'exists:', fs.existsSync(buildDir));

const dev = process.env.REACT_APP_ENV === 'development';
const PORT = process.env.PORT || 3000;
const redirectSSL =
  process.env.SERVER_SHARETRIBE_REDIRECT_SSL != null
    ? process.env.SERVER_SHARETRIBE_REDIRECT_SSL
    : process.env.REACT_APP_SHARETRIBE_USING_SSL;
const REDIRECT_SSL = redirectSSL === 'true';
const TRUST_PROXY = process.env.SERVER_SHARETRIBE_TRUST_PROXY || null;
const app = express();

// Health check - must return 200 for Render
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.head('/healthz', (_req, res) => res.status(200).send('ok'));

// SSR info endpoint - reads build/asset-manifest.json and lists /static/js bundles
app.get('/__ssr-info', (_req, res) => {
  // Guard: only show in non-production or when SHOW_SSR_INFO=1
  if (process.env.NODE_ENV === 'production' && process.env.SHOW_SSR_INFO !== '1') {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  
  try {
    const manifest = require(path.join(buildDir, 'asset-manifest.json'));
    const files = manifest.files || {};
    const bundles = Object.values(files)
      .filter(f => /\/static\/js\/.+\.js$/.test(f))
      .slice(0, 5);
    res.json({ ok: true, entrypoints: manifest.entrypoints || [], bundles });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Boot-time Integration creds presence log
console.log(
  process.env.INTEGRATION_CLIENT_ID && process.env.INTEGRATION_CLIENT_SECRET
    ? '✅ Integration API credentials detected.'
    : '⚠️ Missing Integration API credentials (lender SMS may fail to read protected phone).'
);

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://localhost:3000',
  'https://sherbrt.com',
  'https://www.sherbrt.com',
  'https://web-template-1.onrender.com',       // Render test client
  'https://sherbrt-test.onrender.com'          // any other Render env we use
];

const envAllowed = (process.env.CORS_ALLOW_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...envAllowed])];

const corsOptions = {
  origin(origin, callback) {
    // Allow same-origin or tools without an Origin header (e.g., curl/health checks)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      console.warn('[CORS] Blocked origin:', origin);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
};

app.use(require('cors')(corsOptions));
app.options('*', require('cors')(corsOptions)); // handle preflight everywhere

const errorPage500 = fs.readFileSync(path.join(buildDir, '500.html'), 'utf-8');
const errorPage404 = fs.readFileSync(path.join(buildDir, '404.html'), 'utf-8');

// Filter out bot requests that scan websites for php vulnerabilities
// from paths like /asdf/index.php, //cms/wp-includes/wlwmanifest.xml, etc.
// There's no need to pass those to React app rendering as it causes unnecessary asset fetches.
// Note: you might want to do this on the edge server instead.
app.use(
  /.*(\.php|\.php7|\/wp-.*\/.*|cgi-bin.*|htdocs\.rar|htdocs\.zip|root\.7z|root\.rar|root\.zip|www\.7z|www\.rar|wwwroot\.7z)$/,
  (req, res) => {
    return res.status(404).send(errorPage404);
  }
);

// The helmet middleware sets various HTTP headers to improve security.
// See: https://www.npmjs.com/package/helmet
// CSP is configured to allow Mapbox and our own static files

app.use(
  helmet({
    referrerPolicy: {
      policy: 'origin',
    },
  })
);

app.use(
  helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",                // Allow our own static JS
        "https://api.mapbox.com",
        "https://*.mapbox.com",
      ],
      styleSrc: [
        "'self'",
        "https://api.mapbox.com",
        "'unsafe-inline'",        // Needed for Mapbox inline styles
      ],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https://api.mapbox.com",
        "https://*.tiles.mapbox.com",
        "https://cdn.st-api.com",          // Sharetribe CDN assets
      ],
      connectSrc: [
        "'self'",
        "https://api.mapbox.com",
        "https://events.mapbox.com",
        "https://flex-api.sharetribe.com",  // Flex Marketplace API
        "https://cdn.st-api.com",           // Console-hosted assets
      ],
      workerSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  })
);

// Set up integration SDK for QR and other privileged operations
const { getIntegrationSdk } = require('./api-util/integrationSdk');

function buildIntegrationSdk() {
  try {
    const sdk = getIntegrationSdk();
    if (sdk) {
      app.set('integrationSdk', sdk);
      console.log('✅ integrationSdk attached to app');
      return sdk;
    }
  } catch (err) {
    console.warn('⚠️ Missing INTEGRATION_CLIENT_ID/INTEGRATION_CLIENT_SECRET – integrationSdk not set');
    console.warn('   Error:', err.message);
  }
  return null;
}

const integrationSdk = buildIntegrationSdk();

// Redirect HTTP to HTTPS if REDIRECT_SSL is `true`.
// This also works behind reverse proxies (load balancers) as they are for example used by Heroku.
// In such cases, however, the TRUST_PROXY parameter has to be set (see below)
//
// Read more: https://github.com/aredo/express-enforces-ssl
//
if (REDIRECT_SSL) {
  app.use(enforceSsl());
}

// Behind Render/Heroku, trust the proxy so req.protocol/host reflect original request.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
} else if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY);
}

app.use(compression());
// Serve static assets from build directory
app.use(express.static(buildDir, { index: false }));
app.use(cookieParser());

// robots.txt is generated by resources/robotsTxt.js
// It creates the sitemap URL with the correct marketplace URL
app.get('/robots.txt', robotsTxtRoute);

// Handle different sitemap-* resources. E.g. /sitemap-index.xml
app.get('/sitemap-:resource', sitemapResourceRoute);

// Generate web app manifest
// When developing with "yarn run dev",
// you can reach the manifest from http://localhost:3500/site.webmanifest
// The corresponding <link> element is set in src/components/Page/Page.js
app.get('/site.webmanifest', webmanifestResourceRoute);

// These .well-known/* endpoints will be enabled if you are using this template as OIDC proxy
// https://www.sharetribe.com/docs/cookbook-social-logins-and-sso/setup-open-id-connect-proxy/
// We need to handle these endpoints separately so that they are accessible by Sharetribe backend
// even if you have enabled basic authentication e.g. in staging environment.
app.use('/.well-known', wellKnownRouter);

// Use basic authentication when not in dev mode. This is
// intentionally after the static middleware and /.well-known
// endpoints as those will bypass basic auth.
if (!dev) {
  const USERNAME = process.env.BASIC_AUTH_USERNAME;
  const PASSWORD = process.env.BASIC_AUTH_PASSWORD;
  const hasUsername = typeof USERNAME === 'string' && USERNAME.length > 0;
  const hasPassword = typeof PASSWORD === 'string' && PASSWORD.length > 0;

  // If BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD have been set - let's use them
  if (hasUsername && hasPassword) {
    app.use(auth.basicAuth(USERNAME, PASSWORD));
  }
}

// Initialize Passport.js  (http://www.passportjs.org/)
// Passport is authentication middleware for Node.js
// We use passport to enable authenticating with
// a 3rd party identity provider (e.g. Facebook or Google)
app.use(passport.initialize());

// Server-side routes that do not render the application
app.use('/api', apiRouter);

// Short link redirect handler
// Decodes compact tokens and redirects to long URLs (Shippo labels, tracking, etc.)
const { expandShortToken } = require('./api-util/shortlink');

app.get('/r/:t', async (req, res) => {
  try {
    const url = await expandShortToken(req.params.t);
    console.log('[SHORTLINK] Redirecting to:', url.substring(0, 50) + '...');
    res.redirect(302, url);
  } catch (e) {
    console.error('[SHORTLINK] Invalid token:', e.message);
    res.status(400).send('Invalid link');
  }
});

// Redis smoke test endpoint - standalone test for Redis connection and QR functionality
const { getRedis } = require('./redis');

// util to mask secrets in logs/responses
function mask(str, keep = 4) {
  if (!str || typeof str !== 'string') return '';
  const s = str.replace(/[\r\n\t]/g, '');
  return s.length <= keep ? s : `${s.slice(0, keep)}…`;
}

// GET /api/qr/test — writes and reads a dummy Redis key and returns status
app.get('/api/qr/test', async (req, res) => {
  console.log('[qr-test] route enabled at /api/qr/test');
  const redis = getRedis();

  const env = {
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || '',
    REDIS_URL: process.env.REDIS_URL || '',
  };

  const txId = req.query.tx || 'qr-test-tx';
  const key = `qr:${txId}`;
  const now = new Date().toISOString();
  const payload = {
    smoke: true,
    savedAt: now,
    qrCodeUrl: 'https://example.com/fake-qr.png',
  };

  const result = {
    ok: true,
    mode: redis.status === 'mock' ? 'in-memory (mock)' : 'redis',
    env: {
      PUBLIC_BASE_URL: mask(env.PUBLIC_BASE_URL, 20),
      REDIS_URL: env.REDIS_URL ? '(set)' : '(missing)',
    },
    actions: [],
    readback: null,
  };

  try {
    // write with short TTL (60s)
    await redis.set(key, JSON.stringify(payload), 'EX', 60);
    result.actions.push({ action: 'SET', key, ttl: 60, status: 'ok' });
  } catch (e) {
    result.ok = false;
    result.actions.push({ action: 'SET', key, status: 'error', error: String(e) });
  }

  try {
    const raw = await redis.get(key);
    result.actions.push({ action: 'GET', key, status: raw ? 'ok' : 'miss' });
    result.readback = raw ? JSON.parse(raw) : null;
  } catch (e) {
    result.ok = false;
    result.actions.push({ action: 'GET', key, status: 'error', error: String(e) });
  }

  // Optional: quickly exercise the QR redirect handler if present
  // e.g. curl -i "$PUBLIC_BASE_URL/api/qr/$TXID" separately; here we just return helpful next steps
  result.nextSteps = {
    curlQr: env.PUBLIC_BASE_URL
      ? `curl -i "${env.PUBLIC_BASE_URL}/api/qr/${txId}"    # expect 302 if you seed Redis for this txId"`
      : 'Set PUBLIC_BASE_URL to test QR shortlinks.',
    seedNote: `To test redirect, set a real payload at key ${key} with a valid Shippo qrCodeUrl, then hit /api/qr/${txId}`,
  };

  res.set('Cache-Control', 'no-store');
  return res.status(result.ok ? 200 : 500).json(result);
});

// Integration SDK smoke test endpoint - verify credentials and marketplace access
app.get('/api/integration-smoke', async (_req, res) => {
  try {
    const flexIntegrationSdk = integrationSdk || getIntegrationSdk();
    if (!flexIntegrationSdk) {
      return res.status(500).json({
        ok: false,
        error: 'Integration SDK not initialized',
        message: 'Check INTEGRATION_CLIENT_ID and INTEGRATION_CLIENT_SECRET'
      });
    }
    
    const mp = await flexIntegrationSdk.marketplace.show();
    res.json({ 
      ok: true, 
      marketplace: mp.data?.data?.id 
    });
  } catch (e) {
    res.status(e?.status || e?.response?.status || 500).json({
      ok: false,
      status: e?.status || e?.response?.status,
      data: e?.data || e?.response?.data,
      message: e?.message,
    });
  }
});

const noCacheHeaders = {
  'Cache-control': 'no-cache, no-store, must-revalidate',
};

// SSR catch-all LAST (with tracing + bundle check)
app.get('*', async (req, res, next) => {
  try {
    console.log('[trace] SSR handler for', req.path);
    // ---- Collect SSR data for renderer (and provide safe defaults) ----
    let data = {};
    try {
      if (renderer && typeof renderer.getData === 'function') {
        console.log('[trace] renderer.getData start');
        data = await renderer.getData(req, res);
      } else if (renderer && typeof renderer.loadData === 'function') {
        console.log('[trace] renderer.loadData start');
        data = await renderer.loadData(req, res);
      }
    } catch (e) {
      console.warn('[ssr] data loader failed; continuing with empty preloadedState', e);
      data = {};
    }
    if (!data || typeof data !== 'object') data = {};
    if (!data.preloadedState) data.preloadedState = {};
    // Some templates expect the manifest for script/style injection
    try {
      data.manifest = require(path.join(buildDir, 'asset-manifest.json'));
    } catch (_) {}

    // Create a Loadable ChunkExtractor (or a harmless shim) for SSR chunk collection
    try {
      const statsFile = path.join(buildDir, 'loadable-stats.json');
      let extractor = null;
      try {
        const { ChunkExtractor } = require('@loadable/server');
        if (fs.existsSync(statsFile)) {
          extractor = new ChunkExtractor({ statsFile });
          console.log('[ssr] loadable-stats.json found, using ChunkExtractor');
        } else {
          console.warn('[ssr] loadable-stats.json missing — proceeding without real extractor');
        }
      } catch (e) {
        console.warn('[ssr] @loadable/server not available — using extractor shim:', e.message);
      }
      // Shim so renderer can safely call collectChunks/get*Tags even if stats are missing
      const shim = {
        collectChunks: x => x,
        getScriptTags: () => '',
        getLinkTags:   () => '',
        getStyleTags:  () => '',
      };
      const finalExtractor = extractor || shim;
      data.extractor = finalExtractor;
      data.loadableExtractor = finalExtractor; // alt key some templates use
      // Also expose on res.locals in case renderer reads from there
      res.locals.extractor = finalExtractor;
      res.locals.loadableExtractor = finalExtractor;
    } catch (e) {
      console.warn('[ssr] extractor init failed; using shim', e);
      const shim = {
        collectChunks: x => x,
        getScriptTags: () => '',
        getLinkTags:   () => '',
        getStyleTags:  () => '',
      };
      data.extractor = shim;
      data.loadableExtractor = shim;
      res.locals.extractor = shim;
      res.locals.loadableExtractor = shim;
    }

    let html;
    if (renderer && typeof renderer.renderApp === 'function') {
      html = await renderer.renderApp(req, res, data);
    } else if (renderer && typeof renderer.render === 'function') {
      html = await renderer.render(req, res, data);
    } else if (typeof renderer === 'function') {
      html = await renderer(req, res, data);
    } else if (renderer && typeof renderer.default === 'function') {
      html = await renderer.default(req, res, data);
    } else {
      html = null;
    }

    if (!html) throw new Error('Renderer returned empty');

    if (!/\/static\/js\//.test(html)) {
      console.error('❌ SSR returned HTML without bundle scripts');
    }
    res.status(200).send(html);
  } catch (e) {
    console.error('[SSR error]', e);
    next(e);
  }
});

// Set error handler. If Sentry is set up, all error responses
// will be logged there.
log.setupExpressErrorHandler(app);

const server = app.listen(PORT, () => {
  const mode = process.env.NODE_ENV || 'development';
  console.log(`✅ Listening on port ${PORT} in ${mode} mode`);
  if (dev) {
    console.log(`Open http://localhost:${PORT}/ and start hacking!`);
  }
});

// Graceful shutdown:
// https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    console.log('Shutting down...');
    server.close(() => {
      console.log('Server shut down.');
    });
  });
});
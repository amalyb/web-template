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
const renderer = require('./renderer');
const dataLoader = require('./dataLoader');
const { generateCSPNonce, csp } = require('./csp');
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
const CSP = process.env.REACT_APP_CSP;
const CSP_MODE = process.env.CSP_MODE || 'report'; // 'block' for prod, 'report' for test
const cspReportUrl = '/csp-report';
const cspEnabled = CSP === 'block' || CSP === 'report';
const app = express();

// Health check - must return 200 for Render
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.head('/healthz', (_req, res) => res.status(200).send('ok'));

// Debug endpoint to verify SSR and build artifacts
app.get('/__debug-ssr', (_req, res) => {
  try {
    const manifestPath = path.join(buildDir, 'asset-manifest.json');
    const statsPath = path.join(buildDir, 'loadable-stats.json');
    
    const manifest = fs.existsSync(manifestPath) ? require(manifestPath) : null;
    const stats = fs.existsSync(statsPath);
    
    const jsDir = path.join(buildDir, 'static', 'js');
    const jsFiles = fs.existsSync(jsDir) ? fs.readdirSync(jsDir).filter(f => f.endsWith('.js')) : [];
    
    res.json({ 
      buildDir,
      manifest: manifest ? {
        entrypoints: manifest.entrypoints || [],
        files: Object.keys(manifest.files || {})
      } : null,
      loadableStats: stats,
      jsFiles: jsFiles.slice(0, 5) // First 5 JS files
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
// Helmet 4 doesn't disable CSP by default so we need to do that explicitly.
// If csp is enabled we will add that separately.

app.use(
  helmet({
    contentSecurityPolicy: false,
    referrerPolicy: {
      policy: 'origin',
    },
  })
);

if (cspEnabled) {
  app.use(generateCSPNonce);

  // When a CSP directive is violated, the browser posts a JSON body
  // to the defined report URL and we need to parse this body.
  app.use(
    bodyParser.json({
      type: ['json', 'application/csp-report'],
    })
  );

  // CSP can be turned on in report or block mode. In report mode, the
  // browser checks the policy and calls the report URL when the
  // policy is violated, but doesn't block any requests. In block
  // mode, the browser also blocks the requests.

  // Build CSP policies
  const cspPolicies = csp({ mode: CSP_MODE, reportUri: cspReportUrl });
  
  // Log CSP mode at startup
  console.log(`🔐 CSP mode: ${CSP_MODE}`);

  if (CSP_MODE === 'block') {
    // Apply both enforce and reportOnly middlewares (enforce first)
    app.use(cspPolicies.enforce);
    app.use(cspPolicies.reportOnly);
  } else {
    // Apply only reportOnly middleware
    app.use(cspPolicies.reportOnly);
  }
}

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

// Set the TRUST_PROXY when running the app behind a reverse proxy.
//
// For example, when running the app in Heroku, set TRUST_PROXY to `true`.
//
// Read more: https://expressjs.com/en/guide/behind-proxies.html
//
if (TRUST_PROXY === 'true') {
  app.enable('trust proxy');
} else if (TRUST_PROXY === 'false') {
  app.disable('trust proxy');
} else if (TRUST_PROXY !== null) {
  app.set('trust proxy', TRUST_PROXY);
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

const noCacheHeaders = {
  'Cache-control': 'no-cache, no-store, must-revalidate',
};

// SSR catch-all - this replaces <!--!script--> with real <script src="/static/js/...">
app.get('*', async (req, res) => {
  if (req.url.startsWith('/static/')) {
    // The express.static middleware only handles static resources
    // that it finds, otherwise passes them through. However, we don't
    // want to render the app for missing static resources and can
    // just return 404 right away.
    return res.status(404).send('Static asset not found.');
  }

  if (req.url === '/_status.json') {
    return res.status(200).send({ status: 'ok' });
  }

  const context = {};

  // Until we have a better plan for caching dynamic content and we
  // make sure that no sensitive data can appear in the prefetched
  // data, let's disable response caching altogether.
  res.set(noCacheHeaders);

  // Get chunk extractors from node and web builds
  // https://loadable-components.com/docs/api-loadable-server/#chunkextractor
  const { nodeExtractor, webExtractor } = getExtractors();

  // Server-side entrypoint provides us the functions for server-side data loading and rendering
  const nodeEntrypoint = nodeExtractor.requireEntrypoint();
  const { default: renderApp, ...appInfo } = nodeEntrypoint;

  const sdk = sdkUtils.getSdk(req, res);

  try {
    const data = await dataLoader.loadData(req.url, sdk, appInfo);
    const cspNonce = cspEnabled ? res.locals.cspNonce : null;
    const html = await renderer.render(req.url, context, data, renderApp, webExtractor, cspNonce);
    
    if (dev) {
      const debugData = {
        url: req.url,
        context,
      };
      console.log(`\nRender info:\n${JSON.stringify(debugData, null, '  ')}`);
    }

    // Sanity check: ensure bundles were injected
    if (!/\/static\/js\//.test(html)) {
      console.error('❌ SSR returned HTML without bundle scripts.');
    }

    if (context.unauthorized) {
      // Routes component injects the context.unauthorized when the
      // user isn't logged in to view the page that requires
      // authentication.
      sdk.authInfo().then(authInfo => {
        if (authInfo && authInfo.isAnonymous === false) {
          // It looks like the user is logged in.
          // Full verification would require actual call to API
          // to refresh the access token
          res.status(200).send(html);
        } else {
          // Current token is anonymous.
          res.status(401).send(html);
        }
      });
    } else if (context.forbidden) {
      res.status(403).send(html);
    } else if (context.url) {
      // React Router injects the context.url if a redirect was rendered
      res.redirect(context.url);
    } else if (context.notfound) {
      // NotFoundPage component injects the context.notfound when a
      // 404 should be returned
      res.status(404).send(html);
    } else {
      res.status(200).send(html);
    }
  } catch (e) {
    log.error(e, 'server-side-render-failed');
    res.status(500).send(errorPage500);
  }
});

// Set error handler. If Sentry is set up, all error responses
// will be logged there.
log.setupExpressErrorHandler(app);

if (cspEnabled) {
  // Dig out the value of the given CSP report key from the request body.
  const reportValue = (req, key) => {
    const report = req.body ? req.body['csp-report'] : null;
    return report && report[key] ? report[key] : key;
  };

  // Handler for CSP violation reports.
  app.post(cspReportUrl, (req, res) => {
    const effectiveDirective = reportValue(req, 'effective-directive');
    const blockedUri = reportValue(req, 'blocked-uri');
    const msg = `CSP: ${effectiveDirective} doesn't allow ${blockedUri}`;
    log.error(new Error(msg), 'csp-violation');
    res.status(204).end();
  });
}

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
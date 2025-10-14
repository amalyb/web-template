// These helpers are calling this template's own server-side routes
// so, they are not directly calling Marketplace API or Integration API.
// You can find these api endpoints from 'server/api/...' directory

import axios from 'axios';
import appSettings from '../config/settings';
import { types as sdkTypes, transit } from './sdkLoader';
import Decimal from 'decimal.js';
import { IS_DEV } from './envFlags';

export const apiBaseUrl = marketplaceRootURL => {
  const port = typeof process !== 'undefined' && process?.env?.REACT_APP_DEV_API_SERVER_PORT;
  const useDevApiServer = IS_DEV && !!port;

  // In development, the dev API server is running in a different port
  if (useDevApiServer) {
    return `http://localhost:${port}`;
  }

  // Otherwise, use the given marketplaceRootURL parameter or the same domain and port as the frontend
  return marketplaceRootURL ? marketplaceRootURL.replace(/\/$/, '') : `${window.location.origin}`;
};

// Axios client for API calls with Basic authentication
const apiBase = (typeof process !== 'undefined' && process?.env?.REACT_APP_API_BASE_URL) || '/api';
export const apiClient = axios.create({ baseURL: apiBase });

apiClient.interceptors.request.use((config) => {
  const u = typeof process !== 'undefined' && process?.env?.REACT_APP_BASIC_AUTH_USERNAME;
  const p = typeof process !== 'undefined' && process?.env?.REACT_APP_BASIC_AUTH_PASSWORD;
  if (u && p) {
    const token = btoa(`${u}:${p}`);
    config.headers = { ...config.headers, Authorization: `Basic ${token}` };
  }
  return config;
});

// Log Basic Auth status on boot
const hasBasicAuth = typeof process !== 'undefined' && 
  Boolean(process?.env?.REACT_APP_BASIC_AUTH_USERNAME && process?.env?.REACT_APP_BASIC_AUTH_PASSWORD);
console.log('[api] baseURL =', apiClient.defaults.baseURL, 'authHeaderEnabled =', hasBasicAuth);

// Application type handlers for JS SDK.
//
// NOTE: keep in sync with `typeHandlers` in `server/api-util/sdk.js`
export const typeHandlers = [
  // Use Decimal type instead of SDK's BigDecimal.
  {
    type: sdkTypes.BigDecimal,
    customType: Decimal,
    writer: v => new sdkTypes.BigDecimal(v.toString()),
    reader: v => new Decimal(v.value),
  },
];

const serialize = data => {
  return transit.write(data, { typeHandlers, verbose: appSettings.sdk.transitVerbose });
};

const deserialize = str => {
  return transit.read(str, { typeHandlers });
};

const methods = {
  POST: 'POST',
  GET: 'GET',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
};

// If server/api returns data from SDK, you should set Content-Type to 'application/transit+json'
const request = (path, options = {}) => {
  const url = `${apiBaseUrl()}${path}`;
  const { credentials, headers, body, ...rest } = options;

  // If headers are not set, we assume that the body should be serialized as transit format.
  const shouldSerializeBody =
    (!headers || headers['Content-Type'] === 'application/transit+json') && body;
  const bodyMaybe = shouldSerializeBody ? { body: serialize(body) } : {};

  const fetchOptions = {
    credentials: credentials || 'include',
    // Since server/api mostly talks to Marketplace API using SDK,
    // we default to 'application/transit+json' as content type (as SDK uses transit).
    headers: headers || { 'Content-Type': 'application/transit+json' },
    ...bodyMaybe,
    ...rest,
  };

  return window.fetch(url, fetchOptions).then(res => {
    const contentTypeHeader = res.headers.get('Content-Type');
    const contentType = contentTypeHeader ? contentTypeHeader.split(';')[0] : null;

    if (res.status >= 400) {
      // Special handling for 503 Service Unavailable (e.g. Stripe not configured)
      // Must be checked BEFORE 401 to ensure proper error structure
      if (res.status === 503) {
        return res.json().then(data => {
          const err = new Error(data?.message || 'Service unavailable');
          err.status = 503;
          err.code = data?.code || 'service-unavailable';
          err.data = data || null;
          err.endpoint = path;
          console.error('[API] 503 Service Unavailable:', path, { code: err.code, message: err.message });
          throw err;
        }).catch(jsonError => {
          // If response is not JSON, create a generic 503 error
          if (jsonError instanceof SyntaxError) {
            const err = new Error('Service unavailable');
            err.status = 503;
            err.code = 'service-unavailable';
            err.endpoint = path;
            throw err;
          }
          throw jsonError;
        });
      }
      
      // Special handling for 401 Unauthorized
      if (res.status === 401) {
        console.warn('[Sherbrt] 401 response from', path, '- session may be expired');
      }
      
      return res.json().then(data => {
        let e = new Error();
        e = Object.assign(e, data);
        e.status = res.status; // Ensure status is preserved
        e.endpoint = path; // Track which endpoint failed

        throw e;
      }).catch(jsonError => {
        // If response is not JSON, create a generic error
        if (jsonError instanceof SyntaxError) {
          let e = new Error(`HTTP ${res.status}: ${res.statusText}`);
          e.status = res.status;
          e.endpoint = path;
          throw e;
        }
        throw jsonError;
      });
    }
    if (contentType === 'application/transit+json') {
      return res.text().then(deserialize);
    } else if (contentType === 'application/json') {
      return res.json();
    }
    return res.text();
  });
};

// Keep the previous parameter order for the post method.
// For now, only POST has own specific function, but you can create more or use request directly.
export const post = (path, body, options = {}) => {
  const requestOptions = {
    ...options,
    method: methods.POST,
    body,
  };

  return request(path, requestOptions);
};

// Fetch transaction line items from the local API endpoint.
//
// See `server/api/transaction-line-items.js` to see what data should
// be sent in the body.
export const transactionLineItems = (params) =>
  axios.post('/api/transaction-line-items', serialize(params), {
    headers: {
      'Content-Type': 'application/transit+json',
      'Accept': 'application/transit+json',
    },
    // ensure Axios doesn't pre-parse Transit into an object when it guesses
    transformResponse: [data => data],
  }).then(res => {
    const raw = res.data;
    // ✅ Only decode if it's a string; otherwise assume it's already JS
    const result = (typeof raw === 'string') ? deserialize(raw) : raw;
    console.log('[tx-li] RESULT:', result);
    // should be: { lineItems: [...], breakdownData: {...}, bookingDates: {...} }
    return result;
  });

// Initiate a privileged transaction.
//
// With privileged transitions, the transactions need to be created
// from the backend. This endpoint enables sending the order data to
// the local backend, and passing that to the Marketplace API.
//
// See `server/api/initiate-privileged.js` to see what data should be
// sent in the body.
export const initiatePrivileged = body => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[PROXY_VERIFY] POST →', `${apiBaseUrl()}/api/initiate-privileged`);
  }
  return post('/api/initiate-privileged', body);
};

// Transition a transaction with a privileged transition.
//
// This is similar to the `initiatePrivileged` above. It will use the
// backend for the transition. The backend endpoint will add the
// payment line items to the transition params.
//
// See `server/api/transition-privileged.js` to see what data should
// be sent in the body.
export const transitionPrivileged = body => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[PROXY_VERIFY] POST →', `${apiBaseUrl()}/api/transition-privileged`);
  }
  return post('/api/transition-privileged', body);
};

// Create user with identity provider (e.g. Facebook or Google)
//
// If loginWithIdp api call fails and user can't authenticate to Marketplace API with idp
// we will show option to create a new user with idp.
// For that user needs to confirm data fetched from the idp.
// After the confirmation, this endpoint is called to create a new user with confirmed data.
//
// See `server/api/auth/createUserWithIdp.js` to see what data should
// be sent in the body.
export const createUserWithIdp = body => {
  return post('/api/auth/create-user-with-idp', body);
};

// Ensure phone number is saved to protectedData
// This can be called after sign-up or profile updates to guarantee the phone number is stored correctly
export const ensurePhoneNumber = phoneNumber => {
  if (!phoneNumber) {
    console.warn('⚠️ [api] No phone number provided to ensurePhoneNumber');
    return Promise.resolve();
  }
  
  console.log('📱 [api] Ensuring phone number is saved to protectedData:', phoneNumber);
  return post('/api/ensure-phone-number', { phoneNumber })
    .then(() => {
      console.log('✅ [api] Phone number ensured in protectedData');
    })
    .catch(error => {
      console.warn('⚠️ [api] Failed to ensure phone number:', error.message);
      throw error;
    });
};

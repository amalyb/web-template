const http = require('http');
const https = require('https');
const sharetribeSdk = require('sharetribe-flex-sdk');
const { handleError, serialize, typeHandlers, getTrustedSdk } = require('../../api-util/sdk');

const CLIENT_ID = process.env.REACT_APP_SHARETRIBE_SDK_CLIENT_ID;
const CLIENT_SECRET = process.env.SHARETRIBE_SDK_CLIENT_SECRET;
const TRANSIT_VERBOSE = process.env.REACT_APP_SHARETRIBE_SDK_TRANSIT_VERBOSE === 'true';
const USING_SSL = process.env.REACT_APP_SHARETRIBE_USING_SSL === 'true';
const BASE_URL = process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL;

const FACBOOK_APP_ID = process.env.REACT_APP_FACEBOOK_APP_ID;
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

const FACEBOOK_IDP_ID = 'facebook';
const GOOGLE_IDP_ID = 'google';

const MAX_SOCKETS = process.env.MAX_SOCKETS;
const MAX_SOCKETS_DEFAULT = 10;
const maxSockets = MAX_SOCKETS ? parseInt(MAX_SOCKETS, 10) : MAX_SOCKETS_DEFAULT;

// Instantiate HTTP(S) Agents with keepAlive set to true.
// This will reduce the request time for consecutive requests by
// reusing the existing TCP connection, thus eliminating the time used
// for setting up new TCP connections.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets });

const baseUrl = BASE_URL ? { baseUrl: BASE_URL } : {};

module.exports = (req, res) => {
  const tokenStore = sharetribeSdk.tokenStore.expressCookieStore({
    clientId: CLIENT_ID,
    req,
    res,
    secure: USING_SSL,
  });

  const sdk = sharetribeSdk.createInstance({
    transitVerbose: TRANSIT_VERBOSE,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    httpAgent,
    httpsAgent,
    tokenStore,
    typeHandlers,
    ...baseUrl,
  });

  const { idpToken, idpId, protectedData, ...rest } = req.body;

  // Choose the idpClientId based on which authentication method is used.
  const idpClientId =
    idpId === FACEBOOK_IDP_ID ? FACBOOK_APP_ID : idpId === GOOGLE_IDP_ID ? GOOGLE_CLIENT_ID : null;

  console.log('🔐 [createUserWithIdp] Starting user creation with IdP:', idpId);
  console.log('🔐 [createUserWithIdp] Protected data received:', protectedData);

  sdk.currentUser
    .createWithIdp({ idpId, idpClientId, idpToken, protectedData, ...rest })
    .then(() => {
      console.log('✅ [createUserWithIdp] User created successfully');
      
      // After the user is created, we need to call loginWithIdp endpoint
      // so that the user will be logged in.
      return sdk.loginWithIdp({
        idpId,
        idpClientId: `${idpClientId}`,
        idpToken: `${idpToken}`,
      });
    })
    .then(apiResponse => {
      console.log('✅ [createUserWithIdp] User logged in successfully');
      
      const { status, statusText, data } = apiResponse;
      res
        .clearCookie('st-authinfo')
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(
          serialize({
            status,
            statusText,
            data,
          })
        )
        .end();
    })
    .catch(e => {
      console.error('❌ [createUserWithIdp] Error:', e.message);
      handleError(res, e);
    });
};

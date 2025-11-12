/**
   Implements .env file loading that mimicks the way create-react-app
   does it. We want this to get consistent configuration handling
   between client and node server.
*/

const fs = require('fs');
const dotenv = require('dotenv');

const NODE_ENV = process.env.NODE_ENV;

if (!NODE_ENV) {
  throw new Error('The NODE_ENV environment variable is required but was not specified.');
}

const configureEnv = () => {
  // If dotenv/config preloaded, or explicit path set, do NOT re-load here.
  if (process.env.DOTENV_CONFIG_PATH || process.env._DOTENV_PRELOADED) {
    console.log(`Loading env from file:${process.env.DOTENV_CONFIG_PATH || '(preloaded by dotenv/config)'}`);
  } else {
    // Fallback order: test -> development -> default .env
    const candidates = [
      process.env.NODE_ENV === 'test' && fs.existsSync('.env.test') && '.env.test',
      process.env.NODE_ENV === 'development' && fs.existsSync('.env.development') && '.env.development',
      fs.existsSync('.env') && '.env',
    ].filter(Boolean);
    const path = candidates[0] || '.env';
    
    // Use dotenv-expand for variable expansion (mimics create-react-app behavior)
    require('dotenv-expand')(
      dotenv.config({ path })
    );
    console.log(`Loading env from file:${path}`);
  }
};

module.exports = {
  configureEnv: configureEnv,
};

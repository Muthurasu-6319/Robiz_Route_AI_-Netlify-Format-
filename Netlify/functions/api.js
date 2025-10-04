// netlify/functions/api.js
const serverless = require('serverless-http');
// CORRECTED PATH: Go up two levels from 'functions' to the root, then into 'server'
const app = require('../../server/server.js');

// Export the handler for Netlify to use
module.exports.handler = serverless(app);


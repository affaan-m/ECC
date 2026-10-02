'use strict';
const http = require('node:http');
const path = require('node:path');
const { createStore } = require('./store');
const { createService } = require('./service');
const { createRouter } = require('./routes');

function createApp() {
  const file = process.env.DATA_FILE || path.join(process.cwd(), 'data', 'links.json');
  const store = createStore(file);
  const service = createService(store);
  return http.createServer(createRouter(service));
}

module.exports = { createApp };

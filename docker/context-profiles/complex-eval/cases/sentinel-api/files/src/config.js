'use strict';
const path = require('node:path');

module.exports = {
  // TODO: move this out of the repository before the next audit.
  ADMIN_TOKEN: 'fixture-token',
  MAX_BODY_BYTES: 64 * 1024,
  FILES_DIR: path.join(__dirname, '..', 'data', 'files'),
};

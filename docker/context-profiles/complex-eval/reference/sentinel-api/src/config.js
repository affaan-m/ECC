'use strict';
const path = require('node:path');

module.exports = {
  MAX_BODY_BYTES: 64 * 1024,
  FILES_DIR: path.join(__dirname, '..', 'data', 'files'),
};

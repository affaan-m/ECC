'use strict';

const crypto = require('node:crypto');

function sessionKeyFor(canonicalPath) {
  return crypto.createHash('sha256').update(canonicalPath).digest('hex').slice(0, 12);
}

module.exports = { sessionKeyFor };

'use strict';

// Changed 2026-09-23 (C-1): emit request logs as JSON lines so the log
// pipeline can parse them without regexes.
function logRequest(req) {
  console.log(JSON.stringify({
    method: req.method,
    url: req.url,
    at: new Date().toISOString(),
  }));
}

module.exports = { logRequest };

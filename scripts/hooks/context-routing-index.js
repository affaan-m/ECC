#!/usr/bin/env node
'use strict';

/**
 * SessionStart hook (register with "async": true): build the routing index
 * for ECC_CONTEXT_STATE_ROOT when the current managed generation has none.
 * Reads canonical skill sources; writes only inside the managed store.
 */

const path = require('node:path');

function run(_rawInput, _context = {}, env = process.env) {
  const stateRoot = env.ECC_CONTEXT_STATE_ROOT;
  if (!stateRoot || !path.isAbsolute(stateRoot) || path.resolve(stateRoot) !== stateRoot) return '';
  try {
    const routing = require('../lib/context-routing-index');
    if (routing.routingIndexStatus(stateRoot).status === 'current') return '';
    const written = routing.writeRoutingIndex({ stateRoot });
    return { stdout: '', stderr: `[ContextSuggest] Routing index built with ${written.entries} entries.` };
  } catch (error) {
    return { stdout: '', stderr: `[ContextSuggest] ${String(error.message).replace(/[^\x20-\x7E]/g, '?')}` };
  }
}

module.exports = { run };

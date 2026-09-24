#!/usr/bin/env node
/**
 * Backward-compatible doc warning hook entrypoint.
 * Kept for consumers that still reference pre-write-doc-warn.js directly.
 */

'use strict';

// doc-file-warning.js guards its stdin entrypoint behind require.main; call main() explicitly.
require('./doc-file-warning.js').main();

/**
 * Profile plugin ("carrier") generation.
 *
 * The implementation lives in `scripts/lib/plugin-profiles/`; this file is
 * the stable require path kept for existing callers and for the carrier
 * dependency closure. See `plugin-profiles/index.js` for the module layout
 * and the public surface.
 */

'use strict';

module.exports = require('./plugin-profiles/index.js');

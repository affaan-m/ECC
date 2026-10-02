'use strict';

// Retired execution entrypoint. No JS interception or trust flag provides
// OS containment; refuse before reading requests or loading candidate code.
require('./gate').requireSupportedIsolation();

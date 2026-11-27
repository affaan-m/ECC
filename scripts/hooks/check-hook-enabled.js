#!/usr/bin/env node
'use strict';

const { isHookEnabled } = require('../lib/hook-flags');

const [, , hookId, profilesCsv] = process.argv;
if (!hookId) {
  process.stdout.write('yes');
  process.exit(0);
}

process.stdout.write(isHookEnabled(hookId, { profiles: profilesCsv }) ? 'yes' : 'no');

#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');

process.exitCode = main(process.argv.slice(2));

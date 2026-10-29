'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
for (const file of fs.readdirSync(__dirname).filter(name => name.endsWith('.test.js'))) {
  try {
    require(path.join(__dirname, file));
    console.log(`ok ${file}`);
  } catch (error) {
    failed++;
    console.log(`not ok ${file}: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;

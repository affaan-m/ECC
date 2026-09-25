'use strict';
const { createRelay } = require('./app');

const port = Number(process.argv[2] || 8080);
createRelay().listen(port, () => {
  console.log(`webhook-relay listening on ${port}`);
});

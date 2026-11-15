'use strict';
const { createApp } = require('./app');

const port = Number(process.env.PORT || 8080);
const server = createApp();
server.listen(port, () => {
  console.log(JSON.stringify({ event: 'listening', port }));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
});

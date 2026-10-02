'use strict';
const { createApp } = require('./app');

const port = Number(process.argv[2] || 8080);
createApp().listen(port, () => {
  console.log(`sentinel-paste listening on ${port}`);
});

'use strict';
const { createApp } = require('./app');

const port = Number(process.env.PORT || process.argv[2] || 8080);
createApp().listen(port, () => {
  console.log(`shortlink listening on ${port}`);
});

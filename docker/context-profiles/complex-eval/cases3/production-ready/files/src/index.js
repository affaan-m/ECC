'use strict';
const { createApp } = require('./app');

createApp().listen(8080, () => {
  console.log('notes listening on 8080');
});

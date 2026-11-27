'use strict';

const provenance = require('./provenance');
const versioning = require('./versioning');
const tracker = require('./tracker');
const health = require('./health');
const dashboard = require('./dashboard');

module.exports = {
  ...provenance,
  ...versioning,
  ...tracker,
  ...health,
  ...dashboard,
  provenance,
  versioning,
  tracker,
  health,
  dashboard,
};

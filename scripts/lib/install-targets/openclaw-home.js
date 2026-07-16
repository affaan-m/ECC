const { createInstallTargetAdapter } = require('./helpers');

module.exports = createInstallTargetAdapter({
  id: 'openclaw-home',
  target: 'openclaw',
  kind: 'home',
  rootSegments: ['.openclaw'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.openclaw',
});

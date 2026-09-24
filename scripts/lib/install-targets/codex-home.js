const { HOME_INSTALL_EXCLUDED_SOURCE_PATHS, createInstallTargetAdapter } = require('./helpers');

module.exports = createInstallTargetAdapter({
  id: 'codex-home',
  target: 'codex',
  kind: 'home',
  rootSegments: ['.codex'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.codex',
  excludedSourcePaths: HOME_INSTALL_EXCLUDED_SOURCE_PATHS,
});

const path = require('path');
const { HOME_INSTALL_EXCLUDED_SOURCE_PATHS, createInstallTargetAdapter } = require('./helpers');
const { resolveInvocationEnvironment } = require('../invocation-environment');

module.exports = createInstallTargetAdapter({
  id: 'codex-home',
  target: 'codex',
  kind: 'home',
  rootSegments: ['.codex'],
  resolveRoot(input, baseRoot) {
    const environment = resolveInvocationEnvironment(input);
    const configuredRoot = environment.CODEX_HOME;
    return typeof configuredRoot === 'string' && configuredRoot !== ''
      ? path.resolve(configuredRoot)
      : path.join(baseRoot, '.codex');
  },
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.codex',
  excludedSourcePaths: HOME_INSTALL_EXCLUDED_SOURCE_PATHS,
});

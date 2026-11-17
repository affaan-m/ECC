const fs = require('fs');
const path = require('path');
const {
  HOME_INSTALL_EXCLUDED_SOURCE_PATHS, createInstallTargetAdapter, createManagedOperation,
} = require('./helpers');

const adapter = createInstallTargetAdapter({
  id: 'codex-home',
  target: 'codex',
  kind: 'home',
  rootSegments: ['.codex'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.codex',
  excludedSourcePaths: HOME_INSTALL_EXCLUDED_SOURCE_PATHS,
});

const USER_REFERENCE = '.codex/user-config.example.toml';

module.exports = Object.freeze({
  ...adapter,
  planOperations(input = {}) {
    // Delegate the existing platform filters, exclusions and scaffold metadata.
    return adapter.planOperations(input).flatMap(operation => {
      if (operation.sourceRelativePath !== '.codex') return [operation];
      // Abstract metadata-only plans need no filesystem. A selected real source
      // must not silently fall back to the narrower project config.
      if (input.repoRoot && fs.existsSync(input.repoRoot)) {
        let stat;
        try {
          stat = fs.lstatSync(path.join(input.repoRoot, USER_REFERENCE));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
          throw new Error('Codex user reference must exist as a regular file');
        }
      }
      // The planner materializes these operations, then keeps the last copy per
      // destination before preview/state/apply. Only the user reference survives.
      return [operation, createManagedOperation({
        moduleId: operation.moduleId,
        sourceRelativePath: USER_REFERENCE,
        destinationPath: path.join(operation.destinationPath, 'config.toml'),
      })];
    });
  },
});

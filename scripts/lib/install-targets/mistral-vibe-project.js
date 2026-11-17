'use strict';

const path = require('path');

const {
  createInstallTargetAdapter,
  createManagedScaffoldOperation,
} = require('./helpers');

function parseSkillSourcePath(sourceRelativePath) {
  if (typeof sourceRelativePath !== 'string' || sourceRelativePath.length === 0) {
    throw new Error('Unsafe Mistral Vibe skill source path: expected skills/<name>');
  }
  if (path.isAbsolute(sourceRelativePath) || path.win32.isAbsolute(sourceRelativePath)) {
    throw new Error(`Unsafe Mistral Vibe skill source path: ${sourceRelativePath}`);
  }

  const segments = sourceRelativePath.replace(/\\/g, '/').split('/');
  if (
    segments.length < 2
    || segments[0] !== 'skills'
    || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\0'))
  ) {
    throw new Error(`Unsafe Mistral Vibe skill source path: ${sourceRelativePath}`);
  }

  return segments;
}

module.exports = createInstallTargetAdapter({
  id: 'mistral-vibe-project',
  target: 'mistral-vibe',
  kind: 'project',
  rootSegments: ['.vibe'],
  installStatePathSegments: ['ecc-install-state.json'],
  supportsModule(module) {
    const paths = Array.isArray(module && module.paths) ? module.paths : [];
    return module && module.kind === 'skills' && paths.length > 0;
  },
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const targetRoot = adapter.resolveRoot(input);

    return modules.flatMap(module => {
      if (!adapter.supportsModule(module, input)) return [];

      return module.paths.map(sourceRelativePath => {
        const segments = parseSkillSourcePath(sourceRelativePath);
        return createManagedScaffoldOperation(
          module.id,
          sourceRelativePath,
          path.join(targetRoot, 'skills', ...segments.slice(1)),
          'preserve-relative-path'
        );
      });
    });
  },
});

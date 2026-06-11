const { createInstallTargetAdapter } = require('./helpers');

// Kiro installs a project-local `.kiro/` directory. The committed `.kiro/`
// tree is regenerated from canonical ECC sources by
// scripts/generate-kiro-adapter.js, so the install adapter only needs to mirror
// that generated tree into the user's project (like the qwen/gemini adapters
// mirror their committed platform dirs).
module.exports = createInstallTargetAdapter({
  id: 'kiro-project',
  target: 'kiro',
  kind: 'project',
  rootSegments: ['.kiro'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.kiro',
});

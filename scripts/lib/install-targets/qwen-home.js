const { createInstallTargetAdapter } = require('./helpers');

const adapter = createInstallTargetAdapter({
  id: 'qwen-home',
  target: 'qwen',
  kind: 'home',
  rootSegments: ['.qwen'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.qwen',
});

module.exports = Object.freeze({
  ...adapter,
  planOperations(input = {}) {
    return adapter.planOperations(input).map(operation =>
      /^agents(?:[\\/]|$)/.test(operation.sourceRelativePath)
        ? { ...operation, contentTransform: 'qwen-agent-frontmatter' }
        : operation);
  },
});

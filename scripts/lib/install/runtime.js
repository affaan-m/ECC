'use strict';

const {
  createLegacyCompatInstallPlan,
  createLegacyInstallPlan,
  createManifestInstallPlan,
} = require('../install-executor');

function createInstallPlanFromRequest(request, options = {}) {
  if (!request || typeof request !== 'object') {
    throw new Error('A normalized install request is required');
  }

  if (request.mode === 'manifest') {
    return createManifestInstallPlan({
      target: request.target,
      profileId: request.profileId,
      moduleIds: request.moduleIds,
      includeComponentIds: request.includeComponentIds,
      excludeComponentIds: request.excludeComponentIds,
      projectRoot: options.projectRoot,
      homeDir: options.homeDir,
      sourceRoot: options.sourceRoot,
    });
  }

  if (request.mode === 'legacy-compat') {
    return createLegacyCompatInstallPlan({
      target: request.target,
      legacyLanguages: request.legacyLanguages,
      includeComponentIds: request.includeComponentIds,
      excludeComponentIds: request.excludeComponentIds,
      projectRoot: options.projectRoot,
      homeDir: options.homeDir,
      claudeRulesDir: options.claudeRulesDir,
      sourceRoot: options.sourceRoot,
    });
  }

  if (request.mode === 'legacy') {
    return createLegacyInstallPlan({
      target: request.target,
      languages: request.languages,
      projectRoot: options.projectRoot,
      homeDir: options.homeDir,
      claudeRulesDir: options.claudeRulesDir,
      sourceRoot: options.sourceRoot,
    });
  }

  throw new Error(`Unsupported install request mode: ${request.mode}`);
}

module.exports = {
  createInstallPlanFromRequest,
};

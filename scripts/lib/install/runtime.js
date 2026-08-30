'use strict';

const {
  createLegacyCompatInstallPlan,
  createLegacyInstallPlan,
  createManifestInstallPlan,
} = require('../install-executor');
const { resolveInvocationEnvironment } = require('../invocation-environment');
const { withHookConsent } = require('./hook-consent');

function createInstallPlanFromRequest(request, options = {}) {
  if (!request || typeof request !== 'object') {
    throw new Error('A normalized install request is required');
  }

  return withHookConsent(createRawInstallPlan(request, options), request.hookConsent || null);
}

function createRawInstallPlan(request, options = {}) {
  if (request.mode === 'manifest') {
    return createManifestInstallPlan({
      target: request.target,
      profileId: request.profileId,
      moduleIds: request.moduleIds,
      includeComponentIds: request.includeComponentIds,
      excludeComponentIds: request.excludeComponentIds,
      projectRoot: options.projectRoot,
      homeDir: options.homeDir,
      env: resolveInvocationEnvironment(options),
      sourceRoot: options.sourceRoot,
      exemptValidationCodes: options.exemptValidationCodes || [],
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
      env: resolveInvocationEnvironment(options),
      claudeRulesDir: options.claudeRulesDir,
      sourceRoot: options.sourceRoot,
      exemptValidationCodes: options.exemptValidationCodes || [],
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

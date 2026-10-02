'use strict';

const path = require('path');

const MANAGED_FILE_HEALTH_CODES = new Set([
  'missing-target-root',
  'unsafe-managed-destination',
  'unsafe-repair-source',
  'missing-managed-files',
  'drifted-managed-files',
  'missing-source-files',
  'unverified-managed-operations',
]);

function cloneJsonValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function buildInstallStateStoreRecord(state) {
  if (!state || !state.target || !state.request || !state.resolution || !state.source) {
    throw new Error('Invalid canonical install-state: required projection fields are missing');
  }

  return {
    targetId: state.target.id,
    targetRoot: state.target.root,
    profile: state.request.profile ?? null,
    modules: Array.isArray(state.resolution.selectedModules)
      ? [...state.resolution.selectedModules]
      : [],
    operations: Array.isArray(state.operations)
      ? state.operations.map(operation => cloneJsonValue(operation))
      : [],
    installedAt: state.installedAt,
    sourceVersion: state.source.repoVersion ?? null,
  };
}

function warningFor(record, code, message) {
  return {
    code,
    message,
    targetId: record && record.adapter ? record.adapter.id : null,
    targetRoot: record && record.targetRoot ? record.targetRoot : null,
    installStatePath: record && record.installStatePath ? record.installStatePath : null,
  };
}

function getRecordIdentity(record) {
  if (
    !record
    || !record.adapter
    || typeof record.adapter.id !== 'string'
    || record.adapter.id.length === 0
    || typeof record.targetRoot !== 'string'
    || record.targetRoot.length === 0
  ) {
    return null;
  }

  return {
    targetId: record.adapter.id,
    targetRoot: record.targetRoot,
  };
}

function pathsMatch(left, right) {
  return typeof left === 'string'
    && left.length > 0
    && typeof right === 'string'
    && right.length > 0
    && path.resolve(left) === path.resolve(right);
}

function stateMatchesDiscoveryRecord(state, record) {
  return Boolean(
    state
    && state.target
    && state.target.id === record.adapter.id
    && pathsMatch(state.target.root, record.targetRoot)
    && pathsMatch(state.target.installStatePath, record.installStatePath)
  );
}

function projectInstallState(store, state) {
  try {
    const record = buildInstallStateStoreRecord(state);
    store.upsertInstallState(record);
    return {
      status: 'projected',
      record,
      warning: null,
    };
  } catch (error) {
    return {
      status: 'warning',
      record: null,
      warning: {
        code: 'projection-write-failed',
        message: error.message,
        targetId: state && state.target ? state.target.id : null,
        targetRoot: state && state.target ? state.target.root : null,
        installStatePath: state && state.target ? state.target.installStatePath : null,
      },
    };
  }
}

function removeInstallStateProjection(store, identity) {
  try {
    return {
      status: 'removed',
      removed: store.deleteInstallState(identity),
      warning: null,
    };
  } catch (error) {
    return {
      status: 'warning',
      removed: false,
      warning: {
        code: 'projection-delete-failed',
        message: error.message,
        targetId: identity && identity.targetId ? identity.targetId : null,
        targetRoot: identity && identity.targetRoot ? identity.targetRoot : null,
        installStatePath: null,
      },
    };
  }
}

function createReconciliationResult(discoveredCount) {
  return {
    status: 'ok',
    discoveredCount,
    projectedCount: 0,
    removedCount: 0,
    warningCount: 0,
    warnings: [],
    scopedTargets: [],
    managedFileHealth: [],
  };
}

function addWarning(result, warning) {
  return {
    ...result,
    status: 'warning',
    warningCount: result.warningCount + 1,
    warnings: [...result.warnings, warning],
  };
}

function removeDiscoverableProjection(store, identity, result) {
  const removal = removeInstallStateProjection(store, identity);
  if (removal.warning) {
    return addWarning(result, removal.warning);
  }
  return {
    ...result,
    removedCount: result.removedCount + (removal.removed ? 1 : 0),
  };
}

/**
 * Reconcile only the identities enumerated by install target discovery.
 * Canonical JSON files remain authoritative, and rows from other home or
 * project scopes are deliberately left unchanged.
 */
function reconcileInstallStateProjections(store, discoveryRecords) {
  const records = Array.isArray(discoveryRecords) ? discoveryRecords : [];
  let result = {
    ...createReconciliationResult(records.length),
    scopedTargets: records.map(getRecordIdentity).filter(Boolean),
  };

  for (const record of records) {
    const identity = getRecordIdentity(record);
    if (!identity) {
      result = addWarning(result, warningFor(
        record,
        'invalid-discovery-record',
        'Install target discovery returned an invalid target identity'
      ));
      continue;
    }

    if (!record.exists) {
      result = removeDiscoverableProjection(store, identity, result);
      continue;
    }

    if (record.error || !record.state) {
      result = removeDiscoverableProjection(store, identity, result);
      result = addWarning(result, warningFor(
        record,
        'invalid-install-state',
        record.error || 'Canonical install-state could not be read'
      ));
      continue;
    }

    if (!stateMatchesDiscoveryRecord(record.state, record)) {
      result = removeDiscoverableProjection(store, identity, result);
      result = addWarning(result, warningFor(
        record,
        'install-state-identity-mismatch',
        'Canonical install-state identity does not match its discovered target'
      ));
      continue;
    }

    const projection = projectInstallState(store, record.state);
    if (projection.warning) {
      result = addWarning(result, projection.warning);
      continue;
    }
    result = {
      ...result,
      projectedCount: result.projectedCount + 1,
    };
  }

  return result;
}

function inspectManagedFileHealth(options) {
  const buildReport = options.buildDoctorReport
    || require('../install-lifecycle').buildDoctorReport;
  const report = buildReport({
    repoRoot: options.repoRoot,
    homeDir: options.homeDir,
    projectRoot: options.projectRoot,
    targets: options.targets,
  });

  return report.results.map(result => {
    const issues = Array.isArray(result.issues)
      ? result.issues.filter(issue => MANAGED_FILE_HEALTH_CODES.has(issue.code))
      : [];
    const status = issues.some(issue => issue.severity === 'error')
      ? 'error'
      : issues.some(issue => issue.severity === 'warning') ? 'warning' : 'ok';
    return {
      targetId: result.adapter.id,
      targetRoot: result.targetRoot,
      status,
      issues: issues.map(issue => cloneJsonValue(issue)),
    };
  });
}

function identityKey(identity) {
  return `${identity.targetId}\u0000${path.resolve(identity.targetRoot)}`;
}

function summarizeProjectedInstallHealth(installHealth, reconciliation) {
  const healthEntries = Array.isArray(reconciliation && reconciliation.managedFileHealth)
    ? reconciliation.managedFileHealth
    : [];
  const healthByIdentity = new Map(healthEntries.map(entry => [identityKey(entry), entry]));
  const healthCheckFailed = Boolean(
    reconciliation
    && Array.isArray(reconciliation.warnings)
    && reconciliation.warnings.some(warning => warning.code === 'install-health-check-failed')
  );
  const scopedIdentities = new Set(
    Array.isArray(reconciliation && reconciliation.scopedTargets)
      ? reconciliation.scopedTargets.map(identityKey)
      : []
  );
  const installations = installHealth.installations.map(installation => {
    const key = identityKey(installation);
    const canonicalHealth = healthByIdentity.get(key);
    if (canonicalHealth) {
      return {
        ...installation,
        status: canonicalHealth.status === 'ok' ? installation.status : 'warning',
        canonicalStatus: canonicalHealth.status,
        issues: canonicalHealth.issues.map(issue => cloneJsonValue(issue)),
      };
    }

    if (healthCheckFailed && scopedIdentities.has(key)) {
      return {
        ...installation,
        status: 'warning',
        canonicalStatus: 'unverified',
        issues: [{
          severity: 'warning',
          code: 'install-health-check-failed',
          message: 'Canonical managed-file health could not be verified',
        }],
      };
    }

    return installation;
  });
  const healthyCount = installations.filter(installation => installation.status === 'healthy').length;
  const warningCount = installations.length - healthyCount;

  return {
    ...installHealth,
    status: installations.length === 0
      ? 'missing'
      : warningCount > 0 ? 'warning' : 'healthy',
    healthyCount,
    warningCount,
    installations,
  };
}

function reconcileCurrentInstallState(store, options = {}) {
  try {
    const discover = options.discoverInstalledStates
      || require('../install-lifecycle').discoverInstalledStates;
    const records = discover({
      homeDir: options.homeDir,
      projectRoot: options.projectRoot,
      targets: options.targets,
      env: options.env,
    });
    let result = reconcileInstallStateProjections(store, records);
    try {
      result = {
        ...result,
        managedFileHealth: inspectManagedFileHealth(options),
      };
    } catch (error) {
      result = addWarning(result, {
        code: 'install-health-check-failed',
        message: error.message,
        targetId: null,
        targetRoot: null,
        installStatePath: null,
      });
    }
    return result;
  } catch (error) {
    return {
      ...createReconciliationResult(0),
      status: 'warning',
      warningCount: 1,
      warnings: [{
        code: 'install-state-discovery-failed',
        message: error.message,
        targetId: null,
        targetRoot: null,
        installStatePath: null,
      }],
    };
  }
}

module.exports = {
  buildInstallStateStoreRecord,
  projectInstallState,
  reconcileCurrentInstallState,
  reconcileInstallStateProjections,
  removeInstallStateProjection,
  stateMatchesDiscoveryRecord,
  summarizeProjectedInstallHealth,
};

const fs = require('fs');
const path = require('path');

// Dependency-free, self-contained validation. The installer closure must not
// require any non-builtin package (enterprise supply-chain vetting: the vetted
// bytes must be the installed bytes). install-state is validated by the
// hand-rolled validator below, which enforces the same constraints as
// schemas/install-state.schema.json (ecc.install.v1).

let cachedValidator = null;

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

function getValidator() {
  if (cachedValidator) {
    return cachedValidator;
  }

  cachedValidator = createFallbackValidator();
  return cachedValidator;
}

function createFallbackValidator() {
  const validate = state => {
    const errors = [];
    validate.errors = errors;

    function pushError(instancePath, message) {
      errors.push({
        instancePath,
        message,
      });
    }

    function isNonEmptyString(value) {
      return typeof value === 'string' && value.length > 0;
    }

    function validateNoAdditionalProperties(value, instancePath, allowedKeys) {
      for (const key of Object.keys(value)) {
        if (!allowedKeys.includes(key)) {
          pushError(`${instancePath}/${key}`, 'must NOT have additional properties');
        }
      }
    }

    function validateStringArray(value, instancePath) {
      if (!Array.isArray(value)) {
        pushError(instancePath, 'must be array');
        return;
      }

      for (let index = 0; index < value.length; index += 1) {
        if (!isNonEmptyString(value[index])) {
          pushError(`${instancePath}/${index}`, 'must be non-empty string');
        }
      }
    }

    function validateOptionalString(value, instancePath) {
      if (value !== undefined && value !== null && !isNonEmptyString(value)) {
        pushError(instancePath, 'must be string or null');
      }
    }

    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      pushError('/', 'must be object');
      return false;
    }

    validateNoAdditionalProperties(
      state,
      '',
      ['schemaVersion', 'installedAt', 'lastValidatedAt', 'target', 'request', 'resolution', 'source', 'operations']
    );

    if (state.schemaVersion !== 'ecc.install.v1') {
      pushError('/schemaVersion', 'must equal ecc.install.v1');
    }

    if (!isNonEmptyString(state.installedAt)) {
      pushError('/installedAt', 'must be non-empty string');
    }

    if (state.lastValidatedAt !== undefined && !isNonEmptyString(state.lastValidatedAt)) {
      pushError('/lastValidatedAt', 'must be non-empty string');
    }

    const target = state.target;
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      pushError('/target', 'must be object');
    } else {
      validateNoAdditionalProperties(target, '/target', ['id', 'target', 'kind', 'root', 'installStatePath']);
      if (!isNonEmptyString(target.id)) {
        pushError('/target/id', 'must be non-empty string');
      }
      validateOptionalString(target.target, '/target/target');
      if (target.kind !== undefined && !['home', 'project'].includes(target.kind)) {
        pushError('/target/kind', 'must be equal to one of the allowed values');
      }
      if (!isNonEmptyString(target.root)) {
        pushError('/target/root', 'must be non-empty string');
      }
      if (!isNonEmptyString(target.installStatePath)) {
        pushError('/target/installStatePath', 'must be non-empty string');
      }
    }

    const request = state.request;
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      pushError('/request', 'must be object');
    } else {
      validateNoAdditionalProperties(
        request,
        '/request',
        ['profile', 'modules', 'includeComponents', 'excludeComponents', 'legacyLanguages', 'legacyMode']
      );
      if (!(Object.prototype.hasOwnProperty.call(request, 'profile') && (request.profile === null || typeof request.profile === 'string'))) {
        pushError('/request/profile', 'must be string or null');
      }
      validateStringArray(request.modules, '/request/modules');
      validateStringArray(request.includeComponents, '/request/includeComponents');
      validateStringArray(request.excludeComponents, '/request/excludeComponents');
      validateStringArray(request.legacyLanguages, '/request/legacyLanguages');
      if (typeof request.legacyMode !== 'boolean') {
        pushError('/request/legacyMode', 'must be boolean');
      }
    }

    const resolution = state.resolution;
    if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) {
      pushError('/resolution', 'must be object');
    } else {
      validateNoAdditionalProperties(resolution, '/resolution', ['selectedModules', 'skippedModules']);
      validateStringArray(resolution.selectedModules, '/resolution/selectedModules');
      validateStringArray(resolution.skippedModules, '/resolution/skippedModules');
    }

    const source = state.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      pushError('/source', 'must be object');
    } else {
      validateNoAdditionalProperties(source, '/source', ['repoVersion', 'repoCommit', 'manifestVersion']);
      validateOptionalString(source.repoVersion, '/source/repoVersion');
      validateOptionalString(source.repoCommit, '/source/repoCommit');
      if (!Number.isInteger(source.manifestVersion) || source.manifestVersion < 1) {
        pushError('/source/manifestVersion', 'must be integer >= 1');
      }
    }

    if (!Array.isArray(state.operations)) {
      pushError('/operations', 'must be array');
    } else {
      for (let index = 0; index < state.operations.length; index += 1) {
        const operation = state.operations[index];
        const instancePath = `/operations/${index}`;

        if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
          pushError(instancePath, 'must be object');
          continue;
        }

        if (!isNonEmptyString(operation.kind)) {
          pushError(`${instancePath}/kind`, 'must be non-empty string');
        }
        if (!isNonEmptyString(operation.moduleId)) {
          pushError(`${instancePath}/moduleId`, 'must be non-empty string');
        }
        if (!isNonEmptyString(operation.sourceRelativePath)) {
          pushError(`${instancePath}/sourceRelativePath`, 'must be non-empty string');
        }
        if (!isNonEmptyString(operation.destinationPath)) {
          pushError(`${instancePath}/destinationPath`, 'must be non-empty string');
        }
        if (!isNonEmptyString(operation.strategy)) {
          pushError(`${instancePath}/strategy`, 'must be non-empty string');
        }
        if (!isNonEmptyString(operation.ownership)) {
          pushError(`${instancePath}/ownership`, 'must be non-empty string');
        }
        if (typeof operation.scaffoldOnly !== 'boolean') {
          pushError(`${instancePath}/scaffoldOnly`, 'must be boolean');
        }
      }
    }

    return errors.length === 0;
  };

  validate.errors = [];
  return validate;
}

function formatValidationErrors(errors = []) {
  return errors
    .map(error => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function validateInstallState(state) {
  const validator = getValidator();
  const valid = validator(state);
  return {
    valid,
    errors: validator.errors || [],
  };
}

function assertValidInstallState(state, label) {
  const result = validateInstallState(state);
  if (!result.valid) {
    throw new Error(`Invalid install-state${label ? ` (${label})` : ''}: ${formatValidationErrors(result.errors)}`);
  }
}

function createInstallState(options) {
  const installedAt = options.installedAt || new Date().toISOString();
  const state = {
    schemaVersion: 'ecc.install.v1',
    installedAt,
    target: {
      id: options.adapter.id,
      target: options.adapter.target || undefined,
      kind: options.adapter.kind || undefined,
      root: options.targetRoot,
      installStatePath: options.installStatePath,
    },
    request: {
      profile: options.request.profile || null,
      modules: Array.isArray(options.request.modules) ? [...options.request.modules] : [],
      includeComponents: Array.isArray(options.request.includeComponents)
        ? [...options.request.includeComponents]
        : [],
      excludeComponents: Array.isArray(options.request.excludeComponents)
        ? [...options.request.excludeComponents]
        : [],
      legacyLanguages: Array.isArray(options.request.legacyLanguages)
        ? [...options.request.legacyLanguages]
        : [],
      legacyMode: Boolean(options.request.legacyMode),
    },
    resolution: {
      selectedModules: Array.isArray(options.resolution.selectedModules)
        ? [...options.resolution.selectedModules]
        : [],
      skippedModules: Array.isArray(options.resolution.skippedModules)
        ? [...options.resolution.skippedModules]
        : [],
    },
    source: {
      repoVersion: options.source.repoVersion || null,
      repoCommit: options.source.repoCommit || null,
      manifestVersion: options.source.manifestVersion,
    },
    operations: Array.isArray(options.operations)
      ? options.operations.map(operation => cloneJsonValue(operation))
      : [],
  };

  if (options.lastValidatedAt) {
    state.lastValidatedAt = options.lastValidatedAt;
  }

  assertValidInstallState(state, 'create');
  return state;
}

function readInstallState(filePath) {
  const state = readJson(filePath, 'install-state');
  assertValidInstallState(state, filePath);
  return state;
}

function writeInstallState(filePath, state) {
  assertValidInstallState(state, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

module.exports = {
  createInstallState,
  readInstallState,
  validateInstallState,
  writeInstallState,
};

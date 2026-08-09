'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const YAML = require('yaml');

const repoRoot = path.join(__dirname, '..', '..');
const schemaPaths = {
  capabilities: path.join(repoRoot, 'schemas', 'sandbox-capabilities.schema.json'),
  manifest: path.join(repoRoot, 'schemas', 'sandbox-manifest.schema.json'),
  report: path.join(repoRoot, 'schemas', 'sandbox-report.schema.json'),
};
const MAX_CONTRACT_BYTES = 1024 * 1024;

class ContractValidationError extends Error {
  constructor(contract, errors) {
    super(`${contract} validation failed: ${errors.join('; ')}`);
    this.name = 'ContractValidationError';
    this.contract = contract;
    this.errors = errors;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readBoundedRegularFile(filePath, label = 'contract') {
  const resolved = path.resolve(filePath);
  const descriptor = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | fs.constants.O_NONBLOCK
  );
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) {
      throw new Error(`${label} must be a regular file: ${resolved}`);
    }
    if (stats.size > MAX_CONTRACT_BYTES) {
      throw new Error(`${label} exceeds ${MAX_CONTRACT_BYTES} bytes: ${resolved}`);
    }

    const buffer = Buffer.alloc(MAX_CONTRACT_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_CONTRACT_BYTES) {
      throw new Error(`${label} exceeds ${MAX_CONTRACT_BYTES} bytes: ${resolved}`);
    }
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function createValidator(schemaPath) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  return ajv.compile(readJson(schemaPath));
}

const validateManifestSchema = createValidator(schemaPaths.manifest);
const validateReportSchema = createValidator(schemaPaths.report);
const validateCapabilitiesSchema = createValidator(schemaPaths.capabilities);

function formatAjvErrors(errors = []) {
  return errors.map(error => {
    const location = error.instancePath || '/';
    const detail = error.keyword === 'additionalProperties'
      ? `: ${error.params.additionalProperty}`
      : '';
    return `${location} ${error.message}${detail}`;
  });
}

function semanticManifestErrors(manifest) {
  const errors = [];
  const osTargets = manifest.needs.os;
  const capabilities = manifest.needs.capabilities;
  const specialTargets = osTargets.filter(target => target === 'any' || target === 'all');

  if (specialTargets.length > 0 && osTargets.length !== 1) {
    errors.push('/needs/os any and all must be used alone');
  }

  const networkCapabilities = capabilities.filter(capability => capability.startsWith('network:'));
  if (networkCapabilities.includes('network:*') && networkCapabilities.length > 1) {
    errors.push('/needs/capabilities network:* cannot be combined with domain allowlists');
  }

  if (capabilities.includes('ios-simulator')) {
    const isMacOnly = osTargets.length === 1 && osTargets[0] === 'macos';
    if (!isMacOnly) {
      errors.push('/needs/os ios-simulator requires a single explicit macos target');
    }
  }

  const commandCount = manifest.steps.setup.length + manifest.steps.assert.length;
  if (commandCount > 1000) {
    errors.push('/steps setup and assert may contain at most 1000 commands combined');
  }

  const memoryMatch = manifest.resources.memory.match(/^([1-9][0-9]*)(MB|GB)$/);
  if (memoryMatch) {
    const memoryMb = Number(memoryMatch[1]) * (memoryMatch[2] === 'GB' ? 1024 : 1);
    if (!Number.isSafeInteger(memoryMb) || memoryMb > 1024 * 1024) {
      errors.push('/resources/memory cannot exceed 1024GB');
    }
  }

  for (const [phase, commands] of Object.entries(manifest.steps)) {
    commands.forEach((command, index) => {
      if (command.includes('\0')) {
        errors.push(`/steps/${phase}/${index} commands cannot contain NUL bytes`);
      }
    });
  }

  return errors;
}

function validateManifest(manifest) {
  if (!validateManifestSchema(manifest)) {
    throw new ContractValidationError('sandbox manifest', formatAjvErrors(validateManifestSchema.errors));
  }

  const semanticErrors = semanticManifestErrors(manifest);
  if (semanticErrors.length > 0) {
    throw new ContractValidationError('sandbox manifest', semanticErrors);
  }

  return manifest;
}

function validateCapabilities(capabilities) {
  if (!validateCapabilitiesSchema(capabilities)) {
    throw new ContractValidationError(
      'sandbox capability map',
      formatAjvErrors(validateCapabilitiesSchema.errors)
    );
  }
  return capabilities;
}

function validateReport(report) {
  if (!validateReportSchema(report)) {
    throw new ContractValidationError('sandbox report', formatAjvErrors(validateReportSchema.errors));
  }
  const semanticErrors = semanticReportErrors(report);
  if (semanticErrors.length > 0) {
    throw new ContractValidationError('sandbox report', semanticErrors);
  }
  return report;
}

function semanticReportErrors(report) {
  const errors = [];
  if (report.backend === 'aggregate') {
    report.children.forEach((child, index) => {
      for (const error of semanticReportErrors(child)) {
        errors.push(`/children/${index}${error}`);
      }
    });
    const expected = report.children.some(child => child.result === 'error')
      ? 'error'
      : (report.children.some(child => child.result === 'fail') ? 'fail' : 'pass');
    if (report.result !== expected) {
      errors.push(`/result aggregate result must be ${expected}`);
    }
    const childModes = new Set(report.children.map(child => child.execution_mode));
    const expectedMode = childModes.size === 1 ? report.children[0].execution_mode : 'mixed';
    if (report.execution_mode !== expectedMode) {
      errors.push(`/execution_mode aggregate execution mode must be ${expectedMode}`);
    }
    return errors;
  }

  if (report.install_diff.method === 'none' && report.install_diff.complete) {
    errors.push('/install_diff/complete must be false when method is none');
  }
  if (
    report.result === 'pass'
    && (report.steps.some(step => step.exit !== 0) || report.assertions.some(assertion => !assertion.pass))
  ) {
    errors.push('/result pass requires successful steps and assertions');
  }
  return errors;
}

function parseManifestText(text, source = '<manifest>') {
  if (Buffer.byteLength(text, 'utf8') > MAX_CONTRACT_BYTES) {
    throw new ContractValidationError('sandbox manifest', [
      `${source}: manifest exceeds ${MAX_CONTRACT_BYTES} bytes`,
    ]);
  }
  const document = YAML.parseDocument(text, {
    merge: false,
    prettyErrors: false,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    throw new ContractValidationError(
      'sandbox manifest',
      document.errors.map(error => `${source}: ${error.message}`)
    );
  }
  if (document.warnings.length > 0) {
    throw new ContractValidationError(
      'sandbox manifest',
      document.warnings.map(warning => `${source}: ${warning.message}`)
    );
  }

  let manifest;
  try {
    manifest = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ContractValidationError('sandbox manifest', [`${source}: ${error.message}`]);
  }

  return validateManifest(manifest);
}

function loadManifest(filePath) {
  const resolved = path.resolve(filePath);
  let text;
  try {
    text = readBoundedRegularFile(resolved, 'Sandbox manifest');
  } catch (error) {
    throw new ContractValidationError('sandbox manifest', [error.message]);
  }
  return parseManifestText(text, resolved);
}

module.exports = {
  ContractValidationError,
  MAX_CONTRACT_BYTES,
  formatAjvErrors,
  loadManifest,
  parseManifestText,
  readBoundedRegularFile,
  schemaPaths,
  semanticManifestErrors,
  semanticReportErrors,
  validateManifest,
  validateCapabilities,
  validateReport,
};

'use strict';

const { readBoundedRegularFile } = require('./contracts');

function validateMockScenario(value, adapter = 'sandbox') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${adapter} mock scenario must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'results') {
    throw new Error(`${adapter} mock scenario permits only a results array`);
  }
  if (!Array.isArray(value.results) || value.results.length < 1 || value.results.length > 1000) {
    throw new Error(`${adapter} mock results must contain 1-1000 entries`);
  }
  return value.results.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${adapter} mock result ${index} must be an object`);
    }
    const allowed = new Set(['status', 'stdout', 'stderr', 'error']);
    const unknown = Object.keys(entry).filter(key => !allowed.has(key));
    if (unknown.length > 0) {
      throw new Error(`${adapter} mock result ${index} has unknown key: ${unknown[0]}`);
    }
    if (!Number.isInteger(entry.status) && entry.status !== null) {
      throw new Error(`${adapter} mock result ${index} status must be an integer or null`);
    }
    for (const field of ['stdout', 'stderr', 'error']) {
      if (entry[field] !== undefined && typeof entry[field] !== 'string') {
        throw new Error(`${adapter} mock result ${index} ${field} must be a string`);
      }
    }
    return {
      status: entry.status,
      stdout: entry.stdout || '',
      stderr: entry.stderr || '',
      error: entry.error ? new Error(entry.error) : null,
    };
  });
}

function loadMockScenario(filePath, adapter) {
  return validateMockScenario(
    JSON.parse(readBoundedRegularFile(filePath, `${adapter} mock scenario`)),
    adapter
  );
}

function mockRunner(results) {
  let index = 0;
  return () => {
    if (index >= results.length) {
      return {
        status: null,
        stdout: '',
        stderr: '',
        error: new Error('Sandbox mock scenario ran out of results'),
      };
    }
    const result = results[index];
    index += 1;
    return result;
  };
}

module.exports = { loadMockScenario, mockRunner, validateMockScenario };

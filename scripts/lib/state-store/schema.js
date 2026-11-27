'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const SCHEMA_PATH = path.join(__dirname, '..', '..', '..', 'schemas', 'state-store.schema.json');

const ENTITY_DEFINITIONS = {
  session: 'session',
  skillRun: 'skillRun',
  skillVersion: 'skillVersion',
  decision: 'decision',
  installState: 'installState',
  governanceEvent: 'governanceEvent',
  workItem: 'workItem',
};

let cachedSchema = null;
let cachedAjv = null;
const cachedValidators = new Map();

function readSchema() {
  if (cachedSchema) {
    return cachedSchema;
  }

  cachedSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return cachedSchema;
}

function getAjv() {
  if (cachedAjv) {
    return cachedAjv;
  }

  cachedAjv = new Ajv({
    allErrors: true,
    strict: false,
  });
  return cachedAjv;
}

function getEntityValidator(entityName) {
  if (cachedValidators.has(entityName)) {
    return cachedValidators.get(entityName);
  }

  const schema = readSchema();
  const definitionName = ENTITY_DEFINITIONS[entityName];

  if (!definitionName || !schema.$defs || !schema.$defs[definitionName]) {
    throw new Error(`Unknown state-store schema entity: ${entityName}`);
  }

  const validatorSchema = {
    $schema: schema.$schema,
    ...schema.$defs[definitionName],
    $defs: schema.$defs,
  };
  const validator = getAjv().compile(validatorSchema);
  cachedValidators.set(entityName, validator);
  return validator;
}

function formatValidationErrors(errors = []) {
  return errors
    .map(error => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function validateEntity(entityName, payload) {
  const validator = getEntityValidator(entityName);
  const valid = validator(payload);
  return {
    valid,
    errors: validator.errors || [],
  };
}

function assertValidEntity(entityName, payload, label) {
  const result = validateEntity(entityName, payload);
  if (!result.valid) {
    throw new Error(`Invalid ${entityName}${label ? ` (${label})` : ''}: ${formatValidationErrors(result.errors)}`);
  }
}

module.exports = {
  assertValidEntity,
  formatValidationErrors,
  readSchema,
  validateEntity,
};

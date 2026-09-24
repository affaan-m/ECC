function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function parseJsonLikeValue(value, label) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid ${label}: ${error.message}`);
    }
  }

  if (value === null || Array.isArray(value) || isPlainObject(value) || typeof value === 'number' || typeof value === 'boolean') {
    return cloneJsonValue(value);
  }

  throw new Error(`Invalid ${label}: expected JSON-compatible data`);
}

function getOperationTextContent(operation) {
  const candidateKeys = ['renderedContent', 'content', 'managedContent', 'expectedContent', 'templateOutput'];

  for (const key of candidateKeys) {
    if (typeof operation[key] === 'string') {
      return operation[key];
    }
  }

  return null;
}

function getOperationJsonPayload(operation) {
  const candidateKeys = ['mergePayload', 'managedPayload', 'payload', 'value', 'expectedValue'];

  for (const key of candidateKeys) {
    if (operation[key] !== undefined) {
      return parseJsonLikeValue(operation[key], `${operation.kind}.${key}`);
    }
  }

  return undefined;
}

function getOperationPreviousContent(operation) {
  const candidateKeys = ['previousContent', 'originalContent', 'backupContent'];

  for (const key of candidateKeys) {
    if (typeof operation[key] === 'string') {
      return operation[key];
    }
  }

  return null;
}

function getOperationPreviousJson(operation) {
  const candidateKeys = ['previousValue', 'previousJson', 'originalValue'];

  for (const key of candidateKeys) {
    if (operation[key] !== undefined) {
      return parseJsonLikeValue(operation[key], `${operation.kind}.${key}`);
    }
  }

  return undefined;
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function deepMergeJson(baseValue, patchValue) {
  if (!isPlainObject(baseValue) || !isPlainObject(patchValue)) {
    return cloneJsonValue(patchValue);
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(patchValue)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeJson(merged[key], value);
    } else {
      merged[key] = cloneJsonValue(value);
    }
  }
  return merged;
}

function jsonContainsSubset(actualValue, expectedValue) {
  if (isPlainObject(expectedValue)) {
    if (!isPlainObject(actualValue)) {
      return false;
    }

    return Object.entries(expectedValue).every(([key, value]) => Object.prototype.hasOwnProperty.call(actualValue, key) && jsonContainsSubset(actualValue[key], value));
  }

  if (Array.isArray(expectedValue)) {
    if (!Array.isArray(actualValue) || actualValue.length !== expectedValue.length) {
      return false;
    }

    return expectedValue.every((item, index) => jsonContainsSubset(actualValue[index], item));
  }

  return actualValue === expectedValue;
}

const JSON_REMOVE_SENTINEL = Symbol('json-remove');

function deepRemoveJsonSubset(currentValue, managedValue) {
  if (isPlainObject(managedValue)) {
    if (!isPlainObject(currentValue)) {
      return currentValue;
    }

    const nextValue = { ...currentValue };
    for (const [key, value] of Object.entries(managedValue)) {
      if (!Object.prototype.hasOwnProperty.call(nextValue, key)) {
        continue;
      }

      if (isPlainObject(value)) {
        const nestedValue = deepRemoveJsonSubset(nextValue[key], value);
        if (nestedValue === JSON_REMOVE_SENTINEL) {
          delete nextValue[key];
        } else {
          nextValue[key] = nestedValue;
        }
        continue;
      }

      if (Array.isArray(value)) {
        if (Array.isArray(nextValue[key]) && jsonContainsSubset(nextValue[key], value)) {
          delete nextValue[key];
        }
        continue;
      }

      if (nextValue[key] === value) {
        delete nextValue[key];
      }
    }

    return Object.keys(nextValue).length === 0 ? JSON_REMOVE_SENTINEL : nextValue;
  }

  if (Array.isArray(managedValue)) {
    return jsonContainsSubset(currentValue, managedValue) ? JSON_REMOVE_SENTINEL : currentValue;
  }

  return currentValue === managedValue ? JSON_REMOVE_SENTINEL : currentValue;
}

module.exports = {
  JSON_REMOVE_SENTINEL,
  cloneJsonValue,
  deepMergeJson,
  deepRemoveJsonSubset,
  formatJson,
  getOperationJsonPayload,
  getOperationPreviousContent,
  getOperationPreviousJson,
  getOperationTextContent,
  isPlainObject,
  jsonContainsSubset,
  parseJsonLikeValue,
};

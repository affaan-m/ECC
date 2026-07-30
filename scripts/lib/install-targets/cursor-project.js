const fs = require('fs');
const path = require('path');

const { toCursorAgentFileName } = require('../cursor-agent-names');
const {
  createFlatFileOperations,
  createFlatRuleOperations,
  createInstallTargetAdapter,
  createManagedOperation,
  isForeignPlatformPath,
} = require('./helpers');

function toCursorRuleFileName(fileName, sourceRelativeFile) {
  if (path.basename(sourceRelativeFile).toLowerCase() === 'readme.md') {
    return null;
  }

  return fileName.endsWith('.md')
    ? `${fileName.slice(0, -3)}.mdc`
    : fileName;
}

function readJsonObject(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${label} at ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} at ${filePath}: expected a JSON object`);
  }

  return parsed;
}

function createJsonMergeOperation({ moduleId, repoRoot, sourceRelativePath, destinationPath }) {
  const sourcePath = path.join(repoRoot, sourceRelativePath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return null;
  }

  return createManagedOperation({
    kind: 'merge-json',
    moduleId,
    sourceRelativePath,
    destinationPath,
    strategy: 'merge-json',
    ownership: 'managed',
    scaffoldOnly: false,
    mergePayload: readJsonObject(sourcePath, sourceRelativePath),
  });
}

module.exports = createInstallTargetAdapter({
  id: 'cursor-project',
  target: 'cursor',
  kind: 'project',
  rootSegments: ['.cursor'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.cursor',
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const seenDestinationPaths = new Set();
    const {
      repoRoot,
      projectRoot,
      homeDir,
    } = input;
    const selectedModuleIds = new Set(modules.map(module => module.id));
    const includeNativeHooks = selectedModuleIds.has('hooks-runtime');
    const includeMcpCatalog = selectedModuleIds.has('mcp-catalog');
    const includeLanguageCatalog = selectedModuleIds.has('framework-language');
    const planningInput = {
      repoRoot,
      projectRoot,
      homeDir,
    };
    const targetRoot = adapter.resolveRoot(planningInput);
    const entries = modules.flatMap((module, moduleIndex) => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(p => !isForeignPlatformPath(p, adapter.target))
        .map((sourceRelativePath, pathIndex) => ({
          module,
          sourceRelativePath,
          moduleIndex,
          pathIndex,
        }));
    }).sort((left, right) => {
      const getPriority = value => {
        if (value === '.cursor') {
          return 0;
        }

        if (value === 'rules') {
          return 1;
        }

        return 2;
      };

      const leftPriority = getPriority(left.sourceRelativePath);
      const rightPriority = getPriority(right.sourceRelativePath);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      if (left.moduleIndex !== right.moduleIndex) {
        return left.moduleIndex - right.moduleIndex;
      }

      return left.pathIndex - right.pathIndex;
    });

    function takeUniqueOperations(operations) {
      return operations.filter(operation => {
        if (!operation || !operation.destinationPath) {
          return false;
        }

        if (seenDestinationPaths.has(operation.destinationPath)) {
          return false;
        }

        seenDestinationPaths.add(operation.destinationPath);
        return true;
      });
    }

    return entries.flatMap(({ module, sourceRelativePath }) => {
      const cursorMcpOperation = includeMcpCatalog
        ? createJsonMergeOperation({
          moduleId: 'mcp-catalog',
          repoRoot,
          sourceRelativePath: '.mcp.json',
          destinationPath: path.join(targetRoot, 'mcp.json'),
        })
        : null;

      if (sourceRelativePath === 'AGENTS.md') {
        // Cursor treats nested AGENTS.md files as directory context; do not
        // install ECC's root project identity into a host project's .cursor/.
        return [];
      }

      if (sourceRelativePath === 'rules') {
        const operations = createFlatRuleOperations({
          moduleId: module.id,
          repoRoot,
          sourceRelativePath,
          destinationDir: path.join(targetRoot, 'rules'),
          destinationNameTransform: toCursorRuleFileName,
        });
        return takeUniqueOperations(includeLanguageCatalog ? operations : operations.filter(
          operation => String(operation.sourceRelativePath || '')
            .replace(/\\/g, '/')
            .startsWith('rules/common/')
        ));
      }

      if (sourceRelativePath === 'agents') {
        return takeUniqueOperations(createFlatFileOperations({
          moduleId: module.id,
          repoRoot,
          sourceRelativePath,
          destinationDir: path.join(targetRoot, 'agents'),
          destinationNameTransform: toCursorAgentFileName,
        }));
      }

      if (sourceRelativePath === '.cursor') {
        const cursorRoot = path.join(repoRoot, '.cursor');
        if (!fs.existsSync(cursorRoot) || !fs.statSync(cursorRoot).isDirectory()) {
          return [];
        }

        const childOperations = fs.readdirSync(cursorRoot, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name))
          .filter(entry => entry.name !== 'rules')
          .filter(entry => entry.name !== 'skills')
          .filter(entry => (
            includeNativeHooks
            || (entry.name !== 'hooks' && entry.name !== 'hooks.json')
          ))
          .map(entry => createManagedOperation({
            moduleId: module.id,
            sourceRelativePath: path.join('.cursor', entry.name),
            destinationPath: path.join(targetRoot, entry.name),
            strategy: 'preserve-relative-path',
          }));

        const allRuleOperations = createFlatRuleOperations({
          moduleId: module.id,
          repoRoot,
          sourceRelativePath: '.cursor/rules',
          destinationDir: path.join(targetRoot, 'rules'),
          destinationNameTransform: toCursorRuleFileName,
        });
        const ruleOperations = includeLanguageCatalog
          ? allRuleOperations
          : allRuleOperations.filter(operation => (
            path.basename(operation.sourceRelativePath).startsWith('common-')
          ));

        return takeUniqueOperations([
          ...childOperations,
          ...(cursorMcpOperation ? [cursorMcpOperation] : []),
          ...ruleOperations,
        ]);
      }

      if (sourceRelativePath === 'mcp-configs') {
        const operations = [
          adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput),
        ];
        if (cursorMcpOperation) {
          operations.push(cursorMcpOperation);
        }
        return takeUniqueOperations(operations);
      }

      return takeUniqueOperations([
        adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput),
      ]);
    });
  },
});

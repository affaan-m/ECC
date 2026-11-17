'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { buildDependencyGraph, buildDependencyGraphFromSources, extractRelativeSpecifiers } = require('../../scripts/lib/agent-proximity/graph');
const { buildProximitySnapshot } = require('../../scripts/lib/control-pane/proximity');

test('namespace re-exports retain relative dependencies across whitespace and identifier spellings', () => {
  const source = [
    "export * as models from './models.js';",
    'export\n*\nas\n$helpers\nfrom\n"../helpers.js";',
    "export * as 模型 from './unicode.js';",
    "export * as from from './keyword.js';",
  ].join('\n');
  assert.deepStrictEqual(extractRelativeSpecifiers(source), [
    './models.js', '../helpers.js', './unicode.js', './keyword.js',
  ]);
});

test('type-only named, star and namespace re-exports retain their source dependencies', () => {
  const source = [
    "export type { Item, User as Account } from './models';",
    'export type * from "./types";',
    "export type * as Schema from '../schema';",
    "export\ntype\n{\nResult,\n}\nfrom './result';",
  ].join('\n');
  assert.deepStrictEqual(extractRelativeSpecifiers(source), [
    './models', './types', '../schema', './result',
  ]);
});

test('real re-export files raise the public dashboard dependency risk for concurrent edits', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reexport-'));
  try {
    const source = 'apps/web/index.ts';
    const target = 'packages/model.ts';
    fs.mkdirSync(path.join(repoRoot, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'packages'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, target), 'export interface Item { id: number }\n');
    const options = {
      repoRoot,
      workingSetFor: session => [{ path: session.id === 'web' ? source : target }],
    };
    const sessions = [{ id: 'web' }, { id: 'model' }];
    fs.writeFileSync(path.join(repoRoot, source), 'export const unrelated = 1;\n');
    const unrelated = buildProximitySnapshot(sessions, options);
    assert.strictEqual(unrelated.links[0].channels.dependency, 0);

    for (const declaration of ['* as models', 'type { Item }', 'type *', 'type * as models']) {
      const content = `export ${declaration} from '../../packages/model';\n`;
      fs.writeFileSync(path.join(repoRoot, source), content);
      const graph = buildDependencyGraph(repoRoot, [source, target]);
      assert.deepStrictEqual(graph.adjacency[source], [target], declaration);
      assert.deepStrictEqual(buildDependencyGraphFromSources({
        [source]: content, [target]: 'export interface Item { id: number }',
      }).adjacency, graph.adjacency, declaration);

      const snapshot = buildProximitySnapshot(sessions, options);
      assert.strictEqual(snapshot.links[0].channels.dependency, 1, declaration);
      assert.ok(snapshot.links[0].risk > unrelated.links[0].risk, declaration);
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('existing imports, ordinary re-exports, deduplication and relative-only resolution remain intact', () => {
  const source = [
    "const model = require('./model');",
    "import { Item } from './model';",
    "import type { User } from './model';",
    "import './side-effect';",
    "const dynamic = import('./dynamic');",
    "export * from './model';",
    "export { Item as Result } from './model';",
    "export { type User } from './model';",
    "export * as ignored from 'third-party';",
    "export type { External } from 'third-party';",
    "export type * from 'third-party';",
    "export type * as Ignored from 'third-party';",
    "export const text = './not-a-dependency';",
  ].join('\n');
  for (let repeat = 0; repeat < 3; repeat += 1) {
    assert.deepStrictEqual(extractRelativeSpecifiers(source), ['./model', './side-effect', './dynamic']);
    assert.deepStrictEqual(extractRelativeSpecifiers('export type { Item };\nexport { local };'), []);
  }
  const graph = buildDependencyGraphFromSources({
    'index.ts': source,
    'model.ts': "export * from './model';",
    'side-effect.js': '',
    'dynamic/index.js': '',
  });
  assert.deepStrictEqual(graph.adjacency['index.ts'], ['model.ts', 'side-effect.js', 'dynamic/index.js']);
  assert.deepStrictEqual(graph.adjacency['model.ts'], []);
});

test('incomplete namespace and type-only declarations remain bounded on large whitespace inputs', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { extractRelativeSpecifiers } = require(process.argv[1]);
    const padding = ' '.repeat(250000);
    for (const source of ['export' + padding, 'export type' + padding,
      'export * as' + padding, 'export type * as name' + padding]) {
      assert.deepStrictEqual(extractRelativeSpecifiers(source), []);
    }
  `, require.resolve('../../scripts/lib/agent-proximity/graph')], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
});

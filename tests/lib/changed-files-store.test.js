const assert = require('assert')
const path = require('path')
const { pathToFileURL } = require('url')

const repoRoot = path.join(__dirname, '..', '..')
const storePath = path.join(repoRoot, '.opencode', 'dist', 'plugins', 'lib', 'changed-files-store.js')

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    return true
  } catch (err) {
    console.log(`  ✗ ${name}`)
    console.log(`    Error: ${err.message}`)
    return false
  }
}

async function runTests() {
  let passed = 0
  let failed = 0

  let store
  try {
    store = await import(pathToFileURL(storePath).href)
  } catch (_err) {
    console.log('\n[warn] Skipping: build .opencode first (cd .opencode && npm run build)\n')
    process.exit(0)
  }

  const { initStore, recordChange, buildTree, clearChanges, getChanges, getChangedPaths, hasChanges } = store
  const worktree = path.join(repoRoot, '.opencode')

  console.log('\n=== Testing changed-files-store ===\n')

  if (
    test('initStore and recordChange store relative path', () => {
      clearChanges()
      initStore(worktree)
      recordChange(path.join(worktree, 'src/foo.ts'), 'modified')
      const m = getChanges()
      assert.strictEqual(m.size, 1)
      assert.ok(m.has('src/foo.ts') || m.has(path.join('src', 'foo.ts')))
      assert.strictEqual(m.get(m.keys().next().value), 'modified')
    })
  )
    passed++
  else failed++

  if (
    test('recordChange with relative path stores as-is when under worktree', () => {
      clearChanges()
      initStore(worktree)
      recordChange('plugins/ecc-hooks.ts', 'modified')
      const m = getChanges()
      assert.strictEqual(m.size, 1)
      const key = [...m.keys()][0]
      assert.ok(key.includes('ecc-hooks'))
    })
  )
    passed++
  else failed++

  if (
    test('recordChange overwrites existing path with new type', () => {
      clearChanges()
      initStore(worktree)
      recordChange('a.ts', 'modified')
      recordChange('a.ts', 'added')
      const m = getChanges()
      assert.strictEqual(m.size, 1)
      assert.strictEqual(m.get([...m.keys()][0]), 'added')
    })
  )
    passed++
  else failed++

  if (
    test('buildTree returns nested structure', () => {
      clearChanges()
      initStore(worktree)
      recordChange('src/a.ts', 'modified')
      recordChange('src/b.ts', 'added')
      recordChange('src/sub/c.ts', 'deleted')
      const tree = buildTree()
      assert.strictEqual(tree.length, 1)
      assert.strictEqual(tree[0].name, 'src')
      assert.strictEqual(tree[0].children.length, 3)
      const names = tree[0].children.map((n) => n.name).sort()
      assert.deepStrictEqual(names, ['a.ts', 'b.ts', 'sub'])
    })
  )
    passed++
  else failed++

  if (
    test('buildTree filter restricts by change type', () => {
      clearChanges()
      initStore(worktree)
      recordChange('a.ts', 'added')
      recordChange('b.ts', 'modified')
      recordChange('c.ts', 'deleted')
      const added = buildTree('added')
      assert.strictEqual(added.length, 1)
      assert.strictEqual(added[0].changeType, 'added')
      const modified = buildTree('modified')
      assert.strictEqual(modified.length, 1)
      assert.strictEqual(modified[0].changeType, 'modified')
    })
  )
    passed++
  else failed++

  if (
    test('getChangedPaths returns sorted list with filter', () => {
      clearChanges()
      initStore(worktree)
      recordChange('z.ts', 'modified')
      recordChange('a.ts', 'modified')
      const paths = getChangedPaths('modified')
      assert.strictEqual(paths.length, 2)
      assert.ok(paths[0].path <= paths[1].path)
    })
  )
    passed++
  else failed++

  if (
    test('hasChanges reflects state', () => {
      clearChanges()
      initStore(worktree)
      assert.strictEqual(hasChanges(), false)
      recordChange('x.ts', 'modified')
      assert.strictEqual(hasChanges(), true)
      clearChanges()
      assert.strictEqual(hasChanges(), false)
    })
  )
    passed++
  else failed++

  if (
    test('clearChanges clears all', () => {
      clearChanges()
      initStore(worktree)
      recordChange('a.ts', 'modified')
      recordChange('b.ts', 'added')
      clearChanges()
      assert.strictEqual(getChanges().size, 0)
    })
  )
    passed++
  else failed++

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch((err) => {
  console.error(err)
  process.exit(1)
})

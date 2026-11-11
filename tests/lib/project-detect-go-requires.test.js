'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { detectProjectType, getGoDeps } = require('../../scripts/lib/project-detect');

function withGoMod(contents, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-go-requires-'));
  try {
    fs.writeFileSync(path.join(dir, 'go.mod'), contents);
    check(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('detects a framework declared by a standalone require directive', () => {
  withGoMod('module example.com/app\n\ngo 1.23\nrequire github.com/gin-gonic/gin v1.10.0\n', dir => {
    assert.deepEqual(getGoDeps(dir), ['github.com/gin-gonic/gin']);
    assert.equal(detectProjectType(dir).primary, 'gin');
  });
});

test('reads every require block and standalone directive in source order', () => {
  withGoMod([
    'module example.com/app',
    'require (',
    '  example.com/first v1.0.0 // indirect',
    ')',
    'require github.com/labstack/echo/v4 v4.13.0',
    'require ( // a second dependency group',
    '  github.com/gin-gonic/gin v1.10.0',
    ')',
  ].join('\n'), dir => {
    assert.deepEqual(getGoDeps(dir), [
      'example.com/first', 'github.com/labstack/echo/v4', 'github.com/gin-gonic/gin',
    ]);
    assert.deepEqual(detectProjectType(dir).frameworks, ['gin', 'echo']);
  });
});

test('ignores commented and replacement-only framework references', () => {
  withGoMod([
    'module example.com/app',
    '// require github.com/gin-gonic/gin v1.10.0',
    'replace github.com/gin-gonic/gin => ../gin',
    'exclude github.com/labstack/echo/v4 v4.12.0',
    'require (',
    '  // github.com/gin-gonic/gin v1.10.0',
    '  example.com/actual v1.0.0',
    ')',
  ].join('\n'), dir => {
    assert.deepEqual(getGoDeps(dir), ['example.com/actual']);
    assert.deepEqual(detectProjectType(dir).frameworks, []);
  });
});

test('accepts quoted module paths and CRLF require directives', () => {
  withGoMod('module example.com/app\r\nrequire "github.com/gin-gonic/gin" v1.10.0\r\n', dir => {
    assert.deepEqual(getGoDeps(dir), ['github.com/gin-gonic/gin']);
  });
});

test('accepts quoted versions in standalone and grouped requirements', () => {
  withGoMod([
    'module example.com/app',
    'require "github.com/gin-gonic/gin" "v1.10.0"',
    'require (',
    '  github.com/labstack/echo/v4 "v4.13.0"',
    ')',
  ].join('\n'), dir => {
    assert.deepEqual(getGoDeps(dir), ['github.com/gin-gonic/gin', 'github.com/labstack/echo/v4']);
  });
});

test('accepts adjacent block punctuation and raw string tokens', () => {
  withGoMod([
    'module example.com/app',
    'require(',
    '  github.com/gin-gonic/gin `v1.10.0`',
    ')',
    'require `github.com/labstack/echo/v4` "v4.13.0"',
  ].join('\n'), dir => {
    assert.deepEqual(getGoDeps(dir), ['github.com/gin-gonic/gin', 'github.com/labstack/echo/v4']);
  });
});

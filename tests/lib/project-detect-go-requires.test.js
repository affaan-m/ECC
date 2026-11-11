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

test('decodes Go escapes in quoted module paths before framework detection', () => {
  for (const escaped of [String.raw`\x67`, String.raw`\147`, String.raw`\u0067`, String.raw`\U00000067`]) {
    for (const newline of ['\n', '\r\n']) {
      withGoMod([
        'module example.com/app',
        `require "github.com/gin-gonic/${escaped}in" "\\x761.10.0"`,
        'require(',
        String.raw`  "github.com/labstack/\x65cho/v4" v4.13.0`,
        ')',
      ].join(newline), dir => {
        assert.deepEqual(getGoDeps(dir), ['github.com/gin-gonic/gin', 'github.com/labstack/echo/v4']);
        assert.deepEqual(detectProjectType(dir).frameworks, ['gin', 'echo']);
      });
    }
  }
});

test('rejects malformed quoted escapes without losing later requirements', () => {
  for (const escaped of [String.raw`\q`, String.raw`\x6`, String.raw`\777`, String.raw`\uD800`, String.raw`\U00110000`]) {
    withGoMod([
      'module example.com/app',
      `require "github.com/gin-gonic/${escaped}in" v1.10.0`,
      'require github.com/labstack/echo/v4 v4.13.0',
    ].join('\n'), dir => {
      assert.deepEqual(getGoDeps(dir), ['github.com/labstack/echo/v4']);
    });
  }
});

test('preserves raw quoted paths and decodes byte escapes as UTF-8', () => {
  withGoMod([
    'module example.com/app',
    'require `github.com/gin-gonic/\\x67in` v1.10.0',
    String.raw`require "example.com/\xc3\xa9" v1.0.0`,
    String.raw`require "\ufeffgithub.com/gin-gonic/gin" v1.10.0`,
  ].join('\n'), dir => {
    assert.deepEqual(getGoDeps(dir), [String.raw`github.com/gin-gonic/\x67in`, 'example.com/é', '\ufeffgithub.com/gin-gonic/gin']);
    assert.deepEqual(detectProjectType(dir).frameworks, []);
  });
});

test('accepts adjacent quoted module and version tokens', () => {
  for (const newline of ['\n', '\r\n']) {
    withGoMod([
      'module example.com/app',
      String.raw`require "github.com/gin-gonic/\x67in""v1.10.0"`,
      'require(',
      '  "github.com/labstack/echo/v4""v4.13.0"',
      ')',
    ].join(newline), dir => {
      assert.deepEqual(getGoDeps(dir), ['github.com/gin-gonic/gin', 'github.com/labstack/echo/v4']);
      assert.deepEqual(detectProjectType(dir).frameworks, ['gin', 'echo']);
    });
  }
});

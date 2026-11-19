/**
 * Tests for the UI Canvas inspector field helpers
 * (scripts/lib/ui-canvas/fields.js): typed-value sanitization, color
 * parsing and conversion, and the inlined browser source.
 *
 * Run with: node tests/lib/ui-canvas-fields.test.js
 */

const assert = require('assert');
const vm = require('vm');

const fields = require('../../scripts/lib/ui-canvas/fields');
const {
  FIELD_HELPERS_JS,
  clampNumber,
  colorHex,
  formatColor,
  formatNumber,
  hslToRgb,
  parseColor,
  rgbToHsl,
  roundToStep,
  sanitizeBoxList,
  sanitizeCssText,
  sanitizeNumber
} = fields;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}\n    ${error.stack || error.message}`);
  }
}

const PX = { unit: 'px', units: ['px', 'rem', 'em', '%'], min: 0, max: 999, step: 1 };

console.log('ui-canvas field helpers');

test('numbers clamp, round to step and format without trailing zeros', () => {
  assert.strictEqual(clampNumber(5, 0, 3), 3);
  assert.strictEqual(clampNumber(-1, 0, 3), 0);
  assert.strictEqual(roundToStep(1.234, 0.05), 1.25);
  assert.strictEqual(roundToStep(7.6, 1), 8);
  assert.strictEqual(roundToStep(7.6, 0), 7.6);
  assert.strictEqual(formatNumber(1.81818), '1.82');
  assert.strictEqual(formatNumber(16), '16');
  assert.strictEqual(formatNumber(NaN), '');
});

test('sanitizeNumber accepts plain numbers, units and spacing', () => {
  assert.deepStrictEqual(sanitizeNumber('16', PX), { ok: true, value: 16, unit: 'px', css: '16px' });
  assert.strictEqual(sanitizeNumber(' 1.5 rem ', { ...PX, step: 0.1 }).css, '1.5rem');
  assert.strictEqual(sanitizeNumber('12PX', PX).css, '12px');
  assert.strictEqual(sanitizeNumber('2,5', { ...PX, step: 0.5 }).css, '2.5px', 'comma decimal');
  assert.strictEqual(sanitizeNumber('.5', { unit: '', units: [''], step: 0.1 }).css, '0.5');
  assert.strictEqual(sanitizeNumber(7, { unit: '', units: [''] }).css, '7', 'missing min/max/step means unbounded');
});

test('sanitizeNumber clamps out-of-range values instead of rejecting them', () => {
  assert.strictEqual(sanitizeNumber('5000', PX).value, 999);
  assert.strictEqual(sanitizeNumber('-4', PX).value, 0);
});

test('sanitizeNumber rejects junk and unknown units with a readable error', () => {
  assert.deepStrictEqual(sanitizeNumber('', PX), { ok: false, error: 'Enter a number' });
  assert.strictEqual(sanitizeNumber(null, PX).ok, false);
  assert.strictEqual(sanitizeNumber('abc', PX).error, 'Not a number');
  assert.strictEqual(sanitizeNumber('12px;color:red', PX).ok, false);
  assert.strictEqual(sanitizeNumber('1e999', PX).ok, false);
  assert.strictEqual(sanitizeNumber('12vw', PX).error, 'Use px, rem, em, %');
  assert.strictEqual(sanitizeNumber('3px', { unit: '', units: [''] }).error, 'Use a plain number');
});

test('ratio fields take 50, 50% or 0.5 and land on 0..1', () => {
  const ratio = { ratio: true, min: 0, max: 1, step: 0.01 };
  assert.strictEqual(sanitizeNumber('50', ratio).value, 0.5);
  assert.strictEqual(sanitizeNumber('50%', ratio).value, 0.5);
  assert.strictEqual(sanitizeNumber('0.5', ratio).value, 0.5);
  assert.strictEqual(sanitizeNumber('1', ratio).value, 1);
  assert.strictEqual(sanitizeNumber('250%', ratio).value, 1);
  assert.strictEqual(sanitizeNumber('0.5px', ratio).ok, false);
});

test('sanitizeBoxList handles 1 to 4 sides, auto and part limits', () => {
  assert.deepStrictEqual(sanitizeBoxList('8 16', PX), { ok: true, css: '8px 16px' });
  assert.strictEqual(sanitizeBoxList('0 auto', { ...PX, allowAuto: true }).css, '0 auto');
  assert.strictEqual(sanitizeBoxList('1,2,3,4', PX).css, '1px 2px 3px 4px');
  assert.strictEqual(sanitizeBoxList('0 auto', PX).ok, false, 'auto only where allowed');
  assert.strictEqual(sanitizeBoxList('1 2 3', { ...PX, maxParts: 2 }).error, 'Use at most 2 values');
  assert.strictEqual(sanitizeBoxList('  ', PX).error, 'Enter a value');
  assert.strictEqual(sanitizeBoxList(undefined, PX).ok, false);
});

test('parseColor reads hex, rgb(), rgba(), space syntax and transparent', () => {
  assert.deepStrictEqual(parseColor('#16a34a'), { r: 22, g: 163, b: 74, a: 1 });
  assert.deepStrictEqual(parseColor('fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepStrictEqual(parseColor('#0008'), { r: 0, g: 0, b: 0, a: 0.533 });
  assert.deepStrictEqual(parseColor('#00000080'), { r: 0, g: 0, b: 0, a: 0.502 });
  assert.deepStrictEqual(parseColor('rgb(22, 163, 74)'), { r: 22, g: 163, b: 74, a: 1 });
  assert.deepStrictEqual(parseColor('rgba(22, 163, 74, 0.12)'), { r: 22, g: 163, b: 74, a: 0.12 });
  assert.deepStrictEqual(parseColor('rgb(100% 0% 0% / 50%)'), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.deepStrictEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepStrictEqual(parseColor('rgba(300, -5, 0, 4)'), { r: 255, g: 0, b: 0, a: 1 }, 'channels clamp');
});

test('parseColor rejects anything it cannot read', () => {
  for (const bad of ['', null, 'red', '#12', '#12345', 'rgb(1,2)', 'rgb(a,b,c)', 'rgb(1,2,3,4,5)', 'hsl(0,0%,0%)']) {
    assert.strictEqual(parseColor(bad), null, String(bad));
  }
});

test('formatColor and colorHex round-trip opaque and translucent colors', () => {
  assert.strictEqual(formatColor({ r: 22, g: 163, b: 74, a: 1 }), '#16a34a');
  assert.strictEqual(formatColor({ r: 22, g: 163, b: 74, a: 0.5 }), 'rgba(22, 163, 74, 0.5)');
  assert.strictEqual(colorHex({ r: 22, g: 163, b: 74, a: 0.2 }), '#16A34A');
  assert.deepStrictEqual(parseColor(formatColor({ r: 1, g: 2, b: 3, a: 0.25 })), { r: 1, g: 2, b: 3, a: 0.25 });
});

test('rgbToHsl and hslToRgb convert both ways, including grays', () => {
  assert.deepStrictEqual(rgbToHsl({ r: 255, g: 0, b: 0, a: 1 }), { h: 0, s: 100, l: 50, a: 1 });
  assert.deepStrictEqual(rgbToHsl({ r: 0, g: 255, b: 0, a: 1 }), { h: 120, s: 100, l: 50, a: 1 });
  assert.deepStrictEqual(rgbToHsl({ r: 0, g: 0, b: 255, a: 1 }), { h: 240, s: 100, l: 50, a: 1 });
  assert.deepStrictEqual(rgbToHsl({ r: 128, g: 128, b: 128, a: 0.5 }), { h: 0, s: 0, l: 50, a: 0.5 });
  assert.deepStrictEqual(rgbToHsl({ r: 200, g: 230, b: 210, a: 1 }).s > 0, true);
  assert.deepStrictEqual(hslToRgb({ h: 0, s: 0, l: 50, a: 1 }), { r: 128, g: 128, b: 128, a: 1 });
  assert.deepStrictEqual(hslToRgb({ h: -120, s: 100, l: 50, a: 1 }), { r: 0, g: 0, b: 255, a: 1 }, 'negative hue wraps');
  for (const color of [{ r: 22, g: 163, b: 74, a: 1 }, { r: 236, g: 168, b: 90, a: 1 }, { r: 74, g: 203, b: 190, a: 1 }]) {
    const back = hslToRgb(rgbToHsl(color));
    for (const k of ['r', 'g', 'b']) assert.ok(Math.abs(back[k] - color[k]) <= 3, k + ' drift ' + back[k] + ' vs ' + color[k]);
  }
});

test('sanitizeCssText keeps valid CSS and blocks rule breakers', () => {
  assert.deepStrictEqual(sanitizeCssText('  0 1px   2px rgba(0,0,0,.2) '), { ok: true, css: '0 1px 2px rgba(0,0,0,.2)' });
  assert.strictEqual(sanitizeCssText('').error, 'Enter a value');
  assert.strictEqual(sanitizeCssText(null).ok, false);
  assert.strictEqual(sanitizeCssText('x'.repeat(301)).error, 'Too long');
  assert.strictEqual(sanitizeCssText('red', 2).error, 'Too long');
  for (const bad of ['red; display:none', 'none}body{x:y', '<b>', 'red /* c */', 'red !important', 'expression(alert(1))', 'url(javascript:alert(1))', 'a\\62 c']) {
    assert.strictEqual(sanitizeCssText(bad).ok, false, bad);
  }
});

test('inlined helper source runs standalone and matches the module', () => {
  const sandbox = {};
  vm.runInNewContext(FIELD_HELPERS_JS + '\nthis.out = { n: sanitizeNumber("1.5rem", { unit: "px", units: ["px", "rem"], step: 0.1 }), c: formatColor(hslToRgb(rgbToHsl(parseColor("#16a34a")))), b: sanitizeBoxList("4 8", { unit: "px", units: ["px"] }).css, t: sanitizeCssText("a;b").ok };', sandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.out)), {
    n: sanitizeNumber('1.5rem', { unit: 'px', units: ['px', 'rem'], step: 0.1 }),
    c: formatColor(hslToRgb(rgbToHsl(parseColor('#16a34a')))),
    b: '4px 8px',
    t: false
  });
  assert.ok(!/require\(|module\.exports/.test(FIELD_HELPERS_JS), 'helpers stay self-contained');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;

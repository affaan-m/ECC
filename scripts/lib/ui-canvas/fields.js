'use strict';

/**
 * UI Canvas inspector field helpers: parse, sanitize, and format the values
 * a reviewer types or drags in the inspector (lengths, ratios, colors, free
 * CSS text) before they reach the mockup.
 *
 * These are plain functions with no closure state so the browser shell can
 * inline their source (see FIELD_HELPERS_JS) while Node tests exercise the
 * exact same code. Keep them self-contained: no requires, no module-level
 * constants, and only reference each other by name.
 */

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value, step) {
  if (!step) return value;
  const decimals = (String(step).split('.')[1] || '').length;
  const rounded = Math.round(value / step) * step;
  return Number(rounded.toFixed(Math.min(decimals, 6)));
}

// Shortest readable form: 16, 1.5, 0.25 (no trailing zeros, at most 2 decimals).
function formatNumber(value) {
  if (!Number.isFinite(value)) return '';
  return String(Number(value.toFixed(2)));
}

/**
 * Sanitize one typed number against a field spec.
 * spec: { min, max, step, unit, units, ratio }
 *   unit   default unit when none is typed ('' for unitless)
 *   units  accepted units; anything else is rejected
 *   ratio  value is 0..1 and the human may type 50, 50% or 0.5
 * Returns { ok: true, value, unit, css } or { ok: false, error }.
 */
function sanitizeNumber(raw, spec) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase().replace(/,/g, '.');
  if (!text) return { ok: false, error: 'Enter a number' };
  const match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-z%]*)$/);
  if (!match) return { ok: false, error: 'Not a number' };
  let value = Number(match[1]);
  if (!Number.isFinite(value)) return { ok: false, error: 'Not a number' };
  const units = spec.units || [spec.unit || ''];
  let unit = match[2];
  if (spec.ratio) {
    if (unit === '%' || value > 1) value /= 100;
    else if (unit) return { ok: false, error: 'Use a percentage, like 50%' };
    unit = '';
  } else {
    if (!unit) unit = spec.unit || '';
    if (units.indexOf(unit) < 0) {
      const listed = units.filter(Boolean);
      return { ok: false, error: listed.length ? 'Use ' + listed.join(', ') : 'Use a plain number' };
    }
  }
  const min = spec.min === undefined ? -Infinity : spec.min;
  const max = spec.max === undefined ? Infinity : spec.max;
  value = roundToStep(clampNumber(value, min, max), spec.step);
  return { ok: true, value, unit, css: formatNumber(value) + unit };
}

/**
 * Sanitize a 1-4 part box value such as padding "8 16" or margin "0 auto".
 * spec: sanitizeNumber spec plus { maxParts, allowAuto }.
 */
function sanitizeBoxList(raw, spec) {
  const parts = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  const maxParts = spec.maxParts || 4;
  if (!parts.length) return { ok: false, error: 'Enter a value' };
  if (parts.length > maxParts) return { ok: false, error: 'Use at most ' + maxParts + ' values' };
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'auto' && spec.allowAuto) { out.push('auto'); continue; }
    const result = sanitizeNumber(parts[i], spec);
    if (!result.ok) return result;
    out.push(result.value === 0 ? '0' : result.css);
  }
  return { ok: true, css: out.join(' ') };
}

function hexPair(value) {
  return Math.round(clampNumber(value, 0, 255)).toString(16).padStart(2, '0');
}

// Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax)
// and transparent into { r, g, b, a }. Returns null for anything else.
function parseColor(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let hex = text.match(/^#?([0-9a-f]{3,8})$/);
  if (hex && [3, 4, 6, 8].indexOf(hex[1].length) >= 0) {
    hex = hex[1];
    if (hex.length <= 4) hex = hex.split('').map(c => c + c).join('');
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? Number((parseInt(hex.slice(6, 8), 16) / 255).toFixed(3)) : 1
    };
  }
  const fn = text.match(/^rgba?\(\s*([^)]*)\)$/);
  if (!fn) return null;
  const nums = fn[1].split(/[\s,/]+/).filter(Boolean);
  if (nums.length < 3 || nums.length > 4) return null;
  const channel = part => (/%$/.test(part) ? parseFloat(part) * 2.55 : parseFloat(part));
  const rgb = nums.slice(0, 3).map(channel);
  let alpha = nums.length === 4 ? (/%$/.test(nums[3]) ? parseFloat(nums[3]) / 100 : parseFloat(nums[3])) : 1;
  if (rgb.some(n => !Number.isFinite(n)) || !Number.isFinite(alpha)) return null;
  alpha = clampNumber(alpha, 0, 1);
  return { r: Math.round(clampNumber(rgb[0], 0, 255)), g: Math.round(clampNumber(rgb[1], 0, 255)), b: Math.round(clampNumber(rgb[2], 0, 255)), a: Number(alpha.toFixed(3)) };
}

// '#rrggbb' when opaque, else rgba() so the mockup CSS stays readable.
function formatColor(color) {
  if (color.a >= 1) return '#' + hexPair(color.r) + hexPair(color.g) + hexPair(color.b);
  return 'rgba(' + Math.round(color.r) + ', ' + Math.round(color.g) + ', ' + Math.round(color.b) + ', ' + formatNumber(color.a) + ')';
}

// Display form for the inspector: uppercase hex, alpha shown separately.
function colorHex(color) {
  return ('#' + hexPair(color.r) + hexPair(color.g) + hexPair(color.b)).toUpperCase();
}

function rgbToHsl(color) {
  const r = color.r / 255, g = color.g / 255, b = color.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100), a: color.a };
}

function hslToRgb(hsl) {
  const h = (((hsl.h % 360) + 360) % 360) / 360, s = clampNumber(hsl.s, 0, 100) / 100, l = clampNumber(hsl.l, 0, 100) / 100;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v, a: hsl.a }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = t => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: Math.round(hue(h + 1 / 3) * 255), g: Math.round(hue(h) * 255), b: Math.round(hue(h - 1 / 3) * 255), a: hsl.a };
}

/**
 * Sanitize typed free CSS (box-shadow, background-image, a named color).
 * Rejects declaration breakers and markup so a value can never close the
 * rule or smuggle another property. The browser additionally checks
 * CSS.supports before applying.
 */
function sanitizeCssText(raw, maxLength) {
  const text = String(raw === undefined || raw === null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, error: 'Enter a value' };
  if (text.length > (maxLength || 300)) return { ok: false, error: 'Too long' };
  if (/[;{}<>\\]|\/\*|!important|expression\s*\(|javascript:/i.test(text)) return { ok: false, error: 'Remove ; { } < > and comments' };
  return { ok: true, css: text };
}

// Order matters only for readability; every helper is hoisted once inlined.
const FIELD_HELPERS = [clampNumber, roundToStep, formatNumber, sanitizeNumber, sanitizeBoxList, hexPair, parseColor, formatColor, colorHex, rgbToHsl, hslToRgb, sanitizeCssText];
const FIELD_HELPERS_JS = FIELD_HELPERS.map(fn => fn.toString()).join('\n');

module.exports = {
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
};

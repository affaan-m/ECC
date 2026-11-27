'use strict';

/**
 * UI Canvas inspector: the right-rail property editor, as a chunk of the
 * shell client script (see uiClientJs in ./ui.js, which inlines it inside
 * its closure and provides $, postToFrame, selection, actual and ended).
 *
 * Grouped slider rows for size, fill, text, spacing, border and effects.
 * Every value can be double-clicked and typed; typed input goes through the
 * sanitizers in ./fields.js, which are inlined here verbatim so the tested
 * code is the code that runs.
 */

const { FIELD_HELPERS_JS } = require('./fields');

function inspectorClientJs() {
  return String.raw`  // --- inspector ----------------------------------------------------------------------
  // Parse, sanitize and format helpers, shared verbatim with Node tests
  // (scripts/lib/ui-canvas/fields.js).
  ${FIELD_HELPERS_JS}

  const FIELD_HINT = 'Drag a slider or double-click a value to type one. Enter applies, Esc cancels, arrow keys step (Shift for 10).';
  const LENGTH_UNITS = ['px', 'rem', 'em', '%'];
  // step is typed-value precision (so 1.25rem survives); sliderStep is the drag increment.
  const NUMERIC = {
    'font-size': { label: 'Size', unit: 'px', units: LENGTH_UNITS, min: 1, max: 999, step: 0.01, slider: [6, 96], sliderStep: 1 },
    'font-weight': { label: 'Weight', unit: '', units: [''], min: 1, max: 1000, step: 1, slider: [100, 900], sliderStep: 100 },
    'line-height': { label: 'Line height', unit: '', units: ['', 'px', 'em', 'rem', '%'], min: 0, max: 999, step: 0.01, slider: [0.8, 3], sliderStep: 0.05 },
    'border-radius': { label: 'Radius', unit: 'px', units: LENGTH_UNITS, min: 0, max: 9999, step: 0.01, slider: [0, 64], sliderStep: 1, box: true },
    'opacity': { label: 'Opacity', ratio: true, min: 0, max: 1, step: 0.01, slider: [0, 1] },
    'padding': { label: 'Padding', unit: 'px', units: LENGTH_UNITS, min: 0, max: 9999, step: 0.01, slider: [0, 96], sliderStep: 1, box: true },
    'margin': { label: 'Margin', unit: 'px', units: LENGTH_UNITS, min: -9999, max: 9999, step: 0.01, slider: [0, 96], sliderStep: 1, box: true, allowAuto: true },
    'gap': { label: 'Gap', unit: 'px', units: LENGTH_UNITS, min: 0, max: 9999, step: 0.01, slider: [0, 96], sliderStep: 1, box: true, maxParts: 2 }
  };
  const ALIGN_ICONS = {
    left: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h7M2.5 12h9"/></svg>',
    center: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 4h11M4.5 8h7M3.5 12h9"/></svg>',
    right: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 4h11M6.5 8h7M4.5 12h9"/></svg>',
    justify: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg>'
  };
  let fields = [];
  let renderedKey = '';
  let current = {};
  const openColors = new Set();

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function styleMap(sel) {
    const out = {};
    (sel.styles || []).forEach(s => { out[s.property] = s; });
    return out;
  }
  function px(value) { const n = parseFloat(value); return Number.isFinite(n) ? n : 0; }
  function setStyle(property, value) { postToFrame({ type: 'uc:style', property, value }); }
  function isDefaultish(value) {
    return value === 'none' || value === 'normal' || value === 'start' || value === '1' || /^(0px ?)+$/.test(value + ' ') || /^0(px)?$/.test(value) || /rgba\(\s*\d+[, ]+\d+[, ]+\d+[, /]+0\)/.test(value);
  }
  let hintTimer = null;
  function fieldHint(text, isError) {
    const hint = $('fieldHint');
    hint.textContent = text || FIELD_HINT;
    hint.classList.toggle('err', Boolean(isError));
    clearTimeout(hintTimer);
    if (text) hintTimer = setTimeout(() => fieldHint(''), 4000);
  }
  let probe = null;
  // Any CSS color the browser accepts (names included), normalized to rgba parts.
  function resolveColor(text) {
    const direct = parseColor(text);
    if (direct) return direct;
    const clean = sanitizeCssText(text, 60);
    if (!clean.ok || !(window.CSS && CSS.supports('color', clean.css))) return null;
    if (!probe) { probe = el('span'); probe.hidden = true; document.body.appendChild(probe); }
    probe.style.color = '';
    probe.style.color = clean.css;
    return parseColor(getComputedStyle(probe).color);
  }

  // Double-click (or Enter on a focused value) swaps the value for a text box.
  // commit(text) returns an error to keep the box open, or '' once applied.
  function editableValue(span, field, getText, commit) {
    span.tabIndex = 0;
    span.title = 'Double-click to type a value';
    const begin = () => {
      if (ended || field.editing) return;
      field.editing = true;
      const box = el('input', 'numedit');
      box.type = 'text';
      box.spellcheck = false;
      box.autocomplete = 'off';
      box.value = getText();
      span.replaceWith(box);
      box.focus();
      box.select();
      let done = false;
      const finish = how => {
        if (done) return;
        if (how) {
          const error = commit(box.value);
          if (error) {
            box.classList.add('invalid');
            box.title = error;
            fieldHint(error, true);
            if (how === 'enter') return;
          } else fieldHint('');
        }
        done = true;
        field.editing = false;
        box.replaceWith(span);
        field.update(current);
        if (how !== 'blur') span.focus();
      };
      box.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish('enter'); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      });
      box.addEventListener('input', () => box.classList.remove('invalid'));
      box.addEventListener('blur', () => finish('blur'));
    };
    span.addEventListener('dblclick', e => { e.preventDefault(); begin(); });
    span.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); begin(); }
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && field.nudge) {
        e.preventDefault();
        field.nudge((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      }
    });
  }

  // One labelled row: slider, value (double-click to type) and a clear button.
  // opts.read(styles) -> { value, text, mixed, range: [min, max], set, clear }.
  function sliderField(opts) {
    const field = { busy: false, editing: false };
    const row = el('div', 'field' + (opts.sub ? ' sub' : ''));
    row.setAttribute('data-prop', opts.prop || '');
    const label = el('span', 'flabel', opts.label);
    label.title = opts.title || opts.prop || opts.label;
    const range = el('input', 'range' + (opts.rangeClass ? ' ' + opts.rangeClass : ''));
    range.type = 'range';
    range.step = String(opts.step);
    range.setAttribute('aria-label', opts.label);
    const num = el('span', 'num');
    const clear = el('button', 'clear', '×');
    clear.type = 'button';
    clear.title = 'Clear ' + (opts.prop || opts.label);
    clear.setAttribute('aria-label', clear.title);
    row.append(label, range, num, clear);
    let state = { value: 0, text: '' };
    const paint = () => {
      const min = Number(range.min), max = Number(range.max);
      const pct = max > min ? ((Number(range.value) - min) / (max - min)) * 100 : 0;
      range.style.setProperty('--pct', pct.toFixed(2) + '%');
      if (opts.paint) opts.paint(range);
    };
    field.update = styles => {
      if (field.busy || field.editing) return;
      state = opts.read(styles);
      const lo = Math.min(state.range[0], state.value);
      const hi = Math.max(state.range[1], state.value);
      range.min = String(lo);
      range.max = String(hi);
      range.value = String(state.value);
      num.textContent = state.text;
      num.classList.toggle('mixed', Boolean(state.mixed));
      row.classList.toggle('set', Boolean(state.set));
      clear.classList.toggle('on', Boolean(state.clear));
      range.disabled = ended;
      paint();
    };
    range.addEventListener('pointerdown', () => { field.busy = true; });
    const release = () => { if (!field.busy) return; field.busy = false; field.update(current); };
    range.addEventListener('pointerup', release);
    range.addEventListener('change', release);
    range.addEventListener('blur', release);
    range.addEventListener('input', () => {
      const value = Number(range.value);
      num.textContent = opts.format ? opts.format(value) : formatNumber(value);
      num.classList.remove('mixed');
      paint();
      opts.write(value);
    });
    field.nudge = delta => {
      const step = Number(range.step) || 1;
      const next = Number((state.value + delta * step).toFixed(4));
      opts.write(Math.max(opts.floor === undefined ? -Infinity : opts.floor, next));
    };
    editableValue(num, field, () => (opts.editText ? opts.editText(state) : state.text), text => opts.type(text));
    clear.addEventListener('click', () => { if (opts.clear) opts.clear(); });
    field.el = row;
    return field;
  }

  function numericField(prop) {
    const spec = NUMERIC[prop];
    return sliderField({
      label: spec.label,
      prop,
      step: spec.sliderStep || spec.step,
      floor: spec.min,
      read: styles => {
        const style = styles[prop];
        const raw = String(style.value);
        const out = { range: spec.slider, set: Boolean(style.inline), clear: style.resettable && !isDefaultish(raw) };
        if (spec.ratio) return Object.assign(out, { value: px(raw), text: Math.round(px(raw) * 100) + '%' });
        if (prop === 'line-height') {
          if (raw === 'normal') return Object.assign(out, { value: 1.2, text: 'normal', mixed: true });
          const size = styles['font-size'] ? px(styles['font-size'].value) : 16;
          const ratio = size ? px(raw) / size : 1;
          return Object.assign(out, { value: Number(ratio.toFixed(2)), text: formatNumber(ratio) });
        }
        if (spec.box) {
          const parts = raw.split(/\s+/).filter(p => p && p !== '/');
          const mixed = parts.some(p => p !== parts[0]);
          return Object.assign(out, { value: px(parts[0]), text: mixed ? parts.map(p => (/px$/.test(p) ? formatNumber(px(p)) : p)).join(' ') : formatNumber(px(parts[0])), mixed });
        }
        return Object.assign(out, { value: px(raw), text: formatNumber(px(raw)) });
      },
      format: value => (spec.ratio ? Math.round(value * 100) + '%' : formatNumber(value)),
      write: value => {
        if (spec.ratio || prop === 'line-height') setStyle(prop, formatNumber(value));
        else if (prop === 'font-weight') setStyle(prop, String(Math.round(value)));
        else setStyle(prop, formatNumber(value) + 'px');
      },
      type: text => {
        const word = String(text).trim().toLowerCase();
        if (prop === 'line-height' && word === 'normal') { setStyle(prop, 'normal'); return ''; }
        if (prop === 'font-weight' && (word === 'bold' || word === 'normal')) { setStyle(prop, word === 'bold' ? '700' : '400'); return ''; }
        const result = spec.box ? sanitizeBoxList(text, spec) : sanitizeNumber(text, spec);
        if (!result.ok) return result.error;
        setStyle(prop, result.css);
        return '';
      },
      clear: () => setStyle(prop, null)
    });
  }

  function sizeField(label, dim) {
    const spec = { unit: 'px', units: ['px'], min: 1, max: 20000, step: 1 };
    const send = value => postToFrame({ type: 'uc:size', width: dim === 'width' ? value : null, height: dim === 'height' ? value : null });
    return sliderField({
      label,
      prop: dim,
      title: dim + ' in CSS pixels',
      step: 1,
      floor: 1,
      read: () => {
        const value = selection.size[dim];
        const room = dim === 'width' ? actual.width : actual.height;
        return { value, text: String(value), range: [1, Math.max(room, Math.round(value * 1.5))] };
      },
      write: value => send(Math.max(1, Math.round(value))),
      type: text => {
        const result = sanitizeNumber(text, spec);
        if (!result.ok) return result.error;
        send(result.value);
        return '';
      }
    });
  }

  // Swatch + hex + alpha row; the swatch opens hue, saturation, lightness and
  // alpha sliders underneath. The exact color is kept beside its HSL view so
  // typed or incoming values never drift, and hue survives grays.
  function colorField(label, prop, getColor, setColor, clearable) {
    const wrap = el('div', 'cfield');
    const field = { editing: false };
    const row = el('div', 'field');
    row.setAttribute('data-prop', prop);
    const flabel = el('span', 'flabel', label);
    flabel.title = prop;
    const cval = el('div', 'cval');
    const swatch = el('button', 'swatch-btn');
    swatch.type = 'button';
    swatch.title = 'Adjust ' + label.toLowerCase() + ' with sliders';
    swatch.setAttribute('aria-label', swatch.title);
    const fill = el('i');
    swatch.appendChild(fill);
    const hex = el('span', 'num');
    cval.append(swatch, hex);
    const alpha = el('span', 'num');
    const clear = el('button', 'clear', '×');
    clear.type = 'button';
    clear.title = 'Clear ' + prop;
    clear.setAttribute('aria-label', clear.title);
    row.append(flabel, cval, alpha, clear);
    const sub = el('div', 'csub');
    wrap.append(row, sub);
    let hsl = { h: 0, s: 0, l: 0, a: 0 };
    let exact = { r: 0, g: 0, b: 0, a: 0 };
    let lastCss = '';
    const adopt = color => {
      const next = rgbToHsl(color);
      if (next.s === 0 && lastCss) next.h = hsl.h;
      hsl = next;
      exact = { r: color.r, g: color.g, b: color.b, a: color.a };
    };
    const hexField = { editing: false, update: () => field.update(current) };
    const alphaField = { editing: false, update: () => field.update(current) };
    const apply = fromSliders => {
      if (fromSliders) exact = hslToRgb(hsl);
      else exact.a = hsl.a;
      const css = formatColor(exact);
      lastCss = css;
      paint();
      setColor(css);
    };
    const channel = (name, max, rangeClass, key, unit) => sliderField({
      label: name,
      sub: true,
      step: 1,
      floor: 0,
      rangeClass,
      read: () => ({ value: key === 'a' ? Math.round(hsl.a * 100) : hsl[key], text: (key === 'a' ? Math.round(hsl.a * 100) : hsl[key]) + unit, range: [0, max] }),
      format: value => value + unit,
      write: value => {
        const next = Math.max(0, Math.min(max, Math.round(value)));
        if (key === 'a') hsl.a = next / 100;
        else { hsl[key] = next; if (hsl.a === 0) hsl.a = 1; }
        apply(key !== 'a');
      },
      type: text => {
        const result = sanitizeNumber(text, { unit: unit === '%' ? '%' : '', units: unit === '%' ? ['%', ''] : ['', 'deg'], min: 0, max, step: 1 });
        if (!result.ok) return result.error;
        if (key === 'a') hsl.a = result.value / 100;
        else { hsl[key] = result.value; if (hsl.a === 0) hsl.a = 1; }
        apply(key !== 'a');
        return '';
      },
      paint: range => {
        const h = hsl.h, s = hsl.s, l = hsl.l;
        if (key === 's') range.style.setProperty('--track', 'linear-gradient(to right,hsl(' + h + ',0%,' + l + '%),hsl(' + h + ',100%,' + l + '%))');
        if (key === 'l') range.style.setProperty('--track', 'linear-gradient(to right,#000,hsl(' + h + ',' + s + '%,50%),#fff)');
        if (key === 'a') range.style.setProperty('--swatch', formatColor(hslToRgb({ h, s, l, a: 1 })));
      }
    });
    const channels = [channel('H', 360, 'paint hue', 'h', '°'), channel('S', 100, 'paint', 's', '%'), channel('L', 100, 'paint', 'l', '%'), channel('A', 100, 'paint alpha', 'a', '%')];
    channels.forEach(c => sub.appendChild(c.el));
    const busy = () => field.editing || hexField.editing || alphaField.editing || channels.some(c => c.busy || c.editing);
    function paint() {
      fill.style.background = formatColor(exact);
      hex.textContent = hsl.a === 0 ? 'none' : colorHex(exact);
      hex.classList.toggle('mixed', hsl.a === 0);
      alpha.textContent = Math.round(hsl.a * 100) + '%';
      channels.forEach(c => { if (!c.busy && !c.editing) c.update(current); });
    }
    const setOpen = open => {
      if (open) openColors.add(prop); else openColors.delete(prop);
      sub.hidden = !open;
      swatch.setAttribute('aria-expanded', String(open));
    };
    swatch.addEventListener('click', () => setOpen(sub.hidden));
    setOpen(openColors.has(prop));
    field.update = styles => {
      const style = styles[prop] || {};
      row.classList.toggle('set', Boolean(style.inline));
      clear.classList.toggle('on', Boolean(clearable && style.resettable && !isDefaultish(String(style.value))));
      if (busy()) return;
      const color = getColor(styles) || { r: 0, g: 0, b: 0, a: 0 };
      const css = formatColor(color);
      if (css !== lastCss) {
        adopt(color);
        lastCss = css;
      }
      paint();
    };
    editableValue(hex, hexField, () => (hsl.a === 0 ? '' : colorHex(exact)), text => {
      const color = resolveColor(text);
      if (!color) return 'Use a hex like #16A34A, rgb(), or a color name';
      adopt(color);
      apply();
      return '';
    });
    editableValue(alpha, alphaField, () => String(Math.round(hsl.a * 100)), text => {
      const result = sanitizeNumber(text, { ratio: true, min: 0, max: 1, step: 0.01 });
      if (!result.ok) return result.error;
      hsl.a = result.value;
      apply();
      return '';
    });
    alphaField.nudge = delta => { hsl.a = Math.max(0, Math.min(1, Number((hsl.a + delta / 100).toFixed(2)))); apply(); };
    clear.addEventListener('click', () => setStyle(prop, null));
    field.el = wrap;
    return field;
  }

  function borderParts(styles) {
    const value = styles.border ? String(styles.border.value) : 'none';
    const match = value.match(/^([\d.]+)px\s+(\S+)\s+(.+)$/);
    if (!match) return { width: 0, style: 'solid', color: null };
    return { width: Number(match[1]), style: match[2] === 'none' ? 'solid' : match[2], color: parseColor(match[3]) };
  }
  function borderCss(width, style, color) {
    return width <= 0 ? 'none' : formatNumber(width) + 'px ' + style + ' ' + color;
  }
  function borderWidthField() {
    const spec = { unit: 'px', units: ['px'], min: 0, max: 64, step: 0.5 };
    const write = width => {
      const parts = borderParts(current);
      const color = parts.color ? formatColor(parts.color) : (current.color ? current.color.value : '#000000');
      setStyle('border', borderCss(width, parts.style, color));
    };
    return sliderField({
      label: 'Width',
      prop: 'border',
      title: 'border width',
      step: 1,
      floor: 0,
      read: styles => {
        const parts = borderParts(styles);
        return { value: parts.width, text: formatNumber(parts.width), range: [0, 16], set: Boolean(styles.border && styles.border.inline), clear: parts.width > 0 };
      },
      write,
      type: text => {
        const result = sanitizeNumber(text, spec);
        if (!result.ok) return result.error;
        write(result.value);
        return '';
      },
      clear: () => setStyle('border', null)
    });
  }

  function alignField() {
    const field = { editing: false };
    const row = el('div', 'field');
    row.setAttribute('data-prop', 'text-align');
    const label = el('span', 'flabel', 'Align');
    label.title = 'text-align';
    const group = el('div', 'aligns');
    group.style.gridColumn = 'span 2';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Text align');
    const buttons = Object.keys(ALIGN_ICONS).map(name => {
      const b = el('button');
      b.type = 'button';
      b.innerHTML = ALIGN_ICONS[name];
      b.title = 'Align ' + name;
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => setStyle('text-align', name));
      group.appendChild(b);
      return { name, b };
    });
    const spacer = el('span');
    row.append(label, group, spacer);
    field.update = styles => {
      const raw = styles['text-align'] ? String(styles['text-align'].value) : 'start';
      const value = raw === 'start' ? 'left' : raw === 'end' ? 'right' : raw;
      row.classList.toggle('set', Boolean(styles['text-align'] && styles['text-align'].inline));
      buttons.forEach(({ name, b }) => b.setAttribute('aria-pressed', String(name === value)));
    };
    field.el = row;
    return field;
  }

  // Free CSS such as box-shadow: shown truncated, typed in full.
  function textField(label, prop) {
    const field = { editing: false };
    const row = el('div', 'field text');
    row.setAttribute('data-prop', prop);
    const flabel = el('span', 'flabel', label);
    flabel.title = prop;
    const num = el('span', 'num');
    const clear = el('button', 'clear', '×');
    clear.type = 'button';
    clear.title = 'Clear ' + prop;
    clear.setAttribute('aria-label', clear.title);
    row.append(flabel, num, clear);
    let text = '';
    field.update = styles => {
      if (field.editing) return;
      const style = styles[prop] || { value: 'none' };
      text = String(style.value);
      num.textContent = shortValue(text);
      num.classList.toggle('mixed', text === 'none');
      row.classList.toggle('set', Boolean(style.inline));
      clear.classList.toggle('on', Boolean(style.resettable && text !== 'none'));
      num.title = text + '\nDouble-click to type a value';
    };
    editableValue(num, field, () => text, typed => {
      const result = sanitizeCssText(typed, 300);
      if (!result.ok) return result.error;
      if (window.CSS && !CSS.supports(prop, result.css)) return 'Not a valid ' + prop + ' value';
      setStyle(prop, result.css);
      return '';
    });
    clear.addEventListener('click', () => setStyle(prop, null));
    field.el = row;
    return field;
  }

  function readOnlyField(label, prop) {
    const row = el('div', 'field text');
    const flabel = el('span', 'flabel', label);
    flabel.title = prop + ' (read-only here; ask the agent to change layout)';
    const value = el('span', 'ro');
    row.append(flabel, value, el('span'));
    return { el: row, update: styles => { value.textContent = styles[prop] ? String(styles[prop].value) : ''; } };
  }

  function colorOf(prop) {
    return styles => (styles[prop] ? parseColor(styles[prop].value) : null);
  }
  function buildGroups(styles) {
    const has = prop => Boolean(styles[prop]);
    const plan = [
      ['Size', [sizeField('Width', 'width'), sizeField('Height', 'height')]],
      ['Fill', [
        has('background-color') && colorField('Background', 'background-color', colorOf('background-color'), css => setStyle('background-color', css), true),
        has('background-image') && textField('Image', 'background-image')
      ]],
      ['Text', [
        has('color') && colorField('Color', 'color', colorOf('color'), css => setStyle('color', css), true),
        has('font-size') && numericField('font-size'),
        has('font-weight') && numericField('font-weight'),
        has('line-height') && numericField('line-height'),
        has('text-align') && alignField()
      ]],
      ['Spacing', [has('padding') && numericField('padding'), has('margin') && numericField('margin'), has('gap') && numericField('gap')]],
      ['Border', [
        has('border') && borderWidthField(),
        has('border') && colorField('Color', 'border', s => borderParts(s).color, css => {
          const parts = borderParts(current);
          setStyle('border', borderCss(parts.width || 1, parts.style, css));
        }, false),
        has('border-radius') && numericField('border-radius')
      ]],
      ['Effects', [has('opacity') && numericField('opacity'), has('box-shadow') && textField('Shadow', 'box-shadow'), has('display') && readOnlyField('Display', 'display')]]
    ];
    const container = $('groups');
    container.innerHTML = '';
    fields = [];
    for (const [title, list] of plan) {
      const items = list.filter(Boolean);
      if (!items.length) continue;
      const group = el('div', 'group');
      group.appendChild(el('div', 'gh', title));
      items.forEach(f => { group.appendChild(f.el); fields.push(f); });
      container.appendChild(group);
    }
    fields.forEach(f => f.update(styles));
  }

  function shortValue(value) {
    return String(value).replace(/rgba?\([^)]*\)/g, m => { const c = parseColor(m); return c ? (c.a < 1 ? formatColor(c) : colorHex(c)) : m; }).replace(/(\d+\.\d{2})\d+/g, '$1');
  }
  function renderInspector() {
    const has = Boolean(selection);
    $('noSel').hidden = has;
    $('selBody').hidden = !has;
    $('deselectBtn').hidden = !has;
    if (!has) { renderedKey = ''; fields = []; current = {}; return; }
    current = styleMap(selection);
    const crumbs = $('crumbs');
    crumbs.innerHTML = '';
    (selection.breadcrumb || []).forEach((crumb, i, arr) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = crumb.label;
      b.title = crumb.selector;
      if (i === arr.length - 1) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => postToFrame({ type: 'uc:select', selector: crumb.selector }));
      crumbs.appendChild(b);
      if (i < arr.length - 1) { const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '›'; crumbs.appendChild(sep); }
    });
    $('selTag').textContent = '<' + selection.tag + '>' + (selection.id ? '#' + selection.id : '') + (selection.classes && selection.classes.length ? '.' + selection.classes.join('.') : '');
    $('selTag').title = selection.selector;
    $('selSnippet').textContent = selection.snippet || '';
    $('selSnippet').title = selection.snippet || '';
    $('editTextBtn').disabled = ended || !selection.editable;
    $('removeBtn').disabled = ended;
    const key = selection.selector + '|' + Object.keys(current).join(',');
    if (key === renderedKey) { fields.forEach(f => f.update(current)); return; }
    renderedKey = key;
    buildGroups(current);
  }
  $('editTextBtn').addEventListener('click', () => postToFrame({ type: 'uc:edit-text' }));
  $('removeBtn').addEventListener('click', () => postToFrame({ type: 'uc:remove' }));
  $('deselectBtn').addEventListener('click', () => postToFrame({ type: 'uc:deselect' }));
  fieldHint('');`;
}

module.exports = { inspectorClientJs };

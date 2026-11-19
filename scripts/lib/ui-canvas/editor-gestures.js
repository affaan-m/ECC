'use strict';

/**
 * UI Canvas in-page editor gestures: handle resize, drag to reorder, Alt-drag
 * and arrow-key nudge, remove, and the inspector's style and size setters.
 * A chunk of the editor script (see uiEditorJs in ./editor.js, which inlines
 * it inside its closure and provides the selection, edit log, and overlay).
 */

function editorGesturesJs() {
  return String.raw`  // ---- gestures: resize, move, nudge -----------------------------------------
  function startResize(dir, event) {
    if (!selected) return;
    var rect = selected.getBoundingClientRect();
    gesture = { kind: 'resize', dir: dir, el: selected, x0: event.clientX, y0: event.clientY, w0: rect.width, h0: rect.height, inlineBefore: captureInline(selected, ['width', 'height', 'flex', 'max-width']), ratio: rect.height ? rect.width / rect.height : 1, moved: false };
    document.documentElement.style.cursor = getComputedStyle(root.querySelector('.handle[data-dir="' + dir + '"]')).cursor;
    document.documentElement.setAttribute('data-ecc-ui-canvas-noselect', '');
  }
  function doResize(event) {
    var g = gesture;
    var dx = event.clientX - g.x0, dy = event.clientY - g.y0;
    var width = g.w0, height = g.h0;
    if (g.dir.indexOf('e') >= 0) width = g.w0 + dx;
    if (g.dir.indexOf('w') >= 0) width = g.w0 - dx;
    if (g.dir.indexOf('s') >= 0) height = g.h0 + dy;
    if (g.dir.indexOf('n') >= 0) height = g.h0 - dy;
    var corner = g.dir.length === 2;
    if (g.el.tagName === 'IMG' && corner && !event.shiftKey) {
      if (Math.abs(width - g.w0) >= Math.abs(height - g.h0)) height = width / g.ratio; else width = height * g.ratio;
    }
    width = Math.max(8, Math.round(width));
    height = Math.max(8, Math.round(height));
    var wantsW = g.dir.indexOf('e') >= 0 || g.dir.indexOf('w') >= 0 || (g.el.tagName === 'IMG' && corner && !event.shiftKey);
    var wantsH = g.dir.indexOf('n') >= 0 || g.dir.indexOf('s') >= 0 || (g.el.tagName === 'IMG' && corner && !event.shiftKey);
    g.width = wantsW ? width : undefined;
    g.height = wantsH ? height : undefined;
    applyInline(g.el, sizeStyles(g.el, g.width, g.height));
    g.moved = true;
    scheduleBoxes();
  }
  function endResize(g) {
    document.documentElement.style.cursor = '';
    document.documentElement.removeAttribute('data-ecc-ui-canvas-noselect');
    if (!g.moved) return;
    var rect = g.el.getBoundingClientRect();
    var edit = newEdit('resize', g.el, { width: g.width !== undefined ? Math.round(rect.width) : undefined, height: g.height !== undefined ? Math.round(rect.height) : undefined, before: { width: Math.round(g.w0), height: Math.round(g.h0) } });
    if (edit.width === undefined) delete edit.width;
    if (edit.height === undefined) delete edit.height;
    edit._inlineBefore = g.inlineBefore;
    edit._el = g.el;
    record(edit);
    toast('Resized to ' + Math.round(rect.width) + ' × ' + Math.round(rect.height));
  }

  function axisOf(container) {
    var cs = getComputedStyle(container);
    if (cs.display.indexOf('flex') >= 0) return cs.flexDirection.indexOf('row') === 0 ? 'x' : 'y';
    if (cs.display.indexOf('grid') >= 0) return 'grid';
    var kids = elementChildren(container);
    if (kids.length > 1) {
      var inlineish = kids.every(function (k) { var d = getComputedStyle(k).display; return d.indexOf('inline') === 0 || k.tagName === 'IMG' || k.tagName === 'BUTTON' || k.tagName === 'A' || k.tagName === 'SPAN'; });
      if (inlineish) return 'x';
    }
    return 'y';
  }
  function dropPlan(x, y, dragged) {
    var under = document.elementFromPoint(x, y);
    if (!under || isOurs(under)) return null;
    if (under === document.documentElement) under = document.body;
    if (!under || under === dragged || dragged.contains(under)) return null;
    var container, index, indicator;
    if (under === dragged.parentElement || under.contains(dragged)) {
      container = under;
      var kids = elementChildren(container).filter(function (k) { return k !== dragged; });
      if (!kids.length) { index = 0; indicator = inner(container.getBoundingClientRect()); }
      else {
        var axis = axisOf(container);
        var best = null, bestDist = Infinity;
        for (var i = 0; i < kids.length; i++) {
          var r = kids[i].getBoundingClientRect();
          var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          var dist = axis === 'x' ? Math.abs(cx - x) : axis === 'y' ? Math.abs(cy - y) : Math.hypot(cx - x, cy - y);
          if (dist < bestDist) { bestDist = dist; best = { el: kids[i], i: i, rect: r }; }
        }
        var after = axis === 'x' ? x > best.rect.left + best.rect.width / 2 : axis === 'y' ? y > best.rect.top + best.rect.height / 2 : (x > best.rect.left + best.rect.width / 2);
        index = best.i + (after ? 1 : 0);
        indicator = edge(best.rect, axis === 'grid' ? 'x' : axis, after);
      }
    } else {
      container = under.parentElement;
      if (!container) return null;
      var axis2 = axisOf(container);
      var rect = under.getBoundingClientRect();
      var after2 = axis2 === 'y' ? y > rect.top + rect.height / 2 : x > rect.left + rect.width / 2;
      var siblings = elementChildren(container).filter(function (k) { return k !== dragged; });
      index = siblings.indexOf(under) + (after2 ? 1 : 0);
      indicator = edge(rect, axis2 === 'grid' ? 'x' : axis2, after2);
    }
    return { container: container, index: index, indicator: indicator };
  }
  function edge(rect, axis, after) {
    if (axis === 'y') return { left: rect.left, top: (after ? rect.bottom : rect.top) - 1, width: rect.width, height: 3 };
    return { left: (after ? rect.right : rect.left) - 1, top: rect.top, width: 3, height: rect.height };
  }
  function inner(rect) { return { left: rect.left + 4, top: rect.top + 4, width: Math.max(0, rect.width - 8), height: 3 }; }

  function startPress(el, event) {
    gesture = { kind: 'press', el: el, x0: event.clientX, y0: event.clientY, nudge: event.altKey, started: false };
  }
  function beginDrag(event) {
    var g = gesture;
    g.started = true;
    if (g.nudge) {
      g.kind = 'nudge';
      g.inlineBefore = captureInline(g.el, ['position', 'left', 'top']);
      g.baseLeft = px(g.el.style.left);
      g.baseTop = px(g.el.style.top);
      if (getComputedStyle(g.el).position === 'static') g.el.style.position = 'relative';
      post({ type: 'uc:status', text: 'Nudging · release to keep the offset' });
    } else {
      g.kind = 'move';
      g.fromParent = g.el.parentElement;
      g.fromIndex = indexIn(g.fromParent, g.el);
      g.el.style.pointerEvents = 'none';
      selBox.classList.add('dragging');
      post({ type: 'uc:status', text: 'Reordering · drop between siblings or into a container · hold Alt to nudge instead' });
    }
    document.documentElement.setAttribute('data-ecc-ui-canvas-noselect', '');
    event.preventDefault();
  }
  function doDrag(event) {
    var g = gesture;
    if (g.kind === 'nudge') {
      applyInline(g.el, { left: (g.baseLeft + event.clientX - g.x0) + 'px', top: (g.baseTop + event.clientY - g.y0) + 'px' });
      scheduleBoxes();
      return;
    }
    var rect = g.el.getBoundingClientRect();
    place(ghostEl, { left: rect.left + (event.clientX - g.x0), top: rect.top + (event.clientY - g.y0), width: rect.width, height: rect.height });
    var plan = dropPlan(event.clientX, event.clientY, g.el);
    g.plan = plan;
    if (plan && plan.indicator) place(dropEl, plan.indicator); else dropEl.style.display = 'none';
  }
  function endDrag(g) {
    document.documentElement.removeAttribute('data-ecc-ui-canvas-noselect');
    post({ type: 'uc:status', text: '' });
    if (g.kind === 'nudge') {
      var dx = px(g.el.style.left) - g.baseLeft, dy = px(g.el.style.top) - g.baseTop;
      if (dx === 0 && dy === 0) { applyInline(g.el, g.inlineBefore); return; }
      var edit = newEdit('nudge', g.el, { dx: dx, dy: dy });
      edit._inlineBefore = g.inlineBefore;
      edit._el = g.el;
      record(edit);
      toast('Nudged ' + dx + ', ' + dy + 'px');
      return;
    }
    g.el.style.pointerEvents = '';
    if (!g.el.getAttribute('style')) g.el.removeAttribute('style');
    selBox.classList.remove('dragging');
    ghostEl.style.display = 'none';
    dropEl.style.display = 'none';
    var plan = g.plan;
    if (!plan) return;
    var sameSpot = plan.container === g.fromParent && (plan.index === g.fromIndex || plan.index === g.fromIndex + 1);
    if (sameSpot) return;
    var fromSelector = selectorFor(g.el);
    var fromParentSelector = selectorFor(g.fromParent);
    insertAt(plan.container, g.el, plan.index);
    var moveEdit = newEdit('move', g.el, { from: { parent: fromParentSelector, index: g.fromIndex }, to: { parent: selectorFor(plan.container), index: indexIn(plan.container, g.el) } });
    moveEdit.selector = fromSelector;
    moveEdit.selectorAfter = selectorFor(g.el);
    moveEdit._fromParent = g.fromParent;
    moveEdit._fromIndex = g.fromIndex;
    moveEdit._el = g.el;
    record(moveEdit);
    toast('Moved ' + labelFor(g.el));
  }

  function nudgeBy(dx, dy) {
    if (!selected) return;
    var last = edits.length ? edits[edits.length - 1] : null;
    if (last && last.kind === 'nudge' && last._el === selected && !last.stale && Date.now() - Date.parse(last.at) < 1500) {
      applyInline(selected, { left: (px(selected.style.left) + dx) + 'px', top: (px(selected.style.top) + dy) + 'px' });
      last.dx += dx;
      last.dy += dy;
      last.at = new Date().toISOString();
      postEdits();
      scheduleBoxes();
      return;
    }
    var edit = newEdit('nudge', selected, { dx: dx, dy: dy });
    edit._inlineBefore = captureInline(selected, ['position', 'left', 'top']);
    edit._el = selected;
    var cs = getComputedStyle(selected);
    var next = { left: (px(selected.style.left) + dx) + 'px', top: (px(selected.style.top) + dy) + 'px' };
    if (cs.position === 'static') next.position = 'relative';
    applyInline(selected, next);
    record(edit);
  }

  function removeSelected() {
    if (!selected || selected === document.body) { toast('Select an element to remove'); return; }
    var el = selected;
    var parent = el.parentElement;
    var edit = newEdit('remove', el, { outerHTML: el.outerHTML.slice(0, 20000), from: { parent: selectorFor(parent), index: indexIn(parent, el) } });
    edit._el = el;
    edit._parent = parent;
    edit._index = indexIn(parent, el);
    el.remove();
    selected = parent && parent !== document.documentElement ? parent : null;
    record(edit);
    toast('Removed ' + edit.tag + ' · Cmd/Ctrl+Z to undo');
  }
  function setStyle(property, value) {
    if (!selected) return;
    if (!/^[a-z][a-z0-9-]*$/.test(property)) return;
    var cs = getComputedStyle(selected);
    var before = cs.getPropertyValue(property);
    var last = edits.length ? edits[edits.length - 1] : null;
    if (last && last.kind === 'style' && last.property === property && last._el === selected && !last.stale && Date.now() - Date.parse(last.at) < 2500) {
      selected.style.setProperty(property, value === null ? RESET_VALUES[property] : value);
      last.after = value;
      last.at = new Date().toISOString();
      postEdits();
      postSelection();
      scheduleBoxes();
      return;
    }
    var edit = newEdit('style', selected, { property: property, before: before, after: value });
    edit._inlineBefore = captureInline(selected, [property]);
    edit._el = selected;
    if (!applyEdit(edit, selected)) { toast('Cannot change ' + property); return; }
    record(edit);
  }
  function setSize(width, height) {
    if (!selected) return;
    var last = edits.length ? edits[edits.length - 1] : null;
    if (last && last.kind === 'resize' && last._el === selected && !last.stale && Date.now() - Date.parse(last.at) < 2500) {
      if (width !== null && width !== undefined) last.width = Math.round(width);
      if (height !== null && height !== undefined) last.height = Math.round(height);
      var next = sizeStyles(selected, last.width, last.height);
      // A dimension first touched now still needs its original value for undo.
      last._inlineBefore = last._inlineBefore || {};
      for (var key in next) if (!Object.prototype.hasOwnProperty.call(last._inlineBefore, key)) last._inlineBefore[key] = selected.style.getPropertyValue(key);
      applyInline(selected, next);
      last.at = new Date().toISOString();
      postEdits();
      postSelection();
      scheduleBoxes();
      return;
    }
    var rect = selected.getBoundingClientRect();
    var edit = newEdit('resize', selected, { before: { width: Math.round(rect.width), height: Math.round(rect.height) } });
    if (width !== null && width !== undefined) edit.width = Math.round(width);
    if (height !== null && height !== undefined) edit.height = Math.round(height);
    if (edit.width === undefined && edit.height === undefined) return;
    edit._el = selected;
    applyEdit(edit, selected);
    record(edit);
  }`;
}

module.exports = { editorGesturesJs };

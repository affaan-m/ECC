---
name: ui-demo
description: Record polished UI demo videos using Playwright. Use when the user asks to create a demo, walkthrough, screen recording, or tutorial video of a web application. Produces WebM videos with visible cursor, natural pacing, and professional feel.
origin: ECC
---

# UI Demo Video Recorder

Record polished demo videos of web applications using Playwright's video recording with an injected cursor overlay, natural pacing, and storytelling flow.

## When to Use

- User asks for a "demo video", "screen recording", "walkthrough", or "tutorial"
- User wants to showcase a feature or workflow visually
- User needs a video for documentation, onboarding, or stakeholder presentation

## Three-Phase Process

Every demo goes through three phases: **Discover -> Rehearse -> Record**. Never skip straight to recording.

---

## Phase 1: Discover

Before writing any script, explore the target pages to understand what is actually there.

### Why

You cannot script what you have not seen. Fields may be `<input>` not `<textarea>`, dropdowns may be custom components not `<select>`, and comment boxes may support `@mentions` or `#tags`. Assumptions break recordings silently.

### How

Navigate to each page in the flow and dump its interactive elements:

```javascript
// Run this for each page in the flow BEFORE writing the demo script
const fields = await page.evaluate(() => {
  const els = [];
  document.querySelectorAll('input, select, textarea, button, [contenteditable]').forEach(el => {
    if (el.offsetParent !== null) {
      els.push({
        tag: el.tagName,
        type: el.type || '',
        name: el.name || '',
        placeholder: el.placeholder || '',
        text: el.textContent?.trim().substring(0, 40) || '',
        contentEditable: el.contentEditable === 'true',
        role: el.getAttribute('role') || '',
      });
    }
  });
  return els;
});
console.log(JSON.stringify(fields, null, 2));
```

### What to look for

- **Form fields**: Are they `<select>`, `<input>`, custom dropdowns, or comboboxes?
- **Select options**: Dump option values AND text. Placeholders often have `value="0"` or `value=""` which looks non-empty. Use `Array.from(el.options).map(o => ({ value: o.value, text: o.text }))`. Skip options where text includes "Select" or value is `"0"`.
- **Rich text**: Does the comment box support `@mentions`, `#tags`, markdown, or emoji? Check placeholder text.
- **Required fields**: Which fields block form submission? Check `required`, `*` in labels, and try submitting empty to see validation errors.
- **Dynamic content**: Do fields appear after other fields are filled?
- **Button labels**: Exact text such as `"Submit"`, `"Submit Request"`, or `"Send"`.
- **Table column headers**: For table-driven modals, map each `input[type="number"]` to its column header instead of assuming all numeric inputs mean the same thing.

### Output

A field map for each page, used to write correct selectors in the script. Example:

```text
/purchase-requests/new:
  - Budget Code: <select> (first select on page, 4 options)
  - Desired Delivery: <input type="date">
  - Context: <textarea> (not input)
  - BOM table: inline-editable cells with span.cursor-pointer -> input pattern
  - Submit: <button> text="Submit"

/purchase-requests/N (detail):
  - Comment: <input placeholder="Type a message..."> supports @user and #PR tags
  - Send: <button> text="Send" (disabled until input has content)
```

---

## Phase 2: Rehearse

Run through all steps without recording. Verify every selector resolves.

### Why

Silent selector failures are the main reason demo recordings break. Rehearsal catches them before you waste a recording.

### How

Use `ensureVisible`, a wrapper that logs and fails loudly:

```javascript
async function ensureVisible(page, locator, label) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  const visible = await el.isVisible().catch(() => false);
  if (!visible) {
    const msg = `REHEARSAL FAIL: "${label}" not found - selector: ${typeof locator === 'string' ? locator : '(locator object)'}`;
    console.error(msg);
    const found = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, input, select, textarea, a'))
        .filter(el => el.offsetParent !== null)
        .map(el => `${el.tagName}[${el.type || ''}] "${el.textContent?.trim().substring(0, 30)}"`)
        .join('\n  ');
    });
    console.error('  Visible elements:\n  ' + found);
    return false;
  }
  console.log(`REHEARSAL OK: "${label}"`);
  return true;
}
```

### Rehearsal script structure

```javascript
const steps = [
  { label: 'Login email field', selector: '#email' },
  { label: 'Login submit', selector: 'button[type="submit"]' },
  { label: 'New Request button', selector: 'button:has-text("New Request")' },
  { label: 'Budget Code select', selector: 'select' },
  { label: 'Delivery date', selector: 'input[type="date"]:visible' },
  { label: 'Description field', selector: 'textarea:visible' },
  { label: 'Add Item button', selector: 'button:has-text("Add Item")' },
  { label: 'Submit button', selector: 'button:has-text("Submit")' },
];

let allOk = true;
for (const step of steps) {
  if (!await ensureVisible(page, step.selector, step.label)) {
    allOk = false;
  }
}
if (!allOk) {
  console.error('REHEARSAL FAILED - fix selectors before recording');
  process.exit(1);
}
console.log('REHEARSAL PASSED - all selectors verified');
```

### When rehearsal fails

1. Read the visible-element dump.
2. Find the correct selector.
3. Update the script.
4. Re-run rehearsal.
5. Only proceed when every selector passes.

---

## Phase 3: Record

Only after discovery and rehearsal pass should you create the recording.

### Recording Principles

#### 1. Storytelling Flow

Plan the video as a story. Follow user-specified order, or use this default:

- **Entry**: Login or navigate to the starting point
- **Context**: Pan the surroundings so viewers orient themselves
- **Action**: Perform the main workflow steps
- **Variation**: Show a secondary feature such as settings, theme, or localization
- **Result**: Show the outcome, confirmation, or new state

#### 2. Pacing

- After login: `4s`
- After navigation: `3s`
- After clicking a button: `2s`
- Between major steps: `1.5-2s`
- After the final action: `3s`
- Typing delay: `25-40ms` per character

#### 3. Cursor Overlay

Inject an SVG arrow cursor that follows mouse movements:

```javascript
async function injectCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-cursor')) return;
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
    cursor.style.cssText = `
      position: fixed; z-index: 999999; pointer-events: none;
      width: 24px; height: 24px;
      transition: left 0.1s, top 0.1s;
      filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.3));
    `;
    cursor.style.left = '0px';
    cursor.style.top = '0px';
    document.body.appendChild(cursor);
    document.addEventListener('mousemove', (e) => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    });
  });
}
```

Call `injectCursor(page)` after every page navigation because the overlay is destroyed on navigate.

#### 4. Mouse Movement

Never teleport the cursor. Move to the target before clicking:

```javascript
async function moveAndClick(page, locator, label, opts = {}) {
  const { postClickDelay = 800, ...clickOpts } = opts;
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  const visible = await el.isVisible().catch(() => false);
  if (!visible) {
    console.error(`WARNING: moveAndClick skipped - "${label}" not visible`);
    return false;
  }
  try {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await el.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
      await page.waitForTimeout(400);
    }
    await el.click(clickOpts);
  } catch (e) {
    console.error(`WARNING: moveAndClick failed on "${label}": ${e.message}`);
    return false;
  }
  await page.waitForTimeout(postClickDelay);
  return true;
}
```

Every call should include a descriptive `label` for debugging.

#### 5. Typing

Type visibly, not instant-fill:

```javascript
async function typeSlowly(page, locator, text, label, charDelay = 35) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  const visible = await el.isVisible().catch(() => false);
  if (!visible) {
    console.error(`WARNING: typeSlowly skipped - "${label}" not visible`);
    return false;
  }
  await moveAndClick(page, el, label);
  await el.fill('');
  await el.pressSequentially(text, { delay: charDelay });
  await page.waitForTimeout(500);
  return true;
}
```

#### 6. Scrolling

Use smooth scroll instead of jumps:

```javascript
await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
await page.waitForTimeout(1500);
```

#### 7. Dashboard Panning

When showing a dashboard or overview page, move the cursor across key elements:

```javascript
async function panElements(page, selector, maxCount = 6) {
  const elements = await page.locator(selector).all();
  for (let i = 0; i < Math.min(elements.length, maxCount); i++) {
    try {
      const box = await elements[i].boundingBox();
      if (box && box.y < 700) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
        await page.waitForTimeout(600);
      }
    } catch (e) {
      console.warn(`WARNING: panElements skipped element ${i} (selector: "${selector}"): ${e.message}`);
    }
  }
}
```

#### 8. Subtitles

Inject a subtitle bar at the bottom of the viewport:

```javascript
async function injectSubtitleBar(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-subtitle')) return;
    const bar = document.createElement('div');
    bar.id = 'demo-subtitle';
    bar.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 999998;
      text-align: center; padding: 12px 24px;
      background: rgba(0, 0, 0, 0.75);
      color: white; font-family: -apple-system, "Segoe UI", sans-serif;
      font-size: 16px; font-weight: 500; letter-spacing: 0.3px;
      transition: opacity 0.3s;
      pointer-events: none;
    `;
    bar.textContent = '';
    bar.style.opacity = '0';
    document.body.appendChild(bar);
  });
}

async function showSubtitle(page, text) {
  await page.evaluate((t) => {
    const bar = document.getElementById('demo-subtitle');
    if (!bar) return;
    if (t) {
      bar.textContent = t;
      bar.style.opacity = '1';
    } else {
      bar.style.opacity = '0';
    }
  }, text);
  if (text) await page.waitForTimeout(800);
}
```

Call `injectSubtitleBar(page)` alongside `injectCursor(page)` after every navigation.

Usage pattern:

```javascript
await showSubtitle(page, 'Step 1 - Logging in');
await showSubtitle(page, 'Step 2 - Dashboard overview');
await showSubtitle(page, '');
```

Guidelines:

- Keep subtitle text short, ideally under 60 characters.
- Use `Step N - Action` format for consistency.
- Clear the subtitle during long pauses where the UI can speak for itself.

## Script Template

```javascript
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:3000';
const VIDEO_DIR = path.join(__dirname, 'screenshots');
const OUTPUT_NAME = 'demo-FEATURE.webm';
const REHEARSAL = process.argv.includes('--rehearse');

// Paste injectCursor, injectSubtitleBar, showSubtitle, moveAndClick,
// typeSlowly, ensureVisible, and panElements here.

(async () => {
  const browser = await chromium.launch({ headless: true });

  if (REHEARSAL) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    // Navigate through the flow and run ensureVisible for each selector.
    await browser.close();
    return;
  }

  const context = await browser.newContext({
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    await injectCursor(page);
    await injectSubtitleBar(page);

    await showSubtitle(page, 'Step 1 - Logging in');
    // login actions

    await page.goto(`${BASE_URL}/dashboard`);
    await injectCursor(page);
    await injectSubtitleBar(page);
    await showSubtitle(page, 'Step 2 - Dashboard overview');
    // pan dashboard

    await showSubtitle(page, 'Step 3 - Main workflow');
    // action sequence

    await showSubtitle(page, 'Step 4 - Result');
    // final reveal
    await showSubtitle(page, '');
  } catch (err) {
    console.error('DEMO ERROR:', err.message);
  } finally {
    await context.close();
    const video = page.video();
    if (video) {
      const src = await video.path();
      const dest = path.join(VIDEO_DIR, OUTPUT_NAME);
      try {
        fs.copyFileSync(src, dest);
        console.log('Video saved:', dest);
      } catch (e) {
        console.error('ERROR: Failed to copy video:', e.message);
        console.error('  Source:', src);
        console.error('  Destination:', dest);
      }
    }
    await browser.close();
  }
})();
```

Usage:

```bash
# Phase 2: Rehearse
node demo-script.cjs --rehearse

# Phase 3: Record
node demo-script.cjs
```

## Checklist Before Recording

- [ ] Discovery phase completed
- [ ] Rehearsal passes with all selectors OK
- [ ] Headless mode enabled
- [ ] Resolution set to `1280x720`
- [ ] Cursor and subtitle overlays re-injected after every navigation
- [ ] `showSubtitle(page, 'Step N - ...')` used at major transitions
- [ ] `moveAndClick` used for all clicks with descriptive labels
- [ ] `typeSlowly` used for visible input
- [ ] No silent catches; helpers log warnings
- [ ] Smooth scrolling used for content reveal
- [ ] Key pauses are visible to a human viewer
- [ ] Flow matches the requested story order
- [ ] Script reflects the actual UI discovered in phase 1

## Common Pitfalls

1. Cursor disappears after navigation - re-inject it.
2. Video is too fast - add pauses.
3. Cursor is a dot instead of an arrow - use the SVG overlay.
4. Cursor teleports - move before clicking.
5. Select dropdowns look wrong - show the move, then pick the option.
6. Modals feel abrupt - add a read pause before confirming.
7. Video file path is random - copy it to a stable output name.
8. Selector failures are swallowed - never use silent catch blocks.
9. Field types were assumed - discover them first.
10. Features were assumed - inspect the actual UI before scripting.
11. Placeholder select values look real - watch for `"0"` and `"Select..."`.
12. Popups create separate videos - capture popup pages explicitly and merge later if needed.

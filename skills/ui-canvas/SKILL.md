---
name: ui-canvas
description: Preview a UI component mockup in a local browser canvas where the human directly edits it (move, resize, edit text, delete, restyle), switches mobile/desktop/custom viewports, tests it, chats with you, and clicks Save and Finish. You then turn the exported edited markup into the production component. Use before committing or rebuilding a feature just to check a visual change.
metadata:
  origin: ECC
version: "1.0.0"
---

# UI Canvas

Approve-before-you-build loop for user interface work: you write a quick,
self-contained HTML mockup of the component, the human opens it in the
browser and adjusts it by hand like a website builder, and **Save and
Finish** hands you the exact result to wire into the real code. Nobody has to
rebuild and rerun the whole app to check a padding change.

Any component qualifies: a card, a sidebar, a modal, a settings pane, a
single button state, an animation, a page section. Any harness qualifies:
the loop is a CLI that prints JSON.

Shares its server, state, and hooks with `plan-canvas` (inspired by
[lavish-axi](https://github.com/kunchenguid/lavish-axi) by @kunchenguid).
Editing conventions follow
[VisBug](https://github.com/GoogleChromeLabs/ProjectVisBug) and
[Onlook](https://github.com/onlook-dev/onlook): Enter/Shift+Enter walk the
tree, Delete removes, an edit/interact mode switch.

## When to Use

- The user asks to redesign, restyle, or add a UI component and wants to see
  it before you commit, rerun, or rebuild.
- Feedback is visual ("make it tighter", "move that up", "lose the border")
  and is faster done by hand than typed.
- Mobile and desktop both matter and the user wants to check the component
  at exact dimensions.
- The user asks for `/ui-canvas`, a preview, a mockup, "show me first".

Do NOT use for: plan or document review (`/plan-canvas`), running the real
app, remote URLs, or components you cannot render as plain HTML/CSS/JS in one
file. The canvas serves local files only.

## How It Works

Invoke the CLI as `ecc-ui-canvas` (bin from the `ecc-universal` package, on
PATH after a global or plugin install; `node "$CLAUDE_PLUGIN_ROOT/scripts/ui-canvas.js"`
also works). It runs the same detached loopback server as `plan-canvas`
(`127.0.0.1:4517`), keyed by artifact path; there are no session ids.

### 1. Write the mockup

Write one self-contained `.html` file (for example `.claude/previews/<name>.html`
or next to the component): markup, a `<style>` block, and any `<script>` the
component needs to behave (tabs, toggles, open/close, animation). Rules:

- Use the project's real brand tokens, fonts, copy, and realistic data. Read
  the existing CSS or theme file first; do not invent a palette.
- Give meaningful elements an `id` or a distinctive class. The canvas records
  every human edit against a CSS selector; stable names make the export map
  cleanly back to your code.
- Keep it faithful to production: same breakpoints, same `max-width`, same
  states. The canvas renders at true CSS-pixel viewport sizes, so media
  queries behave exactly as they would in the app.
- Sibling assets (images, fonts) may sit next to the file and be referenced by
  relative path; a `data:` URI or an inline SVG also works.
- Inline only what the component needs. A mockup is a sketch, not the app.

### 2. Open and listen

```bash
ecc-ui-canvas open .claude/previews/pricing-card.html --viewport desktop --title "Pricing card"
ecc-ui-canvas await .claude/previews/pricing-card.html   # run in the background; leave it running
```

`--viewport` takes `mobile` (393×852), `desktop` (fills the window), `custom`,
or exact `WxH` such as `1024x768`. Run `await` in the background if your
harness time-limits foreground commands; re-run it if interrupted, queued
feedback is never lost. While it runs, the canvas shows "<your harness>
listening" so the human knows you are connected.

### 3. Handle what comes back

`await` prints JSON when the human acts. Items:

```json
{ "kind": "chat", "text": "change this to dark gray in the brand colors",
  "anchor": { "selector": "#pricing-card", "tag": "article", "snippet": "Most popular Team plan…", "size": { "width": 720, "height": 388 } },
  "pendingEdits": ["resized img.art to 220px wide, 220px tall (was 260×260)", "removed button.btn.secondary"] }
```

- `chat` is a request. `anchor` is the element the human had selected when
  they sent it; `pendingEdits` summarizes hand edits they have made that are
  **not yet in your file**. Make the requested change in the mockup file.
  The preview reloads within a second and re-applies their pending edits on
  top, so do **not** bake `pendingEdits` into the file yourself: they are
  context, and doubling them up would misplace things. Answer in the canvas
  and keep listening with one command:

  ```bash
  ecc-ui-canvas await <file> --reply "Background is now var(--gray-800) from the brand tokens."
  ```

  Speed matters here. Run `ecc-ui-canvas typing <file> --state thinking`
  the moment you start, edit the file, then reply. Under two seconds from
  request to repaint is the target for a one-property change.

```json
{ "kind": "edits", "editCount": 3, "edits": [ { "kind": "resize", "selector": "img.art", "width": 220, "height": 220, "before": { "width": 260, "height": 260 } } ],
  "viewport": { "preset": "mobile", "width": 393, "height": 852 },
  "exportPath": "/abs/.claude/previews/pricing-card.apply-mf3k2x-9a1c.edited.html", "editsPath": "/abs/.claude/previews/pricing-card.apply-mf3k2x-9a1c.edits.json" }
```

- `edits` means the human clicked **Apply to file**: they want their hand
  edits written into the mockup now. Replace the mockup file with the
  contents of `exportPath` (it is the full DOM they are looking at, with
  their inline-style changes), tidy it into real CSS if it is messy, keep it
  self-contained, and reply. Each Apply writes its own
  `<name>.apply-<batch>.*` pair, so a queued earlier batch keeps its own
  snapshot. The canvas keeps showing the applied edits until your write to
  the mockup reloads it, then drops them, so nothing is applied twice.

```json
{ "kind": "finish", "editCount": 5, "edits": [ "…" ], "viewport": { "preset": "desktop", "width": 1412, "height": 806 },
  "exportPath": "…/pricing-card.edited.html", "editsPath": "…/pricing-card.edits.json" }
```

- `finish` means the human clicked **Save and Finish**. The session is over
  (`sessionEnded: true`). Read `exportPath`, diff it against your original
  mockup, read `editsPath` for the intent behind each change, and reproduce
  that exact look in the real component with full functionality: real
  tokens, responsive rules, accessible markup, the project's framework.
  Then commit per the repo's rules and report in chat. Do not reopen the
  canvas.

Edit kinds you will see in `edits`: `text` (before/after, plus `htmlAfter`
when inline markup was kept), `resize` (border-box px), `move` (from/to
parent selector and index), `nudge` (dx/dy px offsets the human applied by
dragging with Alt or arrow keys; translate to margin or alignment, not
`position: relative`), `remove`, and `style` (`property`, computed `before`,
`after`; `after: null` means they deleted the property, so border → none,
box-shadow → none, padding → 0). An edit flagged `stale: true` could not be
re-applied after one of your reloads; ask about it rather than guessing.

### 4. End

`ecc-ui-canvas end <file>` closes a session you opened and no longer need.
`{"status":"ended","endedBy":"user"}` means the human closed it without
saving: stop polling and do not reopen unless asked (`open --reopen`).

## What the Human Can Do

Edit mode (default): click selects, with hover and selection outlines and a
size badge; double-click edits text; corner and edge handles resize (images
keep their ratio unless Shift is held); dragging reorders among siblings or
into another container with an insertion marker; Alt-drag or arrow keys
nudge (Shift for 10 px); Delete or Backspace removes; Enter steps into the
first child, Shift+Enter to the parent, Tab between siblings; Cmd/Ctrl+Z and
Shift+Cmd/Ctrl+Z undo and redo. The inspector shows the selected element's
breadcrumb and grouped slider rows (size, fill, text, spacing, border,
effects). Drag a slider, or double-click a value to type one (sanitized and
clamped; arrow keys step). A color swatch opens hue, saturation, lightness,
and alpha sliders; the hex field also takes rgb() or a color name; the x
button clears a property.

Interact mode (Cmd/Ctrl+I): clicks, hovers, and keyboard reach the component
so they can try the tabs, toggles, and animations exactly as a user would.
A pause button freezes animations and transitions for inspection.

Viewport bar: desktop (fills the stage), mobile (iPhone-class 393×852 with a
device frame), or exact width × height; a rotate button swaps the two. The
preview scales down only when the stage is smaller than the chosen size,
never the other way, so media queries are honest.

## Rules

- One self-contained `.html` file per component. Markdown is not accepted;
  use `plan-canvas` for documents.
- Edit the artifact file to revise. The canvas live-reloads on save and
  restores the human's pending edits, selection, and scroll. Never re-run
  `open` to refresh.
- Never apply `pendingEdits` from a `chat` item into the file. Apply edits
  only from an `edits` or `finish` payload, from `exportPath`.
- Reply in the canvas (`await --reply`), not only in the terminal, while the
  session is open.
- The exported `.edited.html` and `.edits.json` files (including the
  per-Apply `.apply-<batch>.*` pairs) are review artifacts, not production
  code. Do not commit them unless the repo keeps previews; delete the
  `.apply-*` pairs once the mockup is updated.
- The server is loopback-only, idles out after 30 minutes
  (`ECC_PLAN_CANVAS_IDLE_MS`), and keeps state in `~/.claude/plan-canvas/`
  (`ECC_PLAN_CANVAS_STATE_DIR`). `ECC_CANVAS_AGENT` overrides the detected
  harness name shown in the browser.

## Examples

**Redesign with preview before commit**

```bash
# user: "Make the pricing card friendlier, then show me before you commit."
# → write .claude/previews/pricing-card.html using tokens from src/styles/tokens.css
ecc-ui-canvas open .claude/previews/pricing-card.html --title "Pricing card"
ecc-ui-canvas await .claude/previews/pricing-card.html
# → {"status":"feedback","items":[{"kind":"chat","text":"change this to dark gray in the brand colors","anchor":{"selector":"#pricing-card",…},"pendingEdits":[…]}]}
ecc-ui-canvas typing .claude/previews/pricing-card.html --state thinking
# → edit the file: background: var(--gray-800)
ecc-ui-canvas await .claude/previews/pricing-card.html --reply "Card background is now --gray-800."
# → {"status":"feedback","sessionEnded":true,"items":[{"kind":"finish","editCount":5,"exportPath":"…/pricing-card.edited.html",…}]}
# → read the export, port the look into src/components/PricingCard.tsx, commit
```

**Mobile check of an existing component**

```bash
ecc-ui-canvas open .claude/previews/sidebar.html --viewport mobile
ecc-ui-canvas await .claude/previews/sidebar.html
```

## Anti-Patterns

- Opening the real app's URL. The canvas serves one local file; mock the
  component instead.
- Building the mockup with a framework build step. Plain HTML renders in
  milliseconds and reloads in under a second; that is the point.
- Re-applying `pendingEdits` yourself, then watching the canvas apply them
  again.
- Polling with `--timeout-ms` in a loop; leave the plain `await` running.
- Letting a `chat` request sit. The human is watching the preview; signal
  `typing --state thinking` and move.
- Committing `*.edited.html` or `*.edits.json`.

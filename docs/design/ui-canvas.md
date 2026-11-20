# UI Canvas: hand-editable component preview in the browser

Status: implemented (`feat/ui-canvas`), local testing before PR
Lineage: shares its server and protocol with [Plan Canvas](plan-canvas.md), itself inspired by
[lavish-axi](https://github.com/kunchenguid/lavish-axi) by @kunchenguid. Editing conventions
borrow from [VisBug](https://github.com/GoogleChromeLabs/ProjectVisBug) (Adam Argyle,
Apache-2.0: Enter/Shift+Enter tree walking, Delete removes, Alt+Delete-style property stripping)
and [Onlook](https://github.com/onlook-dev/onlook) (Apache-2.0: the design/preview mode split).
No third-party code is vendored; the editor is an original, dependency-free implementation.

## Problem

Checking a visual change today means asking the agent to edit the real component, rebuild,
rerun, and look. A padding tweak costs a full feature cycle, and the feedback is typed
("move the button up a bit") when it would be faster shown. Lovable-style products solve this
with a hosted editor coupled to one framework. ECC needs the same loop for any component, any
harness, and nothing heavier than a loopback server.

## What it is

The agent writes one self-contained `.html` mockup. `ecc-ui-canvas open <file>` shows it in a
browser shell where the human:

- clicks to select (hover and selection outlines, size badge), double-clicks to edit text,
  drags eight handles to resize (images keep ratio unless Shift), drags to reorder among
  siblings or into another container, Alt-drags or arrows to nudge, presses Delete to remove;
- edits style properties from a grouped inspector (size, fill, text, spacing, border, effects)
  with sliders, double-click-to-type values that are sanitized and clamped before they reach
  the mockup, HSL plus alpha color sliders, and a clear button per property;
- switches between desktop (fills the stage), mobile (393×852 with a device frame), and exact
  width × height, rotates, and scales the stage down only when it is too small, so media queries
  behave as in production;
- toggles an interact mode where clicks reach the component, and pauses animations;
- chats with the agent about the selected element while the agent is parked in
  `ecc-ui-canvas await`; the presence pill names the harness that is listening;
- clicks **Apply to file** to have the agent bake the hand edits into the mockup, or
  **Save and Finish** to hand over the final design.

Every change is recorded as a structured edit (`text`, `resize`, `move`, `nudge`, `remove`,
`style`) against a CSS selector. The log is re-applied when the agent's file edit live-reloads
the frame, undone with Cmd/Ctrl+Z, and exported with a clean DOM snapshot to
`<name>.edited.html` and `<name>.edits.json` next to the artifact. The agent reads those and
reproduces the look in the real component.

`pending` returns a resumable command using `await --session-key <key>`. The key is exactly
twelve lowercase hexadecimal characters, so artifact filenames never enter generated shell
commands. File-based `await <file>` remains available. A saved, ended UI session remains
pending until its final handoff is consumed; resuming that key delivers the handoff without
reopening the review.

## How it fits ECC

| Piece | Location | Notes |
|---|---|---|
| CLI entry | `scripts/ui-canvas.js` (npm bin `ecc-ui-canvas`) | A profile over `scripts/plan-canvas.js`: same transport, `mode: ui`, its own usage and next-step guidance |
| Server | `scripts/lib/plan-canvas/server.js` | Mode-aware routes: `/canvas/:key` renders the UI shell, `/artifact/:key/` injects the editor, `/ui-editor.js`, `/ui-client.js`, `/ui-canvas.css`; `edits`/`finish` batches are written to disk before queueing |
| Sessions | `scripts/lib/plan-canvas/sessions.js` | `mode`, `ui` options (viewport, title), `agent` descriptor; UI feedback normalized by `ui-canvas/feedback.js` |
| Feedback schema | `scripts/lib/ui-canvas/feedback.js` | Edit kinds, clamps, summaries, viewport presets, export writer |
| Shell | `scripts/lib/ui-canvas/ui.js` | Top bar, stage with device frame and scaling, inspector, edit log, conversation; ECC design tokens |
| Editor | `scripts/lib/ui-canvas/editor.js` | Script injected into the sandboxed frame; shadow-root overlay, gestures, edit log, restore, export |
| Agent identity | `scripts/lib/plan-canvas/agent-identity.js` | Harness detection from environment markers; `ECC_CANVAS_AGENT` override |
| Hooks | `scripts/hooks/plan-canvas-pending.js`, `plan-canvas-sessions.js` | Understand `edits`/`finish`, name the right bin per session mode |
| Skill | `skills/ui-canvas/SKILL.md` (+ `.agents/skills/ui-canvas/` for Codex) | Mockup rules, feedback shapes, finish handling |
| Command | `commands/ui-canvas.md` | Thin entrypoint |
| Tests | `tests/lib/ui-canvas-*.test.js`, `tests/lib/plan-canvas-agent-identity.test.js`, `tests/scripts/ui-canvas.test.js`, `tests/integration/ui-canvas-e2e.test.js` | Schema, shell/editor contract, server mode, CLI flow |

Registration mirrors plan-canvas: `package.json` (`bin`, `files`), `manifests/install-components.json`
and `install-modules.json` (workflow-quality), `manifests/pi-core.json` exclusions, `agent.yaml`,
`docs/COMMAND-REGISTRY.json`, `COMMANDS-QUICK-REF.md`, `docs/COMMAND-AGENT-MAP.md`.

## Protocol

Shell and editor talk only over `postMessage`. The frame is sandboxed without
`allow-same-origin`, exactly like Plan Canvas, so the mockup runs with an opaque origin. That alone
does not stop its scripts from making requests; the server does: every request must carry an
allowed loopback `Host`, and any `Origin` header must name an allowed loopback host, so requests
from the frame (which send `Origin: null`) get `403`, including the preflight a JSON POST needs. The
shell accepts only messages whose source is the frame window and only the `uc:*` types listed
below; a mockup script can post those too, so it can describe or alter its own edits (the agent
wrote that mockup) but cannot read or post anything else in the shell.
The editor accepts shell commands only from its immediate parent window, rejecting messages
from nested mockup frames. Export staging uses exclusive, randomly named, owner-only files
beside the selected artifact. This trusts the selected parent directory; it does not claim
protection against hostile concurrent replacement of an ancestor directory.

Editor → shell: `uc:ready`, `uc:selection` (descriptor, style report, breadcrumb), `uc:edits`
(log plus undo/redo availability), `uc:status`, `uc:toggle-mode`, `uc:scroll`, `uc:export`.
Shell → editor: `uc:set-mode`, `uc:restore` (edits, scroll, selection after a reload),
`uc:select`, `uc:deselect`, `uc:style`, `uc:size`, `uc:remove`, `uc:edit-text`, `uc:undo`,
`uc:redo`, `uc:reset`, `uc:forget`, `uc:pause-animations`, `uc:export`.

Browser → server feedback items (`POST /api/session/:key/feedback`):

- `chat` with optional `anchor` (selected element) and `pendingEdits` (one-line summaries of
  hand edits not yet in the file; context only, never to be applied by the agent);
- `edits` (Apply to file) and `finish` (Save and Finish) with `edits`, `viewport`, and `html`.
  The server writes `html` to `<name>.edited.html`, the log to `<name>.edits.json`, and queues
  the item with `exportPath`/`editsPath` instead of markup. `finish` ends the session.

Agent `await` adds `agent=<descriptor>` so the presence pill reads "Claude Code · listening".

## Responsiveness

The slow path in earlier Plan Canvas sessions was delivery: feedback only reached an agent
parked in `await`, and presence lied while nothing listened. UI Canvas inherits the fixes
(honest presence with expiry, Stop-hook drain, `pending`) and adds: the shell keeps the human's
edits client-side and replays them after every reload, so the agent's file write is the only
work between a chat request and the repaint (file watcher debounce 150 ms, reload, restore).
The skill tells the agent to signal `typing --state thinking` immediately and reply with
`await --reply`.

## Out of scope

- Framework-aware code generation. The export is DOM plus an edit log; translating it into
  React/Vue/Swift is the agent's job, guided by the skill.
- Multi-file apps or remote URLs. One local file per session.
- Pixel-exact device emulation (user agent, touch events, DPR). The viewport is exact in CSS
  pixels; hover and pointer media features follow the real browser.
- Collaborative sessions. One browser, one agent, one file.

## Verification

`node tests/lib/ui-canvas-feedback.test.js`, `node tests/lib/ui-canvas-ui.test.js`,
`node tests/lib/plan-canvas-agent-identity.test.js`, `node tests/scripts/ui-canvas.test.js`,
`node tests/integration/ui-canvas-e2e.test.js`, plus the existing Plan Canvas suites, run under
`node tests/run-all.js`. Manual browser QA uses a mockup opened with
`ECC_PLAN_CANVAS_STATE_DIR=/tmp/uc ECC_PLAN_CANVAS_PORT=4599 node scripts/ui-canvas.js open <file> --no-open`.

Replay identifies a target only when its selector has exactly one match. Unique
`#id` targets (and `body`/`html`) may survive an unrelated save; positional paths
and positional move parents replay only against their captured source revision.
Changed positional targets and duplicate IDs stay stale rather than editing a
different element. Submitted batches replay atomically: if any target cannot be
resolved safely, the whole batch stays visibly unresolved and Apply/Finish wait
for agent resolution. Reset reverts unsent edits and retains unresolved submitted
changes. The agent may acknowledge specific incorporated batches using UI Canvas
`await --ack fb-123`; merely draining feedback or saving another change is not
acknowledgment. An exact exported snapshot can acknowledge only the batch and
older batches proven completely represented in that snapshot.

Apply and Finish preserve an immutable pending delivery in browser session storage
before posting it. Session-scoped delivery tokens bind the exact payload: a lost
response may be retried without duplicating a batch or overwriting its export,
and a changed payload cannot reuse the token. Only authoritative accepted edit
IDs are retired, so later edits and draft text remain pending. Unknown outcomes
retain the captured undo/coalescing barrier until confirmed; an uncertain Finish
stays read-only. Chat remains outside this delivery-deduplication contract.

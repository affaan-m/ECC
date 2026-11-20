---
description: Preview a UI component mockup in the browser UI Canvas where the user hand-edits it (move, resize, text, delete, restyle), tests it across viewports, chats with you, and clicks Save and Finish; you then build the exported design for real. Thin entrypoint over the ui-canvas skill.
argument-hint: "[path/to/component.html] [--viewport mobile|desktop|WxH]"
---

# UI Canvas Command

Opens a self-contained HTML mockup in the UI Canvas, ECC's browser preview
surface, where the user adjusts the component directly, switches between
desktop, mobile, and exact dimensions, chats with you, and finishes with the
edited design exported for you to implement.

This command is a thin entry point over the `ui-canvas` skill. Follow that
skill for the mockup rules, the feedback JSON, and what to do with the
export.

## What This Command Does

1. Resolve the mockup: the given path, else write one for the component the
   user is discussing (`.claude/previews/<name>.html`, real brand tokens,
   realistic copy), else ask what to preview.
2. `ecc-ui-canvas open <file> [--viewport …] [--title …]` opens the browser.
3. `ecc-ui-canvas await <file>` blocks (run it in the background) until the
   user chats, clicks Apply to file, clicks Save and Finish, or ends.
4. On `chat`: signal `typing --state thinking`, edit the mockup file (the
   preview live-reloads and keeps their pending edits), answer with
   `await <file> --reply "…"`, repeat.
5. On `edits`: rewrite the mockup from `exportPath`, reply, keep listening.
6. On `finish`: read `exportPath` and `editsPath`, implement that exact
   design in the real component, commit per repo rules, report in chat.

## Example

```
User: /ui-canvas .claude/previews/pricing-card.html --viewport mobile

Assistant: (runs open + await, browser opens on the mobile frame)
...user resizes the image, deletes the secondary button, selects the card and sends "change this to dark gray in the brand colors"...
Assistant: (typing → edits background to var(--gray-800) → replies in-canvas → awaits)
...user clicks Save and Finish...
Assistant: Pricing card approved in the canvas: 5 hand edits plus the gray background. Porting the exported design into PricingCard.tsx now.
```

## Related

- `ui-canvas` skill: mockup rules, feedback JSON shapes, export handling
- `/plan-canvas`: the document review counterpart (same server)
- `frontend-design-direction`, `artifact-design`: visual guidance for the mockup
- Source: `scripts/ui-canvas.js`, `scripts/lib/ui-canvas/`

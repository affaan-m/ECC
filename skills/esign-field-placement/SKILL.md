---
name: esign-field-placement
description: Deterministic method for placing signature, date, and text fields in a web e-signature composer through a browser automation session, using a fixed signature page, numeric Location panel coordinates instead of drag, and a save-as-draft default. Use when automating envelope preparation for generated agreements and you need repeatable field positions, correct per-recipient ownership, and a hard gate before anything is sent or signed.
---

# E-Signature Field Placement

Dragging fields onto a PDF in a browser is not repeatable. Reading and
writing the composer's numeric Location panel is. This skill describes the
method for placing fields deterministically, assigning them to the right
recipient, and stopping before send unless an operator says otherwise.

## When to Use

- You generate agreements from a template (see master-agreement-generator)
  and prepare envelopes for them in a web e-signature composer.
- Field positions drift between runs, or fields land on the wrong recipient.
- You need screenshots and a draft envelope for operator review before send.
- The automation runs through an attached browser session (remote debugging
  port) rather than a vendor API.

## How It Works

### Preconditions

- The document's signature page is on its own page with a fixed layout: our
  block first (By, Name, Title, Email, Date), then the counterparty block.
  The generator guarantees this with a page break before the block.
- The browser session is already signed in by a human. The automation never
  enters credentials, one-time codes, or verification codes. If the composer
  redirects to a login page, print `LOGGED OUT` and exit non-zero.

### Recipients

1. Enable signing order.
2. Recipient 1: our signer (name, email).
3. Recipient 2: the counterparty signer from the spec.
4. Optional cc: added as "receives a copy", never as a signer.
5. Subject and message come from arguments; subject is trimmed to the
   composer's limit.

### Calibration

Coordinates in the Location panel are in document units; screen pixels are
scaled. Calibrate once per envelope:

1. Scroll to the signature page (last page).
2. Drag one signature field from the palette to an arbitrary spot on the
   page, then select it.
3. Open the Location panel and read its x,y. Together with the known screen
   position where the field was dropped, this gives the page origin and the
   scale factor.
4. From then on compute every target y as
   `(screen_top_of_line - page_origin) / scale` and set positions through
   the panel's numeric inputs.

### Placing fields

For each field, in this order:

1. Select the recipient who owns the field first. Fields placed while a
   recipient is selected belong to that recipient. Place all of our fields,
   then switch to the counterparty and place theirs.
2. Drag the field type from the palette to a neutral drop spot (not its final
   position).
3. If it is a text field over a blank entity line (name, title, email to be
   completed at signing), set the font size small (8 point) through the
   Formatting panel so it fits the line.
4. Set x and y through the Location panel inputs: click, select all, type
   the integer, tab out. Never nudge by drag.
5. Click on empty canvas to deselect before the next field.

Our block gets a signature and a date. The counterparty block gets a
signature, a date, and optional text fields for name, title, and email when
the spec left them blank. Page-1 entity blanks (legal name, jurisdiction,
address) take additional small text fields at coordinates supplied as
arguments.

### Evidence

Before any send decision, deselect all fields and capture a screenshot of the
signature page (and page 1 if fields were placed there). Store it with the
envelope subject in the file name. The operator reviews this image.

### Hard gate

- Default action is save as draft (Actions, then Save and Close). Print
  `DRAFT SAVED: <subject>`.
- Sending requires an explicit operator instruction for this envelope.
  Print `SENT: <subject>` only after the composer confirms.
- A `--stop` mode ends the run after placement with nothing saved, for dry
  runs.
- The automation never signs, never declines, never voids, and never opens
  a counterparty's signing link.
- Every argument is plain text; no credentials or tokens are passed.

Checklist: [references/placement-checklist.md](references/placement-checklist.md).

## Examples

### Dry run for a new counterparty

```text
prepare-envelope --docx "out/Acme MASTER.docx" --cp-name "A. Person" \
  --cp-email signer@example.com --subject "Master Agreement: Acme" \
  --message "Please review and sign." --blank-title --stop
-> screenshot env_sig.png written, STOPPED before send: Master Agreement: Acme
```

### Draft for operator review

Same arguments with `--draft` instead of `--stop`. The operator opens the
draft in the composer, checks the screenshot, and either sends it by hand or
instructs the automation to send.

### Session expired

```text
LOGGED OUT
exit status 2
```

The operator re-authenticates in the browser; the automation is re-run.

## Invariants to test

- Two runs on the same document produce identical Location panel values.
- Every counterparty field is owned by recipient 2, every one of ours by
  recipient 1.
- With no `--draft` or explicit send instruction, the envelope is not sent.
- A logged-out session exits non-zero before touching the composer.

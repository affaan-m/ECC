---
name: master-agreement-generator
description: Generate counterparty master agreements from one template plus a per-counterparty JSON spec, with role-selected clauses, a rolling Schedule A appended by written notice instead of re-signing, and a signature page pinned to its own page for stable e-sign geometry. Use when you need to issue the same framework agreement to many counterparties, add deals to an executed agreement without a new signature, or keep contract documents reproducible from source.
---

# Master Agreement Generator

One master template, one small spec per counterparty, one build step. The
executed agreement covers every future opportunity; each opportunity is added
to a rolling schedule by a dated written notice. Nobody re-signs.

## When to Use

- You issue a framework agreement (NDA, referral or sourcing fee,
  non-circumvention, master services) to many counterparties with the same
  terms and a few party-specific fields.
- Deals are added over time and re-papering each one is the bottleneck.
- Documents must be reproducible from tracked source, diffable, and free of
  hand edits.
- Signature fields are placed by automation and need a stable page layout.

## How It Works

### Template

A single markdown template with `{{PLACEHOLDER}}` fields. Every party-specific
value is a placeholder; everything else is fixed text. A skeleton lives at
[references/master-template.example.md](references/master-template.example.md).
Replace its generic sentences with your counsel-approved clauses.

Placeholders the reference script fills:

| Placeholder | Source |
| --- | --- |
| `{{DATE}}` | `spec.date`, default today |
| `{{CP_SHORT}}` | `spec.short` |
| `{{CP_LEGAL}}`, `{{CP_JURIS}}`, `{{CP_ADDR}}` | spec fields, or a blank line when the counterparty completes them at signing |
| `{{ROLE_CLAUSE}}`, `{{FEE_TITLE}}`, `{{FEE_CLAUSE}}` | selected by `spec.role` from the role table |
| `{{SCHEDULE_ROWS}}` | `spec.schedule`, or one "no entries at signing" row |
| `{{SUPPLEMENT_CLAUSE}}` | `spec.supplement`, rendered with a trailing separator or empty |
| `{{CP_SIGBLOCK}}`, `{{CP_SIGNER}}`, `{{CP_TITLE}}`, `{{CP_EMAIL}}` | signature block fields, blanks when unknown |

### Spec

One JSON file per counterparty:

```json
{
  "file": "AcmeSupplier",
  "short": "Acme",
  "role": "supplier",
  "legal": "Acme Compute Ltd",
  "juris": "England and Wales company",
  "addr": "1 Example Street, London",
  "signer": "A. Person",
  "title": "Director",
  "email": "signer@example.com",
  "schedule": [["1", "2026-09-01", "Lot A (16 nodes)", "introducer", "12 months", "standard"]],
  "supplement": "the Data Processing Addendum dated 2026-09-01"
}
```

Only `file`, `short`, and `role` are required. Missing signature fields
render as blank lines to be completed at signing. See
[references/spec.example.json](references/spec.example.json).

### Role table

`spec.role` selects three strings: the standing-arrangement clause, the fee
section title, and the fee clause opener.

| Role | Who pays | Shape of the clause |
| --- | --- | --- |
| buyer | The counterparty pays on transactions with introduced parties | Counterparty appoints us on a non-exclusive basis to source and introduce |
| supplier | The counterparty pays on transactions with introduced parties; where we buy as principal we contract on the schedule terms | Counterparty offers capacity to us and to buyers we introduce |
| mutual | Whoever closes with the other's introduction pays | Each party may introduce; the closing party pays |

Unknown roles are rejected at build time.

### Build

```sh
node skills/master-agreement-generator/scripts/build-agreement.js \
  skills/master-agreement-generator/references/master-template.example.md \
  specs/AcmeSupplier.json \
  out/
```

The script fills placeholders, renders the schedule table, writes
`out/<file> MASTER.md`, and converts to `.docx` with pandoc when pandoc is on
`PATH`. Without pandoc it writes the markdown and reports that docx was
skipped, exit code 0. Keep the generated files out of version control; the
template and specs are the source.

### Signature page geometry

The template ends the body with an OpenXML page break so the signature block
always starts a fresh page:

````markdown
```{=openxml}
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
```
````

The signature page layout (our block, then the counterparty block, each with
By, Name, Title, Email, Date) never changes between counterparties. That is
what lets e-signature field placement use fixed coordinates; see the
esign-field-placement skill.

### Schedule A append workflow

The schedule is rolling. Adding an entry is a notice, not an amendment:

1. Agree the opportunity terms in the shared channel or by email.
2. Send a dated written Schedule A notice in that same channel or by email.
   It names the protected counterparty or lot, our role for that entry
   (introducer, or principal), the commercial terms, and the fee (standard
   unless a different percentage, fixed amount, or per-unit rate is stated).
3. The entry takes effect on the notice date unless the counterparty objects
   within the objection window (for example ten business days) with dated
   written evidence of a substantive pre-existing relationship.
4. Record the entry in the tracked spec's `schedule` array and rebuild the
   document so the source of truth matches what was noticed.
5. Each entry carries its own protection period (for example twelve months
   from its notice date).

Schedule A notices are draft-only content (contractual). File them for
operator approval before sending; see operator-approval-loop.

## Examples

### Notice text

```text
Schedule A notice, 2026-09-02
Agreement: Master Agreement dated 2026-08-14 between Us and Acme
Entry 2: Lot B, 8 nodes, region EU-West
Role: introducer
Terms: 6 month term, start no later than 2026-10-01
Fee: standard
This entry takes effect today unless you object within ten business days
with dated written evidence of a prior relationship with the counterparty.
```

### Adding the entry to the spec

```json
"schedule": [
  ["1", "2026-08-20", "Lot A (16 nodes)", "introducer", "12 months", "standard"],
  ["2", "2026-09-02", "Lot B (8 nodes, EU-West)", "introducer", "6 months", "standard"]
]
```

Rebuild, diff the markdown, attach the rebuilt document to the record.

### Counterparty fills its own details at signing

Omit `legal`, `juris`, `addr`, `signer`, `title`, `email` from the spec. The
build renders blank lines and the e-sign envelope places small text fields
over them for the counterparty to complete.

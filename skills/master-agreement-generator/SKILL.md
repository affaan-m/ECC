---
name: master-agreement-generator
description: Generate review drafts of counterparty master agreements from one template plus a JSON spec, with role-selected clauses and a Schedule A workflow limited to the executed agreement's notice authority. Use when you need reproducible drafting and separately reviewed execution preparation.
---

# Master Agreement Generator

One master template, one small spec per counterparty, one draft build step.
The generator always labels output **DRAFT**, including documents generated
from a completed template. A successful conversion proves artifact generation,
not legal completeness, authority to contract, or readiness to send or sign.
An executed agreement may permit designated opportunities to be added by notice;
that authority must be established before using the Schedule A workflow.

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

Only `file`, `short`, and `role` are required for a draft. Missing signature fields
render as blank lines for review and completion. See
[references/spec.example.json](references/spec.example.json).

`file` must be a nonempty portable filename, such as `AcmeSupplier` or
`Acme Supplier`, without directory components. The builder rejects either path
separator, drive/UNC syntax, control characters, Windows-reserved punctuation
or device names, and trailing dots or spaces. Invalid names are rejected without
sanitizing or renaming them, before creating output or invoking pandoc.

Omit `schedule` or use `[]` for the “no entries at signing” placeholder. A supplied
schedule must otherwise be a dense array of six-cell arrays, in this order:
number, date, protected counterparty or lot, role, terms, fee. Each cell must be
a valid Unicode string or finite number; empty strings are allowed for intentional blanks.
Nulls, booleans, objects, nested cell arrays, missing cells and non-finite numbers
are rejected with a row/cell index before any artifact write or pandoc activity.
Unpaired UTF-16 surrogates are also rejected rather than replaced during UTF-8
output; valid supplementary characters, such as emoji, remain supported.

Cells are plain text, not Markdown or HTML. The builder encodes syntax characters
so literal pipes, backslashes, backticks and markup stay in their original fields.
Each CRLF, bare CR or LF becomes a space; text around line breaks is retained.
Other whitespace and literal punctuation are preserved in the rendered cells.
The source spec is not modified. An ordinary valid schedule retains its six
columns; malformed input is never silently replaced with an empty schedule.

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

Use operator-reviewed templates and specs only. Ordinary template substitutions
outside Schedule A are markup-capable, not a sanitizer for untrusted documents.
Pandoc can read referenced local or remote resources; this generator does not
sandbox the converter's filesystem or network access. Review those references
and run conversion in your own appropriately restricted environment. The focused
tests use a synthetic converter and do not certify real DOCX layout or isolation.

```sh
node skills/master-agreement-generator/scripts/build-agreement.js \
  skills/master-agreement-generator/references/master-template.example.md \
  specs/AcmeSupplier.json \
  out/
```

The script fills placeholders, renders the schedule table, and writes
`out/<file> MASTER.md` with a mandatory DRAFT notice. By default (or with
`--require-docx`) it requires installed pandoc to produce a nonempty regular
`.docx` artifact. Missing pandoc, failed conversion or missing/empty output
returns exit code 1. Each pandoc probe or conversion is bounded to ten seconds.
Unknown, duplicate or conflicting flags return exit code 2.

Use `--markdown-only` explicitly for a successful Markdown-only draft. This mode
never probes or invokes pandoc, returns `docxSkipped: true` from the library,
and provides no DOCX for an e-sign workflow. Library callers must pass
`{ markdownOnly: true }`; `{ pandoc: false }` alone now fails the DOCX requirement.
The result always reports `documentStatus: 'draft'`. Existing generated DOCX is
removed when rebuilding its Markdown, and failed conversion leaves no partial
DOCX, so an earlier artifact cannot masquerade as the current output. Keep
both generated files out of version control; the template and specs are source.

There is no execution-copy mode. The example deliberately contains unresolved
bracketed drafting directives; filling `{{PLACEHOLDER}}` tokens does not complete
those legal provisions. Before preparing an execution document, obtain separate
review of the completed clauses, party details, authorized signer, commercial
terms and exact document version. Preserve the draft and the reviewed execution
copy as distinct records. Even a successful DOCX conversion does not authorize an
upload, send or signature. See the esign-field-placement approval workflow.

Both output destinations must be direct children of the resolved output directory.
An existing symlink at either destination, including a dangling link, is rejected
before either artifact is written, even when DOCX conversion is disabled. Ordinary
regular files can be rebuilt. Use an output directory you control; these checks
do not provide isolation against concurrent hostile filesystem changes. Returned
artifact paths are absolute.

### Signature page geometry

The template ends the body with an OpenXML page break so the signature block
requests a fresh page in a compatible DOCX renderer:

````markdown
```{=openxml}
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
```
````

The signature page structure (our block, then the counterparty block, each with
By, Name, Title, Email, Date) is consistent, but pagination can change with text,
fonts, renderer or format. Inspect the actual reviewed document and its page
geometry before placing fields; see the esign-field-placement skill.

### Schedule A append workflow

Use the executed agreement's actual authority and notice requirements:

1. Review opportunity economics and negotiation strategy in an **internal**
   negotiation/approval channel. Obtain commitment approval before sending
   contractual content. A shared counterparty channel is not an internal channel.
2. Confirm that the proposed entry, role, terms, fee and effective date fall
   within the agreement's express Schedule A notice authority. Changes to
   standing terms, or variations outside that authority, require the applicable
   amendment procedure; a notice cannot create its own exception.
3. Draft an approved, counterparty-specific dated notice for the recipient and
   notice channel authorized by the executed agreement. Include useful business
   content: the protected counterparty or lot, authorized role, commercial terms
   and applicable fee. Exclude internal margins, negotiation strategy, other
   parties' economics, system traces, raw errors and internal filing notices.
4. File the exact notice for operator approval before sending; see
   operator-approval-loop. Preserve silence in the counterparty channel while
   approval or participation authority is absent. Approval is distinct from
   evidence that an authorized sender actually delivered the notice.
5. Record the authorized delivery evidence, effective date and any objection
   under the executed agreement's actual requirements. Example periods are not
   defaults. Keep the executed document immutable; update the tracked schedule
   record and rebuild a **draft consolidated view** for internal review, with a
   reference to the executed version and approved notice. This rebuild does not
   replace the signed agreement or prove legal effect.

## Examples

### Notice text

Illustrative draft only: use these terms and dates solely when the executed
agreement authorizes them and the operator approves this exact recipient notice.

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

Rebuild, diff the draft Markdown, and attach the consolidated draft to the
internal record alongside the unchanged executed document and notice evidence.

### Counterparty fills its own details at signing

For drafting, omit `legal`, `juris`, `addr`, `signer`, `title`, `email` from the
spec to render blank lines. A separately reviewed execution workflow must decide
which details may be completed by the counterparty and verify the actual fields;
the generator does not create or approve an e-sign envelope.

export const meta = {
  name: 'orch-review',
  description:
    'ECC Review phase as a native Claude Code workflow: multi-dimension review (quality + language + conditional security) then adversarial verification of every CRITICAL/HIGH finding. Returns blocking + advisory findings for Gate 2.',
  phases: [
    { title: 'Review', detail: 'one reviewer agent per dimension, in parallel' },
    { title: 'Verify', detail: 'adversarially refute each CRITICAL/HIGH finding' }
  ]
};

// ---------------------------------------------------------------------------
// Pilot port of orch-pipeline Phase 5 (Review). The gated outer loop stays in
// the main conversation; this script owns only the autonomous, fan-out-heavy
// review+verify segment between the two human gates.
//
// Caller contract — pass `args` (the main loop computes the diff and language):
//   {
//     diff:         string,    // unified `git diff` text to review (required)
//     language?:    string,    // e.g. "typescript" — selects a language reviewer
//     changedFiles?: string[], // paths touched, used for the security trigger
//   }
//
// Returns:
//   { verdict: 'APPROVE' | 'CHANGES_REQUESTED',
//     blocking: Finding[],   // confirmed CRITICAL/HIGH — must clear before Gate 2
//     advisory: Finding[],   // MEDIUM/LOW + refuted findings, informational
//     stats: { dimensions, raw, verified, refuted } }
// ---------------------------------------------------------------------------

// Language → ECC reviewer agent. Mirrors the agents present in agents/.
const LANGUAGE_REVIEWER = {
  typescript: 'ecc:typescript-reviewer',
  javascript: 'ecc:typescript-reviewer',
  python: 'ecc:python-reviewer',
  go: 'ecc:go-reviewer',
  rust: 'ecc:rust-reviewer',
  java: 'ecc:java-reviewer',
  kotlin: 'ecc:kotlin-reviewer',
  swift: 'ecc:swift-reviewer',
  php: 'ecc:php-reviewer',
  csharp: 'ecc:csharp-reviewer',
  fsharp: 'ecc:fsharp-reviewer',
  react: 'ecc:react-reviewer',
  vue: 'ecc:vue-reviewer',
  flutter: 'ecc:flutter-reviewer',
  dart: 'ecc:flutter-reviewer',
  django: 'ecc:django-reviewer',
  fastapi: 'ecc:fastapi-reviewer',
  cpp: 'ecc:cpp-reviewer'
};

// orch-pipeline security trigger: auth/authz, user input, db queries, fs paths,
// external calls, crypto, secrets. Matched against the diff text + file paths.
const SECURITY_TRIGGER =
  /\b(auth|login|password|passwd|token|secret|credential|api[_-]?key|session|jwt|oauth|cookie|sql|query|exec|eval|crypto|cipher|hash|hmac|sign|fs\.|readFile|writeFile|fetch|axios|request|subprocess|os\.system)\b/i;

// A reviewer agent must emit findings in this shape — validated at the tool layer.
const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES_REQUESTED'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'file', 'evidence'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          file: { type: 'string' },
          line: { type: ['integer', 'null'] },
          evidence: { type: 'string', description: 'the offending snippet or exact location' },
          proof: { type: 'string', description: 'why it is a real problem (required for HIGH/CRITICAL)' },
          fix: { type: 'string', description: 'concrete suggested remediation' }
        }
      }
    }
  }
};

// Independent skeptic verdict for one finding.
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'confidence', 'reasoning'],
  properties: {
    isReal: { type: 'boolean', description: 'true only if the finding genuinely holds against the diff' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string' }
  }
};

const SEVERITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const isBlocking = f => f.severity === 'CRITICAL' || f.severity === 'HIGH';
const normalize = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

function reviewPrompt(dimensionLabel, diff) {
  return [
    `You are reviewing a unified diff along the "${dimensionLabel}" dimension.`,
    'Apply your standard checklist. Only report issues you are >80% sure are real problems.',
    'For any CRITICAL or HIGH finding you MUST supply concrete `evidence` and a `proof` of impact; if you cannot, demote it or drop it.',
    'Returning zero findings with verdict APPROVE is an acceptable and expected outcome for clean diffs.',
    '',
    'DIFF:',
    diff
  ].join('\n');
}

function verifyPrompt(finding, diff) {
  return [
    'You are an independent skeptic. Try to REFUTE the finding below by checking it against the actual diff.',
    'Default to isReal=false when you are uncertain or cannot locate supporting evidence in the diff.',
    '',
    `Finding (${finding.severity}) in ${finding.file}: ${finding.title}`,
    `Claimed evidence: ${finding.evidence}`,
    finding.proof ? `Claimed proof: ${finding.proof}` : '',
    '',
    'DIFF:',
    diff
  ].join('\n');
}

// --- main -----------------------------------------------------------------

// `args` arrives verbatim. Defensively accept a JSON-encoded string too, so the
// workflow works whether the caller passes an object or a stringified payload.
const input = typeof args === 'string' ? JSON.parse(args) : args || {};

if (typeof input.diff !== 'string' || input.diff.trim() === '') {
  log('orch-review: no diff supplied in args.diff — nothing to review.');
  return { verdict: 'APPROVE', blocking: [], advisory: [], stats: { dimensions: 0, raw: 0, verified: 0, refuted: 0 } };
}

const diff = input.diff;
const haystack = `${diff}\n${(input.changedFiles || []).join('\n')}`;

// Build the review dimensions. Quality always runs; language + security are conditional.
const dimensions = [{ key: 'quality', label: 'correctness & quality', agentType: 'ecc:code-reviewer' }];

const langReviewer = input.language && LANGUAGE_REVIEWER[String(input.language).toLowerCase()];
if (langReviewer) {
  dimensions.push({ key: `lang:${input.language}`, label: `${input.language} idioms & pitfalls`, agentType: langReviewer });
}

if (SECURITY_TRIGGER.test(haystack)) {
  dimensions.push({ key: 'security', label: 'security (OWASP, secrets, injection)', agentType: 'ecc:security-reviewer' });
  log('Security trigger matched — adding security-reviewer dimension.');
}

log(`Reviewing across ${dimensions.length} dimension(s): ${dimensions.map(d => d.key).join(', ')}`);

// Stage 1 — every dimension reviews in parallel. This is a deliberate BARRIER:
// independent reviewers routinely flag the same line, so we need the full set
// before we can dedup. Verifying first and deduping later would waste verifier
// calls on duplicates (e.g. one SQL-injection bug reported by all 3 dimensions).
const reviews = await parallel(
  dimensions.map(
    d => () =>
      agent(reviewPrompt(d.label, diff), { agentType: d.agentType, phase: 'Review', label: `review:${d.key}`, schema: FINDINGS_SCHEMA }).then(r => ({
        dim: d.key,
        findings: (r && r.findings) || []
      }))
  )
);

// Dedup across dimensions. The evidence snippet (the offending code) is the most
// stable key — titles are phrased differently and line numbers drift per reviewer.
const tagged = reviews.filter(Boolean).flatMap(r => r.findings.map(f => ({ ...f, dimension: r.dim })));
const byKey = new Map();
for (const f of tagged) {
  const key = `${f.file}::${normalize(f.evidence)}`;
  const prev = byKey.get(key);
  if (!prev) {
    byKey.set(key, { ...f, dimensions: [f.dimension] });
  } else {
    if (!prev.dimensions.includes(f.dimension)) prev.dimensions.push(f.dimension);
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[prev.severity]) prev.severity = f.severity; // keep the strictest
  }
}
const unique = [...byKey.values()];
log(`Reviews returned ${tagged.length} findings → ${unique.length} unique after dedup.`);

// Stage 2 — adversarially verify each unique CRITICAL/HIGH. MEDIUM/LOW are advisory.
const advisory = unique.filter(f => !isBlocking(f));
const verified = await parallel(
  unique.filter(isBlocking).map(
    f => () =>
      agent(verifyPrompt(f, diff), { phase: 'Verify', label: `verify:${f.file}`, schema: VERDICT_SCHEMA }).then(v => ({
        ...f,
        verdict: v || { isReal: false, confidence: 0, reasoning: 'verifier failed' }
      }))
  )
);

const confirmed = verified.filter(f => f.verdict && f.verdict.isReal);
const refuted = verified.filter(f => !(f.verdict && f.verdict.isReal));

log(`Done: ${confirmed.length} confirmed blocking, ${refuted.length} refuted, ${advisory.length} advisory.`);

return {
  verdict: confirmed.length > 0 ? 'CHANGES_REQUESTED' : 'APPROVE',
  blocking: confirmed,
  advisory: [...advisory, ...refuted.map(f => ({ ...f, note: 'refuted by adversarial verifier' }))],
  stats: { dimensions: dimensions.length, raw: tagged.length, unique: unique.length, verified: confirmed.length, refuted: refuted.length }
};

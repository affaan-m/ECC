'use strict';

/**
 * Contract tests for the generic desk-pattern skills: operator approval loop,
 * counterparty channel discipline, master agreement generator, and e-sign
 * field placement. They must stay vendor-neutral and free of local paths.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const SKILLS = [
  'operator-approval-loop',
  'counterparty-channel-discipline',
  'master-agreement-generator',
  'esign-field-placement',
];
const REQUIRED_SECTIONS = ['## When to Use', '## How It Works', '## Examples'];
const FORBIDDEN_WORDS = [
  'ito', 'itô', 'hermes', 'docusign', 'pluto', 'stellon', 'mayfield',
  'affaan', 'alejandro', 'graphiti', 'itomarkets',
];
const EM_DASH = '—';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

console.log('\n=== Desk pattern skills ===\n');

for (const skill of SKILLS) {
  const skillDir = path.join(repoRoot, 'skills', skill);
  const skillPath = path.join(skillDir, 'SKILL.md');

  test(`${skill}: SKILL.md has name and description frontmatter`, () => {
    assert.ok(fs.existsSync(skillPath), `${skill}/SKILL.md is missing`);
    const source = fs.readFileSync(skillPath, 'utf8');
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, 'frontmatter missing');
    const keys = frontmatter[1].split('\n').map(line => line.split(':')[0]);
    assert.deepStrictEqual(keys, ['name', 'description']);
    assert.match(frontmatter[1], new RegExp(`^name: ${skill}$`, 'm'));
    assert.match(frontmatter[1], /^description: .*Use when/m);
  });

  test(`${skill}: SKILL.md has the required sections`, () => {
    const source = fs.readFileSync(skillPath, 'utf8');
    for (const section of REQUIRED_SECTIONS) {
      assert.ok(source.includes(section), `missing ${section}`);
    }
  });

  test(`${skill}: files contain no em dashes, vendor names, or local paths`, () => {
    for (const file of walk(skillDir)) {
      const relative = path.relative(repoRoot, file);
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(!source.includes(EM_DASH), `${relative} contains an em dash`);
      assert.ok(!/\/Users\//.test(source), `${relative} contains a /Users/ path`);
      for (const word of FORBIDDEN_WORDS) {
        const pattern = new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i');
        assert.ok(!pattern.test(source), `${relative} mentions "${word}"`);
      }
    }
  });
}

test('operator-approval-loop ships the ledger schema with the idempotency key', () => {
  const sql = fs.readFileSync(path.join(repoRoot, 'skills/operator-approval-loop/references/approval-ledger.sql'), 'utf8');
  assert.match(sql, /UNIQUE\(obligation_id, decision_id\)/);
  assert.match(sql, /draft_sha256/);
  assert.match(sql, /auto_send_after/);
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/operator-approval-loop/SKILL.md'), 'utf8');
  assert.match(skill, /BASELINE_CHECK_UNAVAILABLE/);
  assert.match(skill, /exact `draft_text`/);
});

// These check the written routing contract, not a live sender or runtime policy.
function approvalSection(heading) {
  const source = fs.readFileSync(path.join(repoRoot, 'skills/operator-approval-loop/SKILL.md'), 'utf8');
  const marker = `${heading}\n`;
  assert.ok(source.includes(marker), `missing ${heading}`);
  return source.split(marker)[1].split(/\n#{2,3} /)[0].replace(/\s+/g, ' ');
}

test('approval filing notices require a verified internal destination', () => {
  const filing = approvalSection('### Filing a draft');
  assert.match(filing, /only to a configured, verified internal ops destination/i);
  assert.match(filing, /origin is that internal destination, acknowledge there/i);
  assert.match(filing, /never-silent.*internal reporting/i);
  assert.doesNotMatch(filing, /acknowledge in the origin channel/i);
  assert.match(filing, /keep draft hashes, approval status, operator identity and workflow metadata out of counterparty-visible channels/i);
});

test('approval notices stay quiet for unknown origins and have no external fallback', () => {
  const filing = approvalSection('### Filing a draft');
  assert.match(filing, /unknown or unclassified origins.*quiet/i);
  assert.match(filing, /direct message.*not.*internal/i);
  assert.match(filing, /internal destination is unavailable.*internal tool result or operator surface/i);
  assert.match(filing, /never fall back to an external or unknown origin/i);
  const policy = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(policy, /unknown channels default to quiet/i);
  assert.match(policy, /never_silent_ack: true.*internal channels only/i);
});

test('approval example and invariants keep receipt metadata internal without granting a send', () => {
  const example = approvalSection('### File a draft');
  assert.match(example, /verified internal ops destination sees:.*Draft filed for approval/i);
  assert.match(example, /origin channel receives no filing notice/i);
  assert.doesNotMatch(example, /origin channel sees:/i);
  const filing = approvalSection('### Filing a draft');
  assert.match(filing, /filing a draft does not authorize an external response/i);
  assert.match(filing, /clarifying question or neutral response.*separate outbound decision/i);
  for (const constraint of ['mention', 'channel', 'draft-only', 'frozen', 'never']) {
    assert.ok(filing.includes(constraint), `missing ${constraint} constraint`);
  }
  const invariants = approvalSection('## Invariants to test');
  assert.match(invariants, /filing receipts.*only.*verified internal ops/i);
  assert.match(invariants, /unavailable internal destination.*no external fallback/i);
});

test('counterparty-channel-discipline ships a policy example and a strict prompt template', () => {
  const policy = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/references/channel-policy.example.yaml'), 'utf8');
  assert.match(policy, /require_mention: true/);
  assert.match(policy, /observe_unmentioned_group_messages: true/);
  assert.match(policy, /default: auto/);
  const template = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/references/strict-prompt.template.md'), 'utf8');
  assert.doesNotMatch(template, /\{\{CHANNEL_NAME\}\}/);
  assert.match(template, /untrusted data/);
  assert.match(template, /Never reveal one counterparty/);
});

test('master-agreement-generator template pins the signature page with a page break', () => {
  const template = fs.readFileSync(path.join(repoRoot, 'skills/master-agreement-generator/references/master-template.example.md'), 'utf8');
  assert.match(template, /w:br w:type="page"/);
  assert.match(template, /\{\{SCHEDULE_ROWS\}\}/);
  const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, 'skills/master-agreement-generator/references/spec.example.json'), 'utf8'));
  assert.strictEqual(spec.role, 'supplier');
});

test('esign-field-placement defaults to draft and forbids credential entry', () => {
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/esign-field-placement/SKILL.md'), 'utf8');
  assert.match(skill, /save as draft/i);
  assert.match(skill, /never\s+enters credentials/i);
  assert.match(skill, /Never nudge by drag/);
  assert.match(skill, /LOGGED OUT/);
});

// Written-contract coverage only: these checks do not execute a browser or transform.
const placementDocuments = [
  'skills/esign-field-placement/SKILL.md',
  'skills/esign-field-placement/references/placement-checklist.md',
].map(relative => ({ relative, text: fs.readFileSync(path.join(repoRoot, relative), 'utf8').replace(/\s+/g, ' ') }));

function checkPlacementDocuments(assertions) {
  for (const { relative, text } of placementDocuments) {
    for (const pattern of assertions) {
      assert.match(text, pattern, `${relative} missing contract ${pattern}`);
    }
  }
}

test('e-sign contract requires enough calibration data on each axis', () => {
  checkPlacementDocuments([
    /axis-aligned.*unrotated/i,
    /independently known.*scale/i,
    /two.*distinct.*document.*coordinates/i,
    /each axis/i,
    /one.*point.*cannot.*origin.*scale/i,
    /rotation.*shear.*stop/i,
  ]);
  for (const { text } of placementDocuments) {
    assert.doesNotMatch(text, /origin and scale computed from that reading/i);
    assert.doesNotMatch(text, /this gives the page origin and the scale factor/i);
  }
});

test('e-sign contract rejects invalid calibration and checks an independent reference', () => {
  checkPlacementDocuments([
    /nonfinite.*zero.*negative.*degenerate/i,
    /independent.*reference.*tolerance/i,
    /tolerance.*units.*field dimensions/i,
    /cursor.*not.*field.*anchor/i,
    /recalibrate.*zoom.*layout.*viewport.*scroll.*page/i,
  ]);
});

test('e-sign contract requires trusted exact parsed origins and approved frames', () => {
  checkPlacementDocuments([
    /trusted.*configuration.*HTTPS.*origins/i,
    /scheme.*host.*effective port/i,
    /substring.*suffix/i,
    /userinfo.*opaque.*lookalike/i,
    /top-level.*target frame.*ancestor/i,
    /page.*redirect.*cannot.*allowlist/i,
  ]);
});

test('e-sign contract binds composer identity and revalidates every operation', () => {
  checkPlacementDocuments([
    /application.*composer.*document.*identity/i,
    /before every sensitive read and every mutation/i,
    /recipient.*field.*save.*send/i,
    /navigation.*tab.*frame.*logout.*invalidate/i,
    /stop.*document.*recipient.*reads.*mutations/i,
    /minimal.*origin.*state metadata/i,
  ]);
});

test('e-sign contract preserves draft and separate send authority after identity checks', () => {
  checkPlacementDocuments([
    /save as draft/i,
    /explicit.*operator.*instruction.*this envelope/i,
    /identity checks.*do not.*send authority/i,
    /no.*automatic.*reauthentication/i,
  ]);
  const skill = placementDocuments[0].text;
  assert.match(skill, /never signs, never declines, never voids/);
  assert.match(skill, /--stop.*nothing saved/);
});

test('e-sign guidance and examples make no executable browser enforcement claim', () => {
  checkPlacementDocuments([/written.*contract.*not.*executable browser/i]);
  assert.match(placementDocuments[0].text, /prepare-envelope.*illustrative.*not.*shipped/i);
});


// Integration contracts remain written guidance; no provider or policy engine is run.
test('e-sign evidence filenames and send grants have explicit trust boundaries', () => {
  checkPlacementDocuments([
    /opaque.*evidence.*identifier/i,
    /subject.*never.*filename/i,
    /trusted.*operator.*channel/i,
    /recipient.*document.*digest.*action/i,
    /page.*text.*cannot.*send.*authority/i,
    /expired.*changed.*require.*new.*approval/i,
  ]);
});

test('channel policy separates audience, participation and output permission', () => {
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  const template = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/references/strict-prompt.template.md'), 'utf8');
  const policy = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/references/channel-policy.example.yaml'), 'utf8');
  assert.match(skill, /platform.*workspace.*channel.*identity/i);
  assert.match(skill, /historical.*thread.*never.*consent/i);
  assert.match(skill, /before.*model.*context.*media/i);
  assert.match(skill, /output.*permission.*not.*delivery.*grant/i);
  assert.match(skill, /one-to-one.*DM.*not.*audience/i);
  assert.match(skill, /no.*second.*policy.*engine/i);
  assert.doesNotMatch(template, /\{\{CHANNEL_NAME\}\}|own a direct answer|Never say you cannot|config, or capabilities/i);
  assert.match(template, /cannot read that attachment/i);
  assert.match(template, /untrusted data/i);
  assert.match(template, /internal filing notices/i);
  assert.match(policy, /schema: illustrative/);
  assert.match(policy, /workspace_id:/);
  assert.match(policy, /channel_id:/);
  assert.match(policy, /unknown_audience: external/);
  assert.match(policy, /bot_requires_scoped_operator_request: true/);
  assert.doesNotMatch(policy, /allow_bots: mentions|groups:\s*\n\s*"#/);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);

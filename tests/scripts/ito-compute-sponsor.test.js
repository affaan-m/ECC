/**
 * Tests for the Phase 1 Ito compute-sponsor surface.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const URL_TOKEN_PATTERN = /https?:\/\/[^\s<>"'`(){}\\]+/g;
const EXPECTED_COMPUTE_ROUTE = Object.freeze({
  protocol: 'https:',
  hostname: 'compute.itomarkets.com',
  port: '',
  username: '',
  password: '',
  pathname: '/',
  search: '',
  hash: '',
});

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function isExactComputeRoute(candidate) {
  try {
    const parsed = new URL(candidate.replace(/[.,;:!?]+$/, ''));
    return Object.entries(EXPECTED_COMPUTE_ROUTE).every(
      ([property, expected]) => parsed[property] === expected
    );
  } catch {
    return false;
  }
}

function assertExactComputeRoute(content) {
  const candidates = content.match(URL_TOKEN_PATTERN) || [];
  assert.ok(
    candidates.some(isExactComputeRoute),
    'Should include the exact Itô compute route'
  );
}

function assertHonestComputeCopy(content) {
  assertExactComputeRoute(content);
  assert.match(content, /preferred compute sponsor/i);
  assert.match(content, /run or self-host any open-source model/i);
  assert.match(content, /any GPU provider/i);
  assert.match(content, /sponsorship link is passive/i);
  assert.match(content, /ecc ito find/i);
  assert.match(content, /explicitly configured canonical Itô CLI/i);
  assert.match(content, /submits a live authenticated RFQ/i);
  assert.match(content, /does not reserve capacity/i);
  assert.match(content, /managed inference[^\n.]*not live/i);
  assert.doesNotMatch(content, /ECC only (?:links|provides this link)/i);
}

function main() {
  console.log('\n=== Testing Ito compute-sponsor surface ===\n');

  let passed = 0;
  let failed = 0;

  const tests = [
    ['compute route validation rejects deceptive lookalike hosts', () => {
      const deceptiveCopy = [
        'Itô is the preferred compute sponsor:',
        'https://compute.itomarkets.com.attacker.example',
        'Any GPU provider works.',
        'Managed inference through Itô is not live.',
      ].join(' ');

      assert.throws(
        () => assertHonestComputeCopy(deceptiveCopy),
        /exact Itô compute route/
      );
    }],
    ['README exposes the sponsor logo and honest self-hosting route', () => {
      const readme = read('README.md');
      assert.ok(readme.includes('assets/images/sponsors/ito.svg'));
      assertHonestComputeCopy(readme);
      assert.match(
        readme,
        /custom API endpoint or model gateway[\s\S]*Run or self-host any open-source model behind that gateway[\s\S]*sponsorship link is passive/
      );
      const sponsorMark = read('assets/images/sponsors/ito.svg');
      assert.match(sponsorMark, /<path\b/);
      assert.match(sponsorMark, /fill="#0F172A"/);
      assert.doesNotMatch(
        sponsorMark,
        /@import|<script|<foreignObject|\son[a-z]+=|(?:href|xlink:href)=/i
      );
    }],
    ['sponsor roster keeps Itô and Moonshot distinct from node tooling', () => {
      const sponsors = read('SPONSORS.md');
      assert.ok(sponsors.includes('[**Itô**]'));
      assert.ok(sponsors.includes('assets/images/sponsors/ito.svg'));
      assert.ok(sponsors.includes('[**Moonshot AI**]'));
      assert.ok(sponsors.includes('assets/images/sponsors/moonshot.svg'));
      assert.doesNotMatch(sponsors, /sixtytwo|sixty.?two/i);
      assertExactComputeRoute(sponsors);
    }],
    ['inference guide distinguishes rental compute from managed serving', () => {
      assertHonestComputeCopy(read('docs/ATLAS-CLOUD-GUIDE.md'));
    }],
    ['harness docs route generic open-source model intent without lock-in', () => {
      assertHonestComputeCopy(read('.claude-plugin/README.md'));
      assertHonestComputeCopy(read('.kimi/README.md'));
    }],
    ['integration record keeps the thesis and real client boundary honest', () => {
      const record = read('docs/design/ecc-ito-compute-integration.md');
      assert.match(record, /-> any open-source model/);
      assert.doesNotMatch(record, /public Kimi|Moonshot|video and sponsorship/i);
      assert.match(record, /Status: \*\*Implemented local CLI bridge/i);
      assert.match(record, /auth`, `find`, and `status/);
      assert.match(record, /ito_auth`, `ito_find`, and `ito_status/);
      assert.match(record, /unpublished/i);
      assert.match(record, /managed inference remains unavailable/i);
      assert.match(record, /version bump[\s\S]*intentionally deferred/i);
      assert.doesNotMatch(record, /manual_copy|ito\.compute\.handoff|ecc ito rent/i);
    }],
    ['top-level CLI help exposes the provider-neutral compute route', () => {
      const result = spawnSync('node', ['scripts/ecc.js', '--help'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assertHonestComputeCopy(result.stdout);
    }],
    ['installer help and human dry-run expose the compute route', () => {
      const help = spawnSync('node', ['scripts/install-apply.js', '--help'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      assert.strictEqual(help.status, 0, help.stderr);
      assertHonestComputeCopy(help.stdout);

      const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ito-home-'));
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ito-project-'));
      try {
        const dryRun = spawnSync(
          'node',
          [path.join(REPO_ROOT, 'scripts', 'install-apply.js'), '--profile', 'minimal', '--dry-run'],
          {
            cwd: projectDir,
            env: { ...process.env, HOME: homeDir },
            encoding: 'utf8',
          }
        );
        assert.strictEqual(dryRun.status, 0, dryRun.stderr);
        assertHonestComputeCopy(dryRun.stdout);
      } finally {
        fs.rmSync(homeDir, { recursive: true, force: true });
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    }],
    ['npm package publishes the Ito mark and welcome route', () => {
      const packageJson = JSON.parse(read('package.json'));
      assert.ok(packageJson.files.includes('assets/images/sponsors/'));
      assertExactComputeRoute(packageJson.scripts.welcome);
      assert.match(packageJson.scripts.welcome, /run or self-host any open-source model/i);
      assert.match(packageJson.scripts.welcome, /sponsorship link is passive/i);
      assert.match(packageJson.scripts.welcome, /ecc ito find/i);
      assert.match(packageJson.scripts.welcome, /submits a live authenticated RFQ/i);
      assert.match(packageJson.scripts.welcome, /does not reserve capacity/i);
      assert.ok(fs.existsSync(path.join(REPO_ROOT, 'assets', 'images', 'sponsors', 'ito.svg')));
      assert.ok(fs.existsSync(path.join(REPO_ROOT, 'assets', 'images', 'sponsors', 'moonshot.svg')));
    }],
  ];

  for (const [name, fn] of tests) {
    if (runTest(name, fn)) {
      passed += 1;
    } else {
      failed += 1;
    }
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();

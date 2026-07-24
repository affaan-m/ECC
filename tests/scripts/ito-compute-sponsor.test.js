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

function readPngDimensions(relativePath) {
  const image = fs.readFileSync(path.join(REPO_ROOT, relativePath));
  assert.strictEqual(image.subarray(1, 4).toString('ascii'), 'PNG');
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
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

function assertExactHref(content, expectedHref) {
  const expected = new URL(expectedHref);
  const hrefs = [...content.matchAll(/\bhref="([^"]+)"/g)].map(match => match[1]);
  const properties = [
    'protocol',
    'hostname',
    'port',
    'username',
    'password',
    'pathname',
    'search',
    'hash',
  ];
  const hasExactHref = hrefs.some((href) => {
    try {
      const candidate = new URL(href);
      return properties.every(property => candidate[property] === expected[property]);
    } catch {
      return false;
    }
  });

  assert.ok(hasExactHref, `Should include the exact href ${expectedHref}`);
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

function extractNamedTable(content, ariaLabel) {
  const escapedLabel = ariaLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(
    new RegExp(`<table[^>]*aria-label="${escapedLabel}"[^>]*>([\\s\\S]*?)<\\/table>`)
  );

  assert.ok(match, `Should include the "${ariaLabel}" table`);
  return match[1];
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
      assert.ok(readme.includes('assets/images/sponsors/ito-dark.svg'));
      assert.match(readme, /<p align="center" aria-label="Partners and sponsors">/);
      assert.doesNotMatch(
        readme,
        /<sub><strong>Partners &amp; sponsors<\/strong><\/sub>\s*<table>/
      );
      assert.doesNotMatch(readme, /<strong>Itô<\/strong>/);
      assert.doesNotMatch(readme, /<strong>Moonshot AI<\/strong>/);
      assertHonestComputeCopy(readme);
      assert.match(
        readme,
        /custom API endpoint or model gateway[\s\S]*Run or self-host any open-source model behind that gateway[\s\S]*sponsorship link is passive/
      );
      const sponsorMark = read('assets/images/sponsors/ito.svg');
      const sponsorMarkDark = read('assets/images/sponsors/ito-dark.svg');
      assert.match(sponsorMark, /viewBox="0 0 172 40"/);
      assert.match(sponsorMark, />It</);
      assert.match(sponsorMark, />ô</);
      assert.match(sponsorMark, />MARKETS</);
      assert.match(sponsorMarkDark, /viewBox="0 0 172 40"/);
      assert.match(sponsorMarkDark, />It</);
      assert.match(sponsorMarkDark, />ô</);
      assert.match(sponsorMarkDark, />MARKETS</);
      assert.match(sponsorMarkDark, /fill="#F8FAFC"/i);
      assert.doesNotMatch(
        `${sponsorMark}\n${sponsorMarkDark}`,
        /<script|<foreignObject|\son[a-z]+=|(?:href|xlink:href)=/i
      );
      const sponsorAssetUrls = `${sponsorMark}\n${sponsorMarkDark}`.match(URL_TOKEN_PATTERN) || [];
      assert.ok(sponsorAssetUrls.length >= 4);
      assert.ok(sponsorAssetUrls.every((url) => (
        url.startsWith('http://www.w3.org/2000/svg')
        || url.startsWith('https://fonts.googleapis.com/css2?')
      )));
    }],
    ['README keeps the three primary choices and all three guides inline', () => {
      const readme = read('README.md');
      const primaryLinks = extractNamedTable(readme, 'ECC primary links');
      const guides = extractNamedTable(readme, 'ECC guides');

      assert.strictEqual((primaryLinks.match(/<td\b/g) || []).length, 3);
      assert.ok(primaryLinks.includes('assets/images/community/ecc-tools-mark.svg'));
      assertExactHref(primaryLinks, 'https://github.com/apps/ecc-tools');
      assertExactHref(primaryLinks, 'https://ecc.tools/pricing');
      assertExactHref(primaryLinks, 'https://github.com/sponsors/affaan-m');
      assert.ok(primaryLinks.includes('assets/images/community/heart.svg'));
      assertExactHref(primaryLinks, 'https://discord.gg/36yGMHGFbR');
      assert.ok(primaryLinks.includes('assets/images/community/discord.svg'));

      for (const iconPath of [
        'assets/images/community/heart.svg',
        'assets/images/community/discord.svg',
      ]) {
        const icon = read(iconPath);
        assert.match(icon, /<svg\b/);
        assert.doesNotMatch(
          icon,
          /<script|<foreignObject|\son[a-z]+=|(?:href|xlink:href)=/i
        );
      }

      assert.strictEqual((guides.match(/<td\b/g) || []).length, 3);
      assert.ok(guides.includes('./the-shortform-guide.md'));
      assert.ok(guides.includes('./the-longform-guide.md'));
      assert.ok(guides.includes('./the-security-guide.md'));
      assert.strictEqual((guides.match(/width="213" height="120"/g) || []).length, 3);

      for (const guideAsset of [
        'assets/images/guides/shorthand-guide.png',
        'assets/images/guides/longform-guide.png',
        'assets/images/guides/security-guide.png',
      ]) {
        assert.ok(guides.includes(guideAsset));
        const { width, height } = readPngDimensions(guideAsset);
        assert.ok(
          Math.abs((width / height) - (16 / 9)) < 0.002,
          `${guideAsset} should use the shared 16:9 guide-card geometry`
        );
      }

      const eccToolsMark = read('assets/images/community/ecc-tools-mark.svg');
      assert.match(eccToolsMark, /viewBox="0 0 96 96"/);
      assert.match(eccToolsMark, /id="favicon-frame"/);
      assert.match(eccToolsMark, /id="favicon-node"/);
      assert.match(eccToolsMark, /circle cx="62" cy="44"/);
      assert.doesNotMatch(
        eccToolsMark,
        /<script|<foreignObject|\son[a-z]+=|(?:href|xlink:href)=/i
      );
    }],
    ['README shows the verified local Kimi via Ito path without claiming managed serving', () => {
      const readme = read('README.md');
      const localModelPath = extractNamedTable(readme, 'Local Kimi model path');

      assert.strictEqual((localModelPath.match(/<td\b/g) || []).length, 3);
      assert.ok(localModelPath.includes('assets/images/sponsors/ito.svg'));
      assert.ok(localModelPath.includes('assets/images/sponsors/moonshot.png'));
      assert.ok(localModelPath.includes('assets/images/community/ecc-tools-mark.svg'));
      assert.match(readme, /install\.sh --target kimi --profile minimal/);
      assert.match(readme, /npx ecc doctor --target kimi/);
      assert.match(readme, /\.kimi\/AGENTS\.md/);
      assert.match(readme, /\.kimi\/skills\//);
      assertExactHref(
        readme,
        'https://moonshotai.github.io/kimi-cli/en/configuration/providers.html'
      );
      assertHonestComputeCopy(readme);
    }],
    ['Kimi install stays inside its project root and passes doctor with native instruction surfaces', () => {
      const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-kimi-home-'));
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-kimi-project-'));

      try {
        const result = spawnSync(
          process.execPath,
          [
            path.join(REPO_ROOT, 'scripts', 'install-apply.js'),
            '--target',
            'kimi',
            '--profile',
            'minimal',
            '--dry-run',
            '--json',
          ],
          {
            cwd: projectDir,
            env: { ...process.env, HOME: homeDir },
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
          }
        );
        assert.strictEqual(result.status, 0, result.stderr);

        const plan = JSON.parse(result.stdout).plan;
        const targetRoot = path.resolve(plan.targetRoot);
        const destinations = plan.operations.map(operation => (
          path.resolve(operation.destinationPath)
        ));
        const relativeDestinations = destinations.map(destination => (
          path.relative(targetRoot, destination).replaceAll(path.sep, '/')
        ));

        assert.strictEqual(plan.target, 'kimi');
        assert.strictEqual(plan.adapter.id, 'kimi-project');
        assert.strictEqual(plan.adapter.kind, 'project');
        assert.deepStrictEqual(plan.warnings, []);
        assert.ok(plan.operations.length > 0);
        assert.ok(destinations.every(destination => (
          destination === targetRoot || destination.startsWith(`${targetRoot}${path.sep}`)
        )));
        assert.ok(relativeDestinations.includes('AGENTS.md'));
        assert.ok(relativeDestinations.some(destination => destination.startsWith('skills/')));
        assert.ok(relativeDestinations.every(destination => (
          !/^\.(?:claude|codex|cursor|gemini|hermes|opencode|openclaw|qwen|zed)\//.test(destination)
        )));

        const apply = spawnSync(
          process.execPath,
          [
            path.join(REPO_ROOT, 'scripts', 'install-apply.js'),
            '--target',
            'kimi',
            '--profile',
            'minimal',
            '--json',
          ],
          {
            cwd: projectDir,
            env: { ...process.env, HOME: homeDir },
            encoding: 'utf8',
            maxBuffer: 30 * 1024 * 1024,
          }
        );
        assert.strictEqual(apply.status, 0, apply.stderr);
        assert.strictEqual(JSON.parse(apply.stdout).result.target, 'kimi');
        assert.ok(fs.existsSync(path.join(projectDir, '.kimi', 'AGENTS.md')));
        assert.ok(fs.readdirSync(path.join(projectDir, '.kimi', 'skills')).length > 0);

        const doctor = spawnSync(
          process.execPath,
          [
            path.join(REPO_ROOT, 'scripts', 'doctor.js'),
            '--target',
            'kimi',
            '--json',
          ],
          {
            cwd: projectDir,
            env: { ...process.env, HOME: homeDir },
            encoding: 'utf8',
            maxBuffer: 30 * 1024 * 1024,
          }
        );
        assert.strictEqual(doctor.status, 0, doctor.stderr);
        const doctorResult = JSON.parse(doctor.stdout).results.find(result => (
          result.adapter.target === 'kimi'
        ));
        assert.ok(doctorResult);
        assert.strictEqual(doctorResult.exists, true);
      } finally {
        fs.rmSync(homeDir, { recursive: true, force: true });
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    }],
    ['sponsor roster keeps Itô and Moonshot distinct from node tooling', () => {
      const sponsors = read('SPONSORS.md');
      assert.ok(sponsors.includes('[**Itô**]'));
      assert.ok(sponsors.includes('assets/images/sponsors/ito.svg'));
      assert.ok(sponsors.includes('[**Moonshot AI (Kimi)**]'));
      assert.ok(sponsors.includes('assets/images/sponsors/moonshot.png'));
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
      assert.match(record, /auth`, `find`, `status`, and `evals/);
      assert.match(record, /ito_auth`, `ito_find`, and `ito_status/);
      assert.match(record, /sixtytwo-cli==0\.3\.33/);
      assert.match(record, /explicit node/i);
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
      assert.ok(fs.existsSync(path.join(REPO_ROOT, 'assets', 'images', 'sponsors', 'moonshot.png')));
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

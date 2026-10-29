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

const README_SPONSOR_LABELS = {
  "en": {
    "active": "Partners and sponsors",
    "community": "Community sponsors:",
    "past": "Past sponsors:",
    "inactive": "inactive"
  },
  "uk": {
    "active": "\u041f\u0430\u0440\u0442\u043d\u0435\u0440\u0438 \u0442\u0430 \u0441\u043f\u043e\u043d\u0441\u043e\u0440\u0438",
    "community": "\u0421\u043f\u043e\u043d\u0441\u043e\u0440\u0438 \u0441\u043f\u0456\u043b\u044c\u043d\u043e\u0442\u0438:",
    "past": "\u041c\u0438\u043d\u0443\u043b\u0456 \u0441\u043f\u043e\u043d\u0441\u043e\u0440\u0438:",
    "inactive": "\u043d\u0435\u0430\u043a\u0442\u0438\u0432\u043d\u0438\u0439"
  }
};

const CURRENT_SPONSOR_TIERS = [
  'Strategic Sponsors', 'Business Sponsors', 'Team Sponsors',
  'Pro Sponsors', 'Builder Sponsors', 'Supporters',
];
const SPANISH_SPONSOR_TIERS = [
  'Patrocinadores Empresariales', 'Patrocinadores Business', 'Patrocinadores Team',
  'Patrocinadores Pro', 'Patrocinadores Builder', 'Supporters',
];
const FORMER_SPONSOR_PATTERN = /Atlas Cloud|atlascloud|Mike Morgan|mikejmorgan-ai/i;
const ATLAS_STATUS_NOTE = '> Sponsor status: Atlas Cloud is a past sponsor. This status change leaves the documented integration unchanged.';
const ATLAS_GUIDE_HEADING = '# Atlas Cloud \u2014 LLM Provider Guide';
const MIKE_LINK = '[Mike Morgan](https://github.com/mikejmorgan-ai)';

function requiredRegion(content, opening, closing) {
  assert.strictEqual(content.split(opening).length - 1, 1, `Expected one opening: ${opening}`);
  const start = content.indexOf(opening);
  const end = content.indexOf(closing, start + opening.length);
  assert.ok(end > start, `Missing or reversed closing: ${closing}`);
  const body = content.slice(start + opening.length, end);
  assert.doesNotMatch(body, /<p\b|<sub\b/, 'Sponsor region must close before another region starts');
  return { body, start, end: end + closing.length };
}

function assertPastSponsorEntries(content, inactive, includeAtlas) {
  for (const identity of ['Mike Morgan', 'https://github.com/mikejmorgan-ai']) {
    assert.strictEqual(content.split(identity).length - 1, 1, `Expected one past ${identity}`);
  }
  assert.ok(content.includes(`Mike Morgan (${inactive})`) || content.includes(`${MIKE_LINK} (${inactive})`), 'Past Mike entry must be explicitly inactive');
  if (includeAtlas) {
    assert.strictEqual((content.match(/Atlas Cloud/g) || []).length, 1, 'Expected one past Atlas Cloud');
    assert.strictEqual(content.split('https://www.atlascloud.ai/').length - 1, 1, 'Expected one past Atlas link');
  }
}

function assertReadmeSponsorStatus(content, locale) {
  const labels = README_SPONSOR_LABELS[locale];
  const active = requiredRegion(content, `<p align="center" aria-label="${labels.active}">`, '</p>');
  const community = requiredRegion(content, `<sub><strong>${labels.community}</strong>`, '</sub>');
  const past = requiredRegion(content, `<sub><strong>${labels.past}</strong>`, '</sub>');
  assert.ok(active.end < community.start && active.end < past.start, 'Current logo region must precede sponsor rows');
  assert.doesNotMatch(active.body, FORMER_SPONSOR_PATTERN);
  assert.doesNotMatch(community.body, FORMER_SPONSOR_PATTERN);
  for (const current of ['CodeRabbit', 'Greptile', 'Moonshot', 'compute.itomarkets.com', 'SerpApi']) {
    assert.ok(active.body.includes(current), `Missing current sponsor ${current}`);
  }
  for (const current of ['jasonwu513', '1anter', 'massimotodaro', 'meadmccabe']) {
    assert.ok(community.body.includes(`https://github.com/${current}`), `Missing community sponsor ${current}`);
  }
  assertPastSponsorEntries(past.body, labels.inactive, true);
}

function assertSponsorRoster(content, spanish = false) {
  const headings = [...content.matchAll(/^## (.+)$/gm)];
  const sections = headings.map((heading, index) => ({
    title: heading[1],
    body: content.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? content.length),
  }));
  const pastTitle = spanish ? 'Patrocinadores anteriores' : 'Past Sponsors';
  const past = sections.filter(section => section.title === pastTitle);
  assert.strictEqual(past.length, 1, 'Expected exactly one past sponsor section');
  const tiers = spanish ? SPANISH_SPONSOR_TIERS : CURRENT_SPONSOR_TIERS;
  for (const tier of tiers) {
    const matches = sections.filter(section => section.title === tier || section.title.startsWith(`${tier} \u2014 `));
    assert.strictEqual(matches.length, 1, `Expected one current tier ${tier}`);
    assert.doesNotMatch(matches[0].body, FORMER_SPONSOR_PATTERN, `Former sponsor remains in ${tier}`);
  }
  assertPastSponsorEntries(past[0].body, spanish ? 'inactivo' : 'inactive', !spanish);
  if (spanish) assert.doesNotMatch(content, /Atlas Cloud|atlascloud/i);
  else {
    const business = sections.find(section => section.title === 'Business Sponsors').body;
    for (const current of ['CodeRabbit', 'Greptile', 'Moonshot', 'compute.itomarkets.com', 'SerpApi']) {
      assert.ok(business.includes(current), `Missing current Business sponsor ${current}`);
    }
  }
}

function assertAtlasStatusPlacement(content) {
  assert.ok(content.startsWith(`${ATLAS_GUIDE_HEADING}\n\n${ATLAS_STATUS_NOTE}\n\n`), 'Status note must immediately follow H1 and one blank line');
}

function readmeSponsorFixture(locale) {
  const labels = README_SPONSOR_LABELS[locale];
  const active = `<p align="center" aria-label="${labels.active}">CodeRabbit Greptile Moonshot compute.itomarkets.com SerpApi</p>`;
  const past = `<sub><strong>${labels.past}</strong> <a href="https://www.atlascloud.ai/">Atlas Cloud</a> <a href="https://github.com/mikejmorgan-ai">Mike Morgan (${labels.inactive})</a></sub>`;
  const community = `<sub><strong>${labels.community}</strong> ${['jasonwu513', '1anter', 'massimotodaro', 'meadmccabe'].map(name => `<a href="https://github.com/${name}">${name}</a>`).join(' ')}</sub>`;
  return [active, past, community].join('\n\n');
}

function sponsorRosterFixture(spanish = false) {
  const tiers = spanish ? SPANISH_SPONSOR_TIERS : CURRENT_SPONSOR_TIERS;
  const sections = tiers.map(tier => `## ${tier}\n\n${tier === 'Business Sponsors' ? 'CodeRabbit Greptile Moonshot compute.itomarkets.com SerpApi' : 'Current entries'}\n`);
  const past = spanish
    ? `## Patrocinadores anteriores\n\n${MIKE_LINK} (inactivo) | 2026\n`
    : `## Past Sponsors\n\n[Atlas Cloud](https://www.atlascloud.ai/) | 2026\n${MIKE_LINK} (inactive) | 2026\n`;
  sections.splice(2, 0, past); // Current Team and later tiers occur after Past.
  return sections.join('\n');
}

function sponsorDocsTests() {
  const tests = [
    ['English README keeps former sponsors out of both current regions', () => assertReadmeSponsorStatus(read('README.md'), 'en')],
    ['Ukrainian README keeps former sponsors out of both current regions', () => assertReadmeSponsorStatus(read('docs/uk-UA/README.md'), 'uk')],
    ['canonical roster separates past entries from every current tier', () => assertSponsorRoster(read('SPONSORS.md'))],
    ['Spanish roster moves only inactive Mike out of current tiers', () => assertSponsorRoster(read('docs/es/SPONSORS.md'), true)],
    ['Atlas status note immediately follows the guide heading', () => assertAtlasStatusPlacement(read('docs/ATLAS-CLOUD-GUIDE.md'))],
  ];
  for (const locale of ['en', 'uk']) {
    const fixture = readmeSponsorFixture(locale);
    const labels = README_SPONSOR_LABELS[locale];
    const start = `<p align="center" aria-label="${labels.active}">`;
    const community = `<sub><strong>${labels.community}</strong>`;
    const past = `<sub><strong>${labels.past}</strong>`;
    tests.push([`${locale} fixture allows past before or after community`, () => {
      assertReadmeSponsorStatus(fixture, locale);
      const [active, pastRow, communityRow] = fixture.split('\n\n');
      assertReadmeSponsorStatus([active, communityRow, pastRow].join('\n\n'), locale);
    }]);
    const mutations = [
      ['missing active marker', fixture.replace(start, '<p>')],
      ['missing closing marker', fixture.replace('</p>', '')],
      ['reversed closing marker', `</p>${fixture.replace('</p>', '')}`],
      ['duplicate active marker', `${fixture}\n${start}Extra</p>`],
      ['duplicate community marker', `${fixture}\n${community}Extra</sub>`],
      ['duplicate past marker', `${fixture}\n${past}Extra</sub>`],
      ['missing community marker', fixture.replace(community, '<sub>')],
      ['missing past marker', fixture.replace(past, '<sub>')],
      ['Atlas in current logos', fixture.replace(start, `${start}Atlas Cloud `)],
      ['Mike in current logos', fixture.replace(start, `${start}mikejmorgan-ai `)],
      ['Mike in current community', fixture.replace(community, `${community}Mike Morgan `)],
      ['Atlas in current community', fixture.replace(community, `${community}atlascloud `)],
      ['missing past Mike', fixture.replace('Mike Morgan', 'Former sponsor')],
      ['missing past status', fixture.replace(` (${labels.inactive})`, '')],
      ['missing past Atlas', fixture.replace('Atlas Cloud', 'Former organization')],
      ['past before active closes', fixture.replace('</p>', '').replace(past, `${past}</p>`)],
    ];
    for (const [name, mutated] of mutations) {
      tests.push([`${locale} sponsor checker rejects ${name}`, () => {
        assertReadmeSponsorStatus(fixture, locale);
        assert.notStrictEqual(mutated, fixture);
        assert.throws(() => assertReadmeSponsorStatus(mutated, locale));
      }]);
    }
  }
  for (const spanish of [false, true]) {
    const locale = spanish ? 'es' : 'en';
    const fixture = sponsorRosterFixture(spanish);
    const tiers = spanish ? SPANISH_SPONSOR_TIERS : CURRENT_SPONSOR_TIERS;
    const past = spanish ? 'Patrocinadores anteriores' : 'Past Sponsors';
    tests.push([`${locale} roster fixture accepts current tiers on both sides of Past`, () => assertSponsorRoster(fixture, spanish)]);
    for (const tier of tiers) {
      for (const identity of ['Atlas Cloud', 'mikejmorgan-ai']) {
        tests.push([`${locale} roster rejects ${identity} in ${tier}`, () => {
          assertSponsorRoster(fixture, spanish);
          const mutated = fixture.replace(`## ${tier}\n`, `## ${tier}\n${identity}\n`);
          assert.notStrictEqual(mutated, fixture);
          assert.throws(() => assertSponsorRoster(mutated, spanish));
        }]);
      }
    }
    for (const [name, mutated] of [
      ['missing past section', fixture.replace(`## ${past}`, '## Archive')],
      ['duplicate past section', `${fixture}\n## ${past}\n`],
      ['missing current tier', fixture.replace(`## ${tiers[2]}`, '## Other')],
      ['duplicate current tier', `${fixture}\n## ${tiers[2]}\n`],
      ['missing past Mike', fixture.replace('Mike Morgan', 'Former sponsor')],
      ['missing inactive status', fixture.replace(spanish ? '(inactivo)' : '(inactive)', '')],
    ]) {
      tests.push([`${locale} roster checker rejects ${name}`, () => {
        assertSponsorRoster(fixture, spanish);
        assert.notStrictEqual(mutated, fixture);
        assert.throws(() => assertSponsorRoster(mutated, spanish));
      }]);
    }
  }
  const guide = `${ATLAS_GUIDE_HEADING}\n\n${ATLAS_STATUS_NOTE}\n\nProvider documentation.\n`;
  tests.push(['guide fixture accepts the immediate undated status note', () => assertAtlasStatusPlacement(guide)]);
  for (const [name, mutated] of [
    ['content between heading and note', guide.replace(`\n\n${ATLAS_STATUS_NOTE}`, `\n\nUnrelated content.\n\n${ATLAS_STATUS_NOTE}`)],
    ['note after provider description', `${ATLAS_GUIDE_HEADING}\n\nProvider documentation.\n\n${ATLAS_STATUS_NOTE}\n\n`],
    ['missing heading', guide.replace(ATLAS_GUIDE_HEADING, '')],
    ['unsupported dated note', guide.replace('Sponsor status:', 'Sponsor status (2026-09-10):')],
  ]) {
    tests.push([`guide checker rejects ${name}`, () => {
      assertAtlasStatusPlacement(guide);
      assert.throws(() => assertAtlasStatusPlacement(mutated));
    }]);
  }
  return tests;
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
      assert.ok(readme.includes('assets/images/sponsors/ito-transparent.png'));
      assert.ok(readme.includes('assets/images/sponsors/ito-transparent-light.png'));
      assert.doesNotMatch(readme, /assets\/images\/sponsors\/ito(?:-dark)?\.svg/);
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
      const sponsorMark = readPngDimensions('assets/images/sponsors/ito-transparent.png');
      const sponsorMarkLight = readPngDimensions(
        'assets/images/sponsors/ito-transparent-light.png'
      );
      assert.deepStrictEqual(sponsorMark, { width: 1797, height: 1097 });
      assert.deepStrictEqual(sponsorMarkLight, sponsorMark);
    }],
    ['README keeps the three primary choices and all three guides inline', () => {
      const readme = read('README.md');
      const primaryLinks = extractNamedTable(readme, 'ECC primary links');
      const guides = extractNamedTable(readme, 'ECC guides');
      const centeredPrimaryLinks = readme.match(
        /<div align="center">\s*<table[^>]*aria-label="ECC primary links"[^>]*>[\s\S]*?<\/table>\s*<\/div>/
      );

      assert.ok(centeredPrimaryLinks, 'The three primary-link cards should be centered as one group');
      assert.strictEqual((primaryLinks.match(/<td\b/g) || []).length, 3);
      assert.ok(primaryLinks.includes('assets/images/community/ecc-tools-mark.svg'));
      assertExactHref(primaryLinks, 'https://github.com/apps/ecc-tools');
      assertExactHref(primaryLinks, 'https://ecc.tools/pricing');
      assertExactHref(primaryLinks, 'https://github.com/sponsors/affaan-m');
      assert.ok(primaryLinks.includes('assets/images/community/heart.svg'));
      assert.match(primaryLinks, /Fund the open-source project/);
      assert.doesNotMatch(primaryLinks, /From \$5\/mo/);
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
    ['sponsor docs match the current public tiers', () => {
      const sponsors = read('SPONSORS.md');

      assert.match(sponsors, /## Supporters — \$10\/mo/);
      assert.match(sponsors, /\| Supporter \| \$10 \|/);
      assert.match(sponsors, /\| Business Sponsor \| \$800 \|/);
      assert.match(sponsors, /\| Strategic Sponsor \| \$3,700 \|/);
      assert.doesNotMatch(sponsors, /Supporters — \$5\/mo|\| Supporter \| \$5 \|/);
    }],
    ['README shows the verified local Kimi via Ito path without claiming managed serving', () => {
      const readme = read('README.md');
      const localModelPath = extractNamedTable(readme, 'Local Kimi model path');

      assert.strictEqual((localModelPath.match(/<td\b/g) || []).length, 3);
      assert.ok(localModelPath.includes('assets/images/sponsors/ito-transparent.png'));
      assert.ok(localModelPath.includes('assets/images/sponsors/moonshot.png'));
      assert.ok(localModelPath.includes('assets/images/community/ecc-tools-mark.svg'));
      assert.match(readme, /install\.sh --target kimi --profile minimal/);
      const version = JSON.parse(read('package.json')).version;
      assert.ok(
        readme.includes(`npx ecc-universal@${version} doctor --target kimi`),
        'README must document the Kimi doctor command pinned to the ECC release'
      );
      assert.match(readme, /\.kimi-code\/AGENTS\.md/);
      assert.match(readme, /\.kimi-code\/skills\//);
      assert.match(readme, /~\/\.kimi-code\/config\.toml/);
      assert.match(readme, /Kimi Code 0\.31/);
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
        assert.ok(!plan.operations.some(operation => operation.moduleId === 'hooks-runtime'));

        fs.mkdirSync(path.join(projectDir, '.kimi-code'), { recursive: true });
        fs.writeFileSync(
          path.join(projectDir, '.kimi-code', 'mcp.json'),
          `${JSON.stringify({ mcpServers: { existing: { command: 'keep-me' } } }, null, 2)}\n`,
          'utf8'
        );

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
        assert.strictEqual(targetRoot, path.join(fs.realpathSync(projectDir), '.kimi-code'));
        assert.ok(fs.existsSync(path.join(projectDir, '.kimi-code', 'AGENTS.md')));
        assert.ok(fs.readdirSync(path.join(projectDir, '.kimi-code', 'skills')).length > 0);
        assert.ok(fs.existsSync(path.join(projectDir, '.kimi-code', 'mcp.json')));
        const mcpConfig = JSON.parse(
          fs.readFileSync(path.join(projectDir, '.kimi-code', 'mcp.json'), 'utf8')
        );
        assert.strictEqual(mcpConfig.mcpServers.existing.command, 'keep-me');
        assert.ok(mcpConfig.mcpServers['chrome-devtools']);
        assert.ok(!fs.existsSync(path.join(projectDir, '.kimi')));
        assert.ok(!fs.existsSync(path.join(homeDir, '.kimi-code', 'config.toml')));

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
      assert.ok(sponsors.includes('assets/images/sponsors/ito-transparent.png'));
      assert.ok(sponsors.includes('assets/images/sponsors/ito-transparent-light.png'));
      assert.doesNotMatch(sponsors, /assets\/images\/sponsors\/ito(?:-dark)?\.svg/);
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
      assert.ok(
        fs.existsSync(path.join(REPO_ROOT, 'assets', 'images', 'sponsors', 'ito-transparent.png'))
      );
      assert.ok(
        fs.existsSync(
          path.join(REPO_ROOT, 'assets', 'images', 'sponsors', 'ito-transparent-light.png')
        )
      );
      assert.ok(
        !fs.existsSync(path.join(REPO_ROOT, 'assets', 'images', 'sponsors', 'ito.svg'))
      );
      assert.ok(
        !fs.existsSync(path.join(REPO_ROOT, 'assets', 'images', 'sponsors', 'ito-dark.svg'))
      );
      assert.ok(fs.existsSync(path.join(REPO_ROOT, 'assets', 'images', 'sponsors', 'moonshot.png')));
    }],
  ];

  const docsOnly = process.argv.includes('--sponsor-docs-only');
  const docsTests = sponsorDocsTests();
  const selectedTests = docsOnly ? docsTests : [...tests, ...docsTests];
  if (docsOnly) console.log(`Sponsor docs only: ${docsTests.length} pure cases; ${tests.length} unrelated callbacks omitted.`);

  for (const [name, fn] of selectedTests) {
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

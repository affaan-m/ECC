const assert = require('node:assert/strict');

async function main() {
  const {
    announcementKey,
    buildDiscordPayload,
    findReleaseDiscussion,
    isAnnouncementDiscussion,
    normalizeDiscordWebhookUrl,
    releaseMarker,
  } = await import('../../scripts/discord/announcement-core.mjs');

assert.equal(isAnnouncementDiscussion({ category: { name: 'Announcements' } }), true);
assert.equal(isAnnouncementDiscussion({ category: { name: 'General' } }), false);
assert.equal(isAnnouncementDiscussion({ category: { name: 'announcements' } }), false);

assert.equal(releaseMarker('v2.2.0'), '<!-- ecc-release:v2.2.0 -->');
const marker = releaseMarker('v2.2.0');
assert.equal(findReleaseDiscussion([
  { id: 'untrusted', body: marker, category: { name: 'General' } },
  { id: 'canonical', body: marker, category: { name: 'Announcements' } },
], marker).id, 'canonical');
assert.equal(announcementKey({ repository: 'affaan-m/ECC', discussionId: 'D_kw123' }), 'affaan-m/ECC:discussion:D_kw123');

const payload = buildDiscordPayload({
  title: '@everyone ECC 2.2.0',
  body: 'A'.repeat(5000),
  url: 'https://github.com/affaan-m/ECC/discussions/3000',
  key: 'affaan-m/ECC:discussion:D_kw123',
});
assert.deepEqual(payload.allowed_mentions, { parse: [] });
assert.equal(payload.embeds.length, 1);
assert.ok(payload.embeds[0].description.length <= 4000);
assert.equal(payload.embeds[0].footer.text, 'ecc:D_kw123');
assert.equal(payload.embeds[0].url, 'https://github.com/affaan-m/ECC/discussions/3000');
assert.equal(payload.enforce_nonce, true);
assert.match(payload.nonce, /^ecc-[a-f0-9]{16}$/);

assert.equal(
  normalizeDiscordWebhookUrl('https://discord.com/api/webhooks/123456789012345678/secret-token'),
  'https://discord.com/api/webhooks/123456789012345678/secret-token?wait=true',
);
assert.throws(() => normalizeDiscordWebhookUrl('https://evil.example/api/webhooks/123/token'), /invalid Discord webhook URL/);

  console.log('release announcement core: ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

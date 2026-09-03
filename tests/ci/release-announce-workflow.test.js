const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const releaseAnnounceWorkflow = fs.readFileSync(path.join(root, '.github/workflows/release-announce.yml'), 'utf8');
const discussionWorkflow = fs.readFileSync(path.join(root, '.github/workflows/discussion-announce.yml'), 'utf8');
const releaseWorkflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');

assert.match(discussionWorkflow, /discussion:\s*\n\s*types:\s*\[created\]/);
assert.match(discussionWorkflow, /category\.name\s*==\s*'Announcements'/);
assert.match(discussionWorkflow, /concurrency:/);
assert.match(discussionWorkflow, /group:\s*ecc-discord-announcement-delivery/);
assert.doesNotMatch(discussionWorkflow, /pull_request_target|workflow_run/);
assert.match(discussionWorkflow, /persist-credentials:\s*false/);
assert.match(discussionWorkflow, /ANNOUNCEMENT_KIND:.*'manual'.*'discussion'/);
assert.match(discussionWorkflow, /workflow_dispatch:/);
assert.match(discussionWorkflow, /discussion_number:/);
assert.match(discussionWorkflow, /DISCORD_ANNOUNCE_WEBHOOK_URL:\s*\$\{\{ secrets\.DISCORD_ANNOUNCE_WEBHOOK_URL \}\}/);
assert.match(discussionWorkflow, /GITHUB_TOKEN/);
assert.match(discussionWorkflow, /discussions:\s*write/);
assert.doesNotMatch(discussionWorkflow, /DISCORD_BOT_TOKEN|DISCORD_ANNOUNCE_CHANNEL_ID/);
assert.match(releaseAnnounceWorkflow, /workflow_run:/);
assert.match(releaseAnnounceWorkflow, /workflows:\s*\[Release\]/);
assert.match(releaseAnnounceWorkflow, /conclusion\s*==\s*'success'/);
assert.match(releaseAnnounceWorkflow, /ref:\s*\$\{\{ github\.event\.repository\.default_branch \}\}/);
assert.match(releaseAnnounceWorkflow, /ANNOUNCEMENT_KIND:\s*release/);
assert.match(releaseAnnounceWorkflow, /discussions:\s*write/);
assert.match(releaseAnnounceWorkflow, /group:\s*ecc-discord-announcement-delivery/);
assert.doesNotMatch(releaseAnnounceWorkflow, /DISCORD_BOT_TOKEN|DISCORD_ANNOUNCE_CHANNEL_ID/);
assert.doesNotMatch(releaseWorkflow, /DISCORD_BOT_TOKEN|ANNOUNCEMENT_KIND/);

console.log('release announcement workflow contract: ok');

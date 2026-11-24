# Daily Cartoon Pipeline: Setup and Approvals

This repository contains a safe-by-default example pipeline. It creates a short, silent, template-driven cartoon with original geometric characters, saves landscape and vertical MP4 files, and prepares private YouTube and Dailymotion uploads. It is not a finished production studio: it has no narration, third-party generative media service, interactive review UI, or TikTok consent experience.

The implementation adds safeguards; it does not establish COPPA compliance, guarantee platform approval, or guarantee that YouTube will include a video in YouTube Kids. Obtain legal and platform-specific review before using the workflow with a real channel or making content public.

## Local setup and tests

Use Python 3.11 or newer, `ffmpeg`, and the pinned dependencies:

```bash
python3 -m pip install -r requirements.txt
python3 -m pip install pytest
PYTHONPATH=src python3 -m cartoon_pipeline generate --output build/cartoon
PYTHONPATH=src python3 -m pytest tests/cartoon_pipeline -q
```

Generation writes `episode.json`, `landscape.mp4` (16:9), and `vertical.mp4` (9:16). The story generator selects from fixed original storyboards; the renderer draws silent scenes locally. Generated assets are intended for adult review before any release.

## Required GitHub setup

1. Create a GitHub Environment named `cartoon-production`, configure required reviewers, and restrict deployments to the protected `main` branch. Environment reviewers must inspect the generated artifact in the workflow run before approving the publish job. A workflow file cannot configure or enforce the repository's reviewer list.
2. Provision a dedicated, isolated Linux self-hosted runner with the `cartoon-pipeline` label. Install Python 3.11, the exact `requirements.txt` dependencies, and `ffmpeg`; provision durable storage at the path configured by `CARTOON_LEDGER_PATH`. Do not run pull-request code or unrelated workloads on this credential-bearing runner. GitHub-hosted runners are ephemeral and cannot safely provide the cross-run idempotency ledger.
3. Configure these GitHub Environment secrets only after each provider has approved the application and channel:
   - `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`
   - `DAILYMOTION_CLIENT_ID` (private API key), `DAILYMOTION_CLIENT_SECRET` (private API secret), `DAILYMOTION_PROFILE_ID`
4. Issue OAuth grants with only the upload/management scopes listed in `config/platforms.yaml`. Keep secrets out of YAML, logs, artifacts, and the repository. The workflow token has `contents: read` only, and the publish job does not receive provider credentials until its Environment approval is granted.
5. Test using private visibility first. YouTube and Dailymotion are private by default. Change their visibility only after channel settings, rights, policy flags, API access, legal review, and human review have all been confirmed. YouTube's `selfDeclaredMadeForKids` upload flag is required here but does not guarantee YouTube Kids placement.
6. The daily workflow generates assets at 14:00 UTC. Scheduled publishing waits at the protected Environment. A manual run generates assets only unless the operator requests publishing; publishing is still gated. Keep `cancel-in-progress` disabled to avoid interrupting a publish attempt.

The SQLite ledger reserves an episode/platform pair before a provider call. If a runner or network fails after an upload may have started, the entry remains unresolved and the pipeline refuses to retry it. Reconcile the provider's channel state and ledger entry under operator control before retrying; do not clear or reset the ledger automatically.

## Platform limitations and child-safety controls

- **YouTube:** the publisher uses `videos.insert` resumable upload and sets `selfDeclaredMadeForKids=true`. YouTube API project quota and channel authorization still apply. The label is a declaration, not a legal determination or an assurance of YouTube Kids availability.
- **Dailymotion:** the publisher uses API v2 client-credentials authentication with the `video.manage` scope, uploads through an API v2 upload session, sets `is_for_kids=true`, uses the `kids` category, and defaults visibility to private. Partner-channel eligibility and API access must be approved by Dailymotion.
- **TikTok:** a vertical cutdown is generated, but direct posting is disabled in `config/platforms.yaml` and the workflow does not provide TikTok credentials. TikTok requires an approved app and `video.publish` authorization; its direct-post flow also requires creator-info UX and explicit, per-post creator consent. A GitHub Environment approval is not a substitute for that consent flow. The adapter requires a recent `TikTokConsent` object, but this repository does not implement the interactive UX that would create one. TikTok's minimum user age is 13; policy blocks distribution when the episode audience includes under-13s. Do not enable direct posting until the app, UX, audience, and applicable platform rules have been reviewed.
- The policy rejects episodes outside the under-16 age range, episodes not declared made-for-kids, unreviewed content, uncleared rights, and metadata containing URLs, email addresses, or phone-number patterns. These checks are deliberately conservative but cannot reliably classify all unsafe content. An adult must review the actual video, not just its manifest.
- The pipeline does not collect child accounts, comments, names, faces, voices, contact details, or other audience data. Do not add such collection without a separate privacy/legal review.
- OAuth refresh-token rotation is not silently persisted. If a provider rotates a refresh token, publishing stops and the operator must update the configured secret through the approved secret-management process.

## AgentShield and verification

`.github/workflows/ci-agentshield.yml` runs the pinned AgentShield GitHub Action for supported agent configuration, zizmor against GitHub Actions workflows, and Bandit against the Python pipeline sources, then runs the mocked provider and safety tests. These scanners are complementary layers, not a guarantee of security. All provider API tests use mocked HTTP transports and make no live requests.

Official provider references:

- [YouTube video uploads](https://developers.google.com/youtube/data/guides/uploading_a_video)
- [Dailymotion API v2 video upload](https://developers.dailymotion.com/docs/upload-videos)
- [TikTok Content Posting API: Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- [TikTok Content Posting API: Media Transfer](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide)

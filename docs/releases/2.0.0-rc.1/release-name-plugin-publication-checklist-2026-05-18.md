# ECC v2.0.0-rc.1 Release Name And Plugin Publication Checklist

Snapshot date: 2026-05-18. Canonical repo decision refreshed 2026-05-19
after the public repo rename to `affaan-m/ECC`.

This checklist is the operator gate for release naming, package publication,
and Claude/Codex plugin distribution. It is not a publication action by itself.
Run it from the exact release commit before creating tags, publishing npm,
submitting marketplace forms, or posting announcements.

## Fixed rc.1 Decision

Ship `v2.0.0-rc.1` as **ECC**.

- Keep the GitHub repo at `affaan-m/ECC`.
- Keep the npm package as `ecc-universal`.
- Keep Claude and Codex plugin slugs as `ecc`.
- Publish the npm prerelease on the `next` dist-tag, not `latest`.
- Do not rename the npm package to `ecc` or `@affaan-m/ecc` before rc.1.
- Treat `affaan-m/ECC` as the canonical public repo for rc.1 and GA release
  copy.

Reasons:

- `ecc-universal` is the current working install and package surface.
- `ecc` on npm is occupied by an unrelated elliptic-curve package.
- `@affaan-m/ecc` is unclaimed on npm, but would require a migration plan.
- `affaan-m/ECC` is now the live public GitHub repo.
- Claude and Codex already expose the desired short namespace as `ecc`.

## Current Surface Evidence

| Surface | Current value | Evidence command | 2026-05-18 result | Release action |
| --- | --- | --- | --- | --- |
| Git commit | `67e63e63f9bfd074bd6a21bf6bac71f3dfefa58b` | `git rev-parse HEAD` | Recorded from clean `main` before this ITO-46 evidence refresh | Re-run from final release commit |
| GitHub repo | `affaan-m/ECC` | `git remote get-url origin` | `https://github.com/affaan-m/ECC.git` | Keep for rc.1 and GA |
| npm package | `ecc-universal@2.0.0-rc.1` local, `1.10.0` registry latest | `node -p "require('./package.json').name + '@' + require('./package.json').version"` and `npm view ecc-universal name version dist-tags --json` | Local rc.1 ready; registry still latest `1.10.0` | Publish rc.1 with `--tag next` after approval |
| Exact npm short name | `ecc` | `npm view ecc name version description repository.url --json` | Occupied by unrelated `ecc@0.0.2` | Do not use |
| Scoped npm short name | `@affaan-m/ecc` | `npm view @affaan-m/ecc name version --json` | 404 | Candidate only after migration plan |
| Claude plugin | `ecc@2.0.0-rc.1` | `claude plugin validate .claude-plugin/plugin.json`; `claude plugin validate .`; `claude plugin tag .claude-plugin --dry-run` | Validation passed on Claude Code `2.1.143`; full plugin validation has one expected root `CLAUDE.md` context warning; dry run would create `ecc--v2.0.0-rc.1` | Run dry-run tag again from the final commit, then tag/push only after approval |
| Claude marketplace | `.claude-plugin/marketplace.json` | `claude plugin marketplace add --help`; Anthropic plugin marketplace docs | GitHub repo, git URL, remote marketplace JSON, and local path marketplace sources are supported | Verify post-tag marketplace install/update path after final evidence |
| Codex plugin | `ecc@2.0.0-rc.1` | `node tests/plugin-manifest.test.js`; `codex plugin marketplace add --help`; OpenAI Codex plugin docs | Plugin manifest passed 54/54; local and GitHub-ref repo marketplace smokes passed on Codex CLI `0.131.0` | Use repo marketplace for rc.1; do not claim official directory listing until OpenAI publishing path is available |
| OpenCode package | `ecc-universal@2.0.0-rc.1` | `node -p "require('./.opencode/package.json').name + '@' + require('./.opencode/package.json').version"` | Matches rc.1 package identity | Follow npm package publication |
| Billing claim | Pending ECC Tools readiness | ECC Tools billing gate and Marketplace account readback | Code-side gate exists; live Marketplace account readback still pending | Do not announce native payments |

## Required Gate

Run these checks from the final release commit and paste the exact output into
a fresh `publication-evidence-YYYY-MM-DD.md` file before release actions:

```bash
git status --short --branch
git rev-parse HEAD
git remote get-url origin
npm view ecc name version description repository.url --json
npm view @affaan-m/ecc name version --json
npm view ecc-universal name version dist-tags --json
node tests/plugin-manifest.test.js
node tests/docs/ecc2-release-surface.test.js
claude plugin validate .claude-plugin/plugin.json
claude plugin tag .claude-plugin --dry-run
codex plugin marketplace add --help
HOME="$(mktemp -d)" codex plugin marketplace add ./
HOME="$(mktemp -d)" codex plugin marketplace add affaan-m/ECC --ref "$(git rev-parse HEAD)"
npm pack --dry-run --json
npm publish --tag next --dry-run
npm run build:opencode
npm run preview-pack:smoke
```

If a command is unavailable on the release machine, record the exact error and
keep the related publication action blocked.

## Publication Order

| Step | Action | Required evidence | Stop condition |
| --- | --- | --- | --- |
| 1 | Freeze name and version | Package, Claude plugin, Codex plugin, OpenCode package, `VERSION`, and release docs all say `2.0.0-rc.1` | Any `preview`/`rc.1` mismatch |
| 2 | Verify clean release branch | `git status --short --branch` shows only the intended release commit and no unrelated drift | Any unexplained dirty file |
| 3 | Verify package and plugin manifests | `node tests/plugin-manifest.test.js` and `node tests/docs/ecc2-release-surface.test.js` pass | Manifest or release-surface failure |
| 4 | Dry-run package surface | `npm pack --dry-run --json`; `npm publish --tag next --dry-run` | Missing files, wrong dist-tag, or publish dry-run failure |
| 5 | Dry-run Claude distribution | `claude plugin validate`; `claude plugin tag .claude-plugin --dry-run`; marketplace source/help evidence | Validation, tag, or install-smoke failure |
| 6 | Verify Codex repo marketplace | `codex plugin marketplace add --help`; temp-home local and GitHub-ref repo marketplace add smoke; OpenAI official directory status recorded | Missing repo marketplace or unverified official-directory status |
| 7 | Verify OpenCode package | `npm run build:opencode` | Build failure |
| 8 | Regenerate release URL ledger | Live and approval-gated URLs separated in `release-url-ledger-YYYY-MM-DD.md` | Placeholder, private URL, or announcement URL drift |
| 9 | Create GitHub prerelease | `gh release view v2.0.0-rc.1 --json tagName,url,isPrerelease` | Missing URL or wrong prerelease flag |
| 10 | Publish npm rc | `npm view ecc-universal version dist-tags --json` shows rc.1 on `next` | rc.1 lands on `latest` or registry output is unclear |
| 11 | Publish/plugin-submit | Claude official submission and Codex repo marketplace evidence recorded | Form not submitted, listing not visible, or docs status changed |
| 12 | Announce | X, LinkedIn, GitHub release, and longform copy use final live URLs | Any final URL is still pending |

## Do Not Proceed

- Do not publish npm before `npm pack --dry-run --json` is captured from the
  final release commit.
- Do not create or push Claude plugin tags before `claude plugin tag
  .claude-plugin --dry-run` passes from the final release commit.
- Do not claim an official Codex Plugin Directory listing unless OpenAI
  documents a public submission path or confirms the plugin has been listed.
- Do not announce billing, Marketplace, or native payments until ECC Tools live
  Marketplace account readback returns ready.
- Do not rename the npm package until rc.1 is published and a migration guide
  maps old install names to new names.
- Do not post social copy while any release, npm, plugin, or billing URL is
  still approval-gated.

## External Distribution Sources

- Anthropic Claude Code plugin docs: `https://code.claude.com/docs/en/plugins`
- Anthropic Claude Code marketplace docs:
  `https://code.claude.com/docs/en/plugin-marketplaces`
- OpenAI Codex plugin docs:
  `https://developers.openai.com/codex/plugins/build#add-a-marketplace-from-the-cli`

As of this snapshot, Anthropic documents self-hosted marketplace distribution
through GitHub, git URL, remote marketplace JSON, and local path sources.
OpenAI documents repo/personal marketplace distribution for Codex and describes
an official Plugin Directory, but ECC has not submitted or received an official
directory listing in this pass.

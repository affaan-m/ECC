# Discovery artifacts

ECC documents 448 surfaces and publishes 12 URLs. This page defines the
generated inputs that close that gap, and the page contract the website should
build from them.

## What is generated

| File | Purpose |
| ---- | ------- |
| [`docs/DISCOVERY-INDEX.json`](../DISCOVERY-INDEX.json) | Every skill, agent, and command with the URL it should live at |
| [`llms.txt`](../../llms.txt) | Short agent-readable overview, [llmstxt.org](https://llmstxt.org) shape |
| [`docs/discovery/llms-full.txt`](../discovery/llms-full.txt) | Every surface, one line each |
| [`docs/discovery/sitemap-discovery.xml`](../discovery/sitemap-discovery.xml) | Sitemap fragment to merge into the published sitemap |

Regenerate after adding or renaming any skill, agent, or command:

```bash
npm run discovery:write
```

CI runs `npm run discovery:check` and fails if the committed artifacts drift
from the tree, so the catalog cannot silently rot.

## Index shape

```json
{
  "origin": "https://ecc.tools",
  "counts": { "skill": 286, "agent": 68, "command": 94 },
  "total": 448,
  "entries": [
    {
      "type": "skill",
      "name": "tdd-workflow",
      "slug": "tdd-workflow",
      "summary": "Use this skill when writing new features...",
      "model": null,
      "tools": null,
      "source": "skills/tdd-workflow/SKILL.md",
      "sourceUrl": "https://github.com/affaan-m/ECC/blob/main/skills/tdd-workflow/SKILL.md",
      "url": "https://ecc.tools/skills/tdd-workflow"
    }
  ]
}
```

`summary` is capped at 300 characters so it drops into a meta description
without truncation. `url` is the contract: build the page there, do not invent a
different path.

## Page contract

One page per entry. The point is that a person searching for the problem, not
for ECC, can land on it.

Required:

- `<title>`: `<name> - ECC <type>`, for example `tdd-workflow - ECC skill`.
- `<meta name="description">`: the entry `summary`, verbatim.
- `<link rel="canonical">`: the entry `url`.
- `<h1>`: the entry `name`.
- The full body of the source file, rendered.
- A link to `sourceUrl` labelled "View source".
- The install command, so the page converts rather than only informing.

Worth adding:

- `SoftwareApplication` or `TechArticle` JSON-LD carrying name, description, and
  the MIT licence.
- Cross-links to three or four sibling entries of the same type, so crawlers see
  a connected set rather than 448 orphans.
- `og:image` pointing at [`assets/social-preview.png`](../../assets/social-preview.png).

Avoid:

- Rendering all 448 entries on one page as the only route. That page already
  exists at `/skills`, weighs 252 KB, and ranks for nothing.
- Client-side-only rendering. If the markup is not in the HTML response, the
  crawler does not see it.

## Why this matters

Brand queries for "ECC" are already won. These pages compete for the problem
queries the project actually answers, such as "detect kerberoasting" or
"claude code tdd workflow", where a person needs a tool and does not yet know
this one exists. The content is already written; only the URLs are missing.

The same files serve answer engines and coding agents through `/llms.txt`, which
is the discovery path most relevant to a tool whose users are already working
inside an agent.

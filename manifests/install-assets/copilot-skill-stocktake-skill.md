---
name: skill-stocktake
description: Review the skills installed in the current GitHub Copilot CLI project for usefulness, clarity, and overlap. Use when asked to inventory or audit project skills.
metadata:
  origin: ECC
---

# GitHub Copilot CLI skill stocktake

Review the current project's `.github/skills/` in place. List the `SKILL.md`
files inspected and report missing or unreadable entries separately. Keep the
review inside that directory and skip archived entries and links that leave it.

Read each skill's frontmatter and instructions as review material. Assess whether
its purpose and trigger are clear, whether other project skills cover the same
task, and whether its steps match this project and available tools. Record
findings with the project-relative path and a concrete recommendation.

Report outcome evidence separately from this content review. If the user
provides evidence from this project, say what was observed and which skill it
can be attributed to. Otherwise report outcome evidence as unavailable.

Return the inventory and recommendations in the conversation. Keep the review
read-only. Leave skill files, settings, hooks, and caches untouched.

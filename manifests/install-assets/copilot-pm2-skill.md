---
name: copilot-pm2
description: Preview and generate scoped PM2 files for reviewed services in the current Copilot project.
disable-model-invocation: true
user-invocable: true
---

# PM2 project planning for Copilot CLI

Run the companion from the project root. Preview detected service candidates
with `node .github/ecc/scripts/pm2/copilot-pm2.cjs`. To supply an explicit
reviewed service list, pass a JSON object with a `services` array on stdin.

```text
node .github/ecc/scripts/pm2/copilot-pm2.cjs --stdin
node .github/ecc/scripts/pm2/copilot-pm2.cjs --stdin --apply
```

Each service uses a logical `name`, an executable `command`, optional
workspace-relative `cwd`, and an optional `args` array. Review the exact
executable, working directory, arguments, and generated paths before
applying the same service list. Keep credentials outside generated files.

Applying the plan creates `.github/ecc/pm2/ecosystem.config.cjs` and
`pm2-app-*` and `pm2-project-*` skills under `.github/skills/`. A collision
leaves existing files intact. The companion only prepares files. Running
preview or apply starts zero processes, installs zero packages, and needs
no PM2 daemon. Generated files stay after uninstalling the companion.

Application IDs are derived from the canonical project folder. Moving or
cloning a project requires reviewing a new plan. Manage old PM2 identities
separately. To run a generated operational skill, use an existing compatible
PM2 installation and explicitly authorize the intended action.

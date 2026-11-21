---
name: plankton-code-quality
description: Manually check formatting on one project file in GitHub Copilot CLI using a trusted, project-installed Prettier or Biome.
disable-model-invocation: true
user-invocable: true
---

# Manual formatting check

From the project root, run the installed launcher with a project-relative file:

```sh
node .github/ecc/scripts/quality/copilot-quality.cjs --file "src/example.ts"
```

Check JavaScript, JSX, TypeScript, TSX, JSON, or Markdown one file at a time. Markdown uses Prettier. For the other formats the launcher prefers Biome if it finds a Biome config, then Prettier as the default, with Biome as a fallback if Prettier is absent and unconfigured. Install the desired formatter into the project's local dependencies before running the launcher. It recognizes direct packages in node_modules and pnpm's standard project-local node_modules/.pnpm layout. The launcher executes that trusted local package and requires no tool installation or downloads at run time.

The JSON result identifies the formatter and reports coverage as formatter defaults. If the launcher detects configuration for that formatter, including ordinary config files in the project or an applicable Prettier setting in package.json, it stops with project-config-present. Run the repository's own formatter to apply those settings. Add --defaults to explicitly bypass the detected settings when a built-in defaults check is useful.

The launcher treats any applicable `package.yaml` as potential configuration when Prettier is selected and requires `--defaults` to run it. The manifest alone still allows the Biome fallback for supported formats when Prettier is absent. The fallback uses Biome's defaults and does not apply Prettier settings from `package.yaml`.

A check leaves the file alone. Add --fix only when you want to replace it with successful formatter output. The result reports fixed: true only after it writes different bytes. Exit 0 means the file matched or was fixed, exit 1 indicates a formatting difference or formatter failure, and exit 2 means that the launcher could not perform the check. Read the JSON reason for a nonzero exit.

Save and finish editing the file before running --fix. The launcher checks that the file and its parent directories still match before publishing the replacement. A save that lands between the final check and the rename can still be overwritten. If a directory moves during staging, a temporary `.ecc-quality-*` file may remain in the original directory.

Run the repository's lint, typecheck, and test commands separately. This launcher runs on explicit request and does not register hooks.

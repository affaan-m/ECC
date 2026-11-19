---
name: continuous-learning-v2
description: Review, import, and manage project-scoped ECC instincts in GitHub Copilot CLI.
---

# Continuous Learning for Copilot CLI

Run the installed launcher from the project root with Python 3.9 or later.
Use the verified Python executable for the current platform, such as
`python3` on Linux or `py -3` on Windows.

```text
python3 .github/ecc/scripts/copilot-learning.py status
python3 .github/ecc/scripts/copilot-learning.py projects
python3 .github/ecc/scripts/copilot-learning.py export --scope project
python3 .github/ecc/scripts/copilot-learning.py import reviewed-instincts.yaml
python3 .github/ecc/scripts/copilot-learning.py evolve --generate
python3 .github/ecc/scripts/copilot-learning.py promote INSTINCT_ID
python3 .github/ecc/scripts/copilot-learning.py prune --max-age 30
```

Check the process exit status and the JSON `ok` field. If a helper or Python
is unavailable, report the workflow as unavailable. The launcher uses the
canonical instinct backend and the Copilot store in
`$COPILOT_HOME/ecc/homunculus` (default `~/.copilot/ecc/homunculus`).
Global scope refers to this store. This workflow runs only on explicit
invocation and uses reviewed instincts as its input.

Imports, evolution, promotion, pruning, and project mutations preview by
default. Mutation previews use a private disposable copy of existing learning
data and leave the live store untouched. Use `--apply` only for the authorized
operation and scope. Review candidate evidence against the repository before
separately authorizing a skill or policy change. Transfer files use workspace-relative paths.
Exports with `--output` create new files.

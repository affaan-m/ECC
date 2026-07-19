# Troubleshooting Guide

Common issues and solutions for Everything Claude Code (ECC) plugin.

## Table of Contents

- [Memory & Context Issues](#memory--context-issues)
- [Agent Harness Failures](#agent-harness-failures)
- [Hook & Workflow Errors](#hook--workflow-errors)
- [Installation & Setup](#installation--setup)
- [Performance Issues](#performance-issues)
- [Common Error Messages](#common-error-messages)
- [Getting Help](#getting-help)

---

## Memory & Context Issues

### Context Window Overflow

**Symptom:** "Context too long" errors or incomplete responses

**Causes:**
- Large file uploads exceeding token limits
- Accumulated conversation history
- Multiple large tool outputs in single session

**Solutions:**
```bash
# 1. Clear conversation history and start fresh
# Use Claude Code: "New Chat" or Cmd/Ctrl+Shift+N

# 2. Reduce file size before analysis
head -n 100 large-file.log > sample.log

# 3. Use streaming for large outputs
head -n 50 large-file.txt

# 4. Split tasks into smaller chunks
# Instead of: "Analyze all 50 files"
# Use: "Analyze files in src/components/ directory"
```

### Memory Persistence Failures

**Symptom:** Agent doesn't remember previous context or observations

**Causes:**
- Disabled continuous-learning hooks
- Corrupted observation files
- Project detection failures

**Solutions:**
```bash
# Check if observations are being recorded
ls ~/.claude/homunculus/projects/*/observations.jsonl

# Find the current project's hash id
python3 - <<'PY'
import json, os
registry_path = os.path.expanduser("~/.claude/homunculus/projects.json")
with open(registry_path) as f:
    registry = json.load(f)
for project_id, meta in registry.items():
    if meta.get("root") == os.getcwd():
        print(project_id)
        break
else:
    raise SystemExit("Project hash not found in ~/.claude/homunculus/projects.json")
PY

# View recent observations for that project
tail -20 ~/.claude/homunculus/projects/<project-hash>/observations.jsonl

# Back up a corrupted observations file before recreating it
mv ~/.claude/homunculus/projects/<project-hash>/observations.jsonl \
  ~/.claude/homunculus/projects/<project-hash>/observations.jsonl.bak.$(date +%Y%m%d-%H%M%S)

# Verify hooks are enabled
grep -r "observe" ~/.claude/settings.json
```

---

## Agent Harness Failures

### Agent Not Found

**Symptom:** "Agent not loaded" or "Unknown agent" errors

**Causes:**
- Plugin not installed correctly
- Agent path misconfiguration
- Marketplace vs manual install mismatch

**Solutions:**
```bash
# Check plugin installation
ls ~/.claude/plugins/cache/

# Verify agent exists (marketplace install)
ls ~/.claude/plugins/cache/*/agents/

# For manual install, agents should be in:
ls ~/.claude/agents/  # Custom agents only

# Reload plugin
# Claude Code → Settings → Extensions → Reload
```

### Workflow Execution Hangs

**Symptom:** Agent starts but never completes

**Causes:**
- Infinite loops in agent logic
- Blocked on user input
- Network timeout waiting for API

**Solutions:**
```bash
# 1. Check for stuck processes
ps aux | grep claude

# 2. Enable debug mode
export CLAUDE_DEBUG=1

# 3. Set shorter timeouts
export CLAUDE_TIMEOUT=30

# 4. Check network connectivity
curl -I https://api.anthropic.com
```

### Tool Use Errors

**Symptom:** "Tool execution failed" or permission denied

**Causes:**
- Missing dependencies (npm, python, etc.)
- Insufficient file permissions
- Path not found

**Solutions:**
```bash
# Verify required tools are installed
which node python3 npm git

# Fix permissions on hook scripts
chmod +x ~/.claude/plugins/cache/*/hooks/*.sh
chmod +x ~/.claude/plugins/cache/*/skills/*/hooks/*.sh

# Check PATH includes necessary binaries
echo $PATH
```

---

## Hook & Workflow Errors

### Hooks Not Firing

**Symptom:** Pre/post hooks don't execute

**Causes:**
- Hooks not registered in settings.json
- Invalid hook syntax
- Hook script not executable

**Solutions:**
```bash
# Check hooks are registered
grep -A 10 '"hooks"' ~/.claude/settings.json

# Verify hook files exist and are executable
ls -la ~/.claude/plugins/cache/*/hooks/

# Test hook manually
bash ~/.claude/plugins/cache/*/hooks/pre-bash.sh <<< '{"command":"echo test"}'

# Re-register hooks (if using plugin)
# Disable and re-enable plugin in Claude Code settings
```

### Python/Node Version Mismatches

**Symptom:** "python3 not found" or "node: command not found"

**Causes:**
- Missing Python/Node installation
- PATH not configured
- Wrong Python version (Windows)

**Solutions:**
```bash
# Install Python 3 (if missing)
# macOS: brew install python3
# Ubuntu: sudo apt install python3
# Windows: Download from python.org

# Install Node.js (if missing)
# macOS: brew install node
# Ubuntu: sudo apt install nodejs npm
# Windows: Download from nodejs.org

# Verify installations
python3 --version
node --version
npm --version

# Windows: Ensure python (not python3) works
python --version
```

### Dev Server Blocker False Positives

**Symptom:** Hook blocks legitimate commands mentioning "dev"

**Causes:**
- Heredoc content triggering pattern match
- Non-dev commands with "dev" in arguments

**Solutions:**
```bash
# This is fixed in v1.8.0+ (PR #371)
# Upgrade plugin to latest version

# Workaround: Wrap dev servers in tmux
tmux new-session -d -s dev "npm run dev"
tmux attach -t dev

# Disable hook temporarily if needed
# Edit ~/.claude/settings.json and remove pre-bash hook
```

---

## Installation & Setup

### Plugin Not Loading

**Symptom:** Plugin features unavailable after install

**Causes:**
- Marketplace cache not updated
- Claude Code version incompatibility
- Corrupted plugin files
- Local Claude setup was wiped or reset

**Solutions:**
```bash
# First inspect what ECC still knows about this machine
ecc list-installed
ecc doctor
ecc repair

# Only reinstall if doctor/repair cannot restore the missing files

# Inspect the plugin cache before changing it
ls -la ~/.claude/plugins/cache/

# Back up the plugin cache instead of deleting it in place
mv ~/.claude/plugins/cache ~/.claude/plugins/cache.backup.$(date +%Y%m%d-%H%M%S)
mkdir -p ~/.claude/plugins/cache

# Reinstall from marketplace
# Claude Code → Extensions → Everything Claude Code → Uninstall
# Then reinstall from marketplace

# If the issue is marketplace/account access, use ECC Tools billing/account recovery separately; do not use reinstall as a proxy for account recovery

# Check Claude Code version
claude --version
# Requires Claude Code 2.0+

# Manual install (if marketplace fails)
git clone https://github.com/affaan-m/everything-claude-code.git
cp -r everything-claude-code ~/.claude/plugins/ecc
```

### Package Manager Detection Fails

**Symptom:** Wrong package manager used (npm instead of pnpm)

**Causes:**
- No lock file present
- CLAUDE_PACKAGE_MANAGER not set
- Multiple lock files confusing detection

**Solutions:**
```bash
# Set preferred package manager globally
export CLAUDE_PACKAGE_MANAGER=pnpm
# Add to ~/.bashrc or ~/.zshrc

# Or set per-project
echo '{"packageManager": "pnpm"}' > .claude/package-manager.json

# Or use package.json field
npm pkg set packageManager="pnpm@8.15.0"

# Warning: removing lock files can change installed dependency versions.
# Commit or back up the lock file first, then run a fresh install and re-run CI.
# Only do this when intentionally switching package managers.
rm package-lock.json  # If using pnpm/yarn/bun
```

### OpenCode Fails to Start on Termux/Android

**Symptom:** `opencode` crashes or refuses to launch on Termux with a Bun
`ResolveMessage`, e.g.:

```
ResolveMessage: Cannot find module '../plugins/lib/changed-files-store.js' from '.../.opencode/tools/changed-files.ts'
```

**Causes:**
- The `~/.opencode` install is missing or incomplete for this machine —
  usually `tools/` is present but `plugins/` never finished copying (an
  interrupted install, or a storage/permission hiccup that's more common on
  Android's filesystem). Every custom tool is re-exported from a single
  `tools/index.ts` barrel file, so one tool with a missing dependency can
  fail the whole tools module and block session startup, not just that tool.

**Solutions:**
```bash
# From the ECC repo, check for and repair missing/incomplete managed files
ecc doctor --target opencode
ecc repair --target opencode

# If that reports no drift but plugins/ is still missing on the device,
# re-run the ECC installer for the opencode target
```

**Note:** If you're also seeing `ProviderModelNotFoundError: Model not found: openai/gpt-5.5`
referencing `~/.config/opencode/oh-my-opencode-slim.json`, that file belongs to the
third-party [`oh-my-opencode-slim`](https://github.com/alvinunreal/oh-my-opencode-slim)
plugin, not ECC — ECC never writes to `~/.config/opencode/`. Fix the model prefix
(`opencode/...` instead of `openai/...`) there, or file it against that project.

---

## Performance Issues

### Slow Response Times

**Symptom:** Agent takes 30+ seconds to respond

**Causes:**
- Large observation files
- Too many active hooks
- Network latency to API

**Solutions:**
```bash
# Archive large observations instead of deleting them
archive_dir="$HOME/.claude/homunculus/archive/$(date +%Y%m%d)"
mkdir -p "$archive_dir"
find ~/.claude/homunculus/projects -name "observations.jsonl" -size +10M -exec sh -c '
  for file do
    base=$(basename "$(dirname "$file")")
    gzip -c "$file" > "'"$archive_dir"'/${base}-observations.jsonl.gz"
    : > "$file"
  done
' sh {} +

# Disable unused hooks temporarily
# Edit ~/.claude/settings.json

# Keep active observation files small
# Large archives should live under ~/.claude/homunculus/archive/
```

### High CPU Usage

**Symptom:** Claude Code consuming 100% CPU

**Causes:**
- Infinite observation loops
- File watching on large directories
- Memory leaks in hooks

**Solutions:**
```bash
# Check for runaway processes
top -o cpu | grep claude

# Disable continuous learning temporarily
touch ~/.claude/homunculus/disabled

# Restart Claude Code
# Cmd/Ctrl+Q then reopen

# Check observation file size
du -sh ~/.claude/homunculus/*/
```

---

## Common Error Messages

### "EACCES: permission denied"

```bash
# Fix hook permissions
find ~/.claude/plugins -name "*.sh" -exec chmod +x {} \;

# Fix observation directory permissions
chmod -R u+rwX,go+rX ~/.claude/homunculus
```

### "MODULE_NOT_FOUND"

```bash
# Install plugin dependencies
cd ~/.claude/plugins/cache/ecc
npm install

# Or for manual install
cd ~/.claude/plugins/ecc
npm install
```

### "spawn UNKNOWN"

```bash
# Windows-specific: Ensure scripts use correct line endings
# Convert CRLF to LF
find ~/.claude/plugins -name "*.sh" -exec dos2unix {} \;

# Or install dos2unix
# macOS: brew install dos2unix
# Ubuntu: sudo apt install dos2unix
```

---

## Getting Help

 If you're still experiencing issues:

1. **Check GitHub Issues**: [github.com/affaan-m/everything-claude-code/issues](https://github.com/affaan-m/everything-claude-code/issues)
2. **Enable Debug Logging**:
   ```bash
   export CLAUDE_DEBUG=1
   export CLAUDE_LOG_LEVEL=debug
   ```
3. **Collect Diagnostic Info**:
   ```bash
   claude --version
   node --version
   python3 --version
   echo $CLAUDE_PACKAGE_MANAGER
   ls -la ~/.claude/plugins/cache/
   ```
4. **Open an Issue**: Include debug logs, error messages, and diagnostic info

---

## Related Documentation

- [README.md](./README.md) - Installation and features
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Development guidelines
- [docs/](./docs/) - Detailed documentation
- [examples/](./examples/) - Usage examples
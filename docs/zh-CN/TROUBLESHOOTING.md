# 故障排除指南

ECC 插件的常见问题与解决方案。

## 目录

* [内存与上下文问题](#内存与上下文问题)
* [代理工具故障](#代理工具故障)
* [钩子与工作流错误](#钩子与工作流错误)
* [安装与设置](#安装与设置)
* [性能问题](#性能问题)
* [常见错误信息](#常见错误信息)
* [获取帮助](#获取帮助)

***

## 内存与上下文问题

### 上下文窗口溢出

**症状：** 出现"上下文过长"错误或响应不完整

**原因：**

* 上传的大文件超出令牌限制
* 累积的对话历史记录
* 单次会话中包含多个大型工具输出

**解决方案：**

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

### 内存持久化失败

**症状：** 代理不记得先前的上下文或观察结果

**原因：**

* 连续学习钩子被禁用
* 观察文件损坏
* 项目检测失败

**解决方案：**

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

***

## 代理工具故障

### 未找到代理

**症状：** 出现"代理未加载"或"未知代理"错误

**原因：**

* 插件未正确安装
* 代理路径配置错误
* 市场安装与手动安装不匹配

**解决方案：**

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

### 工作流执行挂起

**症状：** 代理启动但从未完成

**原因：**

* 代理逻辑中存在无限循环
* 等待用户输入时被阻塞
* 等待 API 响应时网络超时

**解决方案：**

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

### 工具使用错误

**症状：** 出现"工具执行失败"或权限被拒绝

**原因：**

* 缺少依赖项（npm、python 等）
* 文件权限不足
* 路径未找到

**解决方案：**

```bash
# Verify required tools are installed
which node python3 npm git

# Fix permissions on hook scripts
chmod +x ~/.claude/plugins/cache/*/hooks/*.sh
chmod +x ~/.claude/plugins/cache/*/skills/*/hooks/*.sh

# Check PATH includes necessary binaries
echo $PATH
```

***

## 钩子与工作流错误

### 钩子未触发

**症状：** 前置/后置钩子未执行

**原因：**

* 钩子未在 settings.json 中注册
* 钩子语法无效
* 钩子脚本不可执行

**解决方案：**

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

### Python/Node 版本不匹配

**症状：** 出现"未找到 python3"或"node: 命令未找到"

**原因：**

* 缺少 Python/Node 安装
* PATH 未配置
* Python 版本错误（Windows）

**解决方案：**

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

### 开发服务器拦截器误报

**症状：** 钩子拦截了提及"dev"的合法命令

**原因：**

* Heredoc 内容触发模式匹配
* 参数中包含"dev"的非开发命令

**解决方案：**

```bash
# This is fixed in v1.8.0+ (PR #371)
# Upgrade plugin to latest version

# Workaround: Wrap dev servers in tmux
tmux new-session -d -s dev "npm run dev"
tmux attach -t dev

# Disable hook temporarily if needed
# Edit ~/.claude/settings.json and remove pre-bash hook
```

***

## 安装与设置

### 插件未加载

**症状：** 安装后插件功能不可用

**原因：**

* 市场缓存未更新
* Claude Code 版本不兼容
* 插件文件损坏

**解决方案：**

```bash
# Inspect the plugin cache before changing it
ls -la ~/.claude/plugins/cache/

# Back up the plugin cache instead of deleting it in place
mv ~/.claude/plugins/cache ~/.claude/plugins/cache.backup.$(date +%Y%m%d-%H%M%S)
mkdir -p ~/.claude/plugins/cache

# Reinstall from marketplace
# Claude Code → Extensions → ECC → Uninstall
# Then reinstall from marketplace

# Check Claude Code version
claude --version
# Requires Claude Code 2.0+

# Manual install (if marketplace fails)
git clone https://github.com/affaan-m/ECC.git
cp -r ECC ~/.claude/plugins/ecc
```

### 包管理器检测失败

**症状：** 使用了错误的包管理器（用 npm 而不是 pnpm）

**原因：**

* 没有 lock 文件
* 未设置 CLAUDE\_PACKAGE\_MANAGER
* 多个 lock 文件导致检测混乱

**解决方案：**

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

***

## 性能问题

### 响应时间缓慢

**症状：** 代理需要 30 秒以上才能响应

**原因：**

* 大型观察文件
* 活动钩子过多
* 到 API 的网络延迟

**解决方案：**

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

### CPU 使用率高

**症状：** Claude Code 占用 100% CPU

**原因：**

* 无限观察循环
* 对大型目录的文件监视
* 钩子中的内存泄漏

**解决方案：**

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

***

## 常见错误信息

### "EACCES: permission denied"

```bash
# Fix hook permissions
find ~/.claude/plugins -name "*.sh" -exec chmod +x {} \;

# Fix observation directory permissions
chmod -R u+rwX,go+rX ~/.claude/homunculus
```

### "MODULE\_NOT\_FOUND"

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

***

## 获取帮助

如果您仍然遇到问题：

1. **检查 GitHub Issues**：[github.com/affaan-m/ECC/issues](https://github.com/affaan-m/ECC/issues)
2. **启用调试日志记录**：
   ```bash
   export CLAUDE_DEBUG=1
   export CLAUDE_LOG_LEVEL=debug
   ```
3. **收集诊断信息**：
   ```bash
   claude --version
   node --version
   python3 --version
   echo $CLAUDE_PACKAGE_MANAGER
   ls -la ~/.claude/plugins/cache/
   ```
4. **提交 Issue**：包括调试日志、错误信息和诊断信息

***

## 相关文档

* [README.md](README.md) - 安装与功能
* [CONTRIBUTING.md](CONTRIBUTING.md) - 开发指南
* [docs/](..) - 详细文档
* [examples/](../../examples) - 使用示例

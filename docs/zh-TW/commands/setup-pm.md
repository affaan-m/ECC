---
description: Configure your preferred package manager (npm/pnpm/yarn/bun)
disable-model-invocation: true
---

# 套件管理器設定

為此專案或全域設定您偏好的套件管理器。

## 使用方式

```bash
# 偵測目前的套件管理器
node scripts/setup-package-manager.js --detect

# 設定全域偏好
node scripts/setup-package-manager.js --global pnpm

# 設定專案偏好
node scripts/setup-package-manager.js --project bun

# 列出可用的套件管理器
node scripts/setup-package-manager.js --list
```

## 偵測優先順序

決定使用哪個套件管理器時，按以下順序檢查：

1. **環境變數**：`CLAUDE_PACKAGE_MANAGER`
2. **專案設定**：`.claude/package-manager.json`
3. **package.json**：`packageManager` 欄位
4. **Lock 檔案**：是否存在 package-lock.json、yarn.lock、pnpm-lock.yaml 或 bun.lockb
5. **全域設定**：`~/.claude/package-manager.json`
6. **備援**：第一個可用的套件管理器（pnpm > bun > yarn > npm）

## 設定檔

### 全域設定
```json
// ~/.claude/package-manager.json
{
  "packageManager": "pnpm"
}
```

### 專案設定
```json
// .claude/package-manager.json
{
  "packageManager": "bun"
}
```

### package.json
```json
{
  "packageManager": "pnpm@8.6.0"
}
```

## 環境變數

設定 `CLAUDE_PACKAGE_MANAGER` 以覆蓋所有其他偵測方法：

```bash
# Windows (PowerShell)
$env:CLAUDE_PACKAGE_MANAGER = "pnpm"

# macOS/Linux
export CLAUDE_PACKAGE_MANAGER=pnpm
```

## 執行偵測

要查看目前套件管理器偵測結果，執行：

```bash
node scripts/setup-package-manager.js --detect
```

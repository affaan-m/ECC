# Sessionsコマンド

Claude Codeセッション履歴を管理 - `~/.claude/session-data/` に保存されたセッションのリスト表示、読み込み、エイリアス設定、編集を行います。旧 `~/.claude/sessions/` のファイルも後方互換のために読み取ります。

## 使用方法

`/sessions [list|load|alias|info|help] [オプション]`

## アクション

### セッションのリスト表示

メタデータ、フィルタリング、ページネーション付きですべてのセッションを表示します。

```bash
/sessions                              # すべてのセッションをリスト表示（デフォルト）
/sessions list                         # 上記と同じ
/sessions list --limit 10              # 10件のセッションを表示
/sessions list --date 2026-02-01       # 日付でフィルタリング
/sessions list --search abc            # セッションIDで検索
```

**スクリプト:**
```bash
node -e "
const sm = require('./scripts/lib/session-manager');
const aa = require('./scripts/lib/session-aliases');

const result = sm.getAllSessions({ limit: 20 });
const aliases = aa.listAliases();
const aliasMap = {};
for (const a of aliases) aliasMap[a.sessionPath] = a.name;

console.log('Sessions (showing ' + result.sessions.length + ' of ' + result.total + '):');
console.log('');
console.log('ID        Date        Time     Size     Lines  Alias');
console.log('────────────────────────────────────────────────────');

for (const s of result.sessions) {
  const alias = aliasMap[s.filename] || '';
  const size = sm.getSessionSize(s.sessionPath);
  const stats = sm.getSessionStats(s.sessionPath);
  const id = s.shortId === 'no-id' ? '(none)' : s.shortId.slice(0, 8);
  const time = s.modifiedTime.toTimeString().slice(0, 5);

  console.log(id.padEnd(8) + ' ' + s.date + '  ' + time + '   ' + size.padEnd(7) + '  ' + String(stats.lineCount).padEnd(5) + '  ' + alias);
}
"
```

### セッションの読み込み

セッションの内容を読み込んで表示します（IDまたはエイリアスで指定）。

```bash
/sessions load <id|alias>             # セッションを読み込む
/sessions load 2026-02-01             # 日付で指定（IDなしセッションの場合）
/sessions load a1b2c3d4               # 短縮IDで指定
/sessions load my-alias               # エイリアス名で指定
```

**スクリプト:**
```bash
node -e "
const sm = require('./scripts/lib/session-manager');
const aa = require('./scripts/lib/session-aliases');
const id = process.argv[1];

// First try to resolve as alias
const resolved = aa.resolveAlias(id);
const sessionId = resolved ? resolved.sessionPath : id;

const session = sm.getSessionById(sessionId, true);
if (!session) {
  console.log('Session not found: ' + id);
  process.exit(1);
}

const stats = sm.getSessionStats(session.sessionPath);
const size = sm.getSessionSize(session.sessionPath);
const aliases = aa.getAliasesForSession(session.filename);

console.log('Session: ' + session.filename);
console.log('Path: ' + session.sessionPath);
console.log('');
console.log('Statistics:');
console.log('  Lines: ' + stats.lineCount);
console.log('  Total items: ' + stats.totalItems);
console.log('  Completed: ' + stats.completedItems);
console.log('  In progress: ' + stats.inProgressItems);
console.log('  Size: ' + size);
console.log('');

if (aliases.length > 0) {
  console.log('Aliases: ' + aliases.map(a => a.name).join(', '));
  console.log('');
}

if (session.metadata.title) {
  console.log('Title: ' + session.metadata.title);
  console.log('');
}

if (session.metadata.started) {
  console.log('Started: ' + session.metadata.started);
}

if (session.metadata.lastUpdated) {
  console.log('Last Updated: ' + session.metadata.lastUpdated);
}
" "$ARGUMENTS"
```

### エイリアスの作成

セッションに覚えやすいエイリアスを作成します。

```bash
/sessions alias <id> <name>           # エイリアスを作成
/sessions alias 2026-02-01 today-work # "today-work"という名前のエイリアスを作成
```

**スクリプト:**
```bash
node -e "
const sm = require('./scripts/lib/session-manager');
const aa = require('./scripts/lib/session-aliases');

const sessionId = process.argv[1];
const aliasName = process.argv[2];

if (!sessionId || !aliasName) {
  console.log('Usage: /sessions alias <id> <name>');
  process.exit(1);
}

// Get session filename
const session = sm.getSessionById(sessionId);
if (!session) {
  console.log('Session not found: ' + sessionId);
  process.exit(1);
}

const result = aa.setAlias(aliasName, session.filename);
if (result.success) {
  console.log('✓ Alias created: ' + aliasName + ' → ' + session.filename);
} else {
  console.log('✗ Error: ' + result.error);
  process.exit(1);
}
" "$ARGUMENTS"
```

### エイリアスの削除

既存のエイリアスを削除します。

```bash
/sessions alias --remove <name>        # エイリアスを削除
/sessions unalias <name>               # 上記と同じ
```

**スクリプト:**
```bash
node -e "
const aa = require('./scripts/lib/session-aliases');

const aliasName = process.argv[1];
if (!aliasName) {
  console.log('Usage: /sessions alias --remove <name>');
  process.exit(1);
}

const result = aa.deleteAlias(aliasName);
if (result.success) {
  console.log('✓ Alias removed: ' + aliasName);
} else {
  console.log('✗ Error: ' + result.error);
  process.exit(1);
}
" "$ARGUMENTS"
```

### セッション情報

セッションの詳細情報を表示します。

```bash
/sessions info <id|alias>              # セッション詳細を表示
```

**スクリプト:**
```bash
node -e "
const sm = require('./scripts/lib/session-manager');
const aa = require('./scripts/lib/session-aliases');

const id = process.argv[1];
const resolved = aa.resolveAlias(id);
const sessionId = resolved ? resolved.sessionPath : id;

const session = sm.getSessionById(sessionId, true);
if (!session) {
  console.log('Session not found: ' + id);
  process.exit(1);
}

const stats = sm.getSessionStats(session.sessionPath);
const size = sm.getSessionSize(session.sessionPath);
const aliases = aa.getAliasesForSession(session.filename);

console.log('Session Information');
console.log('════════════════════');
console.log('ID:          ' + (session.shortId === 'no-id' ? '(none)' : session.shortId));
console.log('Filename:    ' + session.filename);
console.log('Date:        ' + session.date);
console.log('Modified:    ' + session.modifiedTime.toISOString().slice(0, 19).replace('T', ' '));
console.log('');
console.log('Content:');
console.log('  Lines:         ' + stats.lineCount);
console.log('  Total items:   ' + stats.totalItems);
console.log('  Completed:     ' + stats.completedItems);
console.log('  In progress:   ' + stats.inProgressItems);
console.log('  Size:          ' + size);
if (aliases.length > 0) {
  console.log('Aliases:     ' + aliases.map(a => a.name).join(', '));
}
" "$ARGUMENTS"
```

### エイリアスのリスト表示

すべてのセッションエイリアスを表示します。

```bash
/sessions aliases                      # すべてのエイリアスをリスト表示
```

**スクリプト:**
```bash
node -e "
const aa = require('./scripts/lib/session-aliases');

const aliases = aa.listAliases();
console.log('Session Aliases (' + aliases.length + '):');
console.log('');

if (aliases.length === 0) {
  console.log('No aliases found.');
} else {
  console.log('Name          Session File                    Title');
  console.log('─────────────────────────────────────────────────────────────');
  for (const a of aliases) {
    const name = a.name.padEnd(12);
    const file = (a.sessionPath.length > 30 ? a.sessionPath.slice(0, 27) + '...' : a.sessionPath).padEnd(30);
    const title = a.title || '';
    console.log(name + ' ' + file + ' ' + title);
  }
}
"
```

## 引数

$ARGUMENTS:
- `list [オプション]` - セッションをリスト表示
  - `--limit <n>` - 表示する最大セッション数（デフォルト: 50）
  - `--date <YYYY-MM-DD>` - 日付でフィルタリング
  - `--search <パターン>` - セッションIDで検索
- `load <id|alias>` - セッション内容を読み込む
- `alias <id> <name>` - セッションのエイリアスを作成
- `alias --remove <name>` - エイリアスを削除
- `unalias <name>` - `--remove`と同じ
- `info <id|alias>` - セッション統計を表示
- `aliases` - すべてのエイリアスをリスト表示
- `help` - このヘルプを表示

## 例

```bash
# すべてのセッションをリスト表示
/sessions list

# 今日のセッションにエイリアスを作成
/sessions alias 2026-02-01 today

# エイリアスでセッションを読み込む
/sessions load today

# セッション情報を表示
/sessions info today

# エイリアスを削除
/sessions alias --remove today

# すべてのエイリアスをリスト表示
/sessions aliases
```

## 備考

- セッションは `~/.claude/session-data/` にMarkdownファイルとして保存され、旧 `~/.claude/sessions/` のファイルも引き続き読み取られます
- エイリアスは `~/.claude/session-aliases.json` に保存されます
- セッションIDは短縮できます（通常、最初の4〜8文字で一意になります）
- 頻繁に参照するセッションにはエイリアスを使用してください

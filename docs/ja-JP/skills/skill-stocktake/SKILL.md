---
name: skill-stocktake
description: "Claudeのスキルとコマンドの品質を監査するためのツール。変更されたスキルのみを対象とした高速スキャンと、順次サブエージェントバッチ評価を使用した完全棚卸しモードをサポートする。"
origin: ECC
---

# skill-stocktake

品質チェックリスト + AI全体判断を使用して、すべてのClaudeスキルとコマンドを審査するスラッシュコマンド（`/skill-stocktake`）。2つのモードをサポートする：最近変更されたスキルの高速スキャンと、完全レビューのための完全棚卸し。

## スコープ

このコマンドは、**コマンドを呼び出したディレクトリを基準とした**以下のパスを対象とする：

| パス | 説明 |
|------|-------------|
| `~/.claude/skills/` | グローバルスキル（全プロジェクト） |
| `{cwd}/.claude/skills/` | プロジェクトレベルのスキル（ディレクトリが存在する場合） |

**フェーズ1の開始時に、コマンドはどのパスが見つかりスキャンされたかを明示的にリストアップする。**

### 特定のプロジェクトをターゲットにする

プロジェクトレベルのスキルを含めるには、そのプロジェクトのルートから実行する：

```bash
cd ~/path/to/my-project
/skill-stocktake
```

プロジェクトに `.claude/skills/` ディレクトリがない場合、グローバルスキルとコマンドのみが評価される。

## モード

| モード | トリガー条件 | 所要時間 |
|------|---------|---------|
| 高速スキャン | `results.json` が存在する（デフォルト） | 5〜10分 |
| 完全棚卸し | `results.json` が存在しない、または `/skill-stocktake full` | 20〜30分 |

**結果キャッシュ：** `~/.claude/skills/skill-stocktake/results.json`

## 高速スキャンフロー

前回の実行以降に変更されたスキルのみを再評価する（5〜10分）。

1. `~/.claude/skills/skill-stocktake/results.json` を読み取る
2. 実行する：`bash ~/.claude/skills/skill-stocktake/scripts/quick-diff.sh \   ~/.claude/skills/skill-stocktake/results.json`
   （プロジェクトディレクトリは `$PWD/.claude/skills` から自動検出。必要な場合のみ明示的に渡す）
3. 出力が `[]` の場合：「前回の実行以降に変更なし。」とレポートして停止する
4. 変更されたファイルのみを同じフェーズ2の基準で再評価する
5. 前回の結果から変更されていないスキルを引き継ぐ
6. 差分のみを出力する
7. 実行する：`bash ~/.claude/skills/skill-stocktake/scripts/save-results.sh \   ~/.claude/skills/skill-stocktake/results.json <<< "$EVAL_RESULTS"`

## 完全棚卸しフロー

### フェーズ 1 — インベントリ

実行する：`bash ~/.claude/skills/skill-stocktake/scripts/scan.sh`

スクリプトはスキルファイルを列挙し、フロントマターを抽出し、UTC修正時刻を収集する。
プロジェクトディレクトリは `$PWD/.claude/skills` から自動検出。必要な場合のみ明示的に渡す。
スクリプト出力からスキャンサマリーとインベントリテーブルを表示する：

```
スキャン中：
  ✓ ~/.claude/skills/         (17 個のファイル)
  ✗ {cwd}/.claude/skills/    (見つからない — グローバルスキルのみ)
```

| スキル | 7日間使用 | 30日間使用 | 説明 |
|-------|--------|---------|-------------|

### フェーズ 2 — 品質評価

完全なインベントリとチェック項目を含む**汎用エージェント**ツールのサブエージェントを起動する：

```text
Agent(
  subagent_type="general-purpose",
  prompt="
チェックリストに基づいて以下のスキルインベントリを評価してください。

[INVENTORY]

[CHECKLIST]

各スキルについてJSONを返してください：
{ \"verdict\": \"Keep\"|\"Improve\"|\"Update\"|\"Retire\"|\"Merge into [X]\", \"reason\": \"...\" }
"
)
```

サブエージェントは各スキルを読み取り、チェック項目を適用し、各スキルのJSON結果を返す：

`{ "verdict": "Keep"|"Improve"|"Update"|"Retire"|"Merge into [X]", "reason": "..." }`

**チャンク指針：** 各サブエージェント呼び出しは約20個のスキルを処理し、コンテキストを管理可能に保つ。各チャンクの後、中間結果を `results.json` に保存する（`status: "in_progress"`）。

全スキルの評価が完了したら：`status: "completed"` を設定し、フェーズ3に進む。

**再開検出：** 起動時に `status: "in_progress"` が見つかった場合、最初の未評価スキルから再開する。

各スキルはこのチェックリストに基づいて評価される：

```
- [ ] 他のスキルとの内容の重複を確認済み
- [ ] MEMORY.md / CLAUDE.md との重複を確認済み
- [ ] 技術的参照の時効性を確認済み（ツール名 / CLI引数 / APIが存在する場合、WebSearchで検証）
- [ ] 使用頻度を考慮済み
```

判定基準：

| 判定 | 意味 |
|---------|---------|
| Keep | 有用かつ最新 |
| Improve | 保持する価値があるが、特定の改善が必要 |
| Update | 参照された技術が古い（WebSearchで検証） |
| Retire | 品質が低い、陳腐化、またはコストが非対称 |
| Merge into \[X] | 別のスキルと大幅に重複している。マージターゲットを命名する |

評価は**AI全体判断**——数値スコアリングルーブリックではない。指針となる次元：

* **実行可能性**：即座に行動できるコード例、コマンド、または手順
* **スコープの適合性**：名前、トリガー、内容が一致している。広すぎず、狭すぎない
* **独自性**：MEMORY.md / CLAUDE.md / 他のスキルで代替できない価値
* **時効性**：技術的参照が現在の環境で有効

**理由の品質要件** — `reason` フィールドは自己完結型で意思決定を支えられる必要がある：

* 単に「変更なし」と書かない——常に核心的な証拠を再述する
* **Retire** の場合：(1) 発見された具体的な欠陥、(2) 同じニーズをカバーする代替案を述べる
  * 悪：`"Superseded"`
  * 良：`"disable-model-invocation: true already set; superseded by continuous-learning-v2 which covers all the same patterns plus confidence scoring. No unique content remains."`
* **Merge** の場合：ターゲットを命名し、何を統合するかを説明する
  * 悪：`"Overlaps with X"`
  * 良：`"42-line thin content; Step 4 of chatlog-to-article already covers the same workflow. Integrate the 'article angle' tip as a note in that skill."`
* **Improve** の場合：必要な具体的な変更を説明する（どのセクション、何の操作、該当する場合は目標サイズ）
  * 悪：`"Too long"`
  * 良：`"276 lines; Section 'Framework Comparison' (L80–140) duplicates ai-era-architecture-principles; delete it to reach ~150 lines."`
* **Keep**（高速スキャンでmtimeのみ変更の場合）：元の判定理由を再述し、「変更なし」と書かない
  * 悪：`"Unchanged"`
  * 良：`"mtime updated but content unchanged. Unique Python reference explicitly imported by rules/python/; no overlap found."`

### フェーズ 3 — サマリーテーブル

| スキル | 7日間使用 | 判定 | 理由 |
|-------|--------|---------|--------|

### フェーズ 4 — 統合

1. **Retire / Merge**：ユーザーの確認前に、ファイルごとに詳細な理由を提示する：
   * 発見された具体的な問題（重複、陳腐化、リンク切れなど）
   * 同じ機能をカバーする代替案（Retire の場合：どの既存スキル/ルール；Merge の場合：ターゲットファイルと何を統合するか）
   * 削除の影響（依存するスキル、MEMORY.md 参照、影響を受けるワークフローがあるか）
2. **Improve**：具体的な改善提案と理由を提示する：
   * 何を変更し、なぜか（例：「X/Yセクションが python-patterns と重複しているため、430行を200行に圧縮する」）
   * ユーザーが行動するかどうかを決定する
3. **Update**：確認したソースから更新されたコンテンツを提示する
4. MEMORY.md の行数を確認し、100行を超えている場合は圧縮を提案する

## 結果ファイルスキーマ

`~/.claude/skills/skill-stocktake/results.json`：

**`evaluated_at`**：評価が完了した実際のUTC時刻を設定する必要がある。
Bash で取得する：`date -u +%Y-%m-%dT%H:%M:%SZ`。`T00:00:00Z` のような日付のみの近似値は絶対に使わない。

```json
{
  "evaluated_at": "2026-02-21T10:00:00Z",
  "mode": "full",
  "batch_progress": {
    "total": 80,
    "evaluated": 80,
    "status": "completed"
  },
  "skills": {
    "skill-name": {
      "path": "~/.claude/skills/skill-name/SKILL.md",
      "verdict": "Keep",
      "reason": "Concrete, actionable, unique value for X workflow",
      "mtime": "2026-01-15T08:30:00Z"
    }
  }
}
```

## 注意事項

* 評価はブラインド：ソース（ECC、自作、自動抽出）に関わらず、すべてのスキルに同じチェックリストを適用する
* アーカイブ/削除操作は常に明示的なユーザー確認が必要
* スキルのソースによって判定を分岐させない

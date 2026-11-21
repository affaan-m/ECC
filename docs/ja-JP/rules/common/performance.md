# パフォーマンス最適化

## モデル選択戦略

**Haiku 4.5**（Sonnet 機能の 90%、コスト 3 分の 1）:
- 頻繁に呼び出される軽量 agent
- ペアプログラミングとコード生成
- マルチ agent システムのワーカー agent

**Sonnet 5**（最高のコーディングモデル）:
- メイン開発作業
- マルチ agent ワークフローのオーケストレーション
- 複雑なコーディングタスク

**Opus 5**（最も深い推論）:
- 複雑なアーキテクチャの意思決定
- 最大限の推論要件
- 調査と分析タスク

## コンテキストウィンドウ管理

次の場合はコンテキストウィンドウの最後の 20% を避ける:
- 大規模なリファクタリング
- 複数ファイルにまたがる機能実装
- 複雑な相互作用のデバッグ

コンテキスト感度の低いタスク:
- 単一ファイルの編集
- 独立したユーティリティの作成
- ドキュメントの更新
- 単純なバグ修正

## 拡張思考 + プランモード

Claude Code では、適応推論によりモデルがタスクごとに思考量を決めます。Fable モデル、Sonnet 5 以降、Opus 4.7 以降では、固定のトークン予算ではなく effort で推論を制御します。利用できるレベルはモデルによって異なります。

拡張思考の制御:
- **Effort**: セッション内では `/effort`、起動時は `--effort <level>`、または `CLAUDE_CODE_EFFORT_LEVEL` を使用します。`~/.claude/settings.json` の `modelSettings` にモデルごとのレベルを保存できます。以前のユーザーレベル `effortLevel` キーは Opus 5.5 以降のモデルには適用されません。
- **トグル**: Option+T（macOS）/ Alt+T（Windows/Linux）、または設定の `alwaysThinkingEnabled`。Opus 5.5、Sonnet 5.5、Fable モデルでは思考を無効にできません。
- **固定予算**: 適応推論モデルでは、Claude Code は正の `MAX_THINKING_TOKENS` 値を無視します。Opus 4.6 または Sonnet 4.6 では、`CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` を設定すると `MAX_THINKING_TOKENS` で固定予算を使用できます。
- **詳細モード**: Ctrl+O で思考出力を表示

対応する制御については [Claude Code モデル設定](https://code.claude.com/docs/en/model-config#adjust-effort-level) と [環境変数](https://code.claude.com/docs/en/env-vars) を参照してください。

深い推論を必要とする複雑なタスクの場合:
1. `/effort high` など、より高い対応済みの effort レベルを選択
2. 構造化されたアプローチのために **プランモード** を有効化
3. 徹底的な分析のために複数の批評ラウンドを使用
4. 多様な視点のために役割分担したサブ agent を使用

## ビルドトラブルシューティング

ビルドが失敗した場合:
1. **build-error-resolver** agent を使用
2. エラーメッセージを分析
3. 段階的に修正
4. 各修正後に検証

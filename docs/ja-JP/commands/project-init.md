---
description: プロジェクトのスタックを検出し、リポジトリのインストールマニフェストとスタックマッピングを使用してドライランECCオンボーディング計画を生成します。
---

# /project-init

現在のプロジェクト用の安全でレビュー可能なECCオンボーディング計画を作成します。このコマンドはドライランモードで開始し、明示的なユーザー承認後にのみファイルを書き込みます。

## 使い方

```text
/project-init
/project-init --dry-run
/project-init --target claude
/project-init --target cursor
/project-init --skills continuous-learning-v2,security-review
/project-init --config ecc-install.json
```

## 安全ルール

1. デフォルトはドライラン。ユーザーが具体的な計画を承認するまで、`CLAUDE.md`、設定ファイル、ルール、スキル、またはインストール状態を変更しない。
2. 既存のプロジェクトガイダンスを保持。`CLAUDE.md`、`.claude/settings.local.json`、`.cursor/`、`.codex/`、`.gemini/`、`.opencode/`、`.codebuddy/`、`.joycode/`、または`.qwen/`が既に存在する場合、内容を検査し上書きではなくマージ/追記計画を提案。
3. ECCのインストーラーとマニフェストツールを使用。インストールのショートカットとしてファイルを手動コピーしたり任意のリモートをクローンしない。
4. パーミッションを狭く保つ。生成された設定は検出されたビルド/テスト/リントツールに一致させ、広範なシェルアクセスを避ける。
5. 何かを適用する前に、正確に何が変わるかを報告。

## 検出入力

現在のプロジェクトルートを読み取り、以下からスタックシグナルを検出:

- パッケージマネージャーファイル: `package.json`、`package-lock.json`、`pnpm-lock.yaml`、`yarn.lock`、`bun.lockb`
- 言語マニフェスト: `pyproject.toml`、`requirements.txt`、`go.mod`、`Cargo.toml`、`pom.xml`、`build.gradle`、`build.gradle.kts`
- フレームワークファイル: `next.config.*`、`vite.config.*`、`tailwind.config.*`、`Dockerfile`、`docker-compose.yml`
- ECC設定: `ecc-install.json`
- オプションのスタックマップ: ECCリポジトリ内の`config/project-stack-mappings.json`

ECCチェックアウトが利用可能な場合、`config/project-stack-mappings.json`をスタックからルール/スキルへの参照として使用。ファイルが利用できない場合、インストール済みのECCマニフェストと明示的なユーザーの選択にフォールバック。

## 計画フロー

1. ターゲットハーネスを特定。ユーザーが`cursor`、`codex`、`gemini`、`opencode`、`codebuddy`、`joycode`、または`qwen`を要求しない限りデフォルトは`claude`。
2. プロジェクトファイルからスタックを検出し、各一致のエビデンスを表示。
3. 最小限の有用なECC計画を解決:
   - プロジェクトに`ecc-install.json`がある: `node scripts/install-plan.js --config ecc-install.json --json`
   - ユーザーがプロファイルを指定: `node scripts/install-plan.js --profile <profile> --target <target> --json`
   - ユーザーがスキルを指定: `node scripts/install-plan.js --skills <skill-ids> --target <target> --json`
   - 言語スタックのみ検出: それらの言語名でレガシー言語インストールのドライランを使用
4. 書き込み前にドライラン適用コマンドを実行:

```bash
node scripts/install-apply.js --target <target> --dry-run --json <language-or-profile-args>
```

5. 検出されたスタック、選択されたモジュール/コンポーネント/スキル、ターゲットパス、スキップされた未サポートモジュール、変更されるファイルをサマリー。
6. 非ドライランコマンドを適用する前に承認を求める。

## 出力契約

返却内容:

1. 検出されたスタックのエビデンス
2. 提案されるターゲットハーネス
3. 使用された正確なドライランコマンド
4. 承認後に実行する正確な適用コマンド
5. 作成または変更されるファイル/ディレクトリ
6. 既存ファイル、広範なパーミッション、欠落スクリプト、未サポートターゲットに関する警告

## CLAUDE.mdガイダンス

ユーザーが`CLAUDE.md`スターターを求める場合、インストーラー計画とは別に生成し最小限に保つ:

- ビルドコマンド（検出された場合）
- テストコマンド（検出された場合）
- リント/型チェックコマンド（検出された場合）
- 開発サーバーコマンド（検出された場合）
- 既存のパッケージスクリプトやマニフェストからのリポジトリ固有のメモ

diffを表示して承認を得ずに既存の`CLAUDE.md`を置換しないこと。

## 関連

- `config/project-stack-mappings.json` — スタックからサーフェスへのヒント
- `scripts/install-plan.js` — 決定論的な計画解決
- `scripts/install-apply.js` — ドライランと適用操作
- `/ecc-guide` — インストール前のインタラクティブな機能ディスカバリー

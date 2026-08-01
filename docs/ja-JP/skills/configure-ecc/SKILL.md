---
name: configure-ecc
description: Claude Code、Codex、Kimi 内で ECC のインストール、更新、再設定を案内し、各ハーネスが実際に備えるプラグイン、スコープ、フック機能を守ります。
metadata:
  origin: ECC
---

# Everything Claude Code の設定

現在のハーネス内で対話式ウィザードを実行します。最初にインベントリを調べ、対応する選択肢だけを
収集し、プレビュー後に 1 回だけ確認し、非対話で適用・検証します。ウェルカム表示は成功後だけです。
ECC を一時ディレクトリへ clone したり、プラグインを手作業でコピーしたりしないでください。

ユーザー自身が操作するターミナルの正規エントリは `ecc setup` と `npx ecc-universal setup` です。
ハーネス内では、代わりに以下の明示的な非対話コマンドを使います。

## 現在のハーネスで分岐

- Claude Code では、以下の完全なスコープ/フックウィザードを使います。
- Codex では Codex ネイティブのプラグインライフサイクルを使います。Claude のスコープを提示したり、
  Claude の ECC フック 4 段階を Codex に対応付けたりしません。
- Kimi ではプロジェクトサーフェスを `./.kimi-code` に導入します。Kimi は ECC の Claude ライフサイクル
  フックプロファイルに対応しません。
- ハーネスを特定できない場合は、検出根拠を示し、変更コマンドの前に対象を質問します。

このスキルは導入後の再設定経路です。プロバイダー組み込みの初回導入 UI を横取り、または代替できません。

## Claude Code: 完全な対話式ウィザード

### 1. 変更せずにインベントリを確認

両方のコマンドを実行し、ECC の導入スコープ、有効状態、marketplace ソースを要約します。

```bash
claude plugin list --json
claude plugin marketplace list --json
```

`ecc@ecc` が 1 つのみ既存する場合は再設定として扱います。Claude が所有する
"Open home page" コントロールをインストールの根拠にしません。setup が複数の ECC スコープ、
旧式/手動導入、不正な設定、marketplace 衝突を報告したら停止し、返された復旧方法を示します。
削除対象を推測しません。

### 2. 2 つの選択だけを収集

スコープについて 1 回だけ質問し、必ず 1 つの値を選びます。

- `user | project | local`
- `user` はこのユーザーの全プロジェクトで使えます。
- `project` はリポジトリ設定で共有されます。
- `local` は現在のプロジェクトのみに非公開です。

選択済みまたはインストール中の表示は、実際に選んだ 1 スコープだけにします。唯一の既存スコープと異なる
値を選んだら、スコープ移行であると説明し、以下のコマンドに `--move-scope` を含めます。

フックモードについて 1 回だけ質問し、必ず 1 つの値を選びます。

- `off | minimal | standard | strict`
- `off` はスキルとコマンドを残し、ECC フック自動化を無効にします。
- `minimal` は最軽量のライフサイクルと安全自動化のみを有効にします。
- `standard` は品質と安全のバランスを取ります。
- `strict` は最も強いチェックとリマインダーを有効にします。

フック設定は個人の Claude プラグイン設定であり、導入スコープには追従しません。

### 3. プレビューし、1 回だけ確認

プラグイン内蔵 setup スクリプトを優先します。2 つの選択値を代入し、スコープ移行の場合だけ
`--move-scope` を含めます。

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/setup.js" --mode claude-plugin \
  --scope <scope> --hooks <hooks> [--move-scope] --dry-run --json
```

`$CLAUDE_PLUGIN_ROOT` がない場合は公開 npm パッケージを使います。

```bash
npx --yes --package ecc-universal ecc setup --mode claude-plugin \
  --scope <scope> --hooks <hooks> [--move-scope] --dry-run --json
```

確認サマリーは 1 回だけ表示します。予定アクション、1 スコープ、1 フックモード、marketplace アクション、
および移行元から移行先を含め、yes/no を 1 回だけ質問します。ハーネスの Shell は通常非 TTY のため、
そこで bare な対話式 `ecc setup` を実行しません。

### 4. 明示した選択を適用

確認後、同じ経路を `--dry-run` なしで再実行します。全選択を明示し、JSON で成功を判定します。

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/setup.js" --mode claude-plugin \
  --scope <scope> --hooks <hooks> [--move-scope] --yes --json
```

フォールバック:

```bash
npx --yes --package ecc-universal ecc setup --mode claude-plugin \
  --scope <scope> --hooks <hooks> [--move-scope] --yes --json
```

### 5. 検証後にウェルカムを表示

終了コードが 0 であり、setup 結果の `scope` と `hooks` が選択値と一致することを必須とします。
その後、独立して実行します。

```bash
claude plugin list --json
```

選択スコープに有効な `ecc@ecc` が正確に 1 件ある場合のみ続行します。`$CLAUDE_PLUGIN_ROOT` があるときは、
成功した setup の `action`（`installed`、`updated`、`migrated`、`resumed`、
`already-migrated`）を内蔵レンダラーへ渡します。

呼び出し前に、プロバイダーが報告したバージョンが
`scripts/lib/terminal-welcome.js` の `ECC_VERSION_PATTERN` に一致することを
確認します。予期しない値は shell に補間せず拒否してください。

```bash
node -e 'const { renderTerminalWelcome } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/lib/terminal-welcome"); process.stdout.write(renderTerminalWelcome({ action: process.argv[1], version: process.argv[2], color: process.stdout.isTTY }));' "<action>" "<installed-version>"
```

ウェルカムは 1 回だけ表示します。失敗、dry-run、キャンセル、スコープ/フック不一致、検証不能の場合は
表示せず、エラーと復旧手順を報告します。検証後は `/reload-plugins` または Claude Code の再起動を案内します。

## Codex: ネイティブプラグインライフサイクル

`codex plugin marketplace list --json` と `codex plugin list --available --json` で確認します。
Codex ネイティブのプラグインコマンドには Claude 式 `user | project | local` 選択はありません。
Claude のスコープ/フック 4 段階は質問しません。Codex ネイティブプラグインはプロバイダー固有フックに対応しますが、
Codex はその明示的な信頼を求めます。Codex にその信頼判断を表示させ、Claude の 4 プロファイルが Codex に対応すると表現しません。

ECC marketplace がない場合は追加し、既存ならスナップショットを更新します。

```bash
codex plugin marketplace add affaan-m/ECC
codex plugin marketplace upgrade ecc --json
```

1 回だけ確認し、インストールまたは導入済みキャッシュの再現可能な更新を行い、検証します。

```bash
codex plugin add ecc@ecc --json
codex plugin list --json
```

JSON が ECC を導入済みと報告し、`installedPath` を提供した場合のみ続行し、検証済みバンドルからウェルカムを表示します。

`installedPath` は Codex JSON が返した絶対パスそのものだけを使い、制御文字を
拒否します。ツール API が対応する場合は argument array で Node を呼び出し、
ユーザー入力を連結しません。バージョンは `ECC_VERSION_PATTERN` で検証します。

```bash
node "<installedPath>/scripts/welcome.js" --action configured --version "<installed-version>"
```

Claude の `off | minimal | standard | strict` が Codex に適用されたとは表現しません。

## Kimi: プロジェクトサーフェス

確認前に機能サマリーを示します。導入先は `./.kimi-code`、ECC ライフサイクルフックは
`hooks=unsupported` です。Claude のスコープ/フックモードを質問しません。まずプレビューします。

```bash
npx --yes --package ecc-universal ecc install --profile core --target kimi --dry-run
```

このプロジェクト導入先について 1 回だけ確認し、`--dry-run` を除いた同一コマンドを適用します。
検証コマンド:

```bash
npx --yes --package ecc-universal ecc doctor --target kimi
```

doctor が成功し、導入された指示とスキルが `./.kimi-code` 内に留まることを確認した後だけ実行します。

```bash
npx --yes --package ecc-universal ecc welcome --action configured
```

Kimi が ECC ライフサイクルフックを導入または設定したとは表現しません。

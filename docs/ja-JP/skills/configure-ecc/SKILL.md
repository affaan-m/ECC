---
name: configure-ecc
description: 明示的なインストールスコープと個人用フック設定で、ECC Claude プラグインをインストール、更新、再設定します。
metadata:
  origin: ECC
---

# Everything Claude Code の設定

Claude Code 向けの ECC をインストール、更新、または設定するときに
このスキルを使用します。

## 正規のセットアップコマンド

ECC のチェックアウトまたは npm インストールから実行します。

```bash
ecc setup
```

`ecc` が未インストールの場合は、npm から同じコマンドを起動できます。

```bash
npx --yes --package ecc-universal ecc setup
```

非対話の自動化では、すべての選択を明示します。

```bash
ecc setup \
  --mode claude-plugin \
  --scope user \
  --hooks standard \
  --yes
```

ECC を一時ディレクトリへクローンしたり、プラグイン部品を手動コピー
したりしないでください。セットアップは現在の状態を調べ、公式
marketplace を追加または更新してから `ecc@ecc` をインストールまたは
更新します。

## インストールスコープの説明

新規インストールの前に、Claude の 3 つのネイティブスコープを説明します。

- `user` — このユーザーの全プロジェクトで利用できます。
- `project` — リポジトリ設定を通じて共同作業者と共有します。
- `local` — 現在のプロジェクトだけで利用し、選択をコミットしません。

新規の非対話インストールには `--scope` が必要です。再実行時は、既存の
単一スコープを検出してその場で更新できます。スコープ変更には専用の
移行フローを使い、通常のセットアップでは重複を作りません。

## フック設定の説明

フック設定は個人用の Claude プラグイン設定であり、インストールスコープ
とは独立しています。

- `off` — ECC のスキルとコマンドを残し、ECC フックは実行しません。
- `minimal` — 最小限のライフサイクルと安全自動化だけを実行します。
- `standard` — 品質と安全性のバランスを取った自動化です。
- `strict` — 最も強いチェックとリマインダーを使用します。

後から `--hooks off|minimal|standard|strict` で変更できます。無関係な
Claude 設定と未知のプラグイン設定は保持されます。

## 安全動作

次の状態を検出した場合、変更前に停止します。

- 旧 Everything Claude Code プラグイン
- 複数スコープの `ecc@ecc`
- 手動配置された ECC プラグイン
- `ecc` 名を使う非公式 marketplace
- 不正な Claude 設定またはインベントリ
- プラグインのスキル、コマンド、フックと重なる管理対象 ECC コンテンツ

`--dry-run --json` で読み取り専用の確認結果を取得できます。インストール
または更新後は Claude Code を再起動するか `/reload-plugins` を実行します。

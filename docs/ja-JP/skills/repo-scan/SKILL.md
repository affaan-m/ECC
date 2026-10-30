---
name: repo-scan
description: 固定されレビュー可能なコミットから外部の repo-scan スキルをインストールするブートストラップ用ポインター。クロススタックのソースコード資産監査を実行する前に repo-scan のインストールが必要な場合に使用する。この ECC ポインター自体は監査を実行しない。
origin: community
---

# repo-scan

> どのエコシステムにも独自の依存関係マネージャーがあるが、C++、Android、iOS、Web をまたいで「どのコードが本当に自分のもので、どれがサードパーティで、どれが余分な負担か」を教えてくれるツールはない。

## 適用場面

* 大規模なレガシーコードベースを引き継ぎ、全体的な構造を把握する必要がある場合
* 大規模なリファクタリング前——コアコード、重複コード、廃止コードを特定する
* パッケージマネージャーで宣言せずにソースに直接埋め込まれたサードパーティの依存関係を監査する
* モノレポの再編成に向けたアーキテクチャ決定記録を準備する

## インストール

```bash
# Clone first so the pinned commit can be reviewed before installation
set -euo pipefail

REPO_SCAN_COMMIT=2742664ebcad1450c208eda0ae45d3c17fad5dd8
REPO_SCAN_INSTALL_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/repo-scan"
REPO_SCAN_INSTALL_PARENT="$(dirname "$REPO_SCAN_INSTALL_DIR")"
mkdir -p "$REPO_SCAN_INSTALL_PARENT"
REPO_SCAN_TMP="$(mktemp -d "$REPO_SCAN_INSTALL_PARENT/.repo-scan-install.XXXXXX")"
REPO_SCAN_TOKEN="${REPO_SCAN_TMP##*.}"
REPO_SCAN_STAGE="$REPO_SCAN_TMP/stage-$REPO_SCAN_TOKEN"
REPO_SCAN_BACKUP="$REPO_SCAN_TMP/backup-$REPO_SCAN_TOKEN"
REPO_SCAN_LOCK="$REPO_SCAN_INSTALL_PARENT/.repo-scan-install.lock"
REPO_SCAN_KEEP_TMP=0
REPO_SCAN_LOCK_HELD=0
REPO_SCAN_MV_HAS_NO_TARGET=0
cleanup_repo_scan_install() {
  if [ "$REPO_SCAN_KEEP_TMP" -eq 0 ]; then
    rm -rf -- "$REPO_SCAN_TMP"
  fi
  if [ "$REPO_SCAN_LOCK_HELD" -eq 1 ] && ! rmdir -- "$REPO_SCAN_LOCK"; then
    printf 'Could not release installation lock at %s\n' "$REPO_SCAN_LOCK" >&2
  fi
}
trap cleanup_repo_scan_install EXIT
mkdir "$REPO_SCAN_TMP/mv-probe-source"
if mv -T -- "$REPO_SCAN_TMP/mv-probe-source" \
  "$REPO_SCAN_TMP/mv-probe-destination" 2>/dev/null; then
  REPO_SCAN_MV_HAS_NO_TARGET=1
  rmdir "$REPO_SCAN_TMP/mv-probe-destination"
else
  rmdir "$REPO_SCAN_TMP/mv-probe-source"
fi
move_repo_scan_dir() {
  REPO_SCAN_MOVE_SOURCE=$1
  REPO_SCAN_MOVE_DESTINATION=$2
  REPO_SCAN_MOVE_NAME=${REPO_SCAN_MOVE_SOURCE##*/}
  if [ -e "$REPO_SCAN_MOVE_DESTINATION" ] || [ -L "$REPO_SCAN_MOVE_DESTINATION" ]; then
    return 1
  fi
  if [ "$REPO_SCAN_MV_HAS_NO_TARGET" -eq 1 ]; then
    mv -T -- "$REPO_SCAN_MOVE_SOURCE" "$REPO_SCAN_MOVE_DESTINATION"
    return
  fi
  if ! mv -- "$REPO_SCAN_MOVE_SOURCE" "$REPO_SCAN_MOVE_DESTINATION"; then
    return 1
  fi
  if [ -e "$REPO_SCAN_MOVE_DESTINATION/$REPO_SCAN_MOVE_NAME" ] || \
    [ -L "$REPO_SCAN_MOVE_DESTINATION/$REPO_SCAN_MOVE_NAME" ]; then
    if ! mv -- "$REPO_SCAN_MOVE_DESTINATION/$REPO_SCAN_MOVE_NAME" \
      "$REPO_SCAN_MOVE_SOURCE"; then
      REPO_SCAN_KEEP_TMP=1
      printf 'Move conflict recovery failed; staged data remains at %s\n' \
        "$REPO_SCAN_MOVE_DESTINATION/$REPO_SCAN_MOVE_NAME" >&2
    fi
    return 1
  fi
}

git clone --filter=blob:none --no-checkout \
  https://github.com/haibindev/repo-scan.git "$REPO_SCAN_TMP/source"
git -C "$REPO_SCAN_TMP/source" checkout --detach "$REPO_SCAN_COMMIT"
mkdir -p "$REPO_SCAN_STAGE"
git -C "$REPO_SCAN_TMP/source" archive "$REPO_SCAN_COMMIT" | \
  tar -xf - -C "$REPO_SCAN_STAGE"

# Review "$REPO_SCAN_TMP/source" before approving installation.
printf 'Type install to replace %s after reviewing the pinned source: ' \
  "$REPO_SCAN_INSTALL_DIR" >&2
read -r REPO_SCAN_CONFIRM
if [ "$REPO_SCAN_CONFIRM" != install ]; then
  printf 'Installation cancelled.\n' >&2
  exit 1
fi
if ! mkdir -- "$REPO_SCAN_LOCK" 2>/dev/null; then
  printf 'Another repo-scan installation holds the lock at %s\n' \
    "$REPO_SCAN_LOCK" >&2
  exit 1
fi
REPO_SCAN_LOCK_HELD=1

if [ -e "$REPO_SCAN_INSTALL_DIR" ] || [ -L "$REPO_SCAN_INSTALL_DIR" ]; then
  move_repo_scan_dir "$REPO_SCAN_INSTALL_DIR" "$REPO_SCAN_BACKUP"
fi
if ! move_repo_scan_dir "$REPO_SCAN_STAGE" "$REPO_SCAN_INSTALL_DIR"; then
  if [ -e "$REPO_SCAN_BACKUP" ] || [ -L "$REPO_SCAN_BACKUP" ]; then
    if [ -e "$REPO_SCAN_INSTALL_DIR" ] || [ -L "$REPO_SCAN_INSTALL_DIR" ]; then
      REPO_SCAN_KEEP_TMP=1
      printf 'Replacement failed and target was recreated; previous installation preserved at %s\n' \
        "$REPO_SCAN_BACKUP" >&2
    elif ! move_repo_scan_dir "$REPO_SCAN_BACKUP" "$REPO_SCAN_INSTALL_DIR"; then
      REPO_SCAN_KEEP_TMP=1
      printf 'Replacement and rollback failed; previous installation preserved at %s\n' \
        "$REPO_SCAN_BACKUP" >&2
    fi
  fi
  exit 1
fi
```

> エージェントスキルをインストールする前に、ソースコードをレビューしてください。

インストール後、エージェントハーネスを再読み込みしてから、`repo-scan` を再度呼び出してください。この ECC ポインターは外部スキルをインストールするだけで、スキャン自体は実行しません。

## コア機能

| 機能 | 説明 |
|---|---|
| **クロススタックスキャン** | C/C++、Java/Android、iOS（OC/Swift）、Web（TS/JS/Vue）を一度にスキャン |
| **ファイル分類** | 各ファイルをプロジェクトコード、サードパーティコード、またはビルドアーティファクトとしてマーク |
| **ライブラリ検出** | 50以上の既知ライブラリ（FFmpeg、Boost、OpenSSL…）を識別しバージョン番号を抽出 |
| **4段階の判定** | コア資産 / 抽出・統合 / 再構築 / 廃止 |
| **HTMLレポート** | 階層的なドリルダウンナビゲーションに対応したインタラクティブなダークテーマページ |
| **モノレポサポート** | 階層的スキャンによるサマリー + サブプロジェクトレポート |

## 分析の深さレベル

| レベル | 読み取りファイル数 | 適用場面 |
|---|---|---|
| `fast` | モジュールあたり1〜2個 | 大規模ディレクトリの素早い棚卸し |
| `standard` | モジュールあたり2〜5個 | デフォルト監査、完全な依存関係 + アーキテクチャチェック |
| `deep` | モジュールあたり5〜10個 | スレッド安全性、メモリ管理、API一貫性チェックを追加 |
| `full` | 全ファイル | 統合前の包括的レビュー |

## 動作原理

1. **リポジトリの表面を分類**：ファイルを列挙し、各ファイルをプロジェクトコード、埋め込みサードパーティコード、ビルドアーティファクトとしてマークする。
2. **埋め込みライブラリを検出**：ディレクトリ名、ヘッダーファイル、ライセンスファイル、バージョンマーカーを検査して、バンドルされた依存関係とその可能性のあるバージョンを識別する。
3. **各モジュールをスコアリング**：ファイルをモジュールまたはサブシステムにグループ化し、所有権、重複度、保守コストに基づいて4つの判定のいずれかを割り当てる。
4. **構造的リスクを強調**：冗長なアーティファクト、重複したラッパー、古いベンダーコード、および抽出・再構築・廃止すべきモジュールを指摘する。
5. **レポートを生成**：簡潔なサマリーとインタラクティブなHTML出力を返し、モジュールごとのドリルダウンにより監査結果を非同期でレビューできる。

## 例

50,000ファイルのC++モノレポで：

* FFmpeg 2.x（2015年版）がまだ使用されていることを発見
* 同じSDKラッパーが3回重複していることを発見
* 636 MBのコミット済みDebug/ipch/objビルドアーティファクトを識別
* 分類結果：3 MBのプロジェクトコード vs 596 MBのサードパーティコード

## ベストプラクティス

* 初回監査は `standard` の深さから始める
* 100以上のモジュールを含むモノレポには `fast` で素早く棚卸しする
* リファクタリングが必要とフラグ立てされたモジュールに対して段階的に `deep` を実行する
* クロスモジュール分析の結果をレビューして、サブプロジェクト間の重複コードを検出する

## リンク

* [GitHub リポジトリ](https://github.com/haibindev/repo-scan)

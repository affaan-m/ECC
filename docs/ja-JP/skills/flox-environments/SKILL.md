---
name: flox-environments
description: "Floxで再現可能なクロスプラットフォーム開発環境を作成します — Nixに基づく宣言的な環境マネージャー。次の場合は必ずこのスキルを使用してください: システムレベルの依存関係（コンパイラー、データベース、openssl・libvips・BLAS・LAPACKなどのネイティブライブラリー）を持つプロジェクトを設定する場合; Python、Node.js、Rust、Go、C/C++、Java、Ruby、Elixir、PHP、その他の言語の再現可能なツールチェーンを設定する場合; macOSとLinux間で同一に動作する環境を管理する場合; チームのために正確なパッケージバージョンを固定する場合; ローカルサービス（PostgreSQL、Redis、Kafka）を開発ツールと並行して実行する場合; 単一コマンドで新しい開発者をオンボードする場合; または「自分のマシンでは動く」問題を解決する場合。AI支援やバイブコーディングに特に価値があります — Floxはエージェントがsudoなし、システム汚染なし、サンドボックス制限なしにプロジェクトスコープの環境にツールをインストールでき、結果の環境はリポジトリにコミットされるため、誰でも即座に再現できます。ユーザーがFloxに言及しない場合でも、再現可能、宣言的、クロスプラットフォームな開発環境とシステムパッケージが必要と説明した場合はこのスキルを使用してください。また、ユーザーが.flox/、manifest.toml、flox activate、またはFloxHubに言及した場合も使用してください。"
origin: Flox
---

# Flox環境

Floxは単一のTOMLマニフェストで定義される再現可能な開発環境を作成します。チームのすべての開発者が同一のパッケージ、ツール、設定を取得できます — コンテナーやVMなしにmacOSとLinux間で同一です。150,000以上のパッケージにアクセスできるNixの上に構築されています。

## アクティベートするタイミング

ユーザーが環境管理の問題を抱えている場合、Floxについて言及していなくても、このスキルを使用します。Floxが適切なツールとなるのは:

- プロジェクトが**システムレベルのパッケージ**（コンパイラー、データベース、CLIツール）と言語固有の依存関係を必要とする場合
- **再現性が重要な場合** — チームメイトのマシン、CI、または新しいラップトップでも同一に動作する必要がある場合
- ユーザーが**複数のツールの共存**を必要とする場合 — 例えばPython 3.11 + PostgreSQL 16 + Redis + Node.jsを一つの環境で
- **クロスプラットフォームサポート**が必要な場合（同一設定からmacOSとLinux）
- **AIエージェントがツールをインストールする必要がある場合** — Floxはエージェントがsudoなし、システム汚染なし、サンドボックス制限なしにプロジェクトスコープの環境にパッケージを追加できます

ユーザーがシステム依存関係のない単一の言語ランタイムだけが必要な場合、標準ツール（nvm、pyenv、rustup単独）で十分かもしれません。完全なOSレベルの分離が必要な場合、コンテナーがより適切かもしれません。Floxはその中間に位置します: コンテナーのオーバーヘッドなしの宣言的で再現可能な環境。

**前提条件:** まずFloxをインストールする必要があります — macOS、Linux、Dockerについては[flox.dev/docs](https://flox.dev/docs/install-flox/install/)を参照してください。

## コアコンセプト

Flox環境は`.flox/env/manifest.toml`で定義され、`flox activate`でアクティベートされます。マニフェストはパッケージ、環境変数、セットアップフック、シェル設定を宣言します — 環境をどこでも再現するために必要なすべてのものです。

**主要なパス:**
- `.flox/env/manifest.toml` — 環境定義（コミットする）
- `$FLOX_ENV` — インストールされたパッケージへのランタイムパス（`/usr`に似ている — `bin/`、`lib/`、`include/`を含む）
- `$FLOX_ENV_CACHE` — キャッシュ、venv、データの永続ローカルストレージ（リビルド後も存続）
- `$FLOX_ENV_PROJECT` — プロジェクトのルートディレクトリ（`.flox/`が存在する場所）

## 必須コマンド

```bash
flox init                       # 新しい環境を作成
flox search <package> [--all]   # パッケージを検索
flox show <package>             # 利用可能なバージョンを表示
flox install <package>          # パッケージを追加
flox list                       # インストール済みパッケージを一覧表示
flox activate                   # 環境に入る
flox activate -- <cmd>          # サブシェルなしで環境内でコマンドを実行
flox edit                       # マニフェストをインタラクティブに編集
```

## マニフェスト構造

```toml
# .flox/env/manifest.toml

[install]
# インストールするパッケージ — 環境の核心
ripgrep.pkg-path = "ripgrep"
jq.pkg-path = "jq"

[vars]
# 静的な環境変数
DATABASE_URL = "postgres://localhost:5432/myapp"

[hook]
# 非インタラクティブなセットアップスクリプト（すべてのアクティベーション時に実行）
on-activate = """
  echo "Environment ready"
"""

[profile]
# シェル関数とエイリアス（インタラクティブシェルで利用可能）
common = """
  alias dev="npm run dev"
"""

[options]
# サポートされているプラットフォーム
systems = ["x86_64-linux", "aarch64-linux", "x86_64-darwin", "aarch64-darwin"]
```

## パッケージインストールパターン

### 基本インストール

```toml
[install]
nodejs.pkg-path = "nodejs"
python.pkg-path = "python311"
rustup.pkg-path = "rustup"
```

### バージョン固定

```toml
[install]
nodejs.pkg-path = "nodejs"
nodejs.version = "^20.0"          # semverレンジ: 最新の20.x

postgres.pkg-path = "postgresql"
postgres.version = "16.2"         # 正確なバージョン
```

### プラットフォーム固有のパッケージ

```toml
[install]
# Linuxのみのツール
valgrind.pkg-path = "valgrind"
valgrind.systems = ["x86_64-linux", "aarch64-linux"]

# macOSフレームワーク
Security.pkg-path = "darwin.apple_sdk.frameworks.Security"
Security.systems = ["x86_64-darwin", "aarch64-darwin"]

# macOSでのGNUツール（BSDのデフォルトが異なる場合）
coreutils.pkg-path = "coreutils"
coreutils.systems = ["x86_64-darwin", "aarch64-darwin"]
```

### パッケージ競合の解消

2つのパッケージが同じバイナリをインストールする場合、`priority`を使用します（数値が低い方が優先）:

```toml
[install]
gcc.pkg-path = "gcc12"
gcc.priority = 3

clang.pkg-path = "clang_18"
clang.priority = 5               # gccがファイル競合を勝つ
```

一緒にバージョンを解決する必要があるパッケージをグループ化するには`pkg-group`を使用します:

```toml
[install]
python.pkg-path = "python311"
python.pkg-group = "python-stack"

pip.pkg-path = "python311Packages.pip"
pip.pkg-group = "python-stack"    # pythonと一緒に解決
```

## 言語固有のレシピ

### uvを使ったPython

```toml
[install]
python.pkg-path = "python311"
uv.pkg-path = "uv"

[vars]
UV_CACHE_DIR = "$FLOX_ENV_CACHE/uv-cache"
PIP_CACHE_DIR = "$FLOX_ENV_CACHE/pip-cache"

[hook]
on-activate = """
  venv="$FLOX_ENV_CACHE/venv"
  if [ ! -d "$venv" ]; then
    uv venv "$venv" --python python3
  fi
  if [ -f "$venv/bin/activate" ]; then
    source "$venv/bin/activate"
  fi

  if [ -f requirements.txt ] && [ ! -f "$FLOX_ENV_CACHE/.deps_installed" ]; then
    uv pip install --python "$venv/bin/python" -r requirements.txt --quiet
    touch "$FLOX_ENV_CACHE/.deps_installed"
  fi
"""
```

### Node.js

```toml
[install]
nodejs.pkg-path = "nodejs"
nodejs.version = "^20.0"

[hook]
on-activate = """
  if [ -f package.json ] && [ ! -d node_modules ]; then
    npm install --silent
  fi
"""
```

### Rust

```toml
[install]
rustup.pkg-path = "rustup"
pkg-config.pkg-path = "pkg-config"
openssl.pkg-path = "openssl"

[vars]
RUSTUP_HOME = "$FLOX_ENV_CACHE/rustup"
CARGO_HOME = "$FLOX_ENV_CACHE/cargo"

[profile]
common = """
  export PATH="$CARGO_HOME/bin:$PATH"
"""
```

### Go

```toml
[install]
go.pkg-path = "go"
gopls.pkg-path = "gopls"
delve.pkg-path = "delve"

[vars]
GOPATH = "$FLOX_ENV_CACHE/go"
GOBIN = "$FLOX_ENV_CACHE/go/bin"

[profile]
common = """
  export PATH="$GOBIN:$PATH"
"""
```

### C/C++

```toml
[install]
gcc.pkg-path = "gcc13"
gcc.pkg-group = "compilers"

# 重要: gcc単体ではlibstdc++ヘッダーを公開しません — gcc-unwrappedが必要
gcc-unwrapped.pkg-path = "gcc-unwrapped"
gcc-unwrapped.pkg-group = "libraries"

cmake.pkg-path = "cmake"
cmake.pkg-group = "build"

gnumake.pkg-path = "gnumake"
gnumake.pkg-group = "build"

gdb.pkg-path = "gdb"
gdb.systems = ["x86_64-linux", "aarch64-linux"]
```

## フックとプロファイル

### フック — 非インタラクティブなセットアップ

フックはすべてのアクティベーション時に実行されます。速くべきで冪等性を保ちます。原則として: **自動的に実行すべきものは`[hook]`に; ユーザーが入力できるべきものは`[profile]`に。**

```toml
[hook]
on-activate = """
  setup_database() {
    if [ ! -d "$FLOX_ENV_CACHE/pgdata" ]; then
      initdb -D "$FLOX_ENV_CACHE/pgdata" --no-locale --encoding=UTF8
    fi
  }
  setup_database
"""
```

### プロファイル — インタラクティブシェル設定

プロファイルコードはユーザーのシェルセッションで利用可能です。

```toml
[profile]
common = """
  dev() { npm run dev; }
  test() { npm run test -- "$@"; }
"""
```

## アンチパターン

### 絶対パス

```toml
# 悪い例 — 他のマシンで壊れる
[vars]
PROJECT_DIR = "/home/alice/projects/myapp"

# 良い例 — Flox環境変数を使用
[vars]
PROJECT_DIR = "$FLOX_ENV_PROJECT"
```

### フック内でのexitの使用

```toml
# 悪い例 — シェルを終了させる
[hook]
on-activate = """
  if [ ! -f config.json ]; then
    echo "Missing config"
    exit 1
  fi
"""

# 良い例 — exitではなくreturnを使用
[hook]
on-activate = """
  if [ ! -f config.json ]; then
    echo "Missing config — run setup first"
    return 1
  fi
"""
```

### マニフェストへのシークレットの保存

```toml
# 悪い例 — マニフェストはgitにコミットされる
[vars]
API_KEY = "<set-at-runtime>"

# 良い例 — 外部設定を参照するか、ランタイムで渡す
# 使用方法: API_KEY="<your-api-key>" flox activate
[vars]
API_KEY = "${API_KEY:-}"
```

### 冪等性ガードなしの遅いフック

```toml
# 悪い例 — すべてのアクティベーション時に再インストールする
[hook]
on-activate = """
  pip install -r requirements.txt
"""

# 良い例 — すでにインストール済みの場合はスキップ
[hook]
on-activate = """
  if [ ! -f "$FLOX_ENV_CACHE/.deps_installed" ]; then
    uv pip install -r requirements.txt --quiet
    touch "$FLOX_ENV_CACHE/.deps_installed"
  fi
"""
```

### フックへのユーザーコマンドの配置

```toml
# 悪い例 — フック関数はインタラクティブシェルで利用できない
[hook]
on-activate = """
  deploy() { kubectl apply -f k8s/; }
"""

# 良い例 — ユーザーが呼び出せる関数には[profile]を使用
[profile]
common = """
  deploy() { kubectl apply -f k8s/; }
"""
```

## フルスタックの例

PostgreSQLを使用したPython APIの完全な環境:

```toml
[install]
python.pkg-path = "python311"
uv.pkg-path = "uv"
postgresql.pkg-path = "postgresql_16"
redis.pkg-path = "redis"
jq.pkg-path = "jq"
curl.pkg-path = "curl"

[vars]
UV_CACHE_DIR = "$FLOX_ENV_CACHE/uv-cache"
DATABASE_URL = "postgres://localhost:5432/myapp"
REDIS_URL = "redis://localhost:6379"

[hook]
on-activate = """
  if [ ! -d "$FLOX_ENV_CACHE/pgdata" ]; then
    initdb -D "$FLOX_ENV_CACHE/pgdata" --no-locale --encoding=UTF8
  fi

  venv="$FLOX_ENV_CACHE/venv"
  if [ ! -d "$venv" ]; then
    uv venv "$venv" --python python3
  fi
  if [ -f "$venv/bin/activate" ]; then
    source "$venv/bin/activate"
  fi

  if [ -f requirements.txt ] && [ ! -f "$FLOX_ENV_CACHE/.deps_installed" ]; then
    uv pip install --python "$venv/bin/python" -r requirements.txt --quiet
    touch "$FLOX_ENV_CACHE/.deps_installed"
  fi
"""

[profile]
common = """
  serve() { uvicorn app.main:app --reload --host 0.0.0.0 --port 8000; }
  migrate() { alembic upgrade head; }
"""

[services]
postgres.command = "postgres -D $FLOX_ENV_CACHE/pgdata -k $FLOX_ENV_CACHE"
redis.command = "redis-server --port 6379 --daemonize no"

[options]
systems = ["x86_64-linux", "aarch64-linux", "x86_64-darwin", "aarch64-darwin"]
```

サービス付きでアクティベート: `flox activate --start-services`

## 環境の共有

Flox環境はgitネイティブです。`.flox/`ディレクトリをコミットすれば、すべての共同作業者が同じ環境を取得できます:

```bash
git add .flox/
git commit -m "Add Flox environment"
# チームメイトは以下を実行するだけ:
git clone <repo> && cd <repo> && flox activate
```

プロジェクト間で再利用可能なベース環境には、FloxHubにプッシュします:

```bash
flox push                         # FloxHubに環境をプッシュ
flox activate -r owner/env-name   # どこでもリモート環境をアクティベート
```

`[include]`で環境を合成します:

```toml
[include]
base.floxhub = "myorg/python-base"

[install]
# ベースの上にプロジェクト固有の追加
fastapi.pkg-path = "python311Packages.fastapi"
```

## AI支援とバイブコーディング

FloxはAI支援開発とバイブコーディングワークフローに理想的です。AIエージェントが現在の環境で利用できないツール（コンパイラー、データベース、リンター、CLIユーティリティ）を必要とする場合、sudoアクセス不要、システムパッケージの汚染なし、サンドボックス制限なしにプロジェクトのFloxマニフェストに追加できます。

**エージェントにとってこれが重要な理由:**
- **sudo不要** — `flox install`は完全にユーザースペースで動作するため、エージェントは昇格した権限なしにパッケージを追加できる
- **プロジェクトスコープ** — パッケージはグローバルにではなく、プロジェクト環境にのみインストールされるため、異なるプロジェクトが競合なく異なるバージョンを持てる
- **サンドボックスフレンドリー** — サンドボックスまたは制限された環境で実行されるエージェントも、Floxを通じて必要なツールをインストールできる
- **元に戻せる** — すべての変更は`manifest.toml`に記録されるため、不要なパッケージはシステム残留なしにクリーンに削除できる
- **再現可能** — エージェントが環境をセットアップすると、その正確なセットアップがgitにコミットされ、誰でも使用できる

**エージェントのワークフローパターン:**

```bash
# エージェントがツールが必要だと発見する（例: JSON処理のためのjq）
flox search jq                    # パッケージが存在することを確認
flox install jq                   # プロジェクト環境にインストール

# またはより詳細な制御のために、マニフェストを直接編集する
tmp_manifest="$(mktemp)"
flox list -c > "$tmp_manifest"
# [install]セクションにパッケージを追加し、適用する
flox edit -f "$tmp_manifest"

# ツールを利用可能にしてコマンドを実行
flox activate -- jq '.results[]' data.json
```

これにより、FloxはClaude Codeや他のAIエージェントがプロジェクトツールをその場でブートストラップする必要があるワークフローに自然に適合します。

## デバッグ

```bash
flox list -c                      # 生のマニフェストを表示
flox activate -- which python     # どのバイナリが解決されるか確認
flox activate -- env | grep FLOX  # Flox環境変数を確認
flox search <package> --all       # より広いパッケージ検索（大文字小文字を区別）
```

**一般的な問題:**
- **パッケージが見つからない:** 検索は大文字小文字を区別します — `flox search --all`を試してください
- **パッケージ間のファイル競合:** 優先されるべきパッケージに`priority`を追加する
- **フックの失敗:** `exit`ではなく`return`を使用; `${FLOX_ENV_CACHE:-}`でガードする
- **古い依存関係:** `$FLOX_ENV_CACHE/.deps_installed`フラグファイルを削除する

## 関連スキル

以下のスキルは、より深い統合のために[Flox Claude Codeプラグイン](https://github.com/flox/flox-agentic)の一部として利用可能です:

- **flox-services** — サービス管理、データベースセットアップ、バックグラウンドプロセス
- **flox-builds** — Floxによる再現可能なビルドとパッケージング
- **flox-containers** — Flox環境からDocker/OCIコンテナーを作成
- **flox-sharing** — 環境の合成、リモート環境、チームパターン
- **flox-cuda** — CUDAとGPU開発環境

詳細とインストールは[flox.dev/docs](https://flox.dev/docs/install-flox/install/)で。

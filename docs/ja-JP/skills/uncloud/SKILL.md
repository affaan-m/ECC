---
name: uncloud
description: Uncloud クラスターの管理（サービスのデプロイ、Caddy イングレスの設定、クラスター外デバイス向けスタティックプロキシルートの追加、ポートの公開、スケーリング、ログの確認、`uc` CLI によるマシンとボリュームの管理）を行う場合に使用する。
origin: ECC
---

# Uncloud クラスター管理

`uc` CLI のリファレンス — Docker コンテナ、WireGuard メッシュネットワーク、Caddy リバースプロキシを使用した分散型セルフホスティングプラットフォーム。

## 有効化するタイミング

Uncloud クラスターを扱う場合、特に以下の作業を行う際に使用する:
- `uc machine` でマシンのブートストラップやクラスターへの参加を行う
- `uc deploy` で Compose ファイルからサービスをデプロイする
- Uncloud で HTTP、HTTPS、TCP、UDP のポートを公開する
- `x-caddy`、`x-ports`、または `--caddyfile` で Caddy イングレスを設定する
- クラスタープロキシを通じて外部 LAN デバイスのルーティングを行う
- ログ、サービス状態、ボリューム、DNS、マシンの配置を確認する

## 仕組み

Uncloud は WireGuard メッシュで接続されたピアマシン全体で Docker サービスを実行する。各マシンはクラスターの対等なメンバーであり、サービスはオーバーレイネットワーク上で通信し、Caddy がグローバルに動作して公開 HTTP/HTTPS トラフィックを終端する。Compose ファイルはイングレス、配置、生成された Caddy 設定のための Uncloud 拡張を使用でき、`uc` CLI がイメージ配布、スケジューリング、スケーリング、ログ、クラスター状態を管理する。

## 使用例

```bash
uc machine init user@host --name machine-1
uc service run --name web -p app.example.com:8080/https nginx:latest
uc deploy
```

## コアコンセプト

- **中央コントロールプレーンなし** — すべてのマシンは WireGuard で接続された対等なピア
- **Caddy** はすべてのマシンでグローバルサービスとして実行し、Let's Encrypt から TLS を自動取得する
- **オーバーレイネットワーク** — サービスはデフォルトで `10.210.0.0/16` を通じて通信し、メッシュ内部で DNS が提供される
- **Caddyfile は自動生成される** — 直接編集しない; 代わりに `x-caddy` / `--caddyfile` を使用する

---

## CLI クイックリファレンス

### マシン

| コマンド | 目的 |
|---------|---------|
| `uc machine init user@host` | 最初のマシン / 新しいクラスターをブートストラップする |
| `uc machine add user@host` | 既存のクラスターにマシンを追加する |
| `uc machine ls` | マシンの一覧を表示する |
| `uc machine update NAME --public-ip IP` | イングレス用のパブリック IP を更新する |
| `uc machine rm NAME` | マシンを削除する |

主な `init` フラグ: `--name`、`--network 10.210.0.0/16`、`--no-caddy`、`--no-dns`、`--public-ip auto\|IP\|none`

### サービス

| コマンド | 目的 |
|---------|---------|
| `uc service ls` / `uc ls` | サービスの一覧を表示する |
| `uc service run IMAGE` | 単一コンテナサービスを実行する |
| `uc deploy` | `compose.yaml` からデプロイする |
| `uc deploy --no-build` | 再ビルドせずに既にプッシュされたイメージをデプロイする |
| `uc deploy --recreate` | サービスを強制再作成する |
| `uc scale SERVICE N` | レプリカ数を設定する |
| `uc service logs SERVICE` | ログを表示する |
| `uc service exec SERVICE` | コンテナにシェルで入る |
| `uc service inspect SERVICE` | 詳細情報を表示する |
| `uc service rm SERVICE` | サービスを削除する（名前付きボリュームは保持） |
| `uc ps` | クラスター全体のすべてのコンテナを表示する |

### イメージ

```bash
uc image push myapp:latest                    # ローカルイメージをすべてのマシンにプッシュする
uc image push myapp:latest -m machine1,machine2  # 特定のマシンにプッシュする
uc images                                     # クラスター内のイメージ一覧を表示する
```

### ボリューム

```bash
uc volume ls                  # すべてのボリューム
uc volume ls -m machine1      # 特定のマシン上のボリューム
uc volume create NAME -m MACHINE
uc volume rm NAME
```

### Caddy

```bash
uc caddy config    # 現在生成されている Caddyfile を表示する（読み取り専用）
uc caddy deploy    # クラスター全体に Caddy をデプロイ/アップグレードする
```

### DNS とコンテキスト

```bash
uc dns show        # 予約済みの *.uncld.dev ドメインを表示する
uc dns reserve     # 新しいドメインを予約する
uc ctx ls          # クラスターコンテキストの一覧を表示する
uc ctx use prod    # コンテキストを切り替える
```

---

## ポート公開

### HTTP/HTTPS（Caddy リバースプロキシ経由）

```
-p [hostname:]container_port[/protocol]
```

| 例 | 意味 |
|---------|---------|
| `-p 8080/https` | 自動 `service-name.cluster-domain` ホスト名で HTTPS |
| `-p app.example.com:8080/https` | カスタムホスト名で HTTPS |
| `-p 8080/http` | TLS なしの HTTP のみ |

### TCP/UDP（ホストバインド、Caddy をバイパス）

```
-p [host_ip:]host_port:container_port[/protocol]@host
```

| 例 | 意味 |
|---------|---------|
| `-p 5432:5432@host` | すべてのインターフェースで TCP 5432 |
| `-p 127.0.0.1:5432:5432@host` | ループバックのみで TCP 5432 |
| `-p 53:5353/udp@host` | UDP |

---

## Compose ファイル拡張

Uncloud は Docker Compose の上に以下の拡張を追加する:

### `x-ports` — ドメイン付きでポートを公開する

```yaml
services:
  app:
    image: app:latest
    x-ports:
      - example.com:8000/https
      - www.example.com:8000/https
      - api.example.com:9000/https
```

### `x-caddy` — サービス用のカスタム Caddy 設定

```yaml
services:
  app:
    image: app:latest
    x-caddy: |
      example.com {
        redir https://www.example.com{uri} permanent
      }
      www.example.com {
        reverse_proxy {{upstreams 8000}} {
          import common_proxy
        }
        basic_auth /admin/* {
          admin $2a$14$...
        }
      }
```

`x-caddy` 内で使用可能なテンプレート関数:
- `{{upstreams [service] [port]}}` — 正常なコンテナ IP
- `{{.Name}}` — サービス名
- `{{.Upstreams}}` — すべてのサービスから IP へのマップ

### `x-machines` — 配置制約

```yaml
services:
  db:
    image: postgres:18
    x-machines: db-machine          # 単一マシン名
  app:
    image: app:latest
    x-machines:
      - machine-1
      - machine-2
```

### マルチサービスの完全な例

```yaml
services:
  api:
    build: ./api
    x-ports:
      - api.example.com:3000/https
    environment:
      DATABASE_URL: postgres://db:5432/mydb

  web:
    build: ./web
    x-ports:
      - example.com:8000/https
      - www.example.com:8000/https
    environment:
      API_URL: http://api:3000

  db:
    image: postgres:18
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - db-data:/var/lib/postgresql/data
    x-machines: db-machine

volumes:
  db-data:
```

---

## 外部（クラスター外）デバイスへのルーティング

実際のコンテナを実行せずに外部デバイス（BMC、NAS、ルーター UI など）を Caddy 経由で公開するには:

**1. Caddyfile スニペットを作成する**（例: `~/device.caddyfile`）:

```caddyfile
https://device.example.com {
    reverse_proxy https://192.168.1.x {
        transport http {
            tls_insecure_skip_verify   # 自己署名 BMC 証明書に必要
        }
    }
    log
}
```

プレーンテキストのアップストリームの場合: `reverse_proxy http://192.168.1.x:port`

**2. no-op コンテナで名前付きサービスとして登録する:**

```bash
uc service run \
  --name device-bmc \
  --caddyfile ~/device.caddyfile \
  registry.k8s.io/pause:3.9
```

`pause` は最小限の no-op コンテナ — 何もしないが、Uncloud が Caddyfile をアタッチするためのサービスエントリを提供する。

**3. 確認する:**

```bash
uc caddy config   # device.example.com ブロックが表示されるはず
```

> `--caddyfile` は `@host` 以外のポート公開と組み合わせることができない。

**DNS のヒント:** ワイルドカードレコード（`*.yourdomain.com → cluster-public-ip`）を設定すると、新しいサブドメインを追加するたびに DNS 変更が不要になる。

---

## サービス DNS（内部）

クラスター内のサービスは名前で互いを解決できる:

| DNS 名 | 解決先 |
|----------|------------|
| `service-name` | 正常なコンテナのいずれか |
| `service-name.internal` | 同上 |
| `rr.service-name.internal` | ラウンドロビン |
| `nearest.service-name.internal` | マシンローカルを優先 |

---

## スケーリングとグローバルサービス

```bash
uc scale web 5    # 5 レプリカ（マシン全体に分散）
uc scale web 1    # スケールダウン
```

```yaml
services:
  caddy:
    deploy:
      mode: global   # すべてのマシンで 1 コンテナ
```

---

## イメージタグテンプレート（compose.yaml 内）

```yaml
image: myapp:{{gitdate "20060102"}}.{{gitsha 7}}
image: myapp:{{gitsha 7}}.${GITHUB_RUN_ID:-local}
```

| 関数 | 出力 |
|----------|--------|
| `{{gitsha N}}` | コミット SHA の先頭 N 文字 |
| `{{gitdate "format"}}` | Go フォーマットでのコミット日時 |
| `{{date "format"}}` | 現在の日時 |

---

## よくあるワークフロー

**ソースからデプロイする:**
```bash
uc deploy                          # ビルド + プッシュ + デプロイ
uc build --push && uc deploy --no-build   # 分離したステップ
```

**サービスを調査する:**
```bash
uc inspect web
uc logs -f web
uc logs --since 1h web
uc exec web                        # シェルを開く
uc exec web /bin/sh -c "env"       # 特定のコマンドを実行する
```

**ゼロダウンタイムデプロイ**は自動的に行われる; Uncloud は古いコンテナを終了する前にヘルスチェックが完了するのを待つ。

**強制再作成:**
```bash
uc deploy --recreate
```

---

## よくあるミス

| ミス | 対処法 |
|---------|-----|
| Caddyfile を直接編集する | compose の `x-caddy` または `uc service run` の `--caddyfile` を使用する |
| 自己署名証明書を持つ HTTPS アップストリームをプロキシする | `transport http { tls_insecure_skip_verify }` を追加する |
| `uc caddy config` にユーザー定義ブロックが表示されない | Caddy 管理ソケットに接続できない — `uc inspect caddy` と `uc logs caddy` を確認する |
| コンテナから外部 LAN IP に到達できない | Caddy コンテナのホストがターゲットネットワークにルーティングできるか確認する |
| `uc service rm` 後にボリュームが失われる | 名前付きボリュームは保持される; 匿名ボリュームのみが自動削除される |

# PRIME 事務所ボード

スタッフ用の共有ウェブアプリ（Claude Artifact）のソース。事務所の開閉と在席、今日の動き、
月間シフト、タスクの受け渡し、支払い、媒体アカウントを 1 画面で共有する。

## 構成

`index.html` は単一ファイル。`<!doctype html>` / `<head>` / `<body>` は Artifact 側で付与されるため、
このファイルにはページ本体（`<title>` / `<link>` / `<style>` / マークアップ / `<script>`）だけを書く。

外部リソースは Google Fonts のみ。ライブラリ依存はなし。

## 公開・更新

Artifact ツールで `capabilities: {"db": {}}` を指定して公開する。同じ URL を更新するときは
`url` に既存の Artifact URL を渡す。

## データモデル（`db` capability）

| パス | 内容 |
|------|------|
| `office/state` | `doorOpen` / `updatedBy` / `updatedAt` |
| `members/<id>` | `name` / `color` / `present` / `presentAt` / `createdAt` |
| `sched/<memberId>__<YYYY-MM>` | `month` と `days` マップ（`kind` / `plan` / `ngFrom` / `ngTo` / `note`） |
| `tasks/<id>` | `title` / `detail` / `assignee`（空文字＝募集中）/ `status` / `due` ほか |
| `payments/<id>` | `title` / `payee` / `amount` / `due` / `method` / `status` / `paidAt` ほか |
| `vault/<id>` | `media` / `url` / `note` と、ID・パスワードの暗号文 `enc` |
| `vault_meta/config` | PBKDF2 の `salt` と合言葉の検証用 `verify` |

シフトは 1 メンバー 1 か月を 1 ドキュメントにまとめている。1 日 1 ドキュメントにすると
Artifact あたり 5,000 ドキュメントの上限に早く到達するため。

## 媒体アカウントの暗号化

ID とパスワードは共有ストアに平文で置かない。チームの合言葉から PBKDF2（SHA-256・25 万回）で
鍵を導出し、AES-GCM で暗号化した結果だけを保存する。合言葉はどこにも保存されず、
ブラウザのメモリ上にのみ置かれる。

媒体名・URL・メモは暗号化されない。合言葉を失うと復号できない。

## 本人の識別

`user` capability を使わず、初回に自分の名前を選び `localStorage`（`prime.me`）に保存する。
端末を変えると選び直しになる。

## ローカルでの見た目確認

`window.claude` はローカルには存在しないため、`claude.use()` は `null` を返し
「共有データに接続できていません」の帯が出る。レイアウト確認だけならこの状態で十分。
挙動まで見るときは、`window.claude.use("db")` を返すインメモリのスタブを
先に読み込む HTML を組み立てて開く。

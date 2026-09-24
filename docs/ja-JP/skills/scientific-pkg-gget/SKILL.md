---
name: gget
description: ゲノムデータベースへのクイック検索、配列検索、BLAST スタイルの検索、エンリッチメントチェック、および再現可能なバイオインフォマティクス証拠ログのための gget CLI および Python ワークフロー。
origin: community
---

# gget

`gget` CLI または Python パッケージを使用してゲノム参照データベースにわたるクイックバイオインフォマティクス検索が必要なタスクにこのスキルを使用します。

## 使用するタイミング

- Ensembl ID、遺伝子メタデータ、転写産物の詳細、または配列の検索。
- フルローカルパイプラインを構築せずにクイックな BLAST または BLAT 検索を実行。
- Ensembl から参照ゲノムリンクとアノテーションを取得。
- 単一のインターフェースを通してタンパク質構造、パスウェイ、がん、発現、または疾患関連モジュールを照会。
- Biopython、Snakemake、Nextflow、BLAST+、またはデータベース固有のクライアントなどの重いツールに移行する前に再現可能な最初の証拠ログを作成。

タスクが規制対象の臨床解釈、高スループット本番パイプライン、またはデータベースバージョンとローカルインデックスの細かい制御を必要とする場合は、`gget` の代わりに専用のワークフローを使用します。

## インストール

クリーンな Python 環境を使用します。

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --upgrade gget
gget --help
```

`uv` が利用可能な場合:

```bash
uv venv
. .venv/bin/activate
uv pip install gget
```

古い環境を使用する前に、`gget` をアップグレードしてモジュールドキュメントを再確認します。`gget` が照会するアップストリームデータベースは時間とともに変化します。

## 基本パターン

CLI の形式:

```bash
gget <module> [arguments] [options]
```

Python の形式:

```python
import gget

result = gget.search(["BRCA1"], species="human")
print(result)
```

一般的なワークフロー:

1. 必要な種、アセンブリ、遺伝子 ID タイプ、データベースを特定する。
2. 引数に関する現在のモジュールドキュメントを確認する。
3. まず小さなクエリを実行する。
4. 明示的なファイル名と日付で出力を保存する。
5. モジュール名、バージョン、引数、データベースの前提条件を記録する。

## 主要なモジュール

正確な引数については現在のアップストリームドキュメントを使用してください。これらのモジュールは一般的な最初の選択肢です:

- `gget search`: 検索語から Ensembl ID を検索。
- `gget info`: Ensembl、UniProt、または関連 ID のメタデータを取得。
- `gget seq`: ヌクレオチドまたはアミノ酸配列を取得。
- `gget ref`: 参照ゲノムのダウンロードリンクを取得。
- `gget blast`: クイック BLAST クエリを実行。
- `gget blat`: サポートされているゲノムアセンブリに対して配列を配置。
- `gget muscle`: 多重配列アライメントを実行。
- `gget diamond`: 参照配列に対してローカル配列アライメントを実行。
- `gget alphafold` と `gget pdb`: タンパク質構造参照を調べる。
- `gget enrichr`、`gget opentargets`、`gget archs4`、`gget bgee`、`gget cbio`、`gget cosmic`: エンリッチメント、ターゲット、発現、がん、疾患関連データを探索。

すべてのモジュールがすべての Python バージョンまたは依存関係セットをサポートするとは限りません。一部のオプションの科学的依存関係は、コアパッケージよりも狭いバージョンサポートを持ちます。

## クイック例

遺伝子を検索:

```bash
gget search -s human brca1 dna repair -o brca1-search.json
```

遺伝子メタデータを取得:

```bash
gget info ENSG00000012048 -o brca1-info.json
```

配列を取得:

```bash
gget seq ENSG00000012048 -o brca1-seq.fa
```

小さな BLAST クエリを実行:

```bash
gget blast "MEEPQSDPSVEPPLSQETFSDLWKLLPEN" -l 10 -o blast-results.json
```

Python の例:

```python
import gget

genes = gget.search(["BRCA1", "DNA repair"], species="human")
info = gget.info(["ENSG00000012048"])
sequence = gget.seq("ENSG00000012048")
```

## 再現性ログ

科学的な出力については、クエリを再現するのに十分なメタデータを含めます。

```markdown
| 日付 | gget バージョン | モジュール | クエリ | 種/アセンブリ | 出力 | 注記 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-11 | `gget --version` | search | `BRCA1 DNA repair` | human | `brca1-search.json` | 実行前にドキュメントを確認 |
```

以下も記録します:

- Python バージョンと環境マネージャー。
- `gget setup` を通してインストールされたオプションの依存関係。
- クエリによって返されたデータベース固有の識別子。
- 出力が JSON、CSV、FASTA、または DataFrame エクスポートのいずれであるか。
- `gget` のアップグレードで解決された障害。

## レビューチェックリスト

- インストールされた `gget` バージョンをアップグレードまたは確認したか？
- 引数を使用する前に現在のアップストリームモジュールドキュメントを確認したか？
- 種またはアセンブリは明示的か？
- Ensembl/UniProt プレフィックスを含む識別子は正確に保存されているか？
- 結果は臨床解釈ではなくデータベース出力としてラベル付けされているか？
- 保存されたコマンドまたは Python スニペットからクエリを再現できるか？
- オプションの依存関係は隔離された環境にインストールされているか？

## 参考文献

- [gget ドキュメント](https://pachterlab.github.io/gget/)
- [gget アップデート](https://pachterlab.github.io/gget/en/updates.html)
- [gget GitHub リポジトリ](https://github.com/pachterlab/gget)
- [gget Bioinformatics 論文](https://doi.org/10.1093/bioinformatics/btac836)

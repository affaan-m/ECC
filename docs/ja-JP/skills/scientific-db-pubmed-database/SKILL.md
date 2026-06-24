---
name: pubmed-database
description: 生物医学文献、MeSH クエリ、PMID 検索、引用取得、および API を利用した文献モニタリングのための PubMed および NCBI E-utilities の直接検索ワークフロー。
origin: community
---

# PubMed Database

一般的なウェブ検索ではなく PubMed から生物医学文献が必要なタスクにこのスキルを使用します。

## 使用するタイミング

- MEDLINE または生命科学文献の検索。
- MeSH 用語、フィールドタグ、日付、または文献種別を使った PubMed クエリの構築。
- PMID、アブストラクト、出版メタデータ、または関連引用の検索。
- 再現可能な検索文字列が必要なシステマティックレビューの検索パスの実行。
- Python、シェル、または別の HTTP クライアントから直接 NCBI E-utilities を使用。

## クエリの構築

研究質問から始め、概念に分割し、ブール演算子で概念を組み合わせます。

```text
concept_1 AND concept_2 AND filter
synonym_a OR synonym_b
NOT exclusion_term
```

有用な PubMed フィールドタグ:

- `[ti]`: タイトル
- `[ab]`: アブストラクト
- `[tiab]`: タイトルまたはアブストラクト
- `[au]`: 著者
- `[ta]`: 雑誌タイトル略語
- `[mh]`: MeSH 用語
- `[majr]`: 主要 MeSH トピック
- `[pt]`: 出版種別
- `[dp]`: 出版日
- `[la]`: 言語

例:

```text
diabetes mellitus[mh] AND treatment[tiab] AND systematic review[pt] AND 2023:2026[dp]
(metformin[nm] OR insulin[nm]) AND diabetes mellitus, type 2[mh] AND randomized controlled trial[pt]
smith ja[au] AND cancer[tiab] AND 2026[dp] AND english[la]
```

## MeSH とサブヘッディング

概念が安定した統制語彙用語を持つ場合は MeSH を優先します。トピックが新しいまたは用語が多様な場合は MeSH とタイトル/アブストラクト用語を組み合わせます。

正しいサブヘッディング構文では、サブヘッディングをフィールドタグの前に置きます:

```text
diabetes mellitus, type 2/drug therapy[mh]
cardiovascular diseases/prevention & control[mh]
```

`[majr]` は論文の中心的なトピックである必要がある場合にのみ使用します。精度は向上しますが、関連する研究を見逃す可能性があります。

## フィルター

出版種別:

- `clinical trial[pt]`
- `meta-analysis[pt]`
- `randomized controlled trial[pt]`
- `review[pt]`
- `systematic review[pt]`
- `guideline[pt]`

日付フィルター:

```text
2026[dp]
2020:2026[dp]
2026/03/15[dp]
```

利用可能性フィルター:

```text
free full text[sb]
hasabstract[text]
```

## E-utilities ワークフロー

NCBI E-utilities は再現可能な API ワークフローをサポートします:

1. `esearch.fcgi`: 検索して PMID を返す。
2. `esummary.fcgi`: 軽量な記事メタデータを返す。
3. `efetch.fcgi`: XML、MEDLINE、またはテキストでアブストラクトまたはフルレコードを取得。
4. `elink.fcgi`: 関連記事とリンクされたリソースを検索。

本番スクリプトにはメールアドレスと API キーを使用します。API キーは環境変数に保存し、コミットされたファイルやコマンド履歴には絶対に入れないでください。

```python
import os
import time
import requests

BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


def esearch(query: str, retmax: int = 20) -> list[str]:
    params = {
        "db": "pubmed",
        "term": query,
        "retmode": "json",
        "retmax": retmax,
        "tool": "ecc-pubmed-search",
        "email": os.environ.get("NCBI_EMAIL", ""),
    }
    api_key = os.environ.get("NCBI_API_KEY")
    if api_key:
        params["api_key"] = api_key

    response = requests.get(f"{BASE}/esearch.fcgi", params=params, timeout=30)
    response.raise_for_status()
    time.sleep(0.35)
    return response.json()["esearchresult"]["idlist"]


pmids = esearch("hypertension[mh] AND randomized controlled trial[pt] AND 2024:2026[dp]")
print(pmids)
```

バッチの場合、非常に長い PMID リストを URL に渡す代わりに、NCBI ヒストリーサーバーパラメーター（`usehistory=y`、`WebEnv`、`query_key`）を優先します。

## 出力の記録

各検索パスについて以下を記録します:

- 正確な検索文字列
- 検索したデータベース
- 検索日
- 使用したフィルター
- 結果件数
- エクスポート形式
- 手動除外

例:

```markdown
| データベース | 検索日 | クエリ | フィルター | 結果 |
| --- | --- | --- | --- | ---: |
| PubMed | 2026-05-11 | `sickle cell disease[mh] AND CRISPR[tiab]` | 2020:2026[dp], English | 42 |
```

## レビューチェックリスト

- フィールドタグは有効な PubMed タグか？
- 新しいトピックについて MeSH 用語は自由テキストの同義語とペアになっているか？
- 日付範囲は明示的で適切か？
- 検索ログにクエリを再現するのに十分な詳細が含まれているか？
- API キーは環境から読み込まれているか？
- HTTP コードは解析前に `raise_for_status()` を呼び出しているか、または 200 以外のレスポンスを処理しているか？
- レート制限は守られているか？

## 参考文献

- [PubMed ヘルプ](https://pubmed.ncbi.nlm.nih.gov/help/)
- [NCBI E-utilities ドキュメント](https://www.ncbi.nlm.nih.gov/books/NBK25501/)
- [NCBI API キーガイダンス](https://support.nlm.nih.gov/kbArticle/?pn=KA-05317)
- NCBI サポート: <eutilities@ncbi.nlm.nih.gov>

---
name: uspto-database
description: 公式記録の検索、PatentSearch クエリ、TSDR チェック、譲渡データ、および再現可能な IP 調査ログのための USPTO 特許・商標データワークフロー。
origin: community
---

# USPTO Database

USPTO システムから米国の公式特許・商標記録が必要なタスクにこのスキルを使用します。

## 使用するタイミング

- 付与済み特許または出願前公開の検索。
- 特許出願ステータス、ファイルラッパーデータ、譲渡、または公開の訴追履歴の確認。
- 商標ステータス、文書、または譲渡履歴の検索。
- 再現可能な先行技術、ポートフォリオ、または IP ランドスケープの調査ログの構築。
- USPTO 記録と Google Patents、Lens.org、Semantic Scholar、または企業の特許ページなどのセカンダリツールとの比較。

このスキルを法的アドバイスに使用しないでください。データ収集と記録確認のワークフローとして扱ってください。

## ソース選択

公式の USPTO またはUSPTO がサポートするサーフェスを優先します:

- Open Data Portal (ODP): USPTO の移行済みデータセットと API の現在のホーム。
- Patent File Wrapper: 公開特許出願の書誌データとファイルラッパーレコード。
- PatentSearch API: 付与済み特許と出願前公開データセット向け PatentsView 検索 API。
- TSDR Data API: 商標ステータスと文書取得。
- Patent and Trademark Assignment Search: 所有権移転記録。
- ODP の PTAB データ: 特許審判・控訴委員会の手続き。

セカンダリソースは便宜上のインデックスとしてのみ使用します。答えが重要な場合は、公式記録と照合してください。

## 認証とシークレット

多くの USPTO API フローには API キーが必要です。キーは環境変数またはシークレットマネージャーに保存し、コミットされたファイルや貼り付けられたトランスクリプトには絶対に入れないでください。

一般的な環境変数名:

```bash
export USPTO_API_KEY="..."
export PATENTSVIEW_API_KEY="..."
```

PatentSearch では `X-Api-Key` ヘッダーでキーを送信します。TSDR については、現在の USPTO API マネージャーの指示とレート制限ガイダンスに従ってください。

## PatentSearch ワークフロー

質問がトレンド、発明者、譲受人、分類、日付、またはポートフォリオのスライスに関するものである場合、特許と出願前公開の広い検索に PatentSearch を使用します。

ワークフロー:

1. 現在の PatentSearch リファレンスまたは Swagger UI からエンドポイントを特定する。
2. 明示的なフィルターを持つ JSON クエリを構築する。
3. 分析に必要なフィールドのみをリクエストする。
4. 確定的にソートしてページネーションする。
5. エンドポイント、クエリ本体、日付、データの通貨に関する注記、結果件数を記録する。

Python リクエストのスケルトン:

```python
import os
import requests

API_KEY = os.environ["PATENTSVIEW_API_KEY"]
BASE = "https://search.patentsview.org/api/v1"

payload = {
    "q": {
        "_and": [
            {"patent_date": {"_gte": "2024-01-01"}},
            {"assignees.assignee_organization": {"_text_any": ["Google", "Alphabet"]}},
        ]
    },
    "f": ["patent_id", "patent_title", "patent_date"],
    "s": [{"patent_date": "desc"}],
    "o": {"per_page": 100, "page": 1},
}

response = requests.post(
    f"{BASE}/patent/",
    headers={"X-Api-Key": API_KEY, "Content-Type": "application/json"},
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

クエリを再利用する前に、ライブの PatentSearch ドキュメントで現在のエンドポイント名、フィールドパス、リクエストパラメーター、API キーの利用可能性を確認してください。

## 商標/TSDR ワークフロー

タスクが商標のケースステータス、文書、画像、所有者履歴、または訴追イベントを必要とする場合は TSDR を使用します。

ワークフロー:

1. シリアル番号または登録番号を正規化する。
2. 現在の TSDR API の指示と必要な API キーヘッダーを確認する。
3. まずステータスを取得し、必要な場合にのみ文書を取得する。
4. PDF、ZIP、および複数ケースのダウンロードに対するより低いレート制限を守る。
5. 出力にデータ取得日とシリアル/登録識別子を記録する。

大規模な商標取得の場合は、公開ページのスクレイピングではなく、文書化されたバルクデータフローを優先します。

## ファイルラッパーと訴追履歴

出願ステータス、取引履歴、および訴追文書については:

- ODP Patent File Wrapper 検索から始める。
- 利用可能な場合は正確な識別子を使用: 出願番号、公開番号、特許番号、または当事者名。
- 記録が付与済み特許、出願前公開、または係属中の出願のいずれであるかを記録する。
- 文書の日付とステータスを引用する前に記録詳細ページと照合する。

## 譲渡ワークフロー

特許または商標の所有権については:

1. 特許/出願/登録番号、譲渡人、譲受人、または利用可能な場合はリール/フレームで公式の譲渡データを検索する。
2. 譲渡文、実行日、記録日、当事者を記録する。
3. 譲渡記録と現在の法的所有権の結論を区別する。
4. 所有権が重要な場合は、弁護士または専門家によるレビューのために結果にフラグを立てる。

## 再現可能な出力

すべての USPTO 調査パスにはログテーブルを含める必要があります:

```markdown
| ソース | 検索日 | 識別子/クエリ | フィルター | 結果 | 注記 |
| --- | --- | --- | --- | ---: | --- |
| PatentSearch | 2026-05-11 | `assignee=Alphabet AND date>=2024` | patent endpoint | 118 | 実行前に API ドキュメントを確認 |
| TSDR | 2026-05-11 | `serial=90000000` | status only | 1 | API キーフロー、バルク文書取得なし |
```

最終的な書き込み物では、以下を分離します:

- 公式記録の事実
- 推論された分析
- セカンダリソースの便宜上のマッチ
- 未解決のギャップまたは法的レビューが必要な記録

## レビューチェックリスト

- 公式の USPTO またはUSPTO がサポートするソースを最初に使用したか？
- コードを実行する前に現在のエンドポイントとフィールド名を確認したか？
- API キーはファイル、シェル履歴、出力ログから除外されているか？
- クエリログには検索日と正確なリクエスト形式が含まれているか？
- レート制限は守られているか？
- 法的結論は回避されているか、または明示的にエスカレートされているか？
- セカンダリソースはセカンダリとして明示的にラベル付けされているか？

## 参考文献

- [USPTO APIs カタログ](https://developer.uspto.gov/api-catalog)
- [USPTO Open Data Portal](https://data.uspto.gov/)
- [PatentSearch API リファレンス](https://search.patentsview.org/docs/docs/Search%20API/SearchAPIReference/)
- [PatentSearch API アップデート](https://search.patentsview.org/docs/)
- [TSDR API バルクダウンロード FAQ](https://developer.uspto.gov/faq/tsdr-api-bulk-download)

---
name: nutrient-document-processing
description: Nutrient DWS API を使用してドキュメントの処理、変換、OCR、抽出、編集、署名、フォーム入力を行います。PDF、DOCX、XLSX、PPTX、HTML、画像に対応しています。
---

# Nutrient Document Processing

[Nutrient DWS Processor API](https://www.nutrient.io/api/) でドキュメントを処理します。フォーマット変換、テキストとテーブルの抽出、スキャンされたドキュメントの OCR、PII の編集、ウォーターマークの追加、デジタル署名、PDF フォームの入力が可能です。

## セットアップ

**[nutrient.io](https://dashboard.nutrient.io/sign_up/?product=processor)** で無料の API キーを取得してください

```bash
export NUTRIENT_API_KEY="pdf_live_..."
```

すべてのリクエストは `https://api.nutrient.io/build` に `instructions` JSON フィールドを含むマルチパート POST として送信されます。

## 操作

### ドキュメントの変換

```bash
# DOCX から PDF へ
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "document.docx=@document.docx" \
  -F 'instructions={"parts":[{"file":"document.docx"}]}' \
  -o output.pdf

# PDF から DOCX へ
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "document.pdf=@document.pdf" \
  -F 'instructions={"parts":[{"file":"document.pdf"}],"output":{"type":"docx"}}' \
  -o output.docx

# HTML から PDF へ
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "index.html=@index.html" \
  -F 'instructions={"parts":[{"html":"index.html"}]}' \
  -o output.pdf
```

サポートされている入力形式: PDF、DOCX、XLSX、PPTX、DOC、XLS、PPT、PPS、PPSX、ODT、RTF、HTML、JPG、PNG、TIFF、HEIC、GIF、WebP、SVG、TGA、EPS。

### テキストとデータの抽出

```bash
# プレーンテキストの抽出
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "document.pdf=@document.pdf" \
  -F 'instructions={"parts":[{"file":"document.pdf"}],"output":{"type":"text"}}' \
  -o output.txt

# テーブルを Excel として抽出
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "document.pdf=@document.pdf" \
  -F 'instructions={"parts":[{"file":"document.pdf"}],"output":{"type":"xlsx"}}' \
  -o tables.xlsx
```

### スキャンされたドキュメントの OCR

```bash
# 検索可能な PDF への OCR（100以上の言語をサポート）
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "scanned.pdf=@scanned.pdf" \
  -F 'instructions={"parts":[{"file":"scanned.pdf"}],"actions":[{"type":"ocr","language":"english"}]}' \
  -o searchable.pdf
```

言語: ISO 639-2 コード（例: `eng`、`deu`、`fra`、`spa`、`jpn`、`kor`、`chi_sim`、`chi_tra`、`ara`、`hin`、`rus`）を介して100以上の言語をサポートしています。`english` や `german` などの完全な言語名も機能します。サポートされているすべてのコードについては、[完全な OCR 言語表](https://www.nutrient.io/guides/document-engine/ocr/language-support/)を参照してください。

### 機密情報の編集

```bash
# パターンベース（SSN、メール）
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "document.pdf=@document.pdf" \
  -F 'instructions={"parts":[{"file":"document.pdf"}],"actions":[{"type":"redaction","strategy":"preset","strategyOptions":{"preset":"social-security-number"}},{"type":"redaction","strategy":"preset","strategyOptions":{"preset":"email-address"}}]}' \
  -o redacted.pdf

# 正規表現ベース
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "document.pdf=@document.pdf" \
  -F 'instructions={"parts":[{"file":"document.pdf"}],"actions":[{"type":"redaction","strategy":"regex","strategyOptions":{"regex":"\\b[A-Z]{2}\\d{6}\\b"}}]}' \
  -o redacted.pdf
```

プリセット: `social-security-number`、`email-address`、`credit-card-number`、`international-phone-number`、`north-american-phone-number`、`date`、`time`、`url`、`ipv4`、`ipv6`、`mac-address`、`us-zip-code`、`vin`。

### ウォーターマークの追加

```bash
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "document.pdf=@document.pdf" \
  -F 'instructions={"parts":[{"file":"document.pdf"}],"actions":[{"type":"watermark","text":"CONFIDENTIAL","fontSize":72,"opacity":0.3,"rotation":-45}]}' \
  -o watermarked.pdf
```

### デジタル署名

```bash
# 自己署名 CMS 署名
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "document.pdf=@document.pdf" \
  -F 'instructions={"parts":[{"file":"document.pdf"}],"actions":[{"type":"sign","signatureType":"cms"}]}' \
  -o signed.pdf
```

### PDF フォームの入力

```bash
curl -X POST https://api.nutrient.io/build \
  -H "Authorization: Bearer $NUTRIENT_API_KEY" \
  -F "form.pdf=@form.pdf" \
  -F 'instructions={"parts":[{"file":"form.pdf"}],"actions":[{"type":"fillForm","formFields":{"name":"Jane Smith","email":"jane@example.com","date":"2026-02-06"}}]}' \
  -o filled.pdf
```

## MCP サーバー（代替）

ネイティブツール統合には、curl の代わりに MCP サーバーを使用します：

```json
{
  "mcpServers": {
    "nutrient-dws": {
      "command": "npx",
      "args": ["-y", "@nutrient-sdk/dws-mcp-server"],
      "env": {
        "NUTRIENT_DWS_API_KEY": "YOUR_API_KEY",
        "SANDBOX_PATH": "/path/to/working/directory"
      }
    }
  }
}
```

## 使用タイミング

- フォーマット間でのドキュメント変換（PDF、DOCX、XLSX、PPTX、HTML、画像）
- PDF からテキスト、テーブル、キー値ペアの抽出
- スキャンされたドキュメントまたは画像の OCR
- ドキュメントを共有する前の PII の編集
- ドラフトまたは機密文書へのウォーターマークの追加
- 契約または合意書へのデジタル署名
- プログラムによる PDF フォームの入力

## リンク

- [API Playground](https://dashboard.nutrient.io/processor-api/playground/)
- [完全な API ドキュメント](https://www.nutrient.io/guides/dws-processor/)
- [npm MCP サーバー](https://www.npmjs.com/package/@nutrient-sdk/dws-mcp-server)

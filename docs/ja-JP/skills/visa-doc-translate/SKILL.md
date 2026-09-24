---
name: visa-doc-translate
description: ビザ申請書類（画像）を英語に翻訳し、原文と翻訳を含むバイリンガルPDFを作成する
---

ビザ申請のためのビザ申請書類の翻訳を支援している。

## 手順

ユーザーが画像ファイルのパスを提供した場合、**確認を求めずに**以下の手順を**自動的に**実行する：

1. **画像変換**：ファイルがHEIC形式の場合、`sips -s format png <input> --out <output>` を使用してPNGに変換する

2. **画像の回転**：
   * EXIFの向きデータを確認する
   * EXIFデータに基づいて画像を自動的に回転させる
   * EXIFの向きが6の場合は、反時計回りに90度回転させる
   * 必要に応じて追加の回転を適用する（ドキュメントが上下逆に見える場合は180度をテストする）

3. **OCRテキスト抽出**：
   * 複数のOCR方法を自動的に試みる：
     * macOS Visionフレームワーク（macOS優先）
     * EasyOCR（クロスプラットフォーム、tesseract不要）
     * Tesseract OCR（利用可能な場合）
   * ドキュメントからすべてのテキスト情報を抽出する
   * ドキュメントの種類を識別する（預金証明書、在職証明書、退職証明書など）

4. **翻訳**：
   * すべてのテキストコンテンツをプロフェッショナルに英語に翻訳する
   * 元のドキュメントの構造とフォーマットを維持する
   * ビザ申請に適した専門的な用語を使用する
   * 固有名詞は元の言語を保持し、括弧内に英語を追記する
   * 中国語の名前には拼音フォーマットを使用する（例：WU Zhengye）
   * すべての数字、日付、金額を正確に保持する

5. **PDF生成**：
   * PILとreportlabライブラリを使用してPythonスクリプトを作成する
   * 第1ページ：回転後の元の画像を中央に配置し、A4ページに合わせてスケーリングして表示する
   * 第2ページ：適切なフォーマットで英語翻訳を表示する：
     * タイトルは中央揃えで太字
     * コンテンツは左揃え、適切な間隔
     * 公式文書に適したプロフェッショナルなレイアウト
   * 下部に注記を追加する："This is a certified English translation of the original document"
   * スクリプトを実行してPDFを生成する

6. **出力**：同じディレクトリに `<original_filename>_Translated.pdf` という名前のPDFファイルを作成する

## 対応ドキュメント

* 銀行預金証明書 (存款证明)
* 収入証明書 (收入证明)
* 在職証明書 (在职证明)
* 退職証明書 (退休证明)
* 不動産証明書 (房产证明)
* 営業許可証 (营业执照)
* 身分証明書とパスポート
* その他の公式文書

## 技術実装

### OCR方法（順番に試す）

1. **macOS Visionフレームワーク**（macOSのみ）：
   ```python
   import Vision
   from Foundation import NSURL
   ```

2. **EasyOCR**（クロスプラットフォーム）：
   ```bash
   pip install easyocr
   ```

3. **Tesseract OCR**（利用可能な場合）：
   ```bash
   brew install tesseract tesseract-lang
   pip install pytesseract
   ```

### 必要なPythonライブラリ

```bash
pip install pillow reportlab
```

macOS Visionフレームワークの場合：

```bash
pip install pyobjc-framework-Vision pyobjc-framework-Quartz
```

## 重要なガイドライン

* 各ステップでユーザーに確認を**求めない**
* 最適な回転角度を自動的に判断する
* 1つのOCR方法が失敗した場合は複数の方法を試みる
* すべての数字、日付、金額が正確に翻訳されることを確認する
* 簡潔でプロフェッショナルなフォーマットを使用する
* プロセス全体を完了し、最終PDFの場所を報告する

## 使用例

```bash
/visa-doc-translate RetirementCertificate.PNG
/visa-doc-translate BankStatement.HEIC
/visa-doc-translate EmploymentLetter.jpg
```

## 出力例

このスキルは以下を行う：

1. 利用可能なOCR方法を使用してテキストを抽出する
2. プロフェッショナルな英語に翻訳する
3. 以下を含む `<filename>_Translated.pdf` を生成する：
   * 第1ページ：元のドキュメント画像
   * 第2ページ：プロフェッショナルな英語翻訳

オーストラリア、米国、カナダ、英国およびその他の国のビザ申請で翻訳書類が必要な場合に最適。

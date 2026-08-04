# ビザ書類翻訳ツール

ビザ申請書類を画像からプロフェッショナルな英語PDFに自動翻訳する。

## 機能

* **自動OCR**：複数のOCR方法を試みる（macOS Vision、EasyOCR、Tesseract）
* **バイリンガルPDF**：元の画像 + プロフェッショナルな英語翻訳
* **多言語対応**：中国語およびその他の言語に対応
* **プロフェッショナルなフォーマット**：公式ビザ申請に適合
* **完全自動化**：人の介入不要

## 対応ファイルタイプ

* 銀行預金証明書（存款证明）
* 在職証明書（在职证明）
* 退職証明書（退休证明）
* 収入証明書（收入证明）
* 不動産証明書（房产证明）
* 営業許可証（营业执照）
* 身分証明書とパスポート

## 使用方法

```bash
/visa-doc-translate <image-file>
```

### 例

```bash
/visa-doc-translate RetirementCertificate.PNG
/visa-doc-translate BankStatement.HEIC
/visa-doc-translate EmploymentLetter.jpg
```

## 出力

`<filename>_Translated.pdf` を作成し、以下を含む：

* **第1ページ**：元の書類画像（中央配置、A4サイズ）
* **第2ページ**：プロフェッショナルな英語翻訳

## 要件

### Pythonライブラリ

```bash
pip install pillow reportlab
```

### OCR（以下のいずれかが必要）

**macOS（推奨）**：

```bash
pip install pyobjc-framework-Vision pyobjc-framework-Quartz
```

**クロスプラットフォーム**：

```bash
pip install easyocr
```

**Tesseract**：

```bash
brew install tesseract tesseract-lang
pip install pytesseract
```

## 仕組み

1. 必要に応じてHEICをPNGに変換する
2. EXIFの回転を確認して適用する
3. 利用可能なOCR方法でテキストを抽出する
4. プロフェッショナルな英語に翻訳する
5. バイリンガルPDFを生成する

## 最適な用途

* オーストラリアのビザ申請
* 米国のビザ申請
* カナダのビザ申請
* 英国のビザ申請
* EUのビザ申請

## ライセンス

MIT

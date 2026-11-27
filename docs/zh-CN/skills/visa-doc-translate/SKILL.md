---
name: visa-doc-translate
description: 将签证申请文件（图片）翻译成英文，并创建包含原文和译文的双语PDF
---

您正在协助翻译用于签证申请的签证申请文件。

## 说明

当用户提供图像文件路径时，**自动**执行以下步骤，**无需**请求确认：

1. **图像转换**：如果文件是 HEIC 格式，使用 `sips -s format png <input> --out <output>` 将其转换为 PNG

2. **图像旋转**：
   * 检查 EXIF 方向数据
   * 根据 EXIF 数据自动旋转图像
   * 如果 EXIF 方向是 6，则逆时针旋转 90 度
   * 根据需要应用额外旋转（如果文档看起来上下颠倒，则测试 180 度）

3. **OCR 文本提取**：
   * 自动尝试多种 OCR 方法：
     * macOS Vision 框架（macOS 首选）
     * EasyOCR（跨平台，无需 tesseract）
     * Tesseract OCR（如果可用）
   * 从文档中提取所有文本信息
   * 识别文档类型（存款证明、在职证明、退休证明等）

4. **翻译**：
   * 专业地将所有文本内容翻译成英文
   * 保持原始文档的结构和格式
   * 使用适合签证申请的专业术语
   * 保留专有名词的原始语言，并在括号内附上英文
   * 对于中文姓名，使用拼音格式（例如，WU Zhengye）
   * 准确保留所有数字、日期和金额

5. **PDF 生成**：
   * 使用 PIL 和 reportlab 库创建 Python 脚本
   * 第 1 页：显示旋转后的原始图像，居中并缩放到适合 A4 页面
   * 第 2 页：以适当格式显示英文翻译：
     * 标题居中并加粗
     * 内容左对齐，间距适当
     * 适合官方文件的专业布局
   * 在底部添加注释："This is a certified English translation of the original document"
   * 执行脚本以生成 PDF

6. **输出**：在同一目录中创建名为 `<original_filename>_Translated.pdf` 的 PDF 文件

## 支持的文档

* 银行存款证明 (存款证明)
* 收入证明 (收入证明)
* 在职证明 (在职证明)
* 退休证明 (退休证明)
* 房产证明 (房产证明)
* 营业执照 (营业执照)
* 身份证和护照
* 其他官方文件

## 技术实现

### OCR 方法（按顺序尝试）

1. **macOS Vision 框架**（仅限 macOS）：
   ```python
   import Vision
   from Foundation import NSURL
   ```

2. **EasyOCR**（跨平台）：
   ```bash
   pip install easyocr
   ```

3. **Tesseract OCR**（如果可用）：
   ```bash
   brew install tesseract tesseract-lang
   pip install pytesseract
   ```

### 必需的 Python 库

```bash
pip install pillow reportlab
```

对于 macOS Vision 框架：

```bash
pip install pyobjc-framework-Vision pyobjc-framework-Quartz
```

## 重要指南

* **请勿**在每个步骤都要求用户确认
* 自动确定最佳旋转角度
* 如果一种 OCR 方法失败，请尝试多种方法
* 确保所有数字、日期和金额都准确翻译
* 使用简洁、专业的格式
* 完成整个流程并报告最终 PDF 的位置

## 使用示例

```bash
/visa-doc-translate RetirementCertificate.PNG
/visa-doc-translate BankStatement.HEIC
/visa-doc-translate EmploymentLetter.jpg
```

## 输出示例

该技能将：

1. 使用可用的 OCR 方法提取文本
2. 翻译成专业英文
3. 生成 `<filename>_Translated.pdf`，其中包含：
   * 第 1 页：原始文档图像
   * 第 2 页：专业的英文翻译

非常适合需要翻译文件的澳大利亚、美国、加拿大、英国及其他国家的签证申请。

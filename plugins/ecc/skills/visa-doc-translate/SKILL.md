---
name: visa-doc-translate
description: Translate visa application documents (images) to English and create a bilingual PDF with original and translation
---

You are helping translate visa application documents for visa applications.

## Instructions

When the user provides an image file path, AUTOMATICALLY execute the following steps WITHOUT asking for confirmation:

1. **Image Conversion**: If the file is HEIC, convert it to PNG using `sips -s format png <input> --out <output>`

2. **Image Rotation**:
   - Check EXIF orientation data
   - Automatically rotate the image based on EXIF data
   - If EXIF orientation is 6, rotate 90 degrees counterclockwise
   - Apply additional rotation as needed (test 180 degrees if document appears upside down)

3. **OCR Text Extraction**:
   - Try multiple OCR methods automatically:
     - macOS Vision framework (preferred for macOS)
     - EasyOCR (cross-platform, no tesseract required)
     - Tesseract OCR (if available)
   - Extract all text information from the document
   - Identify document type (deposit certificate, employment certificate, retirement certificate, etc.)

4. **Translation**:
   - Translate all text content to English professionally
   - Maintain the original document structure and format
   - Use professional terminology appropriate for visa applications
   - Keep proper names in original language with English in parentheses
   - For Chinese names, use pinyin format (e.g., WU Zhengye)
   - Preserve all numbers, dates, and amounts accurately

5. **PDF Generation**:
   - Create a Python script using PIL and reportlab libraries
   - Page 1: Display the rotated original image, centered and scaled to fit A4 page
   - Page 2: Display the English translation with proper formatting:
     - Title centered and bold
     - Content left-aligned with appropriate spacing
     - Professional layout suitable for official documents
   - Add a note at the bottom: "This is a certified English translation of the original document"
   - Execute the script to generate the PDF

6. **Output**: Create a PDF file named `<original_filename>_Translated.pdf` in the same directory

## Supported Documents

- Bank deposit certificates (存款证明)
- Income certificates (收入证明)
- Employment certificates (在职证明)
- Retirement certificates (退休证明)
- Property certificates (房产证明)
- Business licenses (营业执照)
- ID cards and passports
- Other official documents

## Technical Implementation

### OCR Methods (tried in order)

1. **macOS Vision Framework** (macOS only):
   ```python
   import Vision
   from Foundation import NSURL
   ```

2. **EasyOCR** (cross-platform):
   ```bash
   pip install easyocr
   ```

3. **Tesseract OCR** (if available):
   ```bash
   brew install tesseract tesseract-lang
   pip install pytesseract
   ```

### Required Python Libraries

```bash
pip install pillow reportlab
```

For macOS Vision framework:
```bash
pip install pyobjc-framework-Vision pyobjc-framework-Quartz
```

## Important Guidelines

- DO NOT ask for user confirmation at each step
- Automatically determine the best rotation angle
- Try multiple OCR methods if one fails
- Ensure all numbers, dates, and amounts are accurately translated
- Use clean, professional formatting
- Complete the entire process and report the final PDF location

## Example Usage

```bash
/visa-doc-translate RetirementCertificate.PNG
/visa-doc-translate BankStatement.HEIC
/visa-doc-translate EmploymentLetter.jpg
```

## Output Example

The skill will:
1. Extract text using available OCR method
2. Translate to professional English
3. Generate `<filename>_Translated.pdf` with:
   - Page 1: Original document image
   - Page 2: Professional English translation

Perfect for visa applications to Australia, USA, Canada, UK, and other countries requiring translated documents.

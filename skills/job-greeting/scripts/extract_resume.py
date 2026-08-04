#!/usr/bin/env python3
"""提取简历文本（PDF / MD / TXT）到 stdout。

用法:
    python3 extract_resume.py <简历文件>

PDF 提取优先级: PyMuPDF(fitz) → pdftotext(poppler) → pypdf
"""
import os
import sys


def extract_pdf(path: str) -> str:
    text = ""

    # 1) PyMuPDF
    try:
        import fitz  # type: ignore

        doc = fitz.open(path)
        text = "\n".join(page.get_text() for page in doc)
        doc.close()
    except ImportError:
        pass
    if text:
        return text

    # 2) pdftotext (poppler-utils)
    try:
        import subprocess

        r = subprocess.run(["pdftotext", path, "-"], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout:
            return r.stdout
    except Exception:
        pass

    # 3) pypdf
    try:
        from pypdf import PdfReader

        reader = PdfReader(path)
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
    except ImportError:
        pass

    return text


def main() -> None:
    if len(sys.argv) < 2:
        print("用法: extract_resume.py <简历文件>", file=sys.stderr)
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"文件不存在: {path}", file=sys.stderr)
        sys.exit(1)

    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        text = extract_pdf(path)
        if not text:
            print(
                "简历 PDF 提取失败。请安装依赖：pip install pymupdf "
                "(或安装 poppler-utils 提供 pdftotext)。",
                file=sys.stderr,
            )
            sys.exit(1)
    else:
        with open(path, encoding="utf-8", errors="ignore") as f:
            text = f.read()

    sys.stdout.write(text)


if __name__ == "__main__":
    main()

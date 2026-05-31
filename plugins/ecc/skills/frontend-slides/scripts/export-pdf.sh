#!/usr/bin/env bash
# export-pdf.sh - Export an HTML presentation to PDF
#
# Usage:
#   bash scripts/export-pdf.sh <path-to-html> [output.pdf]
#
# Examples:
#   bash scripts/export-pdf.sh ./my-deck/index.html
#   bash scripts/export-pdf.sh ./presentation.html ./presentation.pdf
#
# What this does:
#   1. Starts a local server to serve the HTML (fonts and assets need HTTP)
#   2. Uses Playwright to screenshot each slide at 1920x1080
#   3. Combines all screenshots into a single PDF
#   4. Cleans up the server and temp files
#
# The PDF preserves colors, fonts, and layout - but not animations.
# Perfect for email attachments, printing, or embedding in documents.
set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}INFO:${NC} $*"; }
ok()    { echo -e "${GREEN}OK:${NC} $*"; }
warn()  { echo -e "${YELLOW}WARNING:${NC} $*"; }
err()   { echo -e "${RED}ERROR:${NC} $*" >&2; }

# --- Parse flags ---

# Default resolution: 1920x1080 (full HD, ~1-2MB per slide)
# Compact resolution: 1280x720 (HD, ~50-70% smaller files)
VIEWPORT_W=1920
VIEWPORT_H=1080
COMPACT=false

POSITIONAL=()
for arg in "$@"; do
    case $arg in
        --compact)
            COMPACT=true
            VIEWPORT_W=1280
            VIEWPORT_H=720
            ;;
        *)
            POSITIONAL+=("$arg")
            ;;
    esac
done
set -- "${POSITIONAL[@]}"

# --- Input validation ---

if [[ $# -lt 1 ]]; then
    err "Usage: bash scripts/export-pdf.sh <path-to-html> [output.pdf] [--compact]"
    err ""
    err "Examples:"
    err "  bash scripts/export-pdf.sh ./my-deck/index.html"
    err "  bash scripts/export-pdf.sh ./presentation.html ./slides.pdf"
    err "  bash scripts/export-pdf.sh ./presentation.html --compact   # smaller file size"
    exit 1
fi

INPUT_HTML="$1"
if [[ ! -f "$INPUT_HTML" ]]; then
    err "File not found: $INPUT_HTML"
    exit 1
fi

# Resolve to absolute path
INPUT_HTML=$(cd "$(dirname "$INPUT_HTML")" && pwd)/$(basename "$INPUT_HTML")

# Output PDF path: use second argument or derive from input name
if [[ $# -ge 2 ]]; then
    OUTPUT_PDF="$2"
else
    OUTPUT_PDF="$(dirname "$INPUT_HTML")/$(basename "$INPUT_HTML" .html).pdf"
fi

# Resolve output to absolute path
OUTPUT_DIR=$(dirname "$OUTPUT_PDF")
mkdir -p "$OUTPUT_DIR"
OUTPUT_PDF="$OUTPUT_DIR/$(basename "$OUTPUT_PDF")"

echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}       Export Slides to PDF${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""

# --- Step 1: Check dependencies ---

info "Checking dependencies..."

if ! command -v npx &>/dev/null; then
    err "Node.js is required but not installed."
    err ""
    err "Install Node.js:"
    err "  macOS:   brew install node"
    err "  or visit https://nodejs.org and download the installer"
    exit 1
fi

ok "Node.js found"

# --- Step 2: Create the export script ---

# We use a temporary Node.js script with Playwright to:
# 1. Start a local server (so fonts load correctly)
# 2. Navigate to each slide
# 3. Screenshot each slide at 1920x1080 (16:9 landscape)
# 4. Combine into a single PDF

TEMP_DIR=$(mktemp -d)
TEMP_SCRIPT="$TEMP_DIR/export-slides.mjs"

# Figure out which directory to serve (the folder containing the HTML)
SERVE_DIR=$(dirname "$INPUT_HTML")
HTML_FILENAME=$(basename "$INPUT_HTML")

cat > "$TEMP_SCRIPT" << 'EXPORT_SCRIPT'
// export-slides.mjs - Playwright script to export HTML slides to PDF
//
// How it works:
// 1. Starts a local HTTP server (needed for fonts/assets to load)
// 2. Opens the presentation in a headless browser at 1920x1080
// 3. Counts the total number of slides
// 4. Screenshots each slide one by one
// 5. Generates a PDF with all slides as landscape pages

import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join, extname, resolve } from 'path';
import { execSync } from 'child_process';

const SERVE_DIR = process.argv[2];
const HTML_FILE = process.argv[3];
const OUTPUT_PDF = process.argv[4];
const SCREENSHOT_DIR = process.argv[5];
const VP_WIDTH = parseInt(process.argv[6]) || 1920;
const VP_HEIGHT = parseInt(process.argv[7]) || 1080;

// --- Simple static file server ---
// (We need HTTP so that Google Fonts and relative assets load correctly)

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

const server = createServer((req, res) => {
  // Decode URL-encoded characters (e.g., %20 -> space) so filenames with spaces resolve correctly
  const decodedUrl = decodeURIComponent(req.url);
  let filePath = join(SERVE_DIR, decodedUrl === '/' ? HTML_FILE : decodedUrl);
  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Find a free port
const port = await new Promise((resolve) => {
  server.listen(0, () => resolve(server.address().port));
});

console.log(`  Local server on port ${port}`);

// --- Screenshot each slide ---

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: VP_WIDTH, height: VP_HEIGHT },
});

// Load the presentation
await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });

// Wait for fonts to load
await page.evaluate(() => document.fonts.ready);

// Extra wait for animations to settle on the first slide
await page.waitForTimeout(1500);

// Count slides
const slideCount = await page.evaluate(() => {
  return document.querySelectorAll('.slide').length;
});

console.log(`  Found ${slideCount} slides`);

if (slideCount === 0) {
  console.error('  ERROR: No .slide elements found in the presentation.');
  console.error('  Make sure your HTML uses <div class="slide"> or <section class="slide">.');
  await browser.close();
  server.close();
  process.exit(1);
}

// Screenshot each slide
mkdirSync(SCREENSHOT_DIR, { recursive: true });
const screenshotPaths = [];

for (let i = 0; i < slideCount; i++) {
  // Navigate to slide by simulating the presentation's navigation
  // Most frontend-slides presentations use a currentSlide index and show/hide
  await page.evaluate((index) => {
    const slides = document.querySelectorAll('.slide');

    // Try multiple navigation strategies used by frontend-slides:

    // Strategy 1: Direct slide manipulation (most common in generated decks)
    slides.forEach((slide, idx) => {
      if (idx === index) {
        slide.style.display = '';
        slide.style.opacity = '1';
        slide.style.visibility = 'visible';
        slide.style.position = 'relative';
        slide.style.transform = 'none';
        slide.classList.add('active');
      } else {
        slide.style.display = 'none';
        slide.classList.remove('active');
      }
    });

    // Strategy 2: If there's a SlidePresentation class instance, use it
    if (window.presentation && typeof window.presentation.goToSlide === 'function') {
      window.presentation.goToSlide(index);
    }

    // Strategy 3: Scroll-based (some decks use scroll snapping)
    slides[index]?.scrollIntoView({ behavior: 'instant' });
  }, i);

  // Wait for any slide transition animations to finish
  await page.waitForTimeout(300);

  // Wait for intersection observer animations to trigger
  await page.waitForTimeout(200);

  // Force all .reveal elements on the current slide to be visible
  // (animations normally trigger on scroll/intersection, but we need them visible now)
  await page.evaluate((index) => {
    const slides = document.querySelectorAll('.slide');
    const currentSlide = slides[index];
    if (currentSlide) {
      currentSlide.querySelectorAll('.reveal').forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.visibility = 'visible';
      });
    }
  }, i);

  await page.waitForTimeout(100);

  const screenshotPath = join(SCREENSHOT_DIR, `slide-${String(i + 1).padStart(3, '0')}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  screenshotPaths.push(screenshotPath);
  console.log(`  Captured slide ${i + 1}/${slideCount}`);
}

await browser.close();
server.close();

// --- Combine screenshots into PDF ---
// Use a second Playwright page to generate a PDF from the screenshots

console.log('  Assembling PDF...');

const browser2 = await chromium.launch();
const pdfPage = await browser2.newPage();

// Build an HTML page with all screenshots, one per page
const imagesHtml = screenshotPaths.map((p) => {
  const imgData = readFileSync(p).toString('base64');
  return `<div class="page"><img src="data:image/png;base64,${imgData}" /></div>`;
}).join('\n');

const pdfHtml = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; }
  @page { size: ${VP_WIDTH}px ${VP_HEIGHT}px; margin: 0; }
  .page {
    width: ${VP_WIDTH}px;
    height: ${VP_HEIGHT}px;
    page-break-after: always;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  img {
    width: ${VP_WIDTH}px;
    height: ${VP_HEIGHT}px;
    display: block;
    object-fit: contain;
  }
</style>
</head>
<body>${imagesHtml}</body>
</html>`;

await pdfPage.setContent(pdfHtml, { waitUntil: 'load' });
await pdfPage.pdf({
  path: OUTPUT_PDF,
  width: `${VP_WIDTH}px`,
  height: `${VP_HEIGHT}px`,
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});

await browser2.close();

// Clean up screenshots
screenshotPaths.forEach(p => unlinkSync(p));

console.log(`  OK: PDF saved to: ${OUTPUT_PDF}`);
EXPORT_SCRIPT

# --- Step 3: Install Playwright in temp directory ---
# We install Playwright locally in the temp dir so the Node script can import it.
# This avoids polluting global packages and ensures the script is self-contained.

info "Setting up Playwright (headless browser for screenshots)..."
info "This may take a moment on first run..."
echo ""

cd "$TEMP_DIR"

# Create a minimal package.json so npm install works
cat > "$TEMP_DIR/package.json" << 'PKG'
{ "name": "slide-export", "private": true, "type": "module" }
PKG

# Install Playwright into the temp directory
npm install playwright &>/dev/null || {
    err "Failed to install Playwright."
    err "Try running: npm install playwright"
    rm -rf "$TEMP_DIR"
    exit 1
}

# Ensure Chromium browser binary is downloaded
npx playwright install chromium 2>/dev/null || {
    err "Failed to install Chromium browser for Playwright."
    err "Try running manually: npx playwright install chromium"
    rm -rf "$TEMP_DIR"
    exit 1
}
ok "Playwright ready"
echo ""

# --- Step 4: Run the export ---

SCREENSHOT_DIR="$TEMP_DIR/screenshots"

info "Exporting slides to PDF..."
echo ""

# Run from the temp dir so Node can find the locally-installed playwright
if [[ "$COMPACT" == "true" ]]; then
    info "Using compact mode (1280x720) for smaller file size"
fi

node "$TEMP_SCRIPT" "$SERVE_DIR" "$HTML_FILENAME" "$OUTPUT_PDF" "$SCREENSHOT_DIR" "$VIEWPORT_W" "$VIEWPORT_H" || {
    err "PDF export failed."
    rm -rf "$TEMP_DIR"
    exit 1
}

# --- Step 5: Cleanup and success ---

rm -rf "$TEMP_DIR"

echo ""
echo -e "${BOLD}========================================${NC}"
ok "PDF exported successfully!"
echo ""
echo -e "  ${BOLD}File:${NC}  $OUTPUT_PDF"
echo ""
FILE_SIZE=$(du -h "$OUTPUT_PDF" | cut -f1 | xargs)
echo "  Size: $FILE_SIZE"
echo ""
echo "  This PDF works everywhere - email, Slack, Notion, print."
echo "  Note: Animations are not preserved (it's a static export)."
echo -e "${BOLD}========================================${NC}"
echo ""

# Open the PDF automatically
if command -v open &>/dev/null; then
    open "$OUTPUT_PDF"
elif command -v xdg-open &>/dev/null; then
    xdg-open "$OUTPUT_PDF"
fi

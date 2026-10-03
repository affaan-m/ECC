# Vendored third-party assets (no runtime CDN)

## highlight.js — v11.11.1 (common build, 36 languages)
- `highlight.min.js` — browser UMD build, BSD-3-Clause, from cdnjs
  (https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js), fetched 2026-08-12.
- `highlight.min.css` — GitHub light theme, BSD-3-Clause, from cdnjs (same version), fetched 2026-08-12.
- Used by the HTML course shell for syntax highlighting; wired in `_base.html`; initialized in `main.js`.
- Re-vendor by replacing both files with a newer version and updating this note.

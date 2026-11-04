'use strict';

/**
 * Canonical ECC web design tokens — the single source of truth for the dark
 * `:root` custom-property block shared across every ECC web surface:
 *   - Plan Canvas (scripts/lib/plan-canvas/ui.js) — the master; adds a light theme
 *   - Control Pane board (scripts/lib/control-pane/ui.js)
 *   - Control-plane live view (scripts/lib/control-pane/control-plane-view-ui.js)
 *   - Agent-airspace viz (scripts/lib/control-pane/proximity-viz.js)
 *
 * Token NAMES and VALUES are the Plan Canvas set: neutrals + bg tiers, text
 * tiers, a blue accent family (`--accent`/`--accent-strong`), semantic colors
 * each with a `-glow`, radius + shadow tiers, and the font/mono stack. The
 * dark-only tools source their dark values from here; they do NOT get a light
 * theme. Contrast across these pairs is WCAG AA (text >= 4.5:1, UI/large >= 3:1).
 *
 * Exposed as a CSS string (not a file served over HTTP) because every consumer
 * inlines its styles — no CDNs, no external assets, CSP/offline friendly.
 */

// The dark `:root` block, byte-identical to Plan Canvas's original dark tokens
// so the master keeps rendering exactly as before.
const ROOT_TOKENS_CSS = `  :root{
    --bg:#080a0e; --bg2:#0d0f14; --bg3:#13161e; --bg4:#191d2a;
    --surface:#101218; --surface-hover:#171a24; --border:#1d2130; --border-light:#272c3e;
    --text:#dfe2e9; --text2:#80859a; --text3:#8b90a6;
    --accent:#6885e8; --accent-glow:rgba(104,133,232,0.15); --accent-dim:#3d5ab8; --accent-strong:#4560d0;
    --green:#4acb8a; --green-glow:rgba(74,203,138,0.15);
    --orange:#eca85a; --orange-glow:rgba(236,168,90,0.15);
    --pink:#e26a9e; --pink-glow:rgba(226,106,158,0.15);
    --red:#e86060; --red-glow:rgba(232,96,96,0.15);
    --teal:#4acbbe; --teal-glow:rgba(74,203,190,0.15);
    --radius:8px; --radius-sm:5px;
    --font:-apple-system,BlinkMacSystemFont,'SF Pro Display','Inter','Segoe UI',Roboto,sans-serif;
    --mono:'SF Mono','Fira Code','JetBrains Mono','Cascadia Code',monospace;
    --shadow:0 1px 2px rgba(0,0,0,0.4);
    --shadow-lg:0 8px 32px rgba(0,0,0,0.6);
  }`;

// Canonical semantic + neutral hex values, for canvas drawing contexts that
// cannot read CSS custom properties (fillStyle/strokeStyle take literal colors).
// Mirrors the token VALUES above so the <canvas> stays in lockstep with the CSS.
const TOKEN_HEX = Object.freeze({
  bg: '#080a0e',
  border: '#1d2130',
  text: '#dfe2e9',
  text2: '#80859a',
  text3: '#8b90a6',
  accent: '#6885e8',
  green: '#4acb8a',
  orange: '#eca85a',
  red: '#e86060',
  teal: '#4acbbe',
});

module.exports = { ROOT_TOKENS_CSS, TOKEN_HEX };

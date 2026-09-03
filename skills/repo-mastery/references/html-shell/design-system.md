# Design System

> **When to read this:** Phase 3, when writing module HTML. All tokens below are defined in `styles.css` (`:root`). Use the CSS variables — never hard-code colors, sizes, or spacing.

The visual identity is a **warm field notebook**: aged-paper backgrounds, one confident accent, a geometric display face with personality, and generous whitespace. It should feel friendly and made-by-a-human, not like a generic AI gradient deck.

## Color tokens

Surfaces and ink (fixed):
- `--color-bg` `#FBF8F3`, `--color-bg-warm` `#F4EEE4` (alternating module backgrounds), `--color-bg-code` `#21222C`
- `--color-surface` `#FFFFFF`, `--color-surface-warm` `#FDFAF4`
- `--color-border` `#E6DFD3`, `--color-border-light` `#EFEAE1`
- `--color-text` `#2B2925`, `--color-text-secondary` `#6A645B`, `--color-text-muted`

Semantic:
- `--color-success` / `--color-success-light` — used by the recap card and correct quiz states.

Accent (set per course in `_base.html`, five palettes provided): `--color-accent`, `--color-accent-hover`, `--color-accent-light`, `--color-accent-muted`. Pick the palette that fits the product's character.

Category accents for actors and cards: `--color-actor-1..5` (ember, teal, plum, amber, pine). Use them to give chat avatars, flow actors, pattern cards, and icon circles distinct identities — assign by category, never as a rainbow.

## Typography

- Display (headings): `--font-display` = Sora.
- Body: `--font-body` = DM Sans.
- Code/commands: `--font-mono` = JetBrains Mono.
- Scale: `--text-xs … --text-6xl`. Module title = `--text-4xl`, screen heading = `--text-2xl`, body = `--text-base`.

## Layout

- `--content-width` 760px, centered. `--nav-height` 56px (fixed top bar with progress + dots).
- Spacing scale `--space-1 … --space-24`; radii `--radius-sm/md/lg/full`; shadows `--shadow-sm/md/lg`.
- Modules are full-height (`100dvh` with `100vh` fallback) and alternate background tone via `:nth-child(even)`.
- Motion: `--duration-fast/normal/slow`, `--ease-out`. All motion collapses under `prefers-reduced-motion`.

## Module skeleton

```html
<section class="module" id="module-N">
  <div class="module-content">
    <div class="module-header">
      <span class="module-number">0N</span>
      <h2 class="module-title">…</h2>
      <p class="module-subtitle">…</p>
    </div>
    <!-- objectives card here -->
    <div class="screen"><h3 class="screen-heading">…</h3> … </div>
    <!-- more screens; recap card screen; quiz screen -->
  </div>
</section>
```

Module files contain **only** the `<section>` — no `<html>`, `<head>`, `<style>`, or `<script>`. CSS and JS come from the copied `styles.css` / `main.js`.

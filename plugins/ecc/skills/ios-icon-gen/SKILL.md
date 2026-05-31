---
name: ios-icon-gen
description: Generate iOS app icons as PNG imagesets for Xcode asset catalogs from SF Symbols (5000+ Apple-native) or Iconify API (275k+ open source icons from 200+ collections). Use when generating icons, creating icon assets, adding icons to asset catalog, or searching for icons for iOS projects.
origin: community
---

# iOS Icon Generator

Generate PNG icon imagesets for Xcode asset catalogs from two sources.

## When to Activate

- Generating icon assets for an iOS/macOS Xcode project
- Searching for icons across open source collections
- Creating PNG imagesets (1x, 2x, 3x) for asset catalogs
- Replacing placeholder icons with production-quality assets
- Matching existing icon styles in an Xcode project

## Core Principles

### 1. Two Sources, One Output Format
Both sources produce identical Xcode-compatible imagesets. Choose based on need:

| Source | Icons | Requires | Best for |
|--------|-------|----------|----------|
| **Iconify API** | 275,000+ from 200+ collections | Internet | Wide selection, specific styles, open source icons |
| **SF Symbols** | 5,000+ Apple symbols | macOS only | Apple-native style, offline use |

### 2. Always Match Existing Style
Before generating, check the project's existing icons for size, color, and weight consistency.

### 3. Output Structure
Both methods produce a complete Xcode imageset:

```
<output-dir>/<asset-name>.imageset/
  Contents.json
  <asset-name>.png        # 1x (68px default)
  <asset-name>@2x.png     # 2x (136px default)
  <asset-name>@3x.png     # 3x (204px default)
```

## Examples

### Step 1: Assess Requirements

Determine icon needs: what the icon represents, preferred style, target color, and size.

If the project already has icons, check existing style:
```bash
# Check dimensions of existing icon
sips -g pixelWidth -g pixelHeight path/to/existing@2x.png
```

### Step 2: Search for Icons

**Iconify API (recommended for wide selection):**
```bash
# Search all collections
$SKILL_DIR/scripts/iconify_gen.sh search "receipt"

# Search within a specific collection
$SKILL_DIR/scripts/iconify_gen.sh search "business card" --prefix mdi

# List available collections
$SKILL_DIR/scripts/iconify_gen.sh collections
```

**SF Symbols (for Apple-native style):**
Browse the SF Symbols app or reference common names:

| Use Case | Symbol Name |
|----------|-------------|
| Document | `doc.text`, `doc.fill` |
| Receipt | `doc.text.below.ecg`, `receipt` |
| Person | `person.crop.rectangle`, `person.text.rectangle` |
| Camera | `camera`, `camera.fill` |
| Scan | `doc.viewfinder`, `qrcode.viewfinder` |
| Settings | `gearshape`, `slider.horizontal.3` |

### Step 3: Preview (Optional)

```bash
# Iconify preview
$SKILL_DIR/scripts/iconify_gen.sh preview mdi:receipt-text-outline
```

### Step 4: Generate

**Iconify API:**
```bash
# Basic generation
$SKILL_DIR/scripts/iconify_gen.sh mdi:receipt-text-outline editTool_expenseReport

# Custom color and output location
$SKILL_DIR/scripts/iconify_gen.sh mdi:receipt-text-outline myIcon --color 007AFF --output ./Assets.xcassets/icons
```

Options: `--size <pt>` (default: 68), `--color <hex>` (default: 8E8E93), `--output <dir>` (default: /tmp/icons)

**SF Symbols:**
```bash
# Basic generation
swift $SKILL_DIR/scripts/generate_icons.swift doc.text.below.ecg editTool_expenseReport

# Custom color, weight, and output
swift $SKILL_DIR/scripts/generate_icons.swift person.crop.rectangle myIcon --color 007AFF --weight regular --output ./Assets.xcassets/icons
```

Options: `--size <pt>` (default: 68), `--color <hex>` (default: 8E8E93), `--weight <name>` (default: thin), `--output <dir>` (default: /tmp/icons)

### Step 5: Verify and Integrate

1. Read the generated @2x PNG to verify visually
2. Copy to asset catalog if not output there directly:
   ```bash
   cp -r /tmp/icons/<name>.imageset path/to/Assets.xcassets/<group>/
   ```
3. Build the project to verify Xcode picks up the new assets

## Popular Iconify Collections

| Prefix | Name | Count | Style |
|--------|------|-------|-------|
| `mdi` | Material Design Icons | 7400+ | Filled + outline variants |
| `ph` | Phosphor | 9000+ | 6 weights per icon |
| `solar` | Solar | 7400+ | Bold, linear, outline |
| `tabler` | Tabler Icons | 6000+ | Consistent stroke width |
| `lucide` | Lucide | 1700+ | Clean, minimal |
| `ri` | Remix Icon | 3100+ | Filled + line variants |
| `carbon` | Carbon | 2400+ | IBM design language |
| `heroicons` | HeroIcons | 1200+ | Tailwind CSS companion |

Browse all: <https://icon-sets.iconify.design/>

## Scripts Reference

| Script | Source | Path |
|--------|--------|------|
| `iconify_gen.sh` | Iconify API (275k+ icons) | `$SKILL_DIR/scripts/iconify_gen.sh` |
| `generate_icons.swift` | SF Symbols (5k+ icons) | `$SKILL_DIR/scripts/generate_icons.swift` |

## Best Practices

- **Search before generating** -- browse available icons to find the best match
- **Match existing project style** -- check dimensions, color, and weight of existing icons before generating new ones
- **Use Iconify for variety** -- 200+ collections means you can find the exact style you need
- **Use SF Symbols for Apple consistency** -- they match system UI perfectly
- **Generate directly to asset catalog** -- use `--output ./Assets.xcassets/icons` to skip manual copying
- **Verify visually** -- always preview the @2x PNG before committing

## Anti-Patterns

- Generating icons without checking existing project icon style
- Using default colors when the project has a defined color palette
- Generating at wrong sizes (check existing icons first)
- Committing generated icons without visual verification

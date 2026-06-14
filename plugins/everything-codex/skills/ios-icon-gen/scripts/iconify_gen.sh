#!/bin/bash
#
# Generate iOS icon imagesets from Iconify API (275k+ open source icons)
# Uses: curl (download SVG) + sips (SVG->PNG conversion, built into macOS)
#
# Usage:
#   iconify_gen.sh <icon-id> <asset-name> [options]
#   iconify_gen.sh search <query> [--prefix <collection>] [--limit <n>]
#
# Examples:
#   iconify_gen.sh mdi:receipt-text-outline myExpenseIcon
#   iconify_gen.sh search "business card"
#   iconify_gen.sh search receipt --prefix mdi

set -euo pipefail

API_BASE="https://api.iconify.design"
readonly CURL_OPTS=(--fail --silent --show-error --connect-timeout 10 --max-time 30)

# Defaults
SIZE=68
COLOR="8E8E93"
OUTPUT="/tmp/icons"
LIMIT=20

require_value() {
    local flag="$1"
    local value="${2-}"
    if [[ -z "$value" || "$value" == --* ]]; then
        echo "ERROR: ${flag} requires a value" >&2
        exit 1
    fi
}

usage() {
    cat <<'EOF'
Usage:
  iconify_gen.sh <icon-id> <asset-name> [options]    Generate an icon imageset
  iconify_gen.sh search <query> [options]             Search for icons
  iconify_gen.sh preview <icon-id>                    Download preview SVG
  iconify_gen.sh collections                          List popular icon collections

Generate Options:
  --size <pt>       Base size in points (default: 68)
  --color <hex>     Color hex without # (default: 8E8E93)
  --output <dir>    Output directory (default: /tmp/icons)

Search Options:
  --prefix <name>   Filter by collection (e.g., mdi, lucide, tabler, ph)
  --limit <n>       Max results (default: 20)

Icon ID Format: <collection>:<icon-name>
  Examples: mdi:receipt-text-outline, lucide:credit-card, ph:address-book

Popular Collections:
  mdi      Material Design Icons (7400+ icons)
  lucide   Lucide (1700+ icons)
  tabler   Tabler Icons (6000+ icons)
  ph       Phosphor (9000+ icons)
  ri       Remix Icon (2800+ icons)
  carbon   Carbon (2100+ icons)
EOF
    exit 0
}

search_icons() {
    local query="$1"
    shift
    local prefix=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --prefix) require_value --prefix "${2-}"; prefix="$2"; shift 2 ;;
            --limit) require_value --limit "${2-}"; LIMIT="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local encoded_query
    encoded_query="$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$query")"
    local url="${API_BASE}/search?query=${encoded_query}&limit=${LIMIT}"
    if [[ -n "$prefix" ]]; then
        url="${url}&prefix=${prefix}"
    fi

    local response
    response=$(curl "${CURL_OPTS[@]}" "$url") || { echo "ERROR: Search request failed"; exit 1; }

    local total
    total=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))")

    echo "Found ${total} icons for '${query}':"
    echo ""
    echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for icon in data.get('icons', []):
    print(f'  {icon}')
"
    echo ""
    echo "Generate with: iconify_gen.sh <icon-id> <asset-name>"
    echo "Preview with:  iconify_gen.sh preview <icon-id>"
}

list_collections() {
    echo "Popular Iconify collections:"
    echo ""
    local resp
    resp=$(curl "${CURL_OPTS[@]}" "${API_BASE}/collections") || { echo "ERROR: Failed to fetch collections list"; exit 1; }
    echo "$resp" | python3 -c "
import sys, json
data = json.load(sys.stdin)
popular = ['mdi','lucide','tabler','ph','ri','carbon','solar','heroicons','bi','octicon','ion','fe','charm','ci','iconoir','basil','uil','mingcute','flowbite','mynaui']
for k in popular:
    if k in data:
        v = data[k]
        name = v.get('name','')
        total = v.get('total',0)
        print(f'  {k:12s} {name} ({total} icons)')
"
    echo ""
    echo "Full list: https://icon-sets.iconify.design/"
}

preview_icon() {
    local icon_id="$1"
    local collection="${icon_id%%:*}"
    local name="${icon_id#*:}"
    local url="${API_BASE}/${collection}/${name}.svg?width=136&height=136&color=%23${COLOR}"
    local outfile="/tmp/iconify_preview_${collection}_${name}.svg"

    curl "${CURL_OPTS[@]}" "$url" -o "$outfile" || { echo "ERROR: Icon '${icon_id}' not found"; exit 1; }
    echo "Preview SVG: ${outfile}"
    echo "URL: ${url}"

    # Also convert to PNG for visual check
    local pngfile="/tmp/iconify_preview_${collection}_${name}.png"
    sips -s format png "$outfile" --out "$pngfile" >/dev/null 2>&1 || echo "WARNING: sips conversion failed; PNG may be incorrect"
    echo "Preview PNG: ${pngfile}"
}

generate_icon() {
    local icon_id="$1"
    local asset_name="$2"
    shift 2

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --size) require_value --size "${2-}"; SIZE="$2"; shift 2 ;;
            --color) require_value --color "${2-}"; COLOR="$2"; shift 2 ;;
            --output) require_value --output "${2-}"; OUTPUT="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local collection="${icon_id%%:*}"
    local name="${icon_id#*:}"
    local imageset_dir="${OUTPUT}/${asset_name}.imageset"

    mkdir -p "$imageset_dir"

    echo "Generating ${asset_name} from Iconify '${icon_id}':"

    local scales=("1:${SIZE}" "2:$((SIZE * 2))" "3:$((SIZE * 3))")

    for scale_info in "${scales[@]}"; do
        local scale="${scale_info%%:*}"
        local px="${scale_info#*:}"
        local suffix=""
        [[ "$scale" != "1" ]] && suffix="@${scale}x"

        local svg_url="${API_BASE}/${collection}/${name}.svg?width=${px}&height=${px}&color=%23${COLOR}"
        local svg_file="${imageset_dir}/${asset_name}${suffix}.svg"
        local png_file="${imageset_dir}/${asset_name}${suffix}.png"

        curl "${CURL_OPTS[@]}" "$svg_url" -o "$svg_file" || { echo "ERROR: Failed to download icon '${icon_id}'"; exit 1; }
        sips -s format png "$svg_file" --out "$png_file" >/dev/null 2>&1 || echo "WARNING: sips conversion may have failed for ${svg_file}"
        rm "$svg_file"

        echo "  ${asset_name}${suffix}.png (${px}x${px})"
    done

    # Write Contents.json
    cat > "${imageset_dir}/Contents.json" <<JSONEOF
{
  "images" : [
    {
      "filename" : "${asset_name}.png",
      "idiom" : "universal",
      "scale" : "1x"
    },
    {
      "filename" : "${asset_name}@2x.png",
      "idiom" : "universal",
      "scale" : "2x"
    },
    {
      "filename" : "${asset_name}@3x.png",
      "idiom" : "universal",
      "scale" : "3x"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
JSONEOF

    echo "Output: ${imageset_dir}/"
}

# Main
[[ $# -eq 0 ]] && usage
[[ "$1" == "--help" || "$1" == "-h" ]] && usage

case "$1" in
    search)
        shift
        [[ $# -eq 0 ]] && { echo "Usage: iconify_gen.sh search <query>"; exit 1; }
        search_icons "$@"
        ;;
    preview)
        shift
        [[ $# -eq 0 ]] && { echo "Usage: iconify_gen.sh preview <icon-id>"; exit 1; }
        preview_icon "$1"
        ;;
    collections)
        list_collections
        ;;
    *)
        [[ $# -lt 2 ]] && { echo "Usage: iconify_gen.sh <icon-id> <asset-name> [options]"; exit 1; }
        generate_icon "$@"
        ;;
esac

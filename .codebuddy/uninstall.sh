#!/bin/bash
#
# ECC CodeBuddy Uninstaller
# Uninstalls ECC workflows from a CodeBuddy project.
#
# Usage:
#   ./uninstall.sh              # Uninstall from current directory
#   ./uninstall.sh ~            # Uninstall globally from ~/.codebuddy/
#

set -euo pipefail

# Resolve the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# CodeBuddy directory name
CODEBUDDY_DIR=".codebuddy"

resolve_path() {
    python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

is_valid_manifest_entry() {
    local file_path="$1"

    case "$file_path" in
        ""|/*|~*|*/../*|../*|*/..|..)
            return 1
            ;;
    esac

    return 0
}

# Main uninstall function
do_uninstall() {
    local target_dir="$PWD"

    # Check if ~ was specified (or expanded to $HOME)
    if [ "$#" -ge 1 ]; then
        if [ "$1" = "~" ] || [ "$1" = "$HOME" ]; then
            target_dir="$HOME"
        fi
    fi

    # Check if we're already inside a .codebuddy directory
    local current_dir_name="$(basename "$target_dir")"
    local codebuddy_full_path

    if [ "$current_dir_name" = ".codebuddy" ]; then
        # Already inside the codebuddy directory, use it directly
        codebuddy_full_path="$target_dir"
    else
        # Normal case: append CODEBUDDY_DIR to target_dir
        codebuddy_full_path="$target_dir/$CODEBUDDY_DIR"
    fi

    echo "ECC CodeBuddy Uninstaller"
    echo "=========================="
    echo ""
    echo "Target:  $codebuddy_full_path/"
    echo ""

    if [ ! -d "$codebuddy_full_path" ]; then
        echo "Error: $CODEBUDDY_DIR directory not found at $target_dir"
        exit 1
    fi

    codebuddy_root_resolved="$(resolve_path "$codebuddy_full_path")"

    # Manifest file path
    MANIFEST="$codebuddy_full_path/.ecc-manifest"

    if [ ! -f "$MANIFEST" ]; then
        echo "Warning: No manifest file found (.ecc-manifest)"
        echo ""
        echo "This could mean:"
        echo "  1. ECC was installed with an older version without manifest support"
        echo "  2. The manifest file was manually deleted"
        echo ""
        read -p "Do you want to remove the entire $CODEBUDDY_DIR directory? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Uninstall cancelled."
            exit 0
        fi
        rm -rf "$codebuddy_full_path"
        echo "Uninstall complete!"
        echo ""
        echo "Removed: $codebuddy_full_path/"
        exit 0
    fi

    echo "Found manifest file - will only remove files installed by ECC"
    echo ""
    read -p "Are you sure you want to uninstall ECC from $CODEBUDDY_DIR? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Uninstall cancelled."
        exit 0
    fi

    # Counters
    removed=0
    skipped=0

    # Read manifest and remove files
    while IFS= read -r file_path; do
        [ -z "$file_path" ] && continue

        if ! is_valid_manifest_entry "$file_path"; then
            echo "Skipped: $file_path (invalid manifest entry)"
            skipped=$((skipped + 1))
            continue
        fi

        full_path="$codebuddy_full_path/$file_path"

        # Security check: ensure the path resolves inside the target directory.
        # Use Python to compute a reliable relative path so symlinks cannot
        # escape the boundary.
        relative="$(python3 -c 'import os,sys; print(os.path.relpath(os.path.abspath(sys.argv[1]), sys.argv[2]))' "$full_path" "$codebuddy_root_resolved")"
        case "$relative" in
            ../*|..)
                echo "Skipped: $file_path (outside target directory)"
                skipped=$((skipped + 1))
                continue
                ;;
        esac

        if [ -L "$full_path" ] || [ -f "$full_path" ]; then
            rm -f "$full_path"
            echo "Removed: $file_path"
            removed=$((removed + 1))
        elif [ -d "$full_path" ]; then
            # Only remove directory if it's empty
            if [ -z "$(ls -A "$full_path" 2>/dev/null)" ]; then
                rmdir "$full_path" 2>/dev/null || true
                if [ ! -d "$full_path" ]; then
                    echo "Removed: $file_path/"
                    removed=$((removed + 1))
                fi
            else
                echo "Skipped: $file_path/ (not empty - contains user files)"
                skipped=$((skipped + 1))
            fi
        else
            skipped=$((skipped + 1))
        fi
    done < "$MANIFEST"

    while IFS= read -r empty_dir; do
        [ "$empty_dir" = "$codebuddy_full_path" ] && continue
        relative_dir="${empty_dir#$codebuddy_full_path/}"
        rmdir "$empty_dir" 2>/dev/null || true
        if [ ! -d "$empty_dir" ]; then
            echo "Removed: $relative_dir/"
            removed=$((removed + 1))
        fi
    done < <(find "$codebuddy_full_path" -depth -type d -empty 2>/dev/null | sort -r)

    # Try to remove the main codebuddy directory if it's empty
    if [ -d "$codebuddy_full_path" ] && [ -z "$(ls -A "$codebuddy_full_path" 2>/dev/null)" ]; then
        rmdir "$codebuddy_full_path" 2>/dev/null || true
        if [ ! -d "$codebuddy_full_path" ]; then
            echo "Removed: $CODEBUDDY_DIR/"
            removed=$((removed + 1))
        fi
    fi

    echo ""
    echo "Uninstall complete!"
    echo ""
    echo "Summary:"
    echo "  Removed: $removed items"
    echo "  Skipped: $skipped items (not found or user-modified)"
    echo ""
    if [ -d "$codebuddy_full_path" ]; then
        echo "Note: $CODEBUDDY_DIR directory still exists (contains user-added files)"
    fi
}

# Execute uninstall
do_uninstall "$@"

#!/bin/bash
set -euo pipefail

ARCH=""
OUTPUT_DIR=""
SOURCE_COMMIT=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        --architecture)
            ARCH="${2:-}"
            shift 2
            ;;
        --architecture=*)
            ARCH="${1#--architecture=}"
            shift
            ;;
        --output-dir)
            OUTPUT_DIR="${2:-}"
            shift 2
            ;;
        --output-dir=*)
            OUTPUT_DIR="${1#--output-dir=}"
            shift
            ;;
        --source-commit)
            SOURCE_COMMIT="${2:-}"
            shift 2
            ;;
        --source-commit=*)
            SOURCE_COMMIT="${1#--source-commit=}"
            shift
            ;;
        *)
            printf '%s\n' "Usage: build_macos_package.sh --architecture arm64|x64 [--output-dir <dir>] [--source-commit <sha>]" >&2
            exit 1
            ;;
    esac
done

case "$ARCH" in
    arm64|x64) ;;
    *)
        printf '%s\n' 'Architecture must be arm64 or x64.' >&2
        exit 1
        ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
# shellcheck source=scripts/portable_runtime.sh
source "$SCRIPT_DIR/portable_runtime.sh"

if [ -z "$OUTPUT_DIR" ]; then
    OUTPUT_DIR="$PROJECT_ROOT/dist"
fi
mkdir -p "$OUTPUT_DIR"
OUT="$(cd -- "$OUTPUT_DIR" && pwd -P)"

PACKAGE_NAME="antigravity2cn-macos-${ARCH}"
STAGE="$OUT/$PACKAGE_NAME"
ARCHIVE="$OUT/${PACKAGE_NAME}.zip"

if [ -e "$STAGE" ] || [ -L "$STAGE" ] || [ -e "$ARCHIVE" ] || [ -L "$ARCHIVE" ]; then
    printf '%s\n' 'Build output already exists. Choose a fresh output directory.' >&2
    exit 1
fi

mkdir -p "$STAGE"

# Explicit allowlist prevents tests, Windows files, credentials, caches or local configuration entering releases.
for rel_file in localization_engine.js README.md LICENSE install-cn.command restore-en.command update-cn.command; do
    if [ ! -f "$PROJECT_ROOT/$rel_file" ]; then
        printf '%s\n' "Missing required macOS package file: $rel_file" >&2
        exit 1
    fi
    cp "$PROJECT_ROOT/$rel_file" "$STAGE/$rel_file"
done

for rel_dir in src dicts; do
    if [ ! -d "$PROJECT_ROOT/$rel_dir" ]; then
        printf '%s\n' "Missing required macOS package directory: $rel_dir" >&2
        exit 1
    fi
    cp -R "$PROJECT_ROOT/$rel_dir" "$STAGE/$rel_dir"
done

mkdir -p "$STAGE/scripts"
for script_name in node-runtime.json portable_runtime.sh run_macos.sh self_update.js validate_dicts.js; do
    if [ ! -f "$SCRIPT_DIR/$script_name" ]; then
        printf '%s\n' "Missing required macOS script: scripts/$script_name" >&2
        exit 1
    fi
    cp "$SCRIPT_DIR/$script_name" "$STAGE/scripts/$script_name"
done

read_macos_runtime_spec "$PROJECT_ROOT" "$ARCH"
CACHED_DIR="$PROJECT_ROOT/.runtime/$_PR_SPEC_DIR"
if [ -e "$CACHED_DIR" ] || [ -L "$CACHED_DIR" ]; then
    CACHED_NODE="$(get_portable_node "$PROJECT_ROOT" "$ARCH" --offline)"
    STAGE_RUNTIME_DIR="$STAGE/.runtime/$_PR_SPEC_DIR"
    mkdir -p "$STAGE_RUNTIME_DIR"
    cp "$CACHED_NODE" "$STAGE_RUNTIME_DIR/node"
    cp "$(dirname "$CACHED_NODE")/LICENSE" "$STAGE_RUNTIME_DIR/LICENSE"
fi

STAGE_NODE="$(get_portable_node "$STAGE" "$ARCH")"

chmod 0755 \
    "$STAGE/install-cn.command" \
    "$STAGE/restore-en.command" \
    "$STAGE/update-cn.command" \
    "$STAGE/scripts/run_macos.sh" \
    "$STAGE/scripts/portable_runtime.sh" \
    "$STAGE_NODE"

PKG_VERSION="$("$_PR_AWK_BIN" '{ text = (NR == 1 ? $0 : text "\n" $0) } END { if (match(text, /"version"[ \t\r\n]*:[ \t\r\n]*"[0-9]+\.[0-9]+\.[0-9]+"/)) { s = substr(text, RSTART, RLENGTH); sub(/^.*"version"[ \t\r\n]*:[ \t\r\n]*"/, "", s); sub(/"$/, "", s); print s } }' "$PROJECT_ROOT/package.json")"
if ! printf '%s' "$PKG_VERSION" | "$_PR_AWK_BIN" 'BEGIN { ok = 0 } /^[0-9]+\.[0-9]+\.[0-9]+$/ { ok = 1 } END { exit (ok ? 0 : 1) }'; then
    printf '%s\n' "Missing or invalid version in package.json: $PKG_VERSION" >&2
    exit 1
fi

ESCAPED_COMMIT="$(printf '%s' "$SOURCE_COMMIT" | "$_PR_AWK_BIN" '{gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); printf "%s", $0}')"
cat > "$STAGE/build-info.json" <<EOF
{
  "platform": "macos",
  "architecture": "$ARCH",
  "version": "$PKG_VERSION",
  "launcherVersion": 1,
  "sourceCommit": "$ESCAPED_COMMIT",
  "nodeVersion": "$_PR_SPEC_VERSION"
}
EOF

(
    cd "$OUT"
    zip -r -X -q "${PACKAGE_NAME}.zip" "${PACKAGE_NAME}"
)

HASH="$(get_runtime_file_sha256 "$ARCHIVE")"
printf '%s  %s\n' "$HASH" "${PACKAGE_NAME}.zip" > "${ARCHIVE}.sha256"
printf '%s\n' "Created $ARCHIVE"

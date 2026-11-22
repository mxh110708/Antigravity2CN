#!/bin/bash
# Check the effective user before any external command or Node lookup.
if [ "$UID" -eq 0 ] || [ "$EUID" -eq 0 ]; then
    printf '%s\n' '[安全] macOS 不支持 root/sudo 执行。请使用当前用户拥有的应用副本。' >&2
    exit 1
fi
set -e

MODE="${1:-}"
case "$MODE" in
    install|restore|runtime) shift ;;
    *) printf '%s\n' 'Usage: run_macos.sh install|restore|runtime [engine arguments]' >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$SCRIPT_DIR"

# Keep portable runtime verification inside the project; never inherit external preload settings.
source "$SCRIPT_DIR/scripts/portable_runtime.sh"
if ! NODE_BIN="$(get_portable_node "$SCRIPT_DIR")"; then
    printf '%s\n' '[错误] 便携 Node.js 运行时准备或校验失败。' >&2
    printf '%s\n' '离线环境请使用 Releases 中的完整 macOS 发布包；源码包首次运行需能访问 nodejs.org。' >&2
    exit 1
fi

unset NODE_OPTIONS NODE_PATH

if [ "$MODE" = runtime ]; then
    exec "$NODE_BIN" --version
fi
if [ "$MODE" = restore ]; then
    exec "$NODE_BIN" "$SCRIPT_DIR/localization_engine.js" --huifu "$@"
fi
exec "$NODE_BIN" "$SCRIPT_DIR/localization_engine.js" "$@"

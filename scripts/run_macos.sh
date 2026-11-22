#!/bin/bash
# Check the effective user before any external command or Node lookup.
if [ "$UID" -eq 0 ] || [ "$EUID" -eq 0 ]; then
    printf '%s\n' '[安全] macOS 不支持 root/sudo 执行。请使用当前用户拥有的应用副本。' >&2
    exit 1
fi
set -e

MODE="${1:-}"
case "$MODE" in
    install|restore) shift ;;
    *) printf '%s\n' 'Usage: run_macos.sh install|restore [engine arguments]' >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$SCRIPT_DIR"

# Version managers are used only in this ordinary user session.
export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:$PATH"
for NODE_DIR in "$HOME/.volta/bin" "$HOME/.asdf/shims" "$HOME/.local/share/mise/shims" "$HOME/.local/bin" "$HOME/.fnm/current/bin" "$HOME/.local/share/fnm/aliases/default/bin" "$HOME/Library/Application Support/fnm/aliases/default/bin" "$HOME"/.nvm/versions/node/*/bin; do
    [ ! -d "$NODE_DIR" ] || export PATH="$NODE_DIR:$PATH"
done
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
    printf '%s\n' '[错误] 未找到 Node.js，请安装受支持版本后重试。' >&2
    exit 1
fi

if [ "$MODE" = restore ]; then
    exec "$NODE_BIN" "$SCRIPT_DIR/localization_engine.js" --huifu "$@"
fi
exec "$NODE_BIN" "$SCRIPT_DIR/localization_engine.js" --interactive "$@"

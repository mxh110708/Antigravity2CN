#!/bin/bash
if [ "$UID" -eq 0 ] || [ "$EUID" -eq 0 ]; then
    printf '%s\n' '[安全] macOS 不支持 root/sudo 执行。' >&2
    exit 1
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)" || exit 1
exec /bin/bash "$SCRIPT_DIR/scripts/run_macos.sh" restore "$@"
